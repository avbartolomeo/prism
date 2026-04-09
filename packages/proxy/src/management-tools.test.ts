import { describe, it, expect, afterEach } from 'vitest'
import { PrismProxy } from './proxy'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import pino from 'pino'
import path from 'path'
import fs from 'fs'
import os from 'os'

const logger = pino({ level: 'silent' })
const mockServerPath = path.resolve(__dirname, 'test-helpers/mock-mcp-server.ts')

describe('ManagementTools', () => {
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

  async function setup(options: {
    tracePath?: string
    configPath?: string
  } = {}): Promise<Client> {
    const tracePath = options.tracePath ?? path.join(os.tmpdir(), `prism-test-${Date.now()}.db`)

    proxy = new PrismProxy({
      servers: [{ name: 'mock', command: 'npx', args: ['tsx', mockServerPath] }],
      maxTokenBudget: 8000,
      tracePath,
      configPath: options.configPath,
      logger,
    })

    await proxy.initialize()

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpServer = (proxy as unknown as { mcpServer: { connect: (t: InMemoryTransport) => Promise<void> } }).mcpServer
    await mcpServer.connect(serverTransport)

    client = new Client({ name: 'test-agent', version: '1.0.0' }, { capabilities: {} })
    await client.connect(clientTransport)

    return client
  }

  it('should include management tools in tools/list', async () => {
    await setup()

    const result = await client.listTools()
    const names = result.tools.map(t => t.name)

    expect(names).toContain('prism_list_servers')
    expect(names).toContain('prism_add_server')
    expect(names).toContain('prism_remove_server')
    expect(names).toContain('prism_get_traces')
    expect(names).toContain('prism_get_costs')
    expect(names).toContain('prism_detect_loops')
  })

  it('should list connected servers', async () => {
    await setup()

    const result = await client.callTool({ name: 'prism_list_servers', arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('mock')
    expect(text).toContain('echo')
    expect(text).toContain('add')
    expect(text).toContain('greet')
  })

  it('should add a new custom server dynamically', async () => {
    await setup()

    const result = await client.callTool({
      name: 'prism_add_server',
      arguments: {
        name: 'mock-2',
        command: 'npx',
        args: ['tsx', mockServerPath],
      },
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('mock-2')
    expect(text).toContain('connected')
    expect(text).toContain('3 tools')

    // Verify it appears in list
    const listResult = await client.callTool({ name: 'prism_list_servers', arguments: {} })
    const listText = (listResult.content as Array<{ type: string; text: string }>)[0].text
    expect(listText).toContain('mock-2')
  })

  it('should reject duplicate server names', async () => {
    await setup()

    const result = await client.callTool({
      name: 'prism_add_server',
      arguments: { name: 'mock', command: 'npx', args: ['tsx', mockServerPath] },
    })

    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('already exists')
  })

  it('should list available servers from registry', async () => {
    await setup()

    const result = await client.callTool({ name: 'prism_available_servers', arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('github')
    expect(text).toContain('fetch')
    expect(text).toContain('memory')
    expect(text).toContain('GITHUB_TOKEN')
  })

  it('should remove a server', async () => {
    await setup()

    const result = await client.callTool({
      name: 'prism_remove_server',
      arguments: { name: 'mock' },
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('disconnected')

    // Verify it's gone
    const listResult = await client.callTool({ name: 'prism_list_servers', arguments: {} })
    const listText = (listResult.content as Array<{ type: string; text: string }>)[0].text
    expect(listText).toContain('No MCP servers')
  })

  it('should reject removing nonexistent server', async () => {
    await setup()

    const result = await client.callTool({
      name: 'prism_remove_server',
      arguments: { name: 'nonexistent' },
    })

    expect(result.isError).toBe(true)
  })

  it('should get traces after tool calls', async () => {
    await setup()

    // Make some calls first
    await client.callTool({ name: 'echo', arguments: { message: 'test' } })
    await client.callTool({ name: 'add', arguments: { a: 1, b: 2 } })

    const result = await client.callTool({ name: 'prism_get_traces', arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('echo')
    expect(text).toContain('add')
    expect(text).toContain('tokens')
  })

  it('should filter traces by tool name', async () => {
    await setup()

    await client.callTool({ name: 'echo', arguments: { message: 'test' } })
    await client.callTool({ name: 'add', arguments: { a: 1, b: 2 } })

    const result = await client.callTool({
      name: 'prism_get_traces',
      arguments: { tool_name: 'echo' },
    })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('echo')
    expect(text).not.toContain('add (mock)')
  })

  it('should get cost summary for current session', async () => {
    await setup()

    await client.callTool({ name: 'echo', arguments: { message: 'test' } })

    const result = await client.callTool({ name: 'prism_get_costs', arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('Tool calls: 1')
    expect(text).toContain('tokens')
    expect(text).toContain('$')
  })

  it('should get costs for all sessions', async () => {
    await setup()

    await client.callTool({ name: 'echo', arguments: { message: 'test' } })

    const result = await client.callTool({
      name: 'prism_get_costs',
      arguments: { all_sessions: true },
    })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('Sessions')
  })

  it('should detect no loops when healthy', async () => {
    await setup()

    await client.callTool({ name: 'echo', arguments: { message: 'test' } })

    const result = await client.callTool({ name: 'prism_detect_loops', arguments: {} })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text

    expect(text).toContain('No loops detected')
  })

  it('should persist new server to config file', async () => {
    const configPath = path.join(os.tmpdir(), `prism-test-config-${Date.now()}.toml`)
    fs.writeFileSync(configPath, `[budget]\nmax_tokens = 8000\n\n[[servers]]\nname = "mock"\ncommand = "npx"\nargs = ["tsx", "${mockServerPath}"]\n`)

    try {
      await setup({ configPath })

      await client.callTool({
        name: 'prism_add_server',
        arguments: { name: 'mock-2', command: 'npx', args: ['tsx', mockServerPath] },
      })

      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).toContain('mock-2')
    } finally {
      try { fs.unlinkSync(configPath) } catch { /* ignore */ }
    }
  })

  it('should remove server from config file', async () => {
    const configPath = path.join(os.tmpdir(), `prism-test-config-${Date.now()}.toml`)
    fs.writeFileSync(configPath, `[budget]\nmax_tokens = 8000\n\n[[servers]]\nname = "mock"\ncommand = "npx"\nargs = ["tsx", "${mockServerPath}"]\n`)

    try {
      await setup({ configPath })

      await client.callTool({
        name: 'prism_remove_server',
        arguments: { name: 'mock' },
      })

      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).not.toContain('name = "mock"')
    } finally {
      try { fs.unlinkSync(configPath) } catch { /* ignore */ }
    }
  })
})
