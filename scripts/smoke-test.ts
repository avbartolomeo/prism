#!/usr/bin/env npx tsx
/**
 * Smoke test — spawns Prism as a child process and connects as an MCP client.
 * Verifies: tool discovery, compression, forwarding, tracing, dashboard API.
 *
 * Usage: npx tsx scripts/smoke-test.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'
import http from 'http'
import fs from 'fs'

const PRISM_CLI = path.resolve(__dirname, '../packages/cli/dist/cli.js')
const CONFIG = path.resolve(__dirname, '../prism.toml')
const TRACES_DB = path.resolve(__dirname, '../prism-traces.db')

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function waitForDashboard(port: number, maxRetries = 20): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await httpGet(`http://localhost:${port}/api/health`)
      return true
    } catch {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  return false
}

async function main(): Promise<void> {
  // Clean up old traces
  try { fs.unlinkSync(TRACES_DB) } catch { /* ignore */ }

  console.log('=== Prism Smoke Test ===\n')

  // 1. Spawn Prism as child process and connect as MCP client
  console.log('1. Connecting to Prism...')
  const transport = new StdioClientTransport({
    command: 'node',
    args: [PRISM_CLI, 'start', '--config', CONFIG],
    stderr: 'pipe',
  })

  const logs: string[] = []
  const stderr = transport.stderr
  if (stderr) {
    stderr.on('data', (chunk: Buffer) => { logs.push(chunk.toString()) })
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
    console.log(`     params: (${Object.keys(props).join(', ')})`)
    console.log()
  }

  // 3. Call tools
  console.log('3. Calling tools...\n')

  console.log('   echo({message: "hello from agent"}) =>')
  const echoResult = await client.callTool({ name: 'echo', arguments: { message: 'hello from agent' } })
  const echoContent = echoResult.content as Array<{ type: string; text: string }>
  console.log(`   => "${echoContent[0].text}"\n`)

  console.log('   add({a: 42, b: 58}) =>')
  const addResult = await client.callTool({ name: 'add', arguments: { a: 42, b: 58 } })
  const addContent = addResult.content as Array<{ type: string; text: string }>
  console.log(`   => ${addContent[0].text}\n`)

  console.log('   greet({name: "Alejandro"}) =>')
  const greetResult = await client.callTool({ name: 'greet', arguments: { name: 'Alejandro' } })
  const greetContent = greetResult.content as Array<{ type: string; text: string }>
  console.log(`   => "${greetContent[0].text}"\n`)

  // 4. Error handling
  console.log('4. Error handling — calling unknown tool...')
  const errorResult = await client.callTool({ name: 'nonexistent', arguments: {} })
  const errorContent = errorResult.content as Array<{ type: string; text: string }>
  console.log(`   isError: ${errorResult.isError}`)
  console.log(`   message: "${errorContent[0].text}"\n`)

  // 5. Compression check
  console.log('5. Compression check...')
  const echoTool = toolsResult.tools.find(t => t.name === 'echo')
  if (echoTool) {
    console.log(`   "This tool" filler removed: ${!echoTool.description?.includes('This tool')}`)
    console.log(`   echo description: "${echoTool.description}"\n`)
  }

  // 6. Dashboard API check
  console.log('6. Dashboard API check...')
  const dashboardUp = await waitForDashboard(3002)
  if (dashboardUp) {
    const health = JSON.parse(await httpGet('http://localhost:3002/api/health'))
    console.log(`   /api/health: ${JSON.stringify(health)}`)

    const traces = JSON.parse(await httpGet('http://localhost:3002/api/traces'))
    console.log(`   /api/traces: ${traces.length} traces recorded`)

    if (traces.length > 0) {
      const t = traces[0]
      console.log(`   Latest trace: ${t.toolName} (${t.durationMs}ms, ${t.inputTokens + t.outputTokens} tokens)`)
    }

    const sessions = JSON.parse(await httpGet('http://localhost:3002/api/sessions'))
    console.log(`   /api/sessions: ${sessions.length} sessions`)

    if (sessions.length > 0) {
      const s = sessions[0]
      console.log(`   Session: ${s.toolCalls} calls, ${s.totalTokens} tokens, $${s.totalCostUsd.toFixed(4)} USD, ${s.errors} errors`)
    }
  } else {
    console.log('   Dashboard not available (port 3002)')
  }
  console.log()

  // Shutdown
  await client.close()

  // Show Prism's logs
  console.log('=== Prism Logs (stderr) ===\n')
  const allLogs = logs.join('')
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
