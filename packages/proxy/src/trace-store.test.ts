import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraceStore } from './trace-store'
import type { TraceRecord } from '@prism-mcp/types'
import fs from 'fs'
import path from 'path'
import os from 'os'
import pino from 'pino'

const logger = pino({ level: 'silent' })

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  const now = new Date()
  return {
    id: TraceStore.generateId(),
    sessionId: 'test-session',
    serverName: 'mock',
    toolName: 'echo',
    input: { message: 'hello' },
    output: { content: [{ type: 'text', text: 'hello' }] },
    startedAt: now,
    completedAt: new Date(now.getTime() + 50),
    durationMs: 50,
    inputTokens: 10,
    outputTokens: 5,
    ...overrides,
  }
}

describe('TraceStore', () => {
  let store: TraceStore
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `prism-test-${Date.now()}.db`)
    store = new TraceStore(dbPath, logger)
  })

  afterEach(() => {
    store.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal') } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm') } catch { /* ignore */ }
  })

  it('should insert and retrieve a trace', () => {
    const trace = makeTrace()
    store.insert(trace)

    const recent = store.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0].id).toBe(trace.id)
    expect(recent[0].toolName).toBe('echo')
    expect(recent[0].input).toEqual({ message: 'hello' })
  })

  it('should retrieve traces by session', () => {
    store.insert(makeTrace({ sessionId: 'session-a', toolName: 'echo' }))
    store.insert(makeTrace({ sessionId: 'session-a', toolName: 'add' }))
    store.insert(makeTrace({ sessionId: 'session-b', toolName: 'greet' }))

    const sessionA = store.getBySession('session-a')
    expect(sessionA).toHaveLength(2)

    const sessionB = store.getBySession('session-b')
    expect(sessionB).toHaveLength(1)
  })

  it('should return traces in correct order', () => {
    const t1 = makeTrace({ startedAt: new Date('2025-01-01T00:00:00Z'), completedAt: new Date('2025-01-01T00:00:01Z') })
    const t2 = makeTrace({ startedAt: new Date('2025-01-01T00:01:00Z'), completedAt: new Date('2025-01-01T00:01:01Z') })

    store.insert(t1)
    store.insert(t2)

    const recent = store.getRecent()
    // Most recent first
    expect(recent[0].startedAt.getTime()).toBeGreaterThan(recent[1].startedAt.getTime())
  })

  it('should compute session summary', () => {
    store.insert(makeTrace({ sessionId: 's1', inputTokens: 100, outputTokens: 50 }))
    store.insert(makeTrace({ sessionId: 's1', inputTokens: 200, outputTokens: 100, error: 'fail' }))

    const summary = store.getSessionSummary('s1')
    expect(summary).toBeDefined()
    expect(summary!.id).toBe('s1')
    expect(summary!.toolCalls).toBe(2)
    expect(summary!.totalTokens).toBe(450) // 100+50+200+100
    expect(summary!.errors).toBe(1)
    expect(summary!.totalCostUsd).toBeGreaterThan(0)
  })

  it('should return undefined for unknown session', () => {
    const summary = store.getSessionSummary('nonexistent')
    expect(summary).toBeUndefined()
  })

  it('should list all sessions', () => {
    store.insert(makeTrace({ sessionId: 's1' }))
    store.insert(makeTrace({ sessionId: 's2' }))
    store.insert(makeTrace({ sessionId: 's1' }))

    const sessions = store.getAllSessions()
    expect(sessions).toHaveLength(2)
  })

  it('should detect error loops', () => {
    // Insert 3 failed calls for the same tool
    for (let i = 0; i < 3; i++) {
      store.insert(makeTrace({ sessionId: 's1', toolName: 'bad-tool', error: 'timeout' }))
    }
    store.insert(makeTrace({ sessionId: 's1', toolName: 'good-tool' }))

    const loops = store.detectErrorLoops('s1', 3, 10)
    expect(loops).toContain('bad-tool')
    expect(loops).not.toContain('good-tool')
  })

  it('should detect call loops', () => {
    // Insert 5 calls to the same tool
    for (let i = 0; i < 5; i++) {
      store.insert(makeTrace({ sessionId: 's1', toolName: 'looping-tool' }))
    }

    const loops = store.detectCallLoops('s1', 5, 10)
    expect(loops).toContain('looping-tool')
  })

  it('should not detect loops below threshold', () => {
    store.insert(makeTrace({ sessionId: 's1', toolName: 'ok-tool', error: 'err' }))
    store.insert(makeTrace({ sessionId: 's1', toolName: 'ok-tool', error: 'err' }))

    const loops = store.detectErrorLoops('s1', 3, 10)
    expect(loops).toHaveLength(0)
  })

  it('should respect limit on getRecent', () => {
    for (let i = 0; i < 10; i++) {
      store.insert(makeTrace())
    }

    const limited = store.getRecent(3)
    expect(limited).toHaveLength(3)
  })

  it('should store and retrieve error field', () => {
    store.insert(makeTrace({ error: 'connection refused' }))

    const traces = store.getRecent()
    expect(traces[0].error).toBe('connection refused')
  })

  it('should store trace without error as undefined', () => {
    store.insert(makeTrace({ error: undefined }))

    const traces = store.getRecent()
    expect(traces[0].error).toBeUndefined()
  })
})
