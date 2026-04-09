import os from 'os'

interface KnownServer {
  name: string
  description: string
  command: string
  args: string[]
  envKeys: string[]
}

const homeDir = os.homedir().replace(/\\/g, '/')

/**
 * Registry of well-known MCP servers with their configs and required secrets.
 */
export const KNOWN_SERVERS: KnownServer[] = [
  {
    name: 'filesystem',
    description: 'Read/write files on your machine',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', homeDir],
    envKeys: [],
  },
  {
    name: 'fetch',
    description: 'Fetch and read web pages',
    command: 'npx',
    args: ['@modelcontextprotocol/server-fetch'],
    envKeys: [],
  },
  {
    name: 'memory',
    description: 'Persistent key-value memory between conversations',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
    envKeys: [],
  },
  {
    name: 'sequential-thinking',
    description: 'Step-by-step reasoning for complex tasks',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sequential-thinking'],
    envKeys: [],
  },
  {
    name: 'github',
    description: 'GitHub repos, PRs, issues, code search',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_TOKEN'],
  },
  {
    name: 'gitlab',
    description: 'GitLab repos, merge requests, issues',
    command: 'npx',
    args: ['@modelcontextprotocol/server-gitlab'],
    envKeys: ['GITLAB_TOKEN'],
  },
  {
    name: 'brave-search',
    description: 'Web search via Brave Search API',
    command: 'npx',
    args: ['@modelcontextprotocol/server-brave-search'],
    envKeys: ['BRAVE_API_KEY'],
  },
  {
    name: 'google-maps',
    description: 'Locations, directions, places',
    command: 'npx',
    args: ['@modelcontextprotocol/server-google-maps'],
    envKeys: ['GOOGLE_MAPS_API_KEY'],
  },
  {
    name: 'slack',
    description: 'Slack messages, channels, users',
    command: 'npx',
    args: ['@modelcontextprotocol/server-slack'],
    envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
  {
    name: 'postgres',
    description: 'Query PostgreSQL databases',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    envKeys: ['POSTGRES_CONNECTION_STRING'],
  },
  {
    name: 'sqlite',
    description: 'Query SQLite databases',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
    envKeys: ['SQLITE_DB_PATH'],
  },
  {
    name: 'puppeteer',
    description: 'Browser automation, screenshots, web scraping',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
    envKeys: [],
  },
]

export function findKnownServer(name: string): KnownServer | undefined {
  return KNOWN_SERVERS.find(s => s.name === name)
}
