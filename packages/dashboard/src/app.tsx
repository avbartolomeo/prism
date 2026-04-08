import { useState, useEffect } from 'preact/hooks'

interface TraceRecord {
  id: string
  sessionId: string
  serverName: string
  toolName: string
  input: Record<string, unknown>
  output: unknown
  startedAt: string
  completedAt: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  error?: string
}

interface SessionSummary {
  id: string
  startedAt: string
  toolCalls: number
  totalTokens: number
  totalCostUsd: number
  errors: number
}

type View = 'traces' | 'sessions'

export function App() {
  const [view, setView] = useState<View>('traces')
  const [traces, setTraces] = useState<TraceRecord[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [view])

  async function fetchData() {
    try {
      setLoading(true)
      if (view === 'traces') {
        const res = await fetch('/api/traces?limit=100')
        setTraces(await res.json())
      } else {
        const res = await fetch('/api/sessions?limit=20')
        setSessions(await res.json())
      }
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Prism Dashboard</h1>
        <nav style={styles.nav}>
          <button
            style={view === 'traces' ? styles.activeTab : styles.tab}
            onClick={() => setView('traces')}
          >
            Traces
          </button>
          <button
            style={view === 'sessions' ? styles.activeTab : styles.tab}
            onClick={() => setView('sessions')}
          >
            Sessions
          </button>
        </nav>
      </header>

      {error && <div style={styles.error}>{error}</div>}
      {loading && traces.length === 0 && sessions.length === 0 && (
        <div style={styles.loading}>Loading...</div>
      )}

      {view === 'traces' && <TracesTable traces={traces} />}
      {view === 'sessions' && <SessionsTable sessions={sessions} />}
    </div>
  )
}

function TracesTable({ traces }: { traces: TraceRecord[] }) {
  if (traces.length === 0) return <div style={styles.empty}>No traces yet</div>

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Time</th>
          <th style={styles.th}>Server</th>
          <th style={styles.th}>Tool</th>
          <th style={styles.th}>Duration</th>
          <th style={styles.th}>Tokens</th>
          <th style={styles.th}>Status</th>
          <th style={styles.th}>Input</th>
        </tr>
      </thead>
      <tbody>
        {traces.map(t => (
          <tr key={t.id} style={t.error ? styles.errorRow : undefined}>
            <td style={styles.td}>{formatTime(t.startedAt)}</td>
            <td style={styles.td}>{t.serverName}</td>
            <td style={styles.tdBold}>{t.toolName}</td>
            <td style={styles.td}>{t.durationMs}ms</td>
            <td style={styles.td}>{t.inputTokens + t.outputTokens}</td>
            <td style={styles.td}>
              {t.error ? <span style={styles.badge.error}>error</span> : <span style={styles.badge.ok}>ok</span>}
            </td>
            <td style={styles.tdCode}>{truncate(JSON.stringify(t.input), 60)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) return <div style={styles.empty}>No sessions yet</div>

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Session</th>
          <th style={styles.th}>Started</th>
          <th style={styles.th}>Tool Calls</th>
          <th style={styles.th}>Total Tokens</th>
          <th style={styles.th}>Cost (USD)</th>
          <th style={styles.th}>Errors</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} style={s.errors > 0 ? styles.errorRow : undefined}>
            <td style={styles.tdCode}>{s.id.slice(0, 8)}...</td>
            <td style={styles.td}>{formatTime(s.startedAt)}</td>
            <td style={styles.td}>{s.toolCalls}</td>
            <td style={styles.td}>{s.totalTokens.toLocaleString()}</td>
            <td style={styles.td}>${s.totalCostUsd.toFixed(4)}</td>
            <td style={styles.td}>
              {s.errors > 0 ? <span style={styles.badge.error}>{s.errors}</span> : <span style={styles.badge.ok}>0</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString()
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    color: '#e0e0e0',
    backgroundColor: '#1a1a2e',
    minHeight: '100vh',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #333',
    paddingBottom: '16px',
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#7c3aed',
    margin: 0,
  },
  nav: { display: 'flex', gap: '8px' },
  tab: {
    padding: '8px 16px',
    border: '1px solid #444',
    borderRadius: '6px',
    background: 'transparent',
    color: '#999',
    cursor: 'pointer',
    fontSize: '14px',
  },
  activeTab: {
    padding: '8px 16px',
    border: '1px solid #7c3aed',
    borderRadius: '6px',
    background: '#7c3aed22',
    color: '#7c3aed',
    cursor: 'pointer',
    fontSize: '14px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '2px solid #333',
    color: '#888',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    fontSize: '11px',
    letterSpacing: '0.5px',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2a3e',
  },
  tdBold: {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2a3e',
    fontWeight: 600,
    color: '#c4b5fd',
  },
  tdCode: {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2a3e',
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#888',
  },
  errorRow: {
    backgroundColor: '#3a1a1a',
  },
  badge: {
    ok: {
      background: '#065f46',
      color: '#6ee7b7',
      padding: '2px 8px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 600,
    },
    error: {
      background: '#7f1d1d',
      color: '#fca5a5',
      padding: '2px 8px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 600,
    },
  },
  loading: { textAlign: 'center' as const, padding: '40px', color: '#666' },
  empty: { textAlign: 'center' as const, padding: '40px', color: '#666' },
  error: {
    background: '#7f1d1d',
    color: '#fca5a5',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '16px',
  },
} as const
