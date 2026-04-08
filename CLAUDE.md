# Prism — MCP Context Router + Agent Observability

## Project overview

Prism is an open-source MCP proxy that sits between AI agents and MCP servers.
It reduces token waste by filtering/compressing tool schemas on-demand, and
provides observability (traces, costs, errors) for every tool call.

## Tech stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.5+ (strict mode)
- **Monorepo**: Turborepo + npm workspaces
- **MCP**: @modelcontextprotocol/sdk
- **Dashboard**: Preact + Vite (Phase 2)
- **Storage**: SQLite (Phase 2)
- **Config**: TOML
- **Testing**: Vitest
- **Linting**: ESLint flat config + Prettier

## Commands

```
npm install        # Install dependencies
npm run build      # Build all packages
npm run test       # Run tests
npm run lint       # Lint
npm run typecheck  # TypeScript check
```

## Coding conventions

- Result<T> pattern: `ok(value)` / `err(new Error(msg))`
- Strict TypeScript: no `any`, no implicit returns
- Named exports, kebab-case files
- Tests colocated: `foo.ts` → `foo.test.ts`

## Monorepo structure

```
packages/
  types/    → Shared interfaces (McpTool, PrismConfig, TraceRecord)
  proxy/    → Core proxy: ToolRegistry, ContextFilter, SchemaCompressor
  cli/      → CLI: prism start, prism status
  dashboard → Web UI for traces + costs (Phase 2)
```

## Claude Code behavior — AUTONOMY

- Work autonomously. Execute tasks end-to-end.
- Only pause if genuinely ambiguous.
- Conventional commits. Branch per feature.
- Run build + lint + test before committing.
