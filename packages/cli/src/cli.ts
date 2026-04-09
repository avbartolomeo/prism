#!/usr/bin/env node
import { Command } from 'commander'
import { PrismProxy, DashboardServer } from 'prism-mcp-proxy'
import { loadConfig } from './config'
import dotenv from 'dotenv'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pino from 'pino'

const program = new Command()

program
  .name('prism')
  .description('MCP Context Router + Agent Observability')
  .version('0.1.0')

program
  .command('start')
  .description('Start the Prism MCP proxy')
  .option('-c, --config <path>', 'Path to prism.toml', 'prism.toml')
  .action(async (options: { config: string }) => {
    // Logs MUST go to stderr — stdout is reserved for MCP stdio protocol
    const logger = pino({
      name: 'prism',
      transport: { target: 'pino-pretty', options: { destination: 2 } },
    })

    logger.info('Starting Prism...')

    // Load .env from same directory as prism.toml
    // Secrets go in .env, not in prism.toml
    const configDir = path.dirname(path.resolve(options.config))
    const envPath = path.join(configDir, '.env')
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
      logger.info({ envPath }, 'Loaded .env file')
    }

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

    // Connect to all backend MCP servers
    const initResult = await proxy.initialize()
    if (!initResult.ok) {
      logger.error({ error: initResult.error.message }, 'Failed to initialize proxy')
      process.exit(1)
      return
    }

    const tools = proxy.getAllTools()
    const filtered = proxy.getFilteredTools()
    logger.info({
      totalTools: tools.length,
      filteredTools: filtered.length,
      tokenSavings: `${tools.length - filtered.length} tools excluded`,
    }, 'Prism ready — serving via stdio')

    // Start dashboard if port is configured
    let dashboard: DashboardServer | undefined
    const traceStore = proxy.getTraceStore()
    if (config.dashboardPort && traceStore) {
      dashboard = new DashboardServer(traceStore, logger)
      await dashboard.start(config.dashboardPort)
    }

    // Start serving MCP protocol via stdio
    await proxy.serve()

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
# Secrets: put API keys in .env (same folder), NOT here.

[budget]
max_tokens = 8000          # Token budget for tool descriptions

[dashboard]
port = 3002                # Web UI at http://localhost:3002

[traces]
path = "./prism-traces.db" # SQLite path for trace storage

# --- MCP Servers ---
# Add your servers below. Prism spawns each as a child process.
# Servers that need API keys will read them from .env automatically.
# You can also add/remove servers at runtime via Claude Code:
#   "Add the GitHub MCP server"

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "${homeDir}"]

# [[servers]]
# name = "fetch"
# command = "npx"
# args = ["@modelcontextprotocol/server-fetch"]

# [[servers]]
# name = "memory"
# command = "npx"
# args = ["@modelcontextprotocol/server-memory"]

# [[servers]]
# name = "github"
# command = "npx"
# args = ["@modelcontextprotocol/server-github"]
# # Set GITHUB_TOKEN in .env

# [[servers]]
# name = "brave-search"
# command = "npx"
# args = ["@modelcontextprotocol/server-brave-search"]
# # Set BRAVE_API_KEY in .env
`

    fs.writeFileSync(outputPath, template)

    // Generate .env template in the same directory
    const envFilePath = path.join(path.dirname(outputPath), '.env')
    if (!fs.existsSync(envFilePath)) {
      const envTemplate = `# Prism — environment variables (secrets go here, not in prism.toml)
# Prism loads this file automatically on startup.

# GitHub
# GITHUB_TOKEN=ghp_your_token_here

# Slack
# SLACK_TOKEN=xoxb-your-token-here

# Brave Search
# BRAVE_API_KEY=your-api-key-here

# Google Maps
# GOOGLE_MAPS_API_KEY=your-api-key-here
`
      fs.writeFileSync(envFilePath, envTemplate)
      console.log(`Created ${envFilePath}`)
    }

    console.log(`Created ${outputPath}`)
    console.log('')
    console.log('Next steps:')
    console.log(`  1. Edit ${options.output} — add your MCP servers`)
    console.log(`  2. Add secrets to .env (same folder) — NOT in prism.toml`)
    console.log(`  3. Configure Claude Code:`)
    console.log('')
    console.log('     Add to .mcp.json (project) or ~/.claude/.mcp.json (global):')
    console.log('     {')
    console.log('       "mcpServers": {')
    console.log('         "prism": {')
    console.log(`           "command": "prism",`)
    console.log(`           "args": ["start", "--config", "${outputPath.replace(/\\/g, '/')}"]`)
    console.log('         }')
    console.log('       }')
    console.log('     }')
    console.log('')
    console.log('  3. Open Claude Code — Prism starts automatically')
  })

program
  .command('status')
  .description('Show Prism status')
  .action(() => {
    console.log('Prism v0.1.1')
    console.log('Status: not running (use "prism start")')
  })

program.parse()
