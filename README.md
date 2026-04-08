# 🔮 Prism

**MCP Context Router + Agent Observability**

Reduce token waste. See what your AI agents do.

---

Prism sits between your AI agent and MCP servers. It filters tool schemas to fit
your token budget and logs every tool call for debugging.

## The Problem

With 3+ MCP servers (150+ tools), tool descriptions eat 40-50% of your context
window. Your LLM gets dumber because its instructions get pushed out by schemas.

## The Solution

```
Agent → Prism (proxy) → MCP Servers
          ↓
    Context Filter (select relevant tools)
    Schema Compressor (shorten descriptions)
    Token Budget (enforce limits)
    Trace Logger (record everything)
```

## Quick Start

```bash
npm install -g prism-mcp
prism start --config prism.toml
```

## Configuration

```toml
[budget]
max_tokens = 8000

[[servers]]
name = "filesystem"
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user"]

[[servers]]
name = "github"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
```

## Status

🚧 In development — Phase 0 (Foundation)

## License

MIT
