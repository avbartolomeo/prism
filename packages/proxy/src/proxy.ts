import type { Result, McpServerConfig, McpTool } from '@prism/types'
import { ok } from '@prism/types'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry } from './tool-registry'
import { ContextFilter } from './context-filter'
import { SchemaCompressor } from './schema-compressor'
import pino from 'pino'

export interface PrismProxyConfig {
  servers: McpServerConfig[]
  maxTokenBudget: number
  logger?: pino.Logger
}

/**
 * PrismProxy — MCP proxy that sits between an AI agent and MCP servers.
 *
 * Acts as an MCP Server (agent connects via stdio) and as MCP Client
 * to each configured backend server. Filters and compresses tool schemas
 * to fit within a token budget.
 */
export class PrismProxy {
  private logger: pino.Logger
  private registry: ToolRegistry
  private filter: ContextFilter
  private compressor: SchemaCompressor
  private mcpServer: Server
  private transport: StdioServerTransport | undefined

  constructor(private config: PrismProxyConfig) {
    this.logger = config.logger ?? pino({ name: 'prism-proxy' })
    this.registry = new ToolRegistry(this.logger)
    this.filter = new ContextFilter(config.maxTokenBudget, this.logger)
    this.compressor = new SchemaCompressor(this.logger)

    this.mcpServer = new Server(
      { name: 'prism-proxy', version: '0.1.0' },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.setupHandlers()
  }

  /**
   * Initialize: connect to all backend MCP servers and build tool registry.
   */
  async initialize(): Promise<Result<void>> {
    this.logger.info({ servers: this.config.servers.length }, 'Initializing Prism proxy')

    for (const server of this.config.servers) {
      if (server.enabled === false) continue
      const result = await this.registry.registerServer(server)
      if (!result.ok) {
        this.logger.warn({ server: server.name, error: result.error.message }, 'Failed to register server')
      }
    }

    const tools = this.registry.getAllTools()
    this.logger.info({ totalTools: tools.length }, 'Tool registry built')

    // Compress all tool descriptions
    for (const tool of tools) {
      tool.compressedDescription = this.compressor.compress(tool.description)
      tool.tokenCount = this.compressor.estimateTokens(tool.description)
    }

    return ok(undefined)
  }

  /**
   * Start serving: accept agent connection via stdio.
   */
  async serve(): Promise<void> {
    this.transport = new StdioServerTransport()
    await this.mcpServer.connect(this.transport)
    this.logger.info('Prism proxy serving via stdio')
  }

  /**
   * Set up MCP request handlers for tools/list and tools/call.
   */
  private setupHandlers(): void {
    // Handle tools/list — return filtered + compressed tools
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = this.registry.getAllTools()
      const filtered = this.filter.select(allTools)

      const tools = filtered.map(tool => ({
        name: tool.name,
        description: tool.compressedDescription ?? tool.description,
        inputSchema: tool.inputSchema as {
          type: 'object'
          properties?: Record<string, object>
          required?: string[]
          [key: string]: unknown
        },
      }))

      this.logger.info(
        { total: allTools.length, returned: tools.length },
        'tools/list served',
      )

      return { tools }
    })

    // Handle tools/call — route to the correct backend server
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const serverName = this.registry.findToolServer(name)

      if (!serverName) {
        this.logger.warn({ tool: name }, 'Tool not found')
        return {
          content: [{ type: 'text' as const, text: `Error: tool "${name}" not found` }],
          isError: true,
        }
      }

      this.logger.info({ tool: name, server: serverName }, 'Forwarding tool call')

      const result = await this.registry.callTool(serverName, name, args ?? {})

      if (!result.ok) {
        this.logger.error({ tool: name, server: serverName, error: result.error.message }, 'Tool call failed')
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
          isError: true,
        }
      }

      // Forward the result as-is from the backend server
      const callResult = result.value as Record<string, unknown>
      return {
        content: (callResult.content ?? [{ type: 'text', text: JSON.stringify(callResult) }]) as Array<{
          type: 'text'
          text: string
        }>,
        isError: callResult.isError as boolean | undefined,
      }
    })
  }

  /**
   * Get filtered tools that fit within the token budget.
   */
  getFilteredTools(context?: string): McpTool[] {
    const allTools = this.registry.getAllTools()
    return this.filter.select(allTools, context)
  }

  /**
   * Get all tools without filtering (for dashboard/debug).
   */
  getAllTools(): McpTool[] {
    return this.registry.getAllTools()
  }

  /**
   * Get the tool registry (for testing).
   */
  getRegistry(): ToolRegistry {
    return this.registry
  }

  /**
   * Shutdown all MCP server connections and the proxy server.
   */
  async shutdown(): Promise<void> {
    await this.registry.shutdown()
    await this.mcpServer.close()
    this.logger.info('Prism proxy shutdown')
  }
}
