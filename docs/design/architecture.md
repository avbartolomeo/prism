# Prism — MCP Context Router + Agent Observability

## Qué es

Prism es un proxy MCP que se ubica entre agentes AI y servidores MCP. Hace dos
cosas:

1. **Context Router**: carga tool schemas on-demand basado en intent, comprime
   descripciones, y gestiona un budget de tokens. Los agentes usan menos
   contexto → son más inteligentes.

2. **Observability**: registra traces de cada tool call, trackea costos, detecta
   loops/errores, y expone un dashboard. Los devs ven qué pasa dentro de sus
   agentes.

## Problema que resuelve

Con 3+ MCP servers (150+ tools), las tool descriptions consumen 40-50% de la
context window del LLM. El modelo "se pone tonto" porque las instrucciones del
usuario se comprimen para dar espacio a los schemas de tools.

Hoy cada framework (CrewAI, LangGraph, Claude Code) hackea su propia solución.
No existe un proxy standalone open-source.

## Cómo funciona

```
Agent (Claude Code, CrewAI, LangGraph, custom)
    ↓ MCP protocol (stdio/SSE/HTTP)
  Prism (proxy)
    ├─ Intent Classifier → selecciona tools relevantes
    ├─ Schema Compressor → reduce descripciones
    ├─ Token Budget Manager → limita total de tokens
    ├─ Trace Logger → registra cada call + response
    └─ Cost Tracker → tokens in/out por tool/session
    ↓ MCP protocol
  MCP Servers (filesystem, GitHub, Slack, DB, etc.)
```

## Arquitectura técnica

### Core (MVP — 2 semanas)

- **Proxy MCP**: recibe conexiones MCP del agente, las forwardea a los MCP
  servers reales. Transparente — el agente no sabe que Prism existe.
- **Tool Registry**: mantiene el catálogo completo de tools de todos los
  servers conectados.
- **Context Filter**: cuando el agente pide la lista de tools, Prism filtra
  basado en:
  - Historial reciente (¿qué tools usó el agente?)
  - Keywords en el último mensaje del usuario
  - Budget de tokens configurable
- **Schema Compressor**: reduce las descripciones de tools sin perder semántica.
  "Search across all connected data stores using a text query. Returns matching
  items with title, content, and metadata." → "Search data stores by text query"

### Observability (semana 3-4)

- **Trace Store**: cada tool call se registra con timestamp, input, output,
  latencia, tokens, costo.
- **Dashboard**: web UI con:
  - Timeline de calls por sesión
  - Token usage por tool/server
  - Costo acumulado
  - Error rate por tool
  - Loop detection (misma tool llamada 3+ veces con mismo input)
- **Alerts**: webhook/email cuando se detecta un loop, un tool falla repetidamente,
  o se excede un budget.

## Tech stack

- **Runtime**: Node.js 22+ (mismo que Nexo — reciclamos experiencia)
- **Language**: TypeScript strict
- **MCP**: @modelcontextprotocol/sdk (oficial)
- **Web UI**: Preact + Vite (ligero, probado en Nexo)
- **Storage**: SQLite para traces (zero-config, embebido)
- **Package**: publicar en npm como `prism-mcp` o `@prism-ai/proxy`
- **Config**: TOML (consistente con Nexo)

## Diferenciadores vs alternativas

| Feature | Prism | LangSmith | LangFuse | Helicone |
|---------|-------|-----------|----------|----------|
| Open source | ✅ | ❌ | ✅ | Parcial |
| MCP nativo | ✅ | ❌ | ❌ | ❌ |
| Context routing | ✅ | ❌ | ❌ | ❌ |
| Token budget | ✅ | ❌ | ❌ | ❌ |
| Self-hosted | ✅ | ❌ | ✅ | ✅ |
| Zero config | ✅ | ❌ | ❌ | ❌ |
| Precio | Gratis | $400/mes | $59/mes | $120/mes |

## Modelo de negocio

- **Open source** (MIT): proxy + dashboard básico
- **Cloud hosted** ($19/mes): traces persistentes, alertas, team sharing
- **Enterprise** ($99/mes): SSO, audit log, SLA

## Plan de implementación

### Phase 0 — Foundation (3 días)
- Monorepo con npm workspaces
- MCP proxy básico (stdio passthrough)
- Config TOML
- CI con GitHub Actions

### Phase 1 — Context Router (1 semana)
- Tool registry con catálogo de todos los servers
- Intent-based filtering (keywords + historial)
- Schema compression
- Token budget manager
- Tests

### Phase 2 — Observability (1 semana)
- Trace store (SQLite)
- Dashboard web (Preact + Vite)
- Token/cost tracking
- Error/loop detection
- Alerts (webhook)

### Phase 3 — Polish + Launch (1 semana)
- npm publish
- README con quickstart
- Demo con Claude Code + 5 MCP servers
- Post en Hacker News / Reddit
- GitHub repo con examples

## Ejemplo de uso

```bash
# Instalar
npm install -g prism-mcp

# Configurar (prism.toml)
[budget]
max_tokens = 8000  # máximo de tokens para tool descriptions

[[servers]]
name = "filesystem"
command = "npx @modelcontextprotocol/server-filesystem /home/user"

[[servers]]
name = "github"
command = "npx @modelcontextprotocol/server-github"
env = { GITHUB_TOKEN = "ghp_..." }

[[servers]]
name = "slack"
command = "npx @modelcontextprotocol/server-slack"

# Arrancar
prism start

# Usar desde Claude Code
claude --mcp-config prism.toml
```

## Definición de éxito

- 1000 GitHub stars en el primer mes
- Mencionado en al menos 2 newsletters de AI
- 100 instalaciones npm por semana
- Usado con Claude Code, Cursor, o Aider en al menos un blog post
