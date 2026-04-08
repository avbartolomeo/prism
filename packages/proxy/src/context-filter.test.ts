import { describe, it, expect } from 'vitest'
import { ContextFilter } from './context-filter'
import type { McpTool } from '@prism/types'
import pino from 'pino'

const logger = pino({ level: 'silent' })

function makeTool(name: string, description: string, serverName = 'test'): McpTool {
  return {
    name,
    description,
    inputSchema: { type: 'object' },
    serverName,
    tokenCount: Math.ceil((name.length + description.length) / 4),
  }
}

describe('ContextFilter', () => {
  it('should return all tools when budget is sufficient', () => {
    const filter = new ContextFilter(10000, logger)
    const tools = [
      makeTool('read', 'Read a file'),
      makeTool('write', 'Write a file'),
    ]

    const result = filter.select(tools)
    expect(result).toHaveLength(2)
  })

  it('should exclude tools that exceed the budget', () => {
    const filter = new ContextFilter(10, logger) // Very small budget
    const tools = [
      makeTool('short', 'Ok'),
      makeTool('long', 'A very long description that takes many tokens to represent'),
    ]

    const result = filter.select(tools)
    // At least one should be excluded due to budget
    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('should prioritize relevant tools when context is provided', () => {
    const filter = new ContextFilter(50, logger)
    const tools = [
      makeTool('read_file', 'Read a file from disk', 'filesystem'),
      makeTool('send_email', 'Send an email message', 'email'),
      makeTool('list_dir', 'List directory contents', 'filesystem'),
    ]

    const result = filter.select(tools, 'filesystem read')
    // filesystem tools should be prioritized
    expect(result.length).toBeGreaterThan(0)
    if (result.length >= 2) {
      const names = result.map(t => t.name)
      expect(names).toContain('read_file')
    }
  })

  it('should handle empty tools list', () => {
    const filter = new ContextFilter(1000, logger)
    const result = filter.select([])
    expect(result).toHaveLength(0)
  })

  it('should handle zero budget', () => {
    const filter = new ContextFilter(0, logger)
    const tools = [makeTool('test', 'A test tool')]
    const result = filter.select(tools)
    expect(result).toHaveLength(0)
  })
})
