import type { McpServerConfig } from 'prism-mcp-types'
import { ToolRegistry } from './tool-registry'
import { TraceStore } from './trace-store'
import { SchemaCompressor } from './schema-compressor'
import { KNOWN_SERVERS, findKnownServer } from './server-registry'
import { VERSION } from './version'
import fs from 'fs'
import pino from 'pino'

/**
 * Tool definition for MCP tools/list response.
 */
export interface ManagementToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
  }
}

/**
 * ManagementTools — Prism's own tools exposed to the agent for self-management
 * and introspection. These appear alongside backend server tools in tools/list.
 */
export class ManagementTools {
  private onToolsChanged: (() => Promise<void>) | undefined

  constructor(
    private registry: ToolRegistry,
    private compressor: SchemaCompressor,
    private traceStore: TraceStore | undefined,
    private sessionId: string,
    private configPath: string | undefined,
    private logger: pino.Logger,
  ) {}

  /**
   * Set callback to notify the agent that the tool list changed.
   * Called after add/remove server so the agent re-fetches tools/list.
   */
  setToolsChangedCallback(cb: () => Promise<void>): void {
    this.onToolsChanged = cb
  }

  /**
   * Get all management tool definitions.
   */
  getToolDefs(): ManagementToolDef[] {
    return [
      {
        name: 'prism_list_servers',
        description: 'List all MCP servers currently connected through Prism with their tools. No files to edit — everything is managed through these tools.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'prism_available_servers',
        description: 'Show MCP servers available to add. Each entry shows the server name, what it does, and what API keys it needs. Use prism_add_server to add one.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'prism_add_server',
        description: 'Add an MCP server by name. For known servers (github, fetch, memory, etc.) just pass the name. For servers needing API keys, pass them in env. For custom servers, pass name + command + args. Do NOT create or edit any config files — this tool handles everything. After adding, tell the user to type /mcp to refresh.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Server name (e.g. "github", "fetch", "memory") or custom name' },
            command: { type: 'string', description: 'Only for custom servers not in registry' },
            args: { type: 'array', items: { type: 'string' }, description: 'Only for custom servers not in registry' },
            env: {
              type: 'object',
              description: 'API keys the server needs (e.g. {"GITHUB_TOKEN": "ghp_..."}). Pass directly — do NOT use .env files.',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'prism_remove_server',
        description: 'Disconnect and remove an MCP server from Prism. Do NOT edit config files manually — this tool handles everything.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Server name to remove' },
          },
          required: ['name'],
        },
      },
      {
        name: 'prism_get_traces',
        description: 'Get recent tool call traces for this session. Shows what tools were called, timing, tokens, and errors.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max traces to return (default 20)' },
            tool_name: { type: 'string', description: 'Filter by tool name' },
          },
        },
      },
      {
        name: 'prism_get_costs',
        description: 'Get token usage summary for the current session or all sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            all_sessions: { type: 'boolean', description: 'Show all sessions (default: current only)' },
          },
        },
      },
      {
        name: 'prism_detect_loops',
        description: 'Check if any tools are being called repeatedly or failing in loops.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'prism_version',
        description: 'Show the current Prism version and status.',
        inputSchema: { type: 'object' },
      },
    ]
  }

  /**
   * Check if a tool name is a management tool.
   */
  isManagementTool(name: string): boolean {
    return name.startsWith('prism_')
  }

  /**
   * Execute a management tool.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      switch (name) {
        case 'prism_list_servers':
          return this.listServers()
        case 'prism_available_servers':
          return this.availableServers()
        case 'prism_add_server':
          return await this.addServer(args)
        case 'prism_remove_server':
          return await this.removeServer(args)
        case 'prism_get_traces':
          return this.getTraces(args)
        case 'prism_get_costs':
          return this.getCosts(args)
        case 'prism_detect_loops':
          return this.detectLoops()
        case 'prism_version':
          return this.version()
        default:
          return { content: [{ type: 'text', text: `Unknown management tool: ${name}` }], isError: true }
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  }

  private listServers(): { content: Array<{ type: 'text'; text: string }> } {
    const allTools = this.registry.getAllTools()
    const serverMap = new Map<string, string[]>()

    for (const tool of allTools) {
      const existing = serverMap.get(tool.serverName) ?? []
      existing.push(tool.name)
      serverMap.set(tool.serverName, existing)
    }

    if (serverMap.size === 0) {
      return { content: [{ type: 'text', text: 'No MCP servers connected.' }] }
    }

    const lines: string[] = [`Connected servers: ${serverMap.size}\n`]
    for (const [server, tools] of serverMap) {
      lines.push(`## ${server}`)
      lines.push(`Tools (${tools.length}): ${tools.join(', ')}\n`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  private availableServers(): { content: Array<{ type: 'text'; text: string }> } {
    const connected = new Set(this.registry.getAllTools().map(t => t.serverName))
    const lines: string[] = ['Available MCP servers:\n']

    for (const s of KNOWN_SERVERS) {
      const status = connected.has(s.name) ? ' (already connected)' : ''
      const keys = s.envKeys.length > 0 ? ` [needs: ${s.envKeys.join(', ')}]` : ''
      lines.push(`- **${s.name}**: ${s.description}${keys}${status}`)
    }

    lines.push('\nTo add one, use prism_add_server with the name.')
    lines.push('For servers that need API keys, ask the user for the key and pass it in the env parameter.')

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  private async addServer(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const name = args.name as string
    const customCommand = args.command as string | undefined
    const customArgs = args.args as string[] | undefined
    const env = (args.env as Record<string, string>) ?? undefined

    if (!name) {
      return { content: [{ type: 'text', text: 'Error: name is required. Use prism_available_servers to see options.' }], isError: true }
    }

    // Check if already connected
    if (this.registry.getToolsByServer(name).length > 0) {
      return { content: [{ type: 'text', text: `Error: server "${name}" already exists.` }], isError: true }
    }

    // Look up in registry, fall back to custom command/args
    const known = findKnownServer(name)
    let serverCommand: string
    let serverArgs: string[]

    if (known) {
      serverCommand = known.command
      serverArgs = known.args

      // Check required env keys
      const missingKeys = known.envKeys.filter(k => !env?.[k] && !process.env[k])
      if (missingKeys.length > 0) {
        return {
          content: [{
            type: 'text',
            text: `Server "${name}" needs these API keys: ${missingKeys.join(', ')}\n\nAsk the user for ${missingKeys.length === 1 ? 'the key' : 'the keys'} and call prism_add_server again with env: {${missingKeys.map(k => `"${k}": "..."`).join(', ')}}`,
          }],
          isError: true,
        }
      }
    } else if (customCommand) {
      serverCommand = customCommand
      serverArgs = customArgs ?? []
    } else {
      return {
        content: [{
          type: 'text',
          text: `Server "${name}" is not in the registry. Provide command and args to add a custom server, or use prism_available_servers to see known servers.`,
        }],
        isError: true,
      }
    }

    const config: McpServerConfig = {
      name,
      command: serverCommand,
      args: serverArgs,
      env,
      enabled: true,
    }

    // Connect to the new server
    const result = await this.registry.registerServer(config)
    if (!result.ok) {
      return { content: [{ type: 'text', text: `Failed to connect: ${result.error.message}` }], isError: true }
    }

    // Compress new tools
    for (const tool of result.value) {
      tool.compressedDescription = this.compressor.compress(tool.description)
      tool.tokenCount = this.compressor.estimateTokens(tool.description)
    }

    // Persist to config
    this.persistServerToConfig(config)

    const toolNames = result.value.map(t => t.name)
    this.logger.info({ server: name, tools: toolNames.length }, 'Server added via management tool')

    // Notify the agent that tools changed
    if (this.onToolsChanged) {
      await this.onToolsChanged()
    }

    return {
      content: [{
        type: 'text',
        text: `Server "${name}" connected. Discovered ${toolNames.length} tools: ${toolNames.join(', ')}\n\nIMPORTANT: Tell the user to type /mcp in Claude Code to refresh the tool list and make the new tools available.`,
      }],
    }
  }

  private async removeServer(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const name = args.name as string
    if (!name) {
      return { content: [{ type: 'text', text: 'Error: name is required' }], isError: true }
    }

    const tools = this.registry.getToolsByServer(name)
    if (tools.length === 0) {
      return { content: [{ type: 'text', text: `Error: server "${name}" not found` }], isError: true }
    }

    await this.registry.disconnectServer(name)

    // Remove from config
    this.removeServerFromConfig(name)

    this.logger.info({ server: name }, 'Server removed via management tool')

    // Notify the agent that tools changed
    if (this.onToolsChanged) {
      await this.onToolsChanged()
    }

    return {
      content: [{ type: 'text', text: `Server "${name}" disconnected and removed.` }],
    }
  }

  private getTraces(
    args: Record<string, unknown>,
  ): { content: Array<{ type: 'text'; text: string }> } {
    if (!this.traceStore) {
      return { content: [{ type: 'text', text: 'Tracing not enabled (no tracePath configured).' }] }
    }

    const limit = (args.limit as number) ?? 20
    const toolName = args.tool_name as string | undefined

    let traces = this.traceStore.getBySession(this.sessionId)

    if (toolName) {
      traces = traces.filter(t => t.toolName === toolName)
    }

    // Take most recent
    traces = traces.slice(-limit)

    if (traces.length === 0) {
      return { content: [{ type: 'text', text: 'No traces found for this session.' }] }
    }

    const lines: string[] = [`Traces (${traces.length}):\n`]
    for (const t of traces) {
      const status = t.error ? `ERROR: ${t.error}` : 'ok'
      const tokens = t.inputTokens + t.outputTokens
      lines.push(`- ${t.toolName} (${t.serverName}) | ${t.durationMs}ms | ${tokens} tokens | ${status}`)
    }

    const totalTokens = traces.reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0)
    const totalErrors = traces.filter(t => t.error).length
    lines.push(`\nTotal: ${totalTokens} tokens, ${totalErrors} errors`)

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  private getCosts(
    args: Record<string, unknown>,
  ): { content: Array<{ type: 'text'; text: string }> } {
    if (!this.traceStore) {
      return { content: [{ type: 'text', text: 'Tracing not enabled (no tracePath configured).' }] }
    }

    const allSessions = args.all_sessions as boolean | undefined

    if (allSessions) {
      const sessions = this.traceStore.getAllSessions(20)
      if (sessions.length === 0) {
        return { content: [{ type: 'text', text: 'No sessions found.' }] }
      }

      const lines: string[] = [`Sessions (${sessions.length}):\n`]
      for (const s of sessions) {
        lines.push(`- ${s.id.slice(0, 8)}... | ${s.toolCalls} calls | ${s.totalTokens} tokens | $${s.totalCostUsd.toFixed(4)} | ${s.errors} errors`)
      }

      const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0)
      const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0)
      lines.push(`\nTotal across sessions: ${totalTokens} tokens, $${totalCost.toFixed(4)} USD`)

      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    // Current session only
    const summary = this.traceStore.getSessionSummary(this.sessionId)
    if (!summary) {
      return { content: [{ type: 'text', text: 'No data for current session yet.' }] }
    }

    const lines = [
      `Current session: ${this.sessionId.slice(0, 8)}...`,
      `Tool calls: ${summary.toolCalls}`,
      `Total tokens: ${summary.totalTokens}`,
      `Estimated cost: $${summary.totalCostUsd.toFixed(4)} USD`,
      `Errors: ${summary.errors}`,
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  private detectLoops(): { content: Array<{ type: 'text'; text: string }> } {
    if (!this.traceStore) {
      return { content: [{ type: 'text', text: 'Tracing not enabled (no tracePath configured).' }] }
    }

    const errorLoops = this.traceStore.detectErrorLoops(this.sessionId)
    const callLoops = this.traceStore.detectCallLoops(this.sessionId)

    if (errorLoops.length === 0 && callLoops.length === 0) {
      return { content: [{ type: 'text', text: 'No loops detected. Everything looks healthy.' }] }
    }

    const lines: string[] = []
    if (errorLoops.length > 0) {
      lines.push(`Error loops (tools failing repeatedly): ${errorLoops.join(', ')}`)
    }
    if (callLoops.length > 0) {
      lines.push(`Call loops (tools called excessively): ${callLoops.join(', ')}`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  private version(): { content: Array<{ type: 'text'; text: string }> } {
    const serverCount = new Set(this.registry.getAllTools().map(t => t.serverName)).size
    const toolCount = this.registry.getAllTools().length

    const lines = [
      'Prism MCP Context Router',
      `Version: ${VERSION}`,
      `Session: ${this.sessionId.slice(0, 8)}`,
      `Servers: ${serverCount} connected`,
      `Tools: ${toolCount} discovered`,
      `Tracing: ${this.traceStore ? 'enabled' : 'disabled'}`,
      '',
      'GitHub: github.com/avbartolomeo/prism',
      'npm: npmjs.com/package/prism-mcp',
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  /**
   * Append a server to the TOML config file.
   */
  private persistServerToConfig(config: McpServerConfig): void {
    if (!this.configPath) return

    try {
      let content = fs.readFileSync(this.configPath, 'utf-8')

      const lines = [
        '',
        '[[servers]]',
        `name = "${config.name}"`,
        `command = "${config.command}"`,
      ]

      if (config.args && config.args.length > 0) {
        lines.push(`args = [${config.args.map(a => `"${a}"`).join(', ')}]`)
      }

      if (config.env && Object.keys(config.env).length > 0) {
        const envParts = Object.entries(config.env).map(([k, v]) => `${k} = "${v}"`)
        lines.push(`env = { ${envParts.join(', ')} }`)
      }

      content += lines.join('\n') + '\n'
      fs.writeFileSync(this.configPath, content)
      this.logger.debug({ server: config.name }, 'Server persisted to config')
    } catch (error) {
      this.logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to persist server to config')
    }
  }

  /**
   * Remove a server from the TOML config file.
   */
  private removeServerFromConfig(name: string): void {
    if (!this.configPath) return

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8')
      const lines = content.split('\n')
      const result: string[] = []
      let skipping = false

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.trim() === '[[servers]]') {
          // Look ahead to see if this is the server we want to remove
          const nameLineIdx = lines.findIndex((l, j) => j > i && j < i + 10 && l.trim().startsWith('name') && l.includes(`"${name}"`))
          if (nameLineIdx !== -1) {
            skipping = true
            continue
          }
        }

        if (skipping) {
          // Stop skipping at the next section or end
          if (line.trim().startsWith('[[') || line.trim().startsWith('[') && !line.trim().startsWith('[[')) {
            skipping = false
          } else {
            continue
          }
        }

        result.push(line)
      }

      fs.writeFileSync(this.configPath, result.join('\n'))
      this.logger.debug({ server: name }, 'Server removed from config')
    } catch (error) {
      this.logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove server from config')
    }
  }

}
