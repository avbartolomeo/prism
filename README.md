# Prism

**MCP Context Router + Agent Observability**

Prism is an open-source proxy that sits between your AI agent and MCP servers.
It filters tool schemas to fit your token budget and logs every tool call for debugging.

## The Problem

With 3+ MCP servers (150+ tools), tool descriptions eat 40-50% of your context
window. Your LLM gets dumber because its instructions get pushed out by tool schemas
it will never use.

## How Prism Solves It

```
Agent  -->  Prism (proxy)  -->  MCP Servers
               |
         Context Filter     (select relevant tools by budget)
         Schema Compressor  (remove filler from descriptions)
         Token Budget       (enforce limits)
         Trace Logger       (record every call to SQLite)
         Dashboard          (web UI for traces + costs)
```

Prism acts as an MCP server to your agent and as an MCP client to your real servers.
Your agent sees a filtered, compressed set of tools. Prism forwards calls transparently.

## Quick Start

```bash
# Install
npm install -g prism-mcp

# Create config
cat > prism.toml << 'EOF'
[budget]
max_tokens = 8000

[dashboard]
port = 3002

[traces]
path = "./prism-traces.db"

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user"]

[[servers]]
name = "github"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_..." }
EOF

# Start
prism start --config prism.toml
```

## Use with Claude Code

Add Prism as your MCP server in `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prism": {
      "command": "prism",
      "args": ["start", "--config", "/path/to/prism.toml"]
    }
  }
}
```

Claude Code now sees only the tools that fit your budget, with compressed descriptions.
All calls are traced to SQLite and visible in the dashboard at `http://localhost:3002`.

## Configuration

### prism.toml

```toml
[budget]
max_tokens = 8000          # Token budget for tool descriptions

[dashboard]
port = 3002                # Dashboard web UI port

[traces]
path = "./prism-traces.db" # SQLite path for traces

# Add your MCP servers:

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user"]

[[servers]]
name = "github"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_..." }

[[servers]]
name = "slack"
command = "npx"
args = ["@modelcontextprotocol/server-slack"]
env = { SLACK_TOKEN = "xoxb-..." }
enabled = false  # Disable without removing
```

### How Filtering Works

1. **Schema Compression**: Removes filler phrases ("This tool", "Allows you to",
   "Can be used to") from descriptions. Caps at 200 chars.

2. **Context Filter**: Scores tools by relevance to the current context.
   Greedily selects tools within the token budget, highest-scored first.

3. **Token Budget**: The `max_tokens` setting limits total tokens used by tool
   descriptions in the agent's context window.

## Dashboard

When `dashboard.port` is configured, Prism serves a web UI with:

- **Traces table**: Every tool call with timing, tokens, server, status
- **Sessions view**: Aggregated stats per session — total calls, tokens, cost, errors
- **Auto-refresh**: Updates every 5 seconds

API endpoints:
- `GET /api/traces?limit=50` — Recent traces
- `GET /api/sessions?limit=20` — Session summaries
- `GET /api/sessions/:id` — Session detail with traces
- `GET /api/health` — Health check

## Observability

### Trace Store

Every `tools/call` is recorded to SQLite with:
- Tool name, server, input/output
- Duration (ms)
- Estimated input/output tokens
- Error message (if any)

### Loop Detection

Prism detects and warns about:
- **Error loops**: Same tool failing 3+ times in the last 10 calls
- **Call loops**: Same tool called 5+ times in the last 10 calls

### Cost Tracking

Tokens are estimated per call (1 token ~ 4 chars) and aggregated per session
with approximate USD cost.

## Architecture

```
packages/
  types/      Shared interfaces (McpTool, PrismConfig, TraceRecord)
  proxy/      Core: ToolRegistry, ContextFilter, SchemaCompressor,
              TraceStore, DashboardServer, PrismProxy
  cli/        CLI: prism start, prism status
  dashboard/  Web UI (Preact + Vite)
```

Built with:
- TypeScript (strict mode)
- @modelcontextprotocol/sdk
- better-sqlite3 (WAL mode)
- Express (API)
- Preact + Vite (dashboard)
- Vitest (41 tests)

## Development

```bash
git clone https://github.com/avbartolomeo/prism
cd prism
npm install
npm run build
npm run test        # 41 tests
npm run typecheck
npm run lint

# Smoke test (end-to-end)
npx tsx scripts/smoke-test.ts
```

## License

MIT
