import { describe, it, expect, afterEach } from 'vitest'
import { ToolRegistry } from './tool-registry'
import pino from 'pino'
import path from 'path'

const logger = pino({ level: 'silent' })

// Path to the mock server (run via tsx)
const mockServerPath = path.resolve(__dirname, 'test-helpers/mock-mcp-server.ts')

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  afterEach(async () => {
    if (registry) await registry.shutdown()
  })

  it('should connect to an MCP server and discover tools', async () => {
    registry = new ToolRegistry(logger)

    const result = await registry.registerServer({
      name: 'mock',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const tools = result.value
    expect(tools).toHaveLength(3)
    expect(tools.map(t => t.name).sort()).toEqual(['add', 'echo', 'greet'])
    expect(tools.every(t => t.serverName === 'mock')).toBe(true)
  })

  it('should call a tool on the connected server', async () => {
    registry = new ToolRegistry(logger)

    await registry.registerServer({
      name: 'mock',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    const result = await registry.callTool('mock', 'echo', { message: 'hello prism' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const callResult = result.value as { content: Array<{ type: string; text: string }> }
    expect(callResult.content[0].text).toBe('hello prism')
  })

  it('should call the add tool correctly', async () => {
    registry = new ToolRegistry(logger)

    await registry.registerServer({
      name: 'mock',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    const result = await registry.callTool('mock', 'add', { a: 3, b: 7 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const callResult = result.value as { content: Array<{ type: string; text: string }> }
    expect(callResult.content[0].text).toBe('10')
  })

  it('should register multiple servers', async () => {
    registry = new ToolRegistry(logger)

    await registry.registerServer({
      name: 'server-a',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    await registry.registerServer({
      name: 'server-b',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    const allTools = registry.getAllTools()
    expect(allTools).toHaveLength(6) // 3 from each

    const serverATools = registry.getToolsByServer('server-a')
    expect(serverATools).toHaveLength(3)

    const serverBTools = registry.getToolsByServer('server-b')
    expect(serverBTools).toHaveLength(3)
  })

  it('should find which server provides a tool', async () => {
    registry = new ToolRegistry(logger)

    await registry.registerServer({
      name: 'my-server',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    expect(registry.findToolServer('echo')).toBe('my-server')
    expect(registry.findToolServer('nonexistent')).toBeUndefined()
  })

  it('should return error for disconnected server', async () => {
    registry = new ToolRegistry(logger)

    const result = await registry.callTool('nonexistent', 'echo', {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Server not connected')
  })

  it('should return error for invalid server command', async () => {
    registry = new ToolRegistry(logger)

    const result = await registry.registerServer({
      name: 'bad-server',
      command: 'nonexistent-binary-xyz',
      args: [],
    })

    expect(result.ok).toBe(false)
  })

  it('should shutdown cleanly', async () => {
    registry = new ToolRegistry(logger)

    await registry.registerServer({
      name: 'mock',
      command: 'npx',
      args: ['tsx', mockServerPath],
    })

    expect(registry.getAllTools()).toHaveLength(3)

    await registry.shutdown()
    expect(registry.getAllTools()).toHaveLength(0)
  })
})
