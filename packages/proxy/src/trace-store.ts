import type { TraceRecord, SessionSummary } from 'prism-mcp-types'
import Database from 'better-sqlite3'
import crypto from 'crypto'
import pino from 'pino'

/**
 * TraceStore — persists tool call traces to SQLite.
 */
export class TraceStore {
  private db: Database.Database

  constructor(
    dbPath: string,
    private logger: pino.Logger,
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id);
      CREATE INDEX IF NOT EXISTS idx_traces_tool ON traces(tool_name);
      CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(started_at);
    `)
    this.logger.debug('Trace store migrated')
  }

  /**
   * Record a new trace.
   */
  insert(trace: TraceRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO traces (id, session_id, server_name, tool_name, input, output,
        started_at, completed_at, duration_ms, input_tokens, output_tokens, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      trace.id,
      trace.sessionId,
      trace.serverName,
      trace.toolName,
      JSON.stringify(trace.input),
      JSON.stringify(trace.output),
      trace.startedAt.toISOString(),
      trace.completedAt.toISOString(),
      trace.durationMs,
      trace.inputTokens,
      trace.outputTokens,
      trace.error ?? null,
    )
  }

  /**
   * Get recent traces, newest first.
   */
  getRecent(limit = 50): TraceRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM traces ORDER BY started_at DESC LIMIT ?',
    ).all(limit) as TraceRow[]

    return rows.map(rowToTrace)
  }

  /**
   * Get traces for a specific session.
   */
  getBySession(sessionId: string): TraceRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM traces WHERE session_id = ? ORDER BY started_at ASC',
    ).all(sessionId) as TraceRow[]

    return rows.map(rowToTrace)
  }

  /**
   * Get session summary — aggregated stats for a session.
   */
  getSessionSummary(sessionId: string): SessionSummary | undefined {
    const row = this.db.prepare(`
      SELECT
        session_id,
        MIN(started_at) as first_started,
        COUNT(*) as tool_calls,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors
      FROM traces
      WHERE session_id = ?
      GROUP BY session_id
    `).get(sessionId) as SessionRow | undefined

    if (!row) return undefined

    return {
      id: row.session_id,
      startedAt: new Date(row.first_started),
      toolCalls: row.tool_calls,
      totalTokens: row.total_tokens,
      totalCostUsd: estimateCost(row.total_tokens),
      errors: row.errors,
    }
  }

  /**
   * Get all session summaries, most recent first.
   */
  getAllSessions(limit = 20): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT
        session_id,
        MIN(started_at) as first_started,
        COUNT(*) as tool_calls,
        SUM(input_tokens + output_tokens) as total_tokens,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors
      FROM traces
      GROUP BY session_id
      ORDER BY first_started DESC
      LIMIT ?
    `).all(limit) as SessionRow[]

    return rows.map(row => ({
      id: row.session_id,
      startedAt: new Date(row.first_started),
      toolCalls: row.tool_calls,
      totalTokens: row.total_tokens,
      totalCostUsd: estimateCost(row.total_tokens),
      errors: row.errors,
    }))
  }

  /**
   * Detect error loops — tools that failed N+ times in the last M calls.
   */
  detectErrorLoops(sessionId: string, threshold = 3, window = 10): string[] {
    const rows = this.db.prepare(`
      SELECT tool_name, COUNT(*) as error_count
      FROM (
        SELECT tool_name, error FROM traces
        WHERE session_id = ? AND error IS NOT NULL
        ORDER BY started_at DESC
        LIMIT ?
      )
      GROUP BY tool_name
      HAVING error_count >= ?
    `).all(sessionId, window, threshold) as Array<{ tool_name: string; error_count: number }>

    return rows.map(r => r.tool_name)
  }

  /**
   * Detect call loops — same tool called N+ times in the last M calls.
   */
  detectCallLoops(sessionId: string, threshold = 5, window = 10): string[] {
    const rows = this.db.prepare(`
      SELECT tool_name, COUNT(*) as call_count
      FROM (
        SELECT tool_name FROM traces
        WHERE session_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      )
      GROUP BY tool_name
      HAVING call_count >= ?
    `).all(sessionId, window, threshold) as Array<{ tool_name: string; call_count: number }>

    return rows.map(r => r.tool_name)
  }

  /**
   * Clear all traces.
   */
  clearAll(): number {
    const result = this.db.prepare('DELETE FROM traces').run()
    return result.changes
  }

  /**
   * Generate a new trace ID.
   */
  static generateId(): string {
    return crypto.randomUUID()
  }

  /**
   * Close the database.
   */
  close(): void {
    this.db.close()
  }
}

// --- internal helpers ---

interface TraceRow {
  id: string
  session_id: string
  server_name: string
  tool_name: string
  input: string
  output: string
  started_at: string
  completed_at: string
  duration_ms: number
  input_tokens: number
  output_tokens: number
  error: string | null
}

interface SessionRow {
  session_id: string
  first_started: string
  tool_calls: number
  total_tokens: number
  errors: number
}

function rowToTrace(row: TraceRow): TraceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    serverName: row.server_name,
    toolName: row.tool_name,
    input: JSON.parse(row.input) as Record<string, unknown>,
    output: JSON.parse(row.output) as unknown,
    startedAt: new Date(row.started_at),
    completedAt: new Date(row.completed_at),
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    error: row.error ?? undefined,
  }
}

/**
 * Estimate cost in USD based on token count.
 * Uses Claude Sonnet average: ~$3/MTok input, ~$15/MTok output → ~$9/MTok blended.
 * This is a rough approximation — actual cost depends on model and input/output ratio.
 */
function estimateCost(tokens: number): number {
  return (tokens / 1_000_000) * 9
}
