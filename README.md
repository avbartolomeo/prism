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

### 1. Install

```bash
npm install -g prism-mcp
```

### 2. Generate config

```bash
prism init
```

This creates `prism.toml` with sensible defaults and shows you the next steps.

### 3. Configure Claude Code

Add Prism to your project's `.mcp.json` (or `~/.claude/.mcp.json` for global):

**Linux / macOS:**
```json
{
  "mcpServers": {
    "prism": {
      "command": "prism",
      "args": ["start", "--config", "/home/your-user/prism.toml"]
    }
  }
}
```

**Windows (PowerShell):**
```json
{
  "mcpServers": {
    "prism": {
      "command": "prism",
      "args": ["start", "--config", "C:/Users/YourUser/prism.toml"]
    }
  }
}
```

### 4. Open Claude Code

Prism starts automatically. Claude Code sees your tools filtered and compressed.
Open `http://localhost:3002` for the dashboard.

## Configuration

Edit `prism.toml` to add your MCP servers:

```toml
[budget]
max_tokens = 8000          # Token budget for tool descriptions

[dashboard]
port = 3002                # Dashboard web UI port

[traces]
path = "./prism-traces.db" # SQLite path for traces

# --- MCP Servers ---

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user"]

[[servers]]
name = "fetch"
command = "npx"
args = ["@modelcontextprotocol/server-fetch"]

[[servers]]
name = "memory"
command = "npx"
args = ["@modelcontextprotocol/server-memory"]

[[servers]]
name = "github"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_..." }

# Disable a server without removing it:
# [[servers]]
# name = "slack"
# command = "npx"
# args = ["@modelcontextprotocol/server-slack"]
# enabled = false
```

## Self-Management Tools

Prism exposes 6 tools that Claude Code can use directly:

| Tool | What it does |
|------|-------------|
| `prism_list_servers` | List connected servers and their tools |
| `prism_add_server` | Add a new MCP server (persists to config) |
| `prism_remove_server` | Disconnect and remove a server |
| `prism_get_traces` | Query tool call history |
| `prism_get_costs` | Token usage and cost summary |
| `prism_detect_loops` | Check for error/call loops |

Example: tell Claude Code *"add the GitHub MCP server"* and it connects it
through Prism. Type `/mcp` after to refresh the tool list.

## How Filtering Works

1. **Schema Compression**: Removes filler phrases ("This tool", "Allows you to",
   "Can be used to") from descriptions. Caps at 200 chars.

2. **Context Filter**: Scores tools by relevance to the current context.
   Greedily selects tools within the token budget, highest-scored first.

3. **Token Budget**: The `max_tokens` setting limits total tokens used by tool
   descriptions in the agent's context window.

## Dashboard

When `dashboard.port` is configured, Prism serves a web UI at `http://localhost:3002`:

- **Stats cards**: Tool calls, tokens, cost, errors, latency
- **Traces table**: Every tool call with expandable input/output detail
- **Filters**: By server, tool, status (ok/error), free text search
- **Sessions view**: Aggregated stats per session
- **Auto-refresh**: Every 5 seconds with live indicator

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
              TraceStore, DashboardServer, ManagementTools, PrismProxy
  cli/        CLI: prism start, prism init, prism status
  dashboard/  Web UI (Preact + Vite)
```

Built with:
- TypeScript (strict mode)
- @modelcontextprotocol/sdk
- better-sqlite3 (WAL mode)
- Express (API)
- Preact + Vite (dashboard)
- Vitest (54 tests)

## Development

```bash
git clone https://github.com/avbartolomeo/prism
cd prism
npm install
npm run build
npm run test        # 54 tests
npm run typecheck
npm run lint

# Smoke test (end-to-end)
npx tsx scripts/smoke-test.ts
```

## License

MIT
