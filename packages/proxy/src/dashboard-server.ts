import express from 'express'
import type { Server } from 'http'
import { TraceStore } from './trace-store'
import path from 'path'
import pino from 'pino'

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
    // API routes
    this.app.get('/api/traces', (_req, res) => {
      const limit = Number(_req.query.limit) || 50
      const traces = this.traceStore.getRecent(limit)
      res.json(traces)
    })

    this.app.get('/api/sessions', (_req, res) => {
      const limit = Number(_req.query.limit) || 20
      const sessions = this.traceStore.getAllSessions(limit)
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
      res.json({ status: 'ok', version: '0.1.0' })
    })

    // Serve dashboard static files (built Preact app)
    const dashboardDist = path.resolve(__dirname, '../../dashboard/dist')
    this.app.use(express.static(dashboardDist))

    // SPA fallback — serve index.html for all non-API routes
    this.app.get('*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'), (err) => {
        if (err) {
          res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Prism Dashboard</title></head>
            <body>
              <h1>Prism Dashboard</h1>
              <p>Dashboard UI not built yet. API available at:</p>
              <ul>
                <li><a href="/api/health">/api/health</a></li>
                <li><a href="/api/traces">/api/traces</a></li>
                <li><a href="/api/sessions">/api/sessions</a></li>
              </ul>
            </body>
            </html>
          `)
        }
      })
    })
  }

  /**
   * Start the dashboard server on the given port.
   */
  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        this.logger.info({ port }, 'Dashboard server started')
        resolve()
      })
    })
  }

  /**
   * Stop the dashboard server.
   */
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
