#!/usr/bin/env node
import { Command } from 'commander'
import { PrismProxy } from '@prism/proxy'
import { loadConfig } from './config'
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
    const logger = pino({ name: 'prism', transport: { target: 'pino-pretty' } })

    logger.info('Starting Prism...')

    const configResult = loadConfig(options.config)
    if (!configResult.ok) {
      logger.error({ error: configResult.error.message }, 'Failed to load config')
      process.exit(1)
      return
    }

    const config = configResult.value
    logger.info({ servers: config.servers.length, budget: config.maxTokenBudget }, 'Config loaded')

    const proxy = new PrismProxy({
      servers: config.servers,
      maxTokenBudget: config.maxTokenBudget,
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

    // Start serving MCP protocol via stdio
    await proxy.serve()

    process.on('SIGINT', async () => {
      logger.info('Shutting down...')
      await proxy.shutdown()
      process.exit(0)
    })
  })

program
  .command('status')
  .description('Show Prism status')
  .action(() => {
    console.log('Prism v0.1.0')
    console.log('Status: not running (use "prism start")')
  })

program.parse()
