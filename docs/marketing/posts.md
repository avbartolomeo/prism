# Prism — Launch Posts

## X/Twitter (Thread)

### Tweet 1 (Hook)
I built an open-source MCP proxy that cuts tool schema token waste by 50%.

If you use Claude Code with 3+ MCP servers, your agent is spending half its context window on tool descriptions it will never use.

Prism fixes that. Here's how 👇

### Tweet 2 (Problem)
The problem: 150+ tools from multiple MCP servers = 40-50% of your context gone.

Your LLM gets dumber because its instructions get pushed out by schemas for tools like "list_directory_with_sizes" when you're asking about GitHub PRs.

### Tweet 3 (Solution)
Prism sits between your agent and MCP servers:

Agent → Prism → MCP Servers

It filters tools by relevance + token budget, compresses descriptions (removes filler like "This tool allows you to..."), and forwards calls transparently.

Your agent sees only what it needs.

### Tweet 4 (Self-management)
The killer feature: Prism manages itself through MCP.

From Claude Code you can say:
- "What MCP servers can I add?"
- "Add GitHub server" → connects live
- "How many tokens did I spend?" → instant answer
- "Am I looping on any tool?" → loop detection

No config files. No restarts.

### Tweet 5 (Observability)
Every tool call is traced to SQLite:
- Timing (ms)
- Token usage
- Cost estimation
- Error detection
- Loop detection

Dashboard at localhost:3002 shows everything in real-time.

### Tweet 6 (Install)
Try it now:

npm install -g prism-mcp
prism init

Then add to your .mcp.json and open Claude Code.

GitHub: github.com/avbartolomeo/prism
npm: npmjs.com/package/prism-mcp

Built by @avbartolomeo with Claude Code.
Open source (MIT). PRs welcome.

### Hashtags for X
#MCP #ClaudeCode #Anthropic #AI #AgentObservability #OpenSource #AIAgents #LLM #ContextWindow #TokenOptimization #ModelContextProtocol

---

## LinkedIn Post

### Title
I built Prism — an open-source MCP proxy that reduces AI agent token waste by 50%

### Body
If you're building with AI agents and MCP (Model Context Protocol), you've probably hit this wall:

3+ MCP servers = 150+ tools = 40-50% of your context window consumed by tool descriptions your agent will never use.

Your LLM literally gets dumber because its instructions get pushed out by schemas.

I built Prism to solve this. It's an open-source proxy that sits between your AI agent and MCP servers:

**What it does:**
→ Filters tools by relevance and token budget
→ Compresses tool descriptions (removes filler phrases)
→ Traces every tool call with timing, tokens, and cost
→ Detects error loops and call loops
→ Provides a real-time dashboard
→ Self-manages through MCP — add/remove servers from your agent

**The key insight:** Prism exposes management tools as MCP tools. Your agent can say "add the GitHub server" and Prism connects it live. No config files, no restarts. The proxy manages itself.

**Tech stack:** TypeScript, @modelcontextprotocol/sdk, SQLite, Express, Preact. 55 tests. Published on npm.

Try it:
npm install -g prism-mcp

GitHub: github.com/avbartolomeo/prism

Built by Alejandro Bartolomeo with Claude Code — the entire project (3 phases, 55 tests, CI/CD, npm publish, dashboard) was built in collaboration with Claude Opus.

I believe MCP needs better infrastructure. Prism is my contribution. If you're at Anthropic or working on MCP tooling, I'd love to connect.

#MCP #AI #OpenSource #Anthropic #ClaudeCode #AIAgents #AgentObservability #ModelContextProtocol #LLM #DeveloperTools #TypeScript

---

## Reddit — r/ClaudeAI

### Title
I built an open-source MCP proxy that reduces tool schema token waste by 50% — Prism

### Body
**The problem:** When you connect 3+ MCP servers to Claude Code (filesystem, GitHub, Slack, etc.), you end up with 150+ tools. The tool descriptions alone eat 40-50% of your context window. Claude gets dumber because its instructions get pushed out.

**The solution:** Prism is a proxy that sits between Claude Code and your MCP servers. It:

- **Filters** tools by relevance and token budget
- **Compresses** descriptions (removes "This tool allows you to..." filler)
- **Traces** every tool call (timing, tokens, cost, errors)
- **Detects** loops (same tool failing repeatedly)
- **Self-manages** — you can say "add the GitHub server" from Claude Code

The self-management part is what I'm most proud of. Prism exposes its own tools through MCP, so Claude Code can add/remove servers, check costs, and detect issues without you ever touching a config file.

**Install:**
```
npm install -g prism-mcp
prism init
```

Then add to `.mcp.json` and open Claude Code.

**GitHub:** github.com/avbartolomeo/prism

Built the entire project with Claude Code (Opus). Open source, MIT license.

---

## Reddit — r/MachineLearning

### Title
[P] Prism — Open-source MCP proxy for AI agent observability and context optimization

### Body
We built Prism, an open-source proxy for the Model Context Protocol (MCP) that addresses the context window waste problem when AI agents use multiple tool servers.

**Problem:** With N MCP servers exposing M tools each, tool schema descriptions can consume 40-50% of the context window, degrading model performance.

**Approach:**
- Relevance-based filtering with greedy token budget allocation
- Schema compression (removing filler phrases, capping description length)
- Per-call tracing with token estimation and cost tracking
- Error/call loop detection (configurable thresholds)
- Self-management through MCP meta-tools

**Architecture:** The proxy acts as an MCP server to the agent and as an MCP client to each backend server. Tool calls are forwarded transparently with tracing. Management operations (add/remove server, query traces, detect loops) are exposed as MCP tools.

**Results:** With 150+ tools across 5 servers, Prism reduces the tool schema token footprint to fit within a configurable budget (default 8000 tokens) while prioritizing relevant tools.

npm: `prism-mcp`
GitHub: github.com/avbartolomeo/prism

---

## Hacker News — Show HN

### Title
Show HN: Prism – Open-source MCP proxy that filters tool schemas to save context

### Body
Prism is an MCP proxy for AI agents (Claude Code, etc.) that reduces token waste from tool descriptions.

The problem: with 3+ MCP servers (filesystem, GitHub, Slack...), you get 150+ tools. The schemas eat 40-50% of context. The LLM performs worse because its instructions get crowded out.

Prism sits between the agent and MCP servers. It filters tools by relevance and token budget, compresses descriptions, traces every call, and detects loops. It self-manages through MCP — you can add/remove servers from within your AI agent.

Stack: TypeScript, @modelcontextprotocol/sdk, SQLite, Express.

npm install -g prism-mcp

https://github.com/avbartolomeo/prism

---

## dev.to / Medium Article

### Title
How I Built an MCP Proxy That Saves 50% of Your AI Agent's Context Window

### Subtitle
And why your AI agent gets dumber when you add more tools

(Full article to be written — outline below)

1. The problem: context window waste with MCP
2. Measuring the waste: real numbers from 5 MCP servers
3. The architecture: proxy pattern for MCP
4. Schema compression: what we remove and why
5. Token budgeting: greedy selection by relevance
6. Self-management: the proxy manages itself through MCP
7. Observability: tracing, costs, loop detection
8. Results and next steps
9. Try it: installation guide

---

## Direct outreach to Anthropic

### Email to developer-relations@anthropic.com

Subject: Open-source MCP proxy solving context waste — Prism

Hi,

I built Prism, an open-source MCP proxy that addresses the context window waste problem when agents use multiple MCP servers. With 150+ tools from 3-5 servers, tool descriptions consume 40-50% of context.

Prism filters by relevance + token budget, compresses schemas, traces every call, and self-manages through MCP tools (agents can add/remove servers live).

- GitHub: github.com/avbartolomeo/prism
- npm: prism-mcp (55 tests, CI/CD, dashboard)
- Built entirely with Claude Code (Opus)

I'm interested in contributing to the MCP ecosystem. Would love to discuss how Prism's approach could inform the protocol or tooling.

Best,
Alejandro Bartolomeo
github.com/avbartolomeo

### X — Tag Anthropic people

@alexalbert_ @AnthropicAI Built an open-source MCP proxy that cuts tool schema token waste by 50%. Self-manages through MCP — add servers from Claude Code without touching config.

github.com/avbartolomeo/prism

Would love your feedback on where this fits in the MCP ecosystem.
