#!/usr/bin/env node
/**
 * Mock MCP server for integration tests.
 * Spawnable as a child process, communicates via stdio.
 * Exposes 3 tools: echo, add, greet.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'mock-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'This tool echoes back the input message. Use this to test connectivity.',
      inputSchema: {
        type: 'object' as const,
        properties: { message: { type: 'string', description: 'Message to echo' } },
        required: ['message'],
      },
    },
    {
      name: 'add',
      description: 'Provides the ability to add two numbers together and returns the result.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
    },
    {
      name: 'greet',
      description: 'Can be used to generate a greeting for a person by name. When called, it produces a friendly hello message.',
      inputSchema: {
        type: 'object' as const,
        properties: { name: { type: 'string', description: 'Name to greet' } },
        required: ['name'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'echo':
      return {
        content: [{ type: 'text' as const, text: String(args?.message ?? '') }],
      }
    case 'add':
      return {
        content: [{ type: 'text' as const, text: String(Number(args?.a ?? 0) + Number(args?.b ?? 0)) }],
      }
    case 'greet':
      return {
        content: [{ type: 'text' as const, text: `Hello, ${String(args?.name ?? 'World')}!` }],
      }
    default:
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      }
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  process.stderr.write(`Mock server error: ${error}\n`)
  process.exit(1)
})
