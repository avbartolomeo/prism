import type { McpServerConfig, McpTool } from 'prism-mcp-types'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry } from './tool-registry'
import { ContextFilter } from './context-filter'
import { SchemaCompressor } from './schema-compressor'
import { TraceStore } from './trace-store'
import { ManagementTools } from './management-tools'
import crypto from 'crypto'
import pino from 'pino'

export interface PrismProxyConfig {
  servers: McpServerConfig[]
  maxTokenBudget: number
  logger?: pino.Logger
  tracePath?: string
  configPath?: string
}

/**
 * PrismProxy — MCP proxy that sits between an AI agent and MCP servers.
 *
 * Starts serving immediately. Connects to backend servers in background
 * so the agent doesn't timeout waiting. Tools appear progressively as
 * servers come online.
 */
export class PrismProxy {
  private logger: pino.Logger
  private registry: ToolRegistry
  private filter: ContextFilter
  private compressor: SchemaCompressor
  private mcpServer: Server
  private transport: StdioServerTransport | undefined
  private traceStore: TraceStore | undefined
  private management: ManagementTools
  private sessionId: string
  private connecting = false
  private serversReady = 0
  private serversTotal = 0

  constructor(private config: PrismProxyConfig) {
    this.logger = config.logger ?? pino({ name: 'prism-proxy' })
    this.registry = new ToolRegistry(this.logger)
    this.filter = new ContextFilter(config.maxTokenBudget, this.logger)
    this.compressor = new SchemaCompressor(this.logger)
    this.sessionId = crypto.randomUUID()

    if (config.tracePath) {
      this.traceStore = new TraceStore(config.tracePath, this.logger)
      this.logger.info({ tracePath: config.tracePath, sessionId: this.sessionId }, 'Trace store initialized')
    }

    this.management = new ManagementTools(
      this.registry,
      this.compressor,
      this.traceStore,
      this.sessionId,
      config.configPath,
      this.logger,
    )

    this.mcpServer = new Server(
      { name: 'prism-proxy', version: '0.2.0' },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.management.setToolsChangedCallback(async () => {
      try {
        await this.mcpServer.sendToolListChanged()
        this.logger.info('Sent tools/list_changed notification to agent')
      } catch (err) {
        this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to send tools/list_changed')
      }
    })

    this.setupHandlers()
  }

  /**
   * Connect to backend servers in background. Returns immediately.
   * Servers connect one at a time and tools appear as they come online.
   */
  startConnecting(): void {
    const enabled = this.config.servers.filter(s => s.enabled !== false)
    this.serversTotal = enabled.length
    this.connecting = true

    this.logger.info({ servers: enabled.length }, 'Connecting to backend servers in background')

    // Run in background — don't await
    this.connectServersSequentially(enabled).catch(err => {
      this.logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Background connection failed')
    })
  }

  private async connectServersSequentially(servers: McpServerConfig[]): Promise<void> {
    for (const server of servers) {
      try {
        const result = await this.registry.registerServer(server)
        if (result.ok) {
          // Compress new tools
          for (const tool of result.value) {
            tool.compressedDescription = this.compressor.compress(tool.description)
            tool.tokenCount = this.compressor.estimateTokens(tool.description)
          }
          this.serversReady++
          this.logger.info(
            { server: server.name, tools: result.value.length, progress: `${this.serversReady}/${this.serversTotal}` },
            'Server connected',
          )

          // Notify agent that new tools are available
          try {
            await this.mcpServer.sendToolListChanged()
          } catch { /* agent may not be connected yet */ }
        } else {
          this.serversReady++
          this.logger.warn({ server: server.name, error: result.error.message }, 'Failed to register server — skipping')
        }
      } catch (err) {
        this.serversReady++
        this.logger.warn(
          { server: server.name, error: err instanceof Error ? err.message : String(err) },
          'Failed to register server — skipping',
        )
      }
    }

    this.connecting = false
    const tools = this.registry.getAllTools()
    this.logger.info(
      { totalTools: tools.length, servers: this.serversReady },
      'All servers processed',
    )
  }

  /**
   * Start serving: accept agent connection via stdio.
   */
  async serve(): Promise<void> {
    this.transport = new StdioServerTransport()
    await this.mcpServer.connect(this.transport)
    this.logger.info('Prism proxy serving via stdio')
  }

  private setupHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = this.registry.getAllTools()
      const filtered = this.filter.select(allTools)

      const backendTools = filtered.map(tool => ({
        name: tool.name,
        description: tool.compressedDescription ?? tool.description,
        inputSchema: tool.inputSchema as {
          type: 'object'
          properties?: Record<string, object>
          required?: string[]
          [key: string]: unknown
        },
      }))

      const mgmtTools = this.management.getToolDefs()
      const tools = [...backendTools, ...mgmtTools]

      this.logger.info(
        { total: allTools.length, returned: backendTools.length, management: mgmtTools.length, connecting: this.connecting },
        'tools/list served',
      )

      return { tools }
    })

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (this.management.isManagementTool(name)) {
        this.logger.info({ tool: name }, 'Executing management tool')
        return this.management.execute(name, args ?? {})
      }

      const serverName = this.registry.findToolServer(name)

      if (!serverName) {
        const status = this.connecting ? ' (some servers still connecting)' : ''
        this.logger.warn({ tool: name }, 'Tool not found')
        return {
          content: [{ type: 'text' as const, text: `Error: tool "${name}" not found${status}` }],
          isError: true,
        }
      }

      this.logger.info({ tool: name, server: serverName }, 'Forwarding tool call')

      const startedAt = new Date()
      const result = await this.registry.callTool(serverName, name, args ?? {})
      const completedAt = new Date()
      const durationMs = completedAt.getTime() - startedAt.getTime()

      if (!result.ok) {
        this.logger.error({ tool: name, server: serverName, error: result.error.message }, 'Tool call failed')
        this.recordTrace(serverName, name, args ?? {}, null, startedAt, completedAt, durationMs, result.error.message)
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
          isError: true,
        }
      }

      const callResult = result.value as Record<string, unknown>
      const isError = callResult.isError as boolean | undefined

      this.recordTrace(
        serverName, name, args ?? {}, callResult,
        startedAt, completedAt, durationMs,
        isError ? 'Tool returned isError' : undefined,
      )

      this.checkForLoops()

      return {
        content: (callResult.content ?? [{ type: 'text', text: JSON.stringify(callResult) }]) as Array<{
          type: 'text'
          text: string
        }>,
        isError,
      }
    })
  }

  private recordTrace(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    startedAt: Date,
    completedAt: Date,
    durationMs: number,
    error?: string,
  ): void {
    if (!this.traceStore) return

    const inputStr = JSON.stringify(input)
    const outputStr = JSON.stringify(output)

    try {
      this.traceStore.insert({
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        serverName,
        toolName,
        input,
        output,
        startedAt,
        completedAt,
        durationMs,
        inputTokens: Math.ceil(inputStr.length / 4),
        outputTokens: Math.ceil(outputStr.length / 4),
        error,
      })
    } catch (err) {
      this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to record trace')
    }
  }

  private checkForLoops(): void {
    if (!this.traceStore) return

    const errorLoops = this.traceStore.detectErrorLoops(this.sessionId)
    if (errorLoops.length > 0) {
      this.logger.warn({ tools: errorLoops }, 'Error loop detected — tools failing repeatedly')
    }

    const callLoops = this.traceStore.detectCallLoops(this.sessionId)
    if (callLoops.length > 0) {
      this.logger.warn({ tools: callLoops }, 'Call loop detected — tools called repeatedly')
    }
  }

  getFilteredTools(context?: string): McpTool[] {
    const allTools = this.registry.getAllTools()
    return this.filter.select(allTools, context)
  }

  getAllTools(): McpTool[] {
    return this.registry.getAllTools()
  }

  getRegistry(): ToolRegistry {
    return this.registry
  }

  getTraceStore(): TraceStore | undefined {
    return this.traceStore
  }

  getSessionId(): string {
    return this.sessionId
  }

  async shutdown(): Promise<void> {
    await this.registry.shutdown()
    await this.mcpServer.close()
    this.traceStore?.close()
    this.logger.info('Prism proxy shutdown')
  }
}
