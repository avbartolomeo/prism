import type { Result, McpServerConfig, McpTool } from '@prism/types'
import { ok, err } from '@prism/types'
import pino from 'pino'

/**
 * ToolRegistry — maintains the catalog of all tools from all MCP servers.
 */
export class ToolRegistry {
  private tools: McpTool[] = []
  private servers = new Map<string, McpServerConfig>()

  constructor(private logger: pino.Logger) {}

  /**
   * Register an MCP server and discover its tools.
   * In Phase 0, this is a placeholder — real MCP connection comes in Phase 1.
   */
  async registerServer(config: McpServerConfig): Promise<Result<void>> {
    try {
      this.servers.set(config.name, config)
      this.logger.info({ server: config.name }, 'Server registered')
      return ok(undefined)
    } catch (error) {
      return err(
        new Error(`Failed to register ${config.name}: ${error instanceof Error ? error.message : String(error)}`)
      )
    }
  }

  /**
   * Add a tool to the registry (called after MCP handshake).
   */
  addTool(tool: McpTool): void {
    this.tools.push(tool)
  }

  /**
   * Get all registered tools.
   */
  getAllTools(): McpTool[] {
    return [...this.tools]
  }

  /**
   * Get tools from a specific server.
   */
  getToolsByServer(serverName: string): McpTool[] {
    return this.tools.filter(t => t.serverName === serverName)
  }

  /**
   * Shutdown all server connections.
   */
  async shutdown(): Promise<void> {
    this.servers.clear()
    this.tools = []
  }
}
