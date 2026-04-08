import express from 'express'
import type { Server } from 'http'
import { TraceStore } from './trace-store'
import path from 'path'
import fs from 'fs'
import pino from 'pino'

// Read version from package.json at build time
const VERSION = '0.1.3'

/**
 * DashboardServer — HTTP API + static file server for the Prism dashboard.
 */
export class DashboardServer {
  private app: express.Application
  private server: Server | undefined

  constructor(
    private traceStore: TraceStore,
    private logger: pino.Logger,
  ) {
    this.app = express()
    this.setupRoutes()
  }

  private setupRoutes(): void {
    // CORS for local dev
    this.app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      next()
    })

    // API routes
    this.app.get('/api/traces', (_req, res) => {
      const limit = Number(_req.query.limit) || 50
      const traces = this.traceStore.getRecent(limit)
      this.logger.debug({ count: traces.length }, 'GET /api/traces')
      res.json(traces)
    })

    this.app.get('/api/sessions', (_req, res) => {
      const limit = Number(_req.query.limit) || 20
      const sessions = this.traceStore.getAllSessions(limit)
      this.logger.debug({ count: sessions.length }, 'GET /api/sessions')
      res.json(sessions)
    })

    this.app.get('/api/sessions/:id', (req, res) => {
      const summary = this.traceStore.getSessionSummary(req.params.id)
      if (!summary) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const traces = this.traceStore.getBySession(req.params.id)
      res.json({ summary, traces })
    })

    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', version: VERSION })
    })

    // Try to serve dashboard static files from multiple locations
    const possibleDashboardPaths = [
      path.resolve(__dirname, '../../dashboard/dist'),       // monorepo dev
      path.resolve(__dirname, '../../../dashboard/dist'),     // npm global install
    ]

    let dashboardDist: string | undefined
    for (const p of possibleDashboardPaths) {
      if (fs.existsSync(p)) {
        dashboardDist = p
        break
      }
    }

    if (dashboardDist) {
      this.app.use(express.static(dashboardDist))
      this.logger.debug({ path: dashboardDist }, 'Serving dashboard static files')
    }

    // SPA fallback / inline dashboard
    this.app.get('{*path}', (_req, res) => {
      if (dashboardDist) {
        const indexPath = path.join(dashboardDist, 'index.html')
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath)
          return
        }
      }

      // Inline minimal dashboard when static files aren't available
      res.status(200).send(this.getInlineDashboard())
    })
  }

  /**
   * Inline dashboard HTML — works when the Preact build isn't available
   * (e.g. global npm install). Fetches data from the API endpoints.
   */
  private getInlineDashboard(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prism Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
    h1 { color: #7c3aed; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 24px; font-size: 14px; }
    .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab { padding: 8px 16px; border: 1px solid #444; border-radius: 6px; background: transparent; color: #999; cursor: pointer; font-size: 14px; }
    .tab.active { border-color: #7c3aed; background: #7c3aed22; color: #7c3aed; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #333; color: #888; font-weight: 600; text-transform: uppercase; font-size: 11px; }
    td { padding: 8px 12px; border-bottom: 1px solid #2a2a3e; }
    .tool { font-weight: 600; color: #c4b5fd; }
    .mono { font-family: monospace; font-size: 12px; color: #888; }
    .ok { background: #065f46; color: #6ee7b7; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    .error { background: #7f1d1d; color: #fca5a5; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    .error-row { background: #3a1a1a; }
    .empty { text-align: center; padding: 40px; color: #666; }
    .stats { display: flex; gap: 24px; margin-bottom: 20px; }
    .stat { background: #2a2a3e; padding: 16px; border-radius: 8px; min-width: 150px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #c4b5fd; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Prism Dashboard</h1>
  <div class="subtitle">MCP Context Router + Observability — auto-refreshes every 5s</div>
  <div class="stats" id="stats"></div>
  <div class="tabs">
    <button class="tab active" onclick="showTab('traces')">Traces</button>
    <button class="tab" onclick="showTab('sessions')">Sessions</button>
  </div>
  <div id="content"></div>

  <script>
    let currentTab = 'traces';

    function showTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      fetchData();
    }

    async function fetchData() {
      try {
        if (currentTab === 'traces') {
          const res = await fetch('/api/traces?limit=100');
          const traces = await res.json();
          renderTraces(traces);
          renderStats(traces);
        } else {
          const res = await fetch('/api/sessions?limit=20');
          const sessions = await res.json();
          renderSessions(sessions);
        }
      } catch (e) {
        document.getElementById('content').innerHTML = '<div class="empty">Error fetching data: ' + e.message + '</div>';
      }
    }

    function renderStats(traces) {
      const total = traces.length;
      const tokens = traces.reduce((s, t) => s + (t.inputTokens || 0) + (t.outputTokens || 0), 0);
      const errors = traces.filter(t => t.error).length;
      const avgMs = total > 0 ? Math.round(traces.reduce((s, t) => s + t.durationMs, 0) / total) : 0;
      document.getElementById('stats').innerHTML =
        '<div class="stat"><div class="stat-value">' + total + '</div><div class="stat-label">Tool Calls</div></div>' +
        '<div class="stat"><div class="stat-value">' + tokens.toLocaleString() + '</div><div class="stat-label">Tokens</div></div>' +
        '<div class="stat"><div class="stat-value">' + errors + '</div><div class="stat-label">Errors</div></div>' +
        '<div class="stat"><div class="stat-value">' + avgMs + 'ms</div><div class="stat-label">Avg Duration</div></div>';
    }

    function renderTraces(traces) {
      if (!traces.length) { document.getElementById('content').innerHTML = '<div class="empty">No traces yet. Use tools through Claude Code and they will appear here.</div>'; return; }
      let html = '<table><thead><tr><th>Time</th><th>Server</th><th>Tool</th><th>Duration</th><th>Tokens</th><th>Status</th><th>Input</th></tr></thead><tbody>';
      for (const t of traces) {
        const time = new Date(t.startedAt).toLocaleTimeString();
        const tokens = (t.inputTokens || 0) + (t.outputTokens || 0);
        const status = t.error ? '<span class="error">error</span>' : '<span class="ok">ok</span>';
        const input = JSON.stringify(t.input || {}).slice(0, 60);
        const cls = t.error ? ' class="error-row"' : '';
        html += '<tr' + cls + '><td>' + time + '</td><td>' + t.serverName + '</td><td class="tool">' + t.toolName + '</td><td>' + t.durationMs + 'ms</td><td>' + tokens + '</td><td>' + status + '</td><td class="mono">' + input + '</td></tr>';
      }
      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    function renderSessions(sessions) {
      if (!sessions.length) { document.getElementById('content').innerHTML = '<div class="empty">No sessions yet.</div>'; return; }
      let html = '<table><thead><tr><th>Session</th><th>Started</th><th>Tool Calls</th><th>Tokens</th><th>Cost (USD)</th><th>Errors</th></tr></thead><tbody>';
      for (const s of sessions) {
        const time = new Date(s.startedAt).toLocaleTimeString();
        const cls = s.errors > 0 ? ' class="error-row"' : '';
        html += '<tr' + cls + '><td class="mono">' + s.id.slice(0,8) + '...</td><td>' + time + '</td><td>' + s.toolCalls + '</td><td>' + s.totalTokens.toLocaleString() + '</td><td>$' + s.totalCostUsd.toFixed(4) + '</td><td>' + (s.errors > 0 ? '<span class="error">' + s.errors + '</span>' : '<span class="ok">0</span>') + '</td></tr>';
      }
      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    fetchData();
    setInterval(fetchData, 5000);
  </script>
</body>
</html>`
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        this.logger.info({ port }, 'Dashboard server started')
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}
