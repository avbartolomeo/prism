import { describe, it, expect, afterEach } from 'vitest'
import { PrismProxy } from './proxy'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import pino from 'pino'
import path from 'path'

const logger = pino({ level: 'silent' })
const mockServerPath = path.resolve(__dirname, 'test-helpers/mock-mcp-server.ts')

describe('PrismProxy', () => {
  let proxy: PrismProxy
  let client: Client

  afterEach(async () => {
    if (client) {
      try { await client.close() } catch { /* ignore */ }
    }
    if (proxy) {
      try { await proxy.shutdown() } catch { /* ignore */ }
    }
  })

  async function setupProxy(
    budget = 8000,
    servers = [{ name: 'mock', command: 'npx', args: ['tsx', mockServerPath] }],
  ): Promise<Client> {
    proxy = new PrismProxy({
      servers,
      maxTokenBudget: budget,
      logger,
    })

    await proxy.initialize()

    // Connect a client to the proxy via InMemoryTransport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    // Access the internal MCP server to connect the transport
    // We use a workaround: connect the server transport directly
    const mcpServer = (proxy as unknown as { mcpServer: { connect: (t: InMemoryTransport) => Promise<void> } }).mcpServer
    await mcpServer.connect(serverTransport)

    client = new Client({ name: 'test-agent', version: '1.0.0' }, { capabilities: {} })
    await client.connect(clientTransport)

    return client
  }

  it('should list tools from backend servers', async () => {
    await setupProxy()

    const result = await client.listTools()
    expect(result.tools.length).toBeGreaterThan(0)

    const toolNames = result.tools.map(t => t.name)
    expect(toolNames).toContain('echo')
    expect(toolNames).toContain('add')
    expect(toolNames).toContain('greet')
  })

  it('should compress tool descriptions', async () => {
    await setupProxy()

    const result = await client.listTools()
    const echoTool = result.tools.find(t => t.name === 'echo')

    // "This tool echoes back..." should have "This tool" removed
    expect(echoTool?.description).not.toContain('This tool')
  })

  it('should forward tool calls to the correct backend', async () => {
    await setupProxy()

    const result = await client.callTool({ name: 'echo', arguments: { message: 'hello from agent' } })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].text).toBe('hello from agent')
  })

  it('should forward add tool calls', async () => {
    await setupProxy()

    const result = await client.callTool({ name: 'add', arguments: { a: 5, b: 3 } })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].text).toBe('8')
  })

  it('should return error for unknown tools', async () => {
    await setupProxy()

    const result = await client.callTool({ name: 'nonexistent', arguments: {} })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].text).toContain('not found')
  })

  it('should filter tools by token budget', async () => {
    // Very small budget — should exclude some backend tools
    await setupProxy(50)

    const result = await client.listTools()
    // 6 management tools are always included, backend tools are filtered by budget
    const mgmtCount = result.tools.filter(t => t.name.startsWith('prism_')).length
    const backendCount = result.tools.length - mgmtCount
    expect(mgmtCount).toBe(8)
    expect(backendCount).toBeLessThan(3)
  })

  it('should aggregate tools from multiple servers', async () => {
    await setupProxy(8000, [
      { name: 'server-a', command: 'npx', args: ['tsx', mockServerPath] },
      { name: 'server-b', command: 'npx', args: ['tsx', mockServerPath] },
    ])

    const allTools = proxy.getAllTools()
    expect(allTools).toHaveLength(6)

    // Both servers' tools should be callable
    const resultA = await client.callTool({ name: 'echo', arguments: { message: 'test' } })
    const content = resultA.content as Array<{ type: string; text: string }>
    expect(content[0].text).toBe('test')
  })

  it('should provide getFilteredTools for dashboard/debug', async () => {
    await setupProxy()

    const filtered = proxy.getFilteredTools()
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(t => t.serverName === 'mock')).toBe(true)
  })

  it('should provide getAllTools for dashboard/debug', async () => {
    await setupProxy()

    const all = proxy.getAllTools()
    expect(all).toHaveLength(3)
  })
})
