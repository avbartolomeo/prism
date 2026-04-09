import type { Result, McpServerConfig, McpTool } from 'prism-mcp-types'
import { ok, err } from 'prism-mcp-types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import pino from 'pino'

interface ConnectedServer {
  config: McpServerConfig
  client: Client
  transport: StdioClientTransport
}

/**
 * ToolRegistry — spawns MCP servers as child processes, performs handshake,
 * discovers tools, and maintains the catalog.
 */
export class ToolRegistry {
  private tools: McpTool[] = []
  private connections = new Map<string, ConnectedServer>()

  constructor(private logger: pino.Logger) {}

  /**
   * Connect to an MCP server via stdio, perform handshake, and discover its tools.
   */
  async registerServer(config: McpServerConfig): Promise<Result<McpTool[]>> {
    try {
      this.logger.info({ server: config.name, command: config.command, args: config.args }, 'Connecting to MCP server')

      // Always pass full process.env so .env vars (loaded by dotenv) reach child processes.
      // Server-specific env from TOML overrides process.env.
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        stderr: 'pipe',
      })

      const client = new Client(
        { name: 'prism-proxy', version: '0.1.0' },
        { capabilities: {} },
      )

      // Connect and perform handshake
      await client.connect(transport)

      this.logger.info({ server: config.name }, 'MCP handshake complete')

      // Discover tools
      const toolsResult = await client.listTools()
      const discovered: McpTool[] = toolsResult.tools.map(t => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
        serverName: config.name,
      }))

      this.tools.push(...discovered)
      this.connections.set(config.name, { config, client, transport })

      this.logger.info(
        { server: config.name, tools: discovered.length, toolNames: discovered.map(t => t.name) },
        'Tools discovered',
      )

      return ok(discovered)
    } catch (error) {
      return err(
        new Error(`Failed to connect to ${config.name}: ${error instanceof Error ? error.message : String(error)}`)
      )
    }
  }

  /**
   * Call a tool on the appropriate MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Result<unknown>> {
    const connection = this.connections.get(serverName)
    if (!connection) {
      return err(new Error(`Server not connected: ${serverName}`))
    }

    try {
      const result = await connection.client.callTool({ name: toolName, arguments: args })
      return ok(result)
    } catch (error) {
      return err(
        new Error(`Tool call failed (${serverName}/${toolName}): ${error instanceof Error ? error.message : String(error)}`)
      )
    }
  }

  /**
   * Get the MCP Client for a specific server (for advanced forwarding).
   */
  getClient(serverName: string): Client | undefined {
    return this.connections.get(serverName)?.client
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
   * Find which server provides a given tool.
   */
  findToolServer(toolName: string): string | undefined {
    return this.tools.find(t => t.name === toolName)?.serverName
  }

  /**
   * Disconnect and remove a single server.
   */
  async disconnectServer(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName)
    if (conn) {
      try {
        await conn.client.close()
      } catch (error) {
        this.logger.warn(
          { server: serverName, error: error instanceof Error ? error.message : String(error) },
          'Error closing server connection',
        )
      }
      this.connections.delete(serverName)
    }
    this.tools = this.tools.filter(t => t.serverName !== serverName)
  }

  /**
   * Shutdown all server connections.
   */
  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close()
        this.logger.info({ server: name }, 'Server connection closed')
      } catch (error) {
        this.logger.warn(
          { server: name, error: error instanceof Error ? error.message : String(error) },
          'Error closing server connection',
        )
      }
    }
    this.connections.clear()
    this.tools = []
  }
}
