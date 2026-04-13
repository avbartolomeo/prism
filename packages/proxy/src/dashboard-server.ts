import express from 'express'
import type { Server } from 'http'
import { ToolRegistry } from './tool-registry'
import { TraceStore } from './trace-store'
import path from 'path'
import fs from 'fs'
import pino from 'pino'
import { VERSION } from './version'

/**
 * DashboardServer — HTTP API + static file server for the Prism dashboard.
 */
export class DashboardServer {
  private app: express.Application
  private server: Server | undefined

  constructor(
    private traceStore: TraceStore,
    private logger: pino.Logger,
    private registry?: ToolRegistry,
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

    this.app.get('/api/servers', (_req, res) => {
      if (!this.registry) {
        res.json([])
        return
      }
      const allTools = this.registry.getAllTools()
      const serverMap = new Map<string, { name: string; tools: string[] }>()
      for (const tool of allTools) {
        const entry = serverMap.get(tool.serverName) ?? { name: tool.serverName, tools: [] }
        entry.tools.push(tool.name)
        serverMap.set(tool.serverName, entry)
      }
      res.json([...serverMap.values()])
    })

    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', version: VERSION })
    })

    this.app.delete('/api/traces', (_req, res) => {
      const deleted = this.traceStore.clearAll()
      this.logger.info({ deleted }, 'All traces cleared')
      res.json({ deleted })
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
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }

    /* Header */
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    h1 { font-size: 22px; color: #a78bfa; font-weight: 700; }
    h1 span { color: #64748b; font-weight: 400; font-size: 13px; margin-left: 8px; }
    .live { display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Stats */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px 20px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #f8fafc; }
    .stat-value.error { color: #f87171; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Tabs + filters */
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .tabs { display: flex; gap: 4px; background: #1e293b; border-radius: 8px; padding: 3px; }
    .tab { padding: 7px 16px; border: none; border-radius: 6px; background: transparent; color: #94a3b8; cursor: pointer; font-size: 13px; font-weight: 500; }
    .tab.active { background: #7c3aed; color: #fff; }
    .tab:hover:not(.active) { color: #e2e8f0; }
    .filters { display: flex; gap: 8px; flex: 1; }
    select, input { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 7px 12px; color: #e2e8f0; font-size: 13px; outline: none; }
    select:focus, input:focus { border-color: #7c3aed; }
    input { min-width: 200px; }

    /* Table */
    table { width: 100%; border-collapse: collapse; }
    thead { position: sticky; top: 0; background: #0f172a; }
    th { text-align: left; padding: 10px 14px; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #1e293b; }
    td { padding: 10px 14px; border-bottom: 1px solid #1e293b; font-size: 13px; vertical-align: top; }
    tr:hover { background: #1e293b44; }
    .error-row { background: #450a0a22; }
    .error-row:hover { background: #450a0a44; }

    /* Cell styles */
    .tool-name { font-weight: 600; color: #c4b5fd; }
    .server-name { color: #94a3b8; }
    .time { color: #64748b; font-variant-numeric: tabular-nums; }
    .duration { font-variant-numeric: tabular-nums; }
    .duration.slow { color: #fb923c; }
    .duration.fast { color: #4ade80; }
    .tokens { font-variant-numeric: tabular-nums; color: #94a3b8; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-ok { background: #052e16; color: #4ade80; }
    .badge-error { background: #450a0a; color: #f87171; }

    /* Detail row */
    .detail { display: none; }
    .detail.open { display: table-row; }
    .detail td { padding: 12px 14px; background: #1e293b; }
    .detail-content { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .detail-section h4 { font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
    .detail-section pre { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; font-size: 12px; color: #e2e8f0; overflow-x: auto; max-height: 200px; white-space: pre-wrap; word-break: break-all; }

    /* Empty state */
    .empty { text-align: center; padding: 60px 20px; color: #475569; }
    .empty h3 { color: #64748b; margin-bottom: 8px; }

    /* Reset button */
    .btn-reset { padding: 7px 16px; border: 1px solid #dc2626; border-radius: 6px; background: transparent; color: #f87171; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-reset:hover { background: #dc262622; }
    .version { color: #475569; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span class="live"></span>Prism <span>MCP Context Router</span></h1>
      <div style="display:flex;align-items:center;gap:16px">
        <span class="version">v${VERSION}</span>
        <button class="btn-reset" onclick="resetTraces()">Reset traces</button>
      </div>
    </header>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <div class="tabs">
        <button class="tab active" onclick="showTab('traces',this)">Traces</button>
        <button class="tab" onclick="showTab('sessions',this)">Sessions</button>
        <button class="tab" onclick="showTab('servers',this)">Servers</button>
      </div>
      <div class="filters" id="filters"></div>
    </div>
    <div id="content"></div>
  </div>

  <script>
    let currentTab = 'traces';
    let allTraces = [];
    let filterServer = '';
    let filterTool = '';
    let filterStatus = '';
    let filterSearch = '';

    function showTab(tab, el) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      fetchData();
    }

    async function fetchData() {
      try {
        if (currentTab === 'traces') {
          const res = await fetch('/api/traces?limit=200');
          allTraces = await res.json();
          renderFilters();
          applyFilters();
        } else if (currentTab === 'sessions') {
          document.getElementById('filters').innerHTML = '';
          const res = await fetch('/api/sessions?limit=20');
          renderSessions(await res.json());
        } else if (currentTab === 'servers') {
          document.getElementById('filters').innerHTML = '';
          const res = await fetch('/api/servers');
          renderServers(await res.json());
        }
      } catch (e) {
        document.getElementById('content').innerHTML = '<div class="empty"><h3>Connection error</h3>' + e.message + '</div>';
      }
    }

    function renderFilters() {
      const servers = [...new Set(allTraces.map(t => t.serverName))].sort();
      const tools = [...new Set(allTraces.map(t => t.toolName))].sort();
      let html = '<select onchange="filterServer=this.value;applyFilters()"><option value="">All servers</option>';
      servers.forEach(s => html += '<option value="'+s+'"' + (filterServer===s?' selected':'') + '>'+s+'</option>');
      html += '</select>';
      html += '<select onchange="filterTool=this.value;applyFilters()"><option value="">All tools</option>';
      tools.forEach(t => html += '<option value="'+t+'"' + (filterTool===t?' selected':'') + '>'+t+'</option>');
      html += '</select>';
      html += '<select onchange="filterStatus=this.value;applyFilters()"><option value="">All status</option><option value="ok"' + (filterStatus==='ok'?' selected':'') + '>OK</option><option value="error"' + (filterStatus==='error'?' selected':'') + '>Errors</option></select>';
      html += '<input type="text" placeholder="Search input/output..." value="'+filterSearch.replace(/"/g,'&quot;')+'" oninput="filterSearch=this.value;applyFilters()">';
      document.getElementById('filters').innerHTML = html;
    }

    function applyFilters() {
      let filtered = allTraces;
      if (filterServer) filtered = filtered.filter(t => t.serverName === filterServer);
      if (filterTool) filtered = filtered.filter(t => t.toolName === filterTool);
      if (filterStatus === 'ok') filtered = filtered.filter(t => !t.error);
      if (filterStatus === 'error') filtered = filtered.filter(t => t.error);
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        filtered = filtered.filter(t =>
          JSON.stringify(t.input||{}).toLowerCase().includes(q) ||
          JSON.stringify(t.output||{}).toLowerCase().includes(q) ||
          t.toolName.toLowerCase().includes(q)
        );
      }
      renderTraces(filtered);
      renderStats(filtered);
    }

    async function resetTraces() {
      if (!confirm('Clear all traces? This cannot be undone.')) return;
      await fetch('/api/traces', { method: 'DELETE' });
      fetchData();
    }

    function renderStats(traces) {
      const total = traces.length;
      const tokens = traces.reduce((s, t) => s + (t.inputTokens||0) + (t.outputTokens||0), 0);
      const errors = traces.filter(t => t.error).length;
      const avgMs = total > 0 ? Math.round(traces.reduce((s, t) => s + t.durationMs, 0) / total) : 0;
      document.getElementById('stats').innerHTML =
        stat(total, 'Tool Calls') +
        stat(tokens.toLocaleString(), 'Tokens') +
        stat(errors, 'Errors', errors > 0) +
        stat(avgMs + 'ms', 'Avg Latency');
    }

    function stat(value, label, isError) {
      return '<div class="stat"><div class="stat-value' + (isError ? ' error' : '') + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
    }

    function toggleDetail(id) {
      const row = document.getElementById('detail-' + id);
      if (row) row.classList.toggle('open');
    }

    function fmt(obj) {
      try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
    }

    function renderTraces(traces) {
      if (!traces.length) {
        document.getElementById('content').innerHTML = '<div class="empty"><h3>No traces yet</h3>Use tools through Claude Code and they will appear here.</div>';
        return;
      }
      let html = '<table><thead><tr><th>Time</th><th>Server</th><th>Tool</th><th>Duration</th><th>Tokens</th><th>Status</th><th>Input</th></tr></thead><tbody>';
      for (const t of traces) {
        const time = new Date(t.startedAt).toLocaleTimeString();
        const tokens = (t.inputTokens||0) + (t.outputTokens||0);
        const durClass = t.durationMs > 1000 ? 'slow' : t.durationMs < 100 ? 'fast' : '';
        const status = t.error ? '<span class="badge badge-error">error</span>' : '<span class="badge badge-ok">ok</span>';
        const inputStr = JSON.stringify(t.input||{});
        const inputShort = inputStr.length > 80 ? inputStr.slice(0,77)+'...' : inputStr;
        const cls = t.error ? ' class="error-row"' : '';
        html += '<tr' + cls + ' onclick="toggleDetail(\\'' + t.id + '\\')" style="cursor:pointer">';
        html += '<td class="time">' + time + '</td>';
        html += '<td class="server-name">' + t.serverName + '</td>';
        html += '<td class="tool-name">' + t.toolName + '</td>';
        html += '<td class="duration ' + durClass + '">' + t.durationMs + 'ms</td>';
        html += '<td class="tokens">' + tokens + '</td>';
        html += '<td>' + status + '</td>';
        html += '<td style="font-family:monospace;font-size:12px;color:#94a3b8;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + inputShort.replace(/</g,'&lt;') + '</td>';
        html += '</tr>';
        html += '<tr class="detail" id="detail-' + t.id + '"><td colspan="7"><div class="detail-content">';
        html += '<div class="detail-section"><h4>Input</h4><pre>' + fmt(t.input).replace(/</g,'&lt;') + '</pre></div>';
        html += '<div class="detail-section"><h4>Output</h4><pre>' + fmt(t.output).replace(/</g,'&lt;') + '</pre></div>';
        if (t.error) html += '<div class="detail-section" style="grid-column:span 2"><h4>Error</h4><pre style="color:#f87171">' + t.error + '</pre></div>';
        html += '</div></td></tr>';
      }
      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    function renderSessions(sessions) {
      if (!sessions.length) { document.getElementById('content').innerHTML = '<div class="empty"><h3>No sessions yet</h3></div>'; return; }
      renderSessionStats(sessions);
      let html = '<table><thead><tr><th>Session</th><th>Started</th><th>Tool Calls</th><th>Tokens</th><th>Errors</th></tr></thead><tbody>';
      for (const s of sessions) {
        const time = new Date(s.startedAt).toLocaleString();
        const cls = s.errors > 0 ? ' class="error-row"' : '';
        html += '<tr' + cls + '>';
        html += '<td style="font-family:monospace;font-size:12px">' + s.id.slice(0,8) + '</td>';
        html += '<td class="time">' + time + '</td>';
        html += '<td>' + s.toolCalls + '</td>';
        html += '<td class="tokens">' + s.totalTokens.toLocaleString() + '</td>';
        html += '<td>' + (s.errors > 0 ? '<span class="badge badge-error">' + s.errors + '</span>' : '<span class="badge badge-ok">0</span>') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      document.getElementById('content').innerHTML = html;
    }

    function renderSessionStats(sessions) {
      const totalCalls = sessions.reduce((s,x) => s + x.toolCalls, 0);
      const totalTokens = sessions.reduce((s,x) => s + x.totalTokens, 0);
      const totalErrors = sessions.reduce((s,x) => s + x.errors, 0);
      document.getElementById('stats').innerHTML =
        stat(sessions.length, 'Sessions') +
        stat(totalCalls, 'Total Calls') +
        stat(totalTokens.toLocaleString(), 'Total Tokens') +
        stat(totalErrors, 'Total Errors', totalErrors > 0);
    }

    function renderServers(servers) {
      if (!servers.length) {
        document.getElementById('stats').innerHTML = '';
        document.getElementById('content').innerHTML = '<div class="empty"><h3>No servers connected</h3></div>';
        return;
      }
      const totalTools = servers.reduce((s, x) => s + x.tools.length, 0);
      document.getElementById('stats').innerHTML =
        stat(servers.length, 'Servers') +
        stat(totalTools, 'Total Tools');
      let html = '';
      for (const s of servers) {
        html += '<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:20px;margin-bottom:16px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
        html += '<div><span style="font-size:16px;font-weight:600;color:#c4b5fd">' + s.name + '</span>';
        html += '<span style="color:#64748b;font-size:13px;margin-left:12px">' + s.tools.length + ' tools</span></div>';
        html += '<span class="badge badge-ok">connected</span></div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        for (const t of s.tools) {
          html += '<span style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:4px 10px;font-size:12px;color:#94a3b8">' + t + '</span>';
        }
        html += '</div></div>';
      }
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
