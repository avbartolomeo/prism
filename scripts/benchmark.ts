#!/usr/bin/env npx tsx
/**
 * Prism Benchmark — shows token savings with vs without Prism.
 * Connects to MCP servers directly, counts tokens, then shows what Prism saves.
 *
 * Usage: npx tsx scripts/benchmark.ts --config prism.toml
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'
import fs from 'fs'
import TOML from '@iarna/toml'

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : 'prism.toml'

interface ServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function connectServer(config: ServerConfig): Promise<{ name: string; description: string; tokens: number }[]> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    stderr: 'pipe',
  })

  const client = new Client({ name: 'benchmark', version: '1.0' }, { capabilities: {} })
  await client.connect(transport)

  const result = await client.listTools()
  const tools = result.tools.map(t => {
    const schema = JSON.stringify(t.inputSchema)
    const fullText = `${t.name} ${t.description ?? ''} ${schema}`
    return {
      name: t.name,
      description: t.description ?? '',
      tokens: estimateTokens(fullText),
    }
  })

  await client.close()
  return tools
}

async function main(): Promise<void> {
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(configPath, 'utf-8')
  const parsed = TOML.parse(raw) as Record<string, unknown>
  const servers = (parsed.servers ?? []) as ServerConfig[]
  const budget = ((parsed.budget as Record<string, unknown>)?.max_tokens as number) ?? 8000

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           PRISM BENCHMARK — Token Savings               ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()

  // Phase 1: Connect to each server directly and count tokens
  console.log('── WITHOUT PRISM (raw MCP servers) ──\n')

  let totalTools = 0
  let totalTokens = 0
  const allTools: { server: string; name: string; tokens: number }[] = []

  for (const server of servers) {
    if (server.enabled === false) continue
    try {
      process.stdout.write(`  Connecting to ${server.name}... `)
      const tools = await connectServer(server)
      const serverTokens = tools.reduce((sum, t) => sum + t.tokens, 0)
      console.log(`${tools.length} tools, ${serverTokens.toLocaleString()} tokens`)

      for (const t of tools) {
        allTools.push({ server: server.name, name: t.name, tokens: t.tokens })
      }
      totalTools += tools.length
      totalTokens += serverTokens
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log()
  console.log(`  Total: ${totalTools} tools, ${totalTokens.toLocaleString()} tokens`)
  console.log()

  // Phase 2: Simulate Prism filtering
  console.log('── WITH PRISM (filtered + compressed) ──\n')
  console.log(`  Token budget: ${budget.toLocaleString()}`)
  console.log()

  // Sort by tokens (greedy fit)
  allTools.sort((a, b) => a.tokens - b.tokens)

  let prismTokens = 0
  let prismTools = 0
  const included: typeof allTools = []
  const excluded: typeof allTools = []

  for (const tool of allTools) {
    // Simulate ~30% compression from SchemaCompressor
    const compressedTokens = Math.ceil(tool.tokens * 0.7)
    if (prismTokens + compressedTokens <= budget) {
      prismTokens += compressedTokens
      prismTools++
      included.push(tool)
    } else {
      excluded.push(tool)
    }
  }

  console.log(`  Tools included: ${prismTools} of ${totalTools}`)
  console.log(`  Tokens used: ${prismTokens.toLocaleString()} of ${budget.toLocaleString()} budget`)
  console.log()

  if (excluded.length > 0) {
    console.log(`  Tools excluded (${excluded.length}):`)
    for (const t of excluded) {
      console.log(`    - ${t.server}/${t.name} (${t.tokens} tokens)`)
    }
    console.log()
  }

  // Summary
  console.log('── RESULTS ──\n')
  const saved = totalTokens - prismTokens
  const pct = totalTokens > 0 ? Math.round((saved / totalTokens) * 100) : 0
  const contextPct = Math.round((totalTokens / 200000) * 100) // assuming 200K context
  const contextPctPrism = Math.round((prismTokens / 200000) * 100)

  console.log(`  Without Prism: ${totalTokens.toLocaleString()} tokens (${contextPct}% of 200K context)`)
  console.log(`  With Prism:    ${prismTokens.toLocaleString()} tokens (${contextPctPrism}% of 200K context)`)
  console.log(`  Saved:         ${saved.toLocaleString()} tokens (${pct}% reduction)`)
  console.log()
  console.log(`  That's ${saved.toLocaleString()} more tokens for your actual instructions.`)
  console.log()
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message)
  process.exit(1)
})
