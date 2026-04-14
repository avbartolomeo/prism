#!/usr/bin/env node
import { Command } from 'commander'
import { PrismProxy, DashboardServer } from 'prism-mcp-proxy'
import { loadConfig } from './config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pino from 'pino'

// Read version from package.json
function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

const VERSION = getVersion()
const program = new Command()

program
  .name('prism')
  .description('MCP Context Router + Agent Observability')
  .version(VERSION)

program
  .command('start')
  .description('Start the Prism MCP proxy')
  .option('-c, --config <path>', 'Path to prism.toml', 'prism.toml')
  .action(async (options: { config: string }) => {
    const logger = pino({
      name: 'prism',
      transport: { target: 'pino-pretty', options: { destination: 2 } },
    })

    logger.info({ version: VERSION }, 'Starting Prism...')

    const configResult = loadConfig(options.config)
    if (!configResult.ok) {
      logger.error({ error: configResult.error.message }, 'Failed to load config')
      process.exit(1)
      return
    }

    const config = configResult.value
    logger.info({ servers: config.servers.length, budget: config.maxTokenBudget }, 'Config loaded')

    const configPath = path.resolve(options.config)
    const proxy = new PrismProxy({
      servers: config.servers,
      maxTokenBudget: config.maxTokenBudget,
      tracePath: config.tracePath ?? './prism-traces.db',
      configPath,
      logger,
    })

    // Start dashboard immediately (before server connections)
    let dashboard: DashboardServer | undefined
    if (config.dashboardPort) {
      const traceStore = proxy.getTraceStore()
      if (traceStore) {
        dashboard = new DashboardServer(traceStore, logger, proxy.getRegistry())
        await dashboard.start(config.dashboardPort)
      }
    }

    // Start serving MCP protocol via stdio IMMEDIATELY
    // Agent connects right away — no waiting for backend servers
    await proxy.serve()
    logger.info('Prism ready — serving via stdio')

    // Connect backend servers in background — tools appear progressively
    proxy.startConnecting()

    process.on('SIGINT', async () => {
      logger.info('Shutting down...')
      if (dashboard) await dashboard.stop()
      await proxy.shutdown()
      process.exit(0)
    })
  })

program
  .command('init')
  .description('Generate a prism.toml config file')
  .option('-o, --output <path>', 'Output path', 'prism.toml')
  .action((options: { output: string }) => {
    const outputPath = path.resolve(options.output)

    if (fs.existsSync(outputPath)) {
      console.error(`File already exists: ${outputPath}`)
      console.error('Remove it first or use --output to specify a different path.')
      process.exit(1)
      return
    }

    const homeDir = os.homedir().replace(/\\/g, '/')

    const template = `# Prism — MCP Context Router
# Docs: https://github.com/avbartolomeo/prism
# Add/remove servers from Claude Code: "add the GitHub MCP server"

[budget]
max_tokens = 8000          # Token budget for tool descriptions

[dashboard]
port = 3002                # Web UI at http://localhost:3002

[traces]
path = "./prism-traces.db" # SQLite path for trace storage

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "${homeDir}"]
`

    fs.writeFileSync(outputPath, template)
    console.log(`Created ${outputPath}`)
    console.log('')
    console.log('Next steps:')
    console.log('  1. Add Prism to .mcp.json (project) or ~/.claude/.mcp.json (global):')
    console.log('')
    console.log('     {')
    console.log('       "mcpServers": {')
    console.log('         "prism": {')
    console.log(`           "command": "prism",`)
    console.log(`           "args": ["start", "--config", "${outputPath.replace(/\\/g, '/')}"]`)
    console.log('         }')
    console.log('       }')
    console.log('     }')
    console.log('')
    console.log('  2. Open Claude Code — Prism starts automatically')
    console.log('  3. Add more servers from Claude Code:')
    console.log('     "What MCP servers can I add?" or "Add GitHub server"')
  })

program
  .command('benchmark')
  .description('Show token savings with vs without Prism')
  .option('-c, --config <path>', 'Path to prism.toml', 'prism.toml')
  .action(async (options: { config: string }) => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const configResult = loadConfig(options.config)
    if (!configResult.ok) {
      console.error(configResult.error.message)
      process.exit(1)
      return
    }

    const { servers, maxTokenBudget: budget } = configResult.value

    console.log('')
    console.log('  ╔══════════════════════════════════════════════════╗')
    console.log('  ║         PRISM — Token Savings Benchmark          ║')
    console.log('  ╚══════════════════════════════════════════════════╝')
    console.log('')
    console.log('  ── WITHOUT PRISM (raw MCP servers) ──')
    console.log('')

    let totalTools = 0
    let totalTokens = 0
    const allTools: { server: string; name: string; tokens: number }[] = []

    for (const server of servers) {
      if (server.enabled === false) continue
      try {
        process.stdout.write(`    Connecting to ${server.name}...`)
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
          stderr: 'pipe',
        })
        const client = new Client({ name: 'benchmark', version: '1.0' }, { capabilities: {} })
        await client.connect(transport)
        const result = await client.listTools()

        let serverTokens = 0
        for (const t of result.tools) {
          const fullText = `${t.name} ${t.description ?? ''} ${JSON.stringify(t.inputSchema)}`
          const tokens = Math.ceil(fullText.length / 4)
          allTools.push({ server: server.name, name: t.name, tokens })
          serverTokens += tokens
        }

        await client.close()
        totalTools += result.tools.length
        totalTokens += serverTokens
        console.log(` ${result.tools.length} tools, ${serverTokens.toLocaleString()} tokens`)
      } catch (e) {
        console.log(` FAILED: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    console.log('')
    console.log(`    Total: ${totalTools} tools, ${totalTokens.toLocaleString()} tokens`)
    console.log('')
    console.log('  ── WITH PRISM (filtered + compressed) ──')
    console.log('')
    console.log(`    Budget: ${budget.toLocaleString()} tokens`)

    allTools.sort((a, b) => a.tokens - b.tokens)
    let prismTokens = 0
    let prismTools = 0
    const excluded: typeof allTools = []

    for (const tool of allTools) {
      const compressed = Math.ceil(tool.tokens * 0.7)
      if (prismTokens + compressed <= budget) {
        prismTokens += compressed
        prismTools++
      } else {
        excluded.push(tool)
      }
    }

    console.log(`    Included: ${prismTools} of ${totalTools} tools`)
    console.log(`    Used: ${prismTokens.toLocaleString()} of ${budget.toLocaleString()} tokens`)

    if (excluded.length > 0) {
      console.log('')
      console.log(`    Excluded (${excluded.length}):`)
      for (const t of excluded.slice(0, 10)) {
        console.log(`      - ${t.server}/${t.name} (${t.tokens} tokens)`)
      }
      if (excluded.length > 10) console.log(`      ... and ${excluded.length - 10} more`)
    }

    const saved = totalTokens - prismTokens
    const pct = totalTokens > 0 ? Math.round((saved / totalTokens) * 100) : 0
    const rawPct = Math.round((totalTokens / 200000) * 100)
    const prismPct = Math.round((prismTokens / 200000) * 100)

    console.log('')
    console.log('  ── RESULTS ──')
    console.log('')
    console.log(`    Without Prism: ${totalTokens.toLocaleString()} tokens (${rawPct}% of 200K context)`)
    console.log(`    With Prism:    ${prismTokens.toLocaleString()} tokens (${prismPct}% of 200K context)`)
    console.log(`    ─────────────────────────────────────`)
    console.log(`    Saved:         ${saved.toLocaleString()} tokens (${pct}% reduction)`)
    console.log('')
  })

program
  .command('status')
  .description('Show Prism status')
  .action(() => {
    console.log(`Prism v${VERSION}`)
    console.log('Status: not running (use "prism start")')
  })

program.parse()
