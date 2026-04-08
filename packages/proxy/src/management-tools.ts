import type { McpServerConfig } from 'prism-mcp-types'
import { ToolRegistry } from './tool-registry'
import { TraceStore } from './trace-store'
import { SchemaCompressor } from './schema-compressor'
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
        description: 'List all MCP servers connected through Prism, with their tools and status.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'prism_add_server',
        description: 'Add a new MCP server to Prism. Connects immediately and persists to config.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique server name' },
            command: { type: 'string', description: 'Command to spawn the server (e.g. "npx")' },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command arguments (e.g. ["@modelcontextprotocol/server-filesystem", "/home/user"])',
            },
            env: {
              type: 'object',
              description: 'Environment variables (e.g. {"GITHUB_TOKEN": "ghp_..."})',
            },
          },
          required: ['name', 'command'],
        },
      },
      {
        name: 'prism_remove_server',
        description: 'Disconnect and remove an MCP server from Prism. Persists to config.',
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
        description: 'Get recent tool call traces. Shows what tools were called, timing, tokens, and errors.',
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
        description: 'Get token usage and cost summary for the current session or all sessions.',
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

  private async addServer(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const name = args.name as string
    const command = args.command as string
    const serverArgs = (args.args as string[]) ?? []
    const env = (args.env as Record<string, string>) ?? undefined

    if (!name || !command) {
      return { content: [{ type: 'text', text: 'Error: name and command are required' }], isError: true }
    }

    // Check if already exists
    if (this.registry.getToolsByServer(name).length > 0) {
      return { content: [{ type: 'text', text: `Error: server "${name}" already exists` }], isError: true }
    }

    const config: McpServerConfig = { name, command, args: serverArgs, env, enabled: true }

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

    // Notify the agent that tools changed — triggers re-fetch of tools/list
    if (this.onToolsChanged) {
      await this.onToolsChanged()
    }

    return {
      content: [{
        type: 'text',
        text: `Server "${name}" connected. Discovered ${toolNames.length} tools: ${toolNames.join(', ')}`,
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
