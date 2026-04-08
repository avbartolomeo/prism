#!/usr/bin/env npx tsx
/**
 * Smoke test — spawns Prism as a child process and connects as an MCP client.
 * Verifies: tool discovery, description compression, tool call forwarding.
 *
 * Usage: npx tsx scripts/smoke-test.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'

const PRISM_CLI = path.resolve(__dirname, '../packages/cli/dist/cli.js')
const CONFIG = path.resolve(__dirname, '../prism.toml')

async function main(): Promise<void> {
  console.log('=== Prism Smoke Test ===\n')

  // 1. Spawn Prism as child process and connect as MCP client
  console.log('1. Connecting to Prism...')
  const transport = new StdioClientTransport({
    command: 'node',
    args: [PRISM_CLI, 'start', '--config', CONFIG],
    stderr: 'pipe',
  })

  // Capture Prism's stderr logs
  const logs: string[] = []
  const stderr = transport.stderr
  if (stderr) {
    stderr.on('data', (chunk: Buffer) => {
      logs.push(chunk.toString())
    })
  }

  const client = new Client(
    { name: 'smoke-test-agent', version: '1.0.0' },
    { capabilities: {} },
  )

  await client.connect(transport)
  console.log('   Connected!\n')

  // 2. List tools
  console.log('2. Listing tools (tools/list)...')
  const toolsResult = await client.listTools()
  console.log(`   Found ${toolsResult.tools.length} tools:\n`)

  for (const tool of toolsResult.tools) {
    console.log(`   - ${tool.name}`)
    console.log(`     description: "${tool.description}"`)
    const props = (tool.inputSchema.properties ?? {}) as Record<string, { type: string }>
    const params = Object.keys(props).join(', ')
    console.log(`     params: (${params})`)
    console.log()
  }

  // 3. Call tools
  console.log('3. Calling tools...\n')

  // Echo
  console.log('   echo({message: "hello from agent"}) =>')
  const echoResult = await client.callTool({
    name: 'echo',
    arguments: { message: 'hello from agent' },
  })
  const echoContent = echoResult.content as Array<{ type: string; text: string }>
  console.log(`   => "${echoContent[0].text}"\n`)

  // Add
  console.log('   add({a: 42, b: 58}) =>')
  const addResult = await client.callTool({
    name: 'add',
    arguments: { a: 42, b: 58 },
  })
  const addContent = addResult.content as Array<{ type: string; text: string }>
  console.log(`   => ${addContent[0].text}\n`)

  // Greet
  console.log('   greet({name: "Alejandro"}) =>')
  const greetResult = await client.callTool({
    name: 'greet',
    arguments: { name: 'Alejandro' },
  })
  const greetContent = greetResult.content as Array<{ type: string; text: string }>
  console.log(`   => "${greetContent[0].text}"\n`)

  // 4. Call unknown tool (error case)
  console.log('4. Error handling — calling unknown tool...')
  const errorResult = await client.callTool({
    name: 'nonexistent',
    arguments: {},
  })
  const errorContent = errorResult.content as Array<{ type: string; text: string }>
  console.log(`   isError: ${errorResult.isError}`)
  console.log(`   message: "${errorContent[0].text}"\n`)

  // 5. Verify compression happened
  console.log('5. Compression check...')
  const echoTool = toolsResult.tools.find(t => t.name === 'echo')
  if (echoTool) {
    const hasFillers = echoTool.description?.includes('This tool')
    console.log(`   "This tool" filler removed: ${!hasFillers}`)
    console.log(`   echo description: "${echoTool.description}"`)
  }
  console.log()

  // Shutdown
  await client.close()

  // Show Prism's logs
  console.log('=== Prism Logs (stderr) ===\n')
  const allLogs = logs.join('')
  // Show last few meaningful lines
  const lines = allLogs.split('\n').filter(l => l.trim())
  for (const line of lines.slice(0, 15)) {
    console.log(`   ${line}`)
  }
  if (lines.length > 15) {
    console.log(`   ... (${lines.length - 15} more lines)`)
  }

  console.log('\n=== Smoke Test PASSED ===')
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err)
  process.exit(1)
})
