#!/usr/bin/env npx tsx
/**
 * Smoke test — simulates exactly what Claude Code does:
 * 1. Spawn Prism as child process
 * 2. Connect as MCP client via stdio
 * 3. Wait for backend servers to connect (background)
 * 4. List tools, call tools, verify dashboard
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
  try { fs.unlinkSync(TRACES_DB) } catch { /* ignore */ }

  console.log('=== Prism Smoke Test (simulates Claude Code) ===\n')

  // 1. Spawn Prism — should respond INSTANTLY (background server connection)
  console.log('1. Spawning Prism and connecting as MCP client...')
  const startTime = Date.now()

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
  const connectTime = Date.now() - startTime
  console.log(`   Connected in ${connectTime}ms`)

  if (connectTime > 5000) {
    console.log('   WARNING: Connection took >5s — this would timeout in Claude Code!')
  } else {
    console.log('   OK — fast enough for Claude Code (< 20s timeout)')
  }
  console.log()

  // 2. List tools immediately — may only have management tools
  console.log('2. Listing tools immediately (servers may still be connecting)...')
  const immediateTools = await client.listTools()
  const mgmtTools = immediateTools.tools.filter(t => t.name.startsWith('prism_'))
  const backendTools = immediateTools.tools.filter(t => !t.name.startsWith('prism_'))
  console.log(`   Management tools: ${mgmtTools.length}`)
  console.log(`   Backend tools: ${backendTools.length}`)
  console.log()

  // 3. Wait for backend servers to connect
  console.log('3. Waiting for backend servers to connect...')
  let lastToolCount = backendTools.length
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    const result = await client.listTools()
    const currentBackend = result.tools.filter(t => !t.name.startsWith('prism_')).length
    if (currentBackend > lastToolCount) {
      console.log(`   ${i + 1}s: ${currentBackend} backend tools (new tools appeared!)`)
      lastToolCount = currentBackend
    } else if (i % 3 === 0) {
      console.log(`   ${i + 1}s: ${currentBackend} backend tools`)
    }
    // If we have tools and they stopped growing, servers are done
    if (currentBackend > 0 && currentBackend === lastToolCount && i > 3) break
  }
  console.log()

  // 4. List all tools
  console.log('4. Final tool list:')
  const finalTools = await client.listTools()
  const finalBackend = finalTools.tools.filter(t => !t.name.startsWith('prism_'))
  const finalMgmt = finalTools.tools.filter(t => t.name.startsWith('prism_'))

  console.log(`   Total: ${finalTools.tools.length} (${finalBackend.length} backend + ${finalMgmt.length} management)`)
  console.log()

  for (const t of finalBackend.slice(0, 10)) {
    console.log(`   - ${t.name}: ${(t.description ?? '').slice(0, 60)}`)
  }
  if (finalBackend.length > 10) {
    console.log(`   ... and ${finalBackend.length - 10} more`)
  }
  console.log()

  // 5. Call a tool
  if (finalBackend.length > 0) {
    const testTool = finalBackend.find(t => t.name === 'echo') ?? finalBackend[0]
    console.log(`5. Calling tool: ${testTool.name}`)

    try {
      let callArgs: Record<string, unknown> = {}
      if (testTool.name === 'echo') callArgs = { message: 'hello from smoke test' }
      else if (testTool.name === 'list_directory') callArgs = { path: '.' }

      const result = await client.callTool({ name: testTool.name, arguments: callArgs })
      const content = result.content as Array<{ type: string; text: string }>
      console.log(`   Result: ${content[0]?.text?.slice(0, 100) ?? 'OK'}`)
    } catch (e) {
      console.log(`   Error: ${e instanceof Error ? e.message : String(e)}`)
    }
    console.log()
  }

  // 6. Test management tools
  console.log('6. Testing management tools...')

  const versionResult = await client.callTool({ name: 'prism_version', arguments: {} })
  console.log(`   prism_version: ${(versionResult.content as Array<{ type: string; text: string }>)[0].text.split('\n')[1]}`)

  const listResult = await client.callTool({ name: 'prism_list_servers', arguments: {} })
  const listText = (listResult.content as Array<{ type: string; text: string }>)[0].text
  console.log(`   prism_list_servers: ${listText.split('\n')[0]}`)
  console.log()

  // 7. Dashboard check
  console.log('7. Dashboard check...')
  try {
    const health = JSON.parse(await httpGet('http://localhost:3002/api/health'))
    console.log(`   /api/health: ${JSON.stringify(health)}`)

    const traces = JSON.parse(await httpGet('http://localhost:3002/api/traces'))
    console.log(`   /api/traces: ${traces.length} traces`)

    const servers = JSON.parse(await httpGet('http://localhost:3002/api/servers'))
    console.log(`   /api/servers: ${servers.length} servers`)
    for (const s of servers) {
      console.log(`     - ${s.name}: ${s.tools.length} tools`)
    }
  } catch (e) {
    console.log(`   Dashboard not available: ${e instanceof Error ? e.message : String(e)}`)
  }
  console.log()

  // Shutdown
  await client.close()

  // Summary
  const totalTime = Date.now() - startTime
  console.log('=== Summary ===')
  console.log(`  Connect time: ${connectTime}ms`)
  console.log(`  Backend tools: ${finalBackend.length}`)
  console.log(`  Management tools: ${finalMgmt.length}`)
  console.log(`  Total time: ${totalTime}ms`)
  console.log()

  if (connectTime < 5000 && finalBackend.length > 0) {
    console.log('=== PASSED ===')
  } else if (connectTime >= 5000) {
    console.log('=== FAILED — connection too slow ===')
    process.exit(1)
  } else {
    console.log('=== WARNING — no backend tools discovered ===')
  }
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err)
  process.exit(1)
})
