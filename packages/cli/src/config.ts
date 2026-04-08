import type { Result, PrismConfig, McpServerConfig } from 'prism-mcp-types'
import { ok, err } from 'prism-mcp-types'
import fs from 'fs'
import TOML from '@iarna/toml'

/**
 * Load Prism config from a TOML file.
 */
export function loadConfig(configPath: string): Result<PrismConfig> {
  try {
    if (!fs.existsSync(configPath)) {
      return err(new Error(`Config file not found: ${configPath}`))
    }

    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = TOML.parse(raw) as Record<string, unknown>

    const budget = parsed.budget as Record<string, unknown> | undefined
    const maxTokenBudget = (budget?.max_tokens as number) ?? 8000

    const servers: McpServerConfig[] = []
    const rawServers = (parsed.servers ?? []) as Array<Record<string, unknown>>
    for (const s of rawServers) {
      servers.push({
        name: s.name as string,
        command: s.command as string,
        args: (s.args as string[]) ?? [],
        env: (s.env as Record<string, string>) ?? {},
        enabled: s.enabled !== false,
      })
    }

    return ok({
      maxTokenBudget,
      servers,
      dashboardPort: (parsed.dashboard as Record<string, unknown>)?.port as number | undefined,
      tracePath: (parsed.traces as Record<string, unknown>)?.path as string | undefined,
    })
  } catch (error) {
    return err(
      new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    )
  }
}
