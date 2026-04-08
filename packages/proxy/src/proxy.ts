import type { Result, McpServerConfig, McpTool } from '@prism/types'
import { ok } from '@prism/types'
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
 * PrismProxy — the core MCP proxy.
 * Sits between an AI agent and MCP servers, filtering and compressing
 * tool schemas to fit within a token budget.
 */
export class PrismProxy {
  private logger: pino.Logger
  private registry: ToolRegistry
  private filter: ContextFilter
  private compressor: SchemaCompressor

  constructor(private config: PrismProxyConfig) {
    this.logger = config.logger ?? pino({ name: 'prism-proxy' })
    this.registry = new ToolRegistry(this.logger)
    this.filter = new ContextFilter(config.maxTokenBudget, this.logger)
    this.compressor = new SchemaCompressor(this.logger)
  }

  /**
   * Initialize: connect to all MCP servers and build tool registry.
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
   * Get filtered tools that fit within the token budget.
   * This is the main function — called when an agent requests tool list.
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
   * Shutdown all MCP server connections.
   */
  async shutdown(): Promise<void> {
    await this.registry.shutdown()
    this.logger.info('Prism proxy shutdown')
  }
}
