/**
 * Lightweight tracer for agent runtime observability.
 *
 * Automatically creates traces and spans by subscribing to EventBus events.
 * Traces represent a complete user prompt cycle; spans represent individual
 * operations (LLM calls, tool executions) within that cycle.
 *
 * Data is buffered in memory and flushed to SQLite when a trace completes,
 * avoiding per-span IO overhead during streaming.
 */

import { EventBus, AgentEvents } from './event-bus';
import BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Trace {
  id: string;
  sessionId: string | null;
  petId: string | null;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ok' | 'error' | 'aborted';
  attributes: Record<string, unknown>;
}

interface Span {
  id: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ok' | 'error';
  attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export class Tracer {
  private eventBus: EventBus;
  private db: BetterSqlite3.Database | null = null;
  private unsubscribers: (() => void)[] = [];

  // Active trace/span tracking
  private activeTrace: Trace | null = null;
  private activeSpans: Map<string, Span> = new Map();
  private spanStack: string[] = [];  // stack of active span IDs

  // Pending data to flush on trace end
  private pendingSpans: Span[] = [];

  // Prepared statements (initialized lazily)
  private stmtInsertTrace: BetterSqlite3.Statement | null = null;
  private stmtInsertSpan: BetterSqlite3.Statement | null = null;
  private stmtDeleteOldTraces: BetterSqlite3.Statement | null = null;

  constructor(db: BetterSqlite3.Database, eventBus: EventBus) {
    this.db = db;
    this.eventBus = eventBus;

    this.initializeSchema();
    this.prepareStatements();
    this.subscribeToEvents();
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initializeSchema(): void {
    if (!this.db) return;

    // Check if traces table exists
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='traces'"
    ).get();

    if (!tableExists) {
      this.db.exec(`
        CREATE TABLE traces (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          pet_id TEXT,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          status TEXT DEFAULT 'running',
          attributes TEXT
        );

        CREATE TABLE spans (
          id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL REFERENCES traces(id),
          name TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          status TEXT DEFAULT 'running',
          attributes TEXT
        );

        CREATE INDEX idx_traces_session ON traces(session_id);
        CREATE INDEX idx_spans_trace ON spans(trace_id);
      `);
    }
  }

  private prepareStatements(): void {
    if (!this.db) return;
    this.stmtInsertTrace = this.db.prepare(
      `INSERT OR REPLACE INTO traces (id, session_id, pet_id, start_time, end_time, status, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtInsertSpan = this.db.prepare(
      `INSERT INTO spans (id, trace_id, name, start_time, end_time, status, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtDeleteOldTraces = this.db.prepare(
      `DELETE FROM traces WHERE start_time < ?`
    );
  }

  // -------------------------------------------------------------------------
  // EventBus subscriptions
  // -------------------------------------------------------------------------

  private subscribeToEvents(): void {
    const unsubStart = this.eventBus.on(AgentEvents.AGENT_START, () => {
      this.startTrace();
    });

    const unsubEnd = this.eventBus.on(AgentEvents.AGENT_END, (payload) => {
      const p = payload as { stopReason?: string };
      const status = (p.stopReason === 'error' || p.stopReason === 'aborted')
        ? (p.stopReason as 'error' | 'aborted') : 'ok';
      this.endTrace(status);
    });

    const unsubMsgStart = this.eventBus.on(AgentEvents.MESSAGE_START, (payload) => {
      const p = payload as { role?: string };
      if (p.role === 'assistant') {
        this.startSpan('llm.call');
      }
    });

    const unsubMsgEnd = this.eventBus.on(AgentEvents.MESSAGE_END, () => {
      this.endTopSpan('ok');
    });

    const unsubToolStart = this.eventBus.on(AgentEvents.TOOL_START, (payload) => {
      const p = payload as { toolName?: string; toolCallId?: string };
      this.startSpan('tool.execute', { toolName: p.toolName, toolCallId: p.toolCallId });
    });

    const unsubToolEnd = this.eventBus.on(AgentEvents.TOOL_END, (payload) => {
      const p = payload as { isError?: boolean; toolName?: string; duration?: number };
      this.endTopSpan(p.isError ? 'error' : 'ok', {
        duration: p.duration,
        success: !p.isError,
      });
    });

    this.unsubscribers = [unsubStart, unsubEnd, unsubMsgStart, unsubMsgEnd, unsubToolStart, unsubToolEnd];
  }

  // -------------------------------------------------------------------------
  // Trace/Span management
  // -------------------------------------------------------------------------

  private startTrace(): void {
    // If there's already an active trace, end it first
    if (this.activeTrace) {
      this.endTrace('ok');
    }

    const id = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTrace = {
      id,
      sessionId: null,
      petId: null,
      startTime: Date.now(),
      endTime: null,
      status: 'running',
      attributes: {},
    };
    this.pendingSpans = [];
  }

  private endTrace(status: 'ok' | 'error' | 'aborted'): void {
    if (!this.activeTrace || !this.db || !this.stmtInsertTrace) return;

    this.activeTrace.endTime = Date.now();
    this.activeTrace.status = status;

    // End any remaining open spans
    for (const [id, span] of this.activeSpans) {
      if (span.status === 'running') {
        span.endTime = Date.now();
        span.status = 'ok';
        this.pendingSpans.push(span);
      }
    }
    this.activeSpans.clear();
    this.spanStack = [];

    // Flush trace + all spans to SQLite
    try {
      const tx = this.db.transaction(() => {
        const t = this.activeTrace!;
        this.stmtInsertTrace!.run(
          t.id, t.sessionId, t.petId,
          t.startTime, t.endTime, t.status,
          JSON.stringify(t.attributes)
        );

        if (this.stmtInsertSpan) {
          for (const s of this.pendingSpans) {
            this.stmtInsertSpan.run(
              s.id, s.traceId, s.name,
              s.startTime, s.endTime, s.status,
              JSON.stringify(s.attributes)
            );
          }
        }
      });
      tx();
    } catch (err) {
      console.error('[tracer] Failed to flush trace:', err);
    }

    this.activeTrace = null;
    this.pendingSpans = [];
  }

  private startSpan(name: string, attributes?: Record<string, unknown>): void {
    if (!this.activeTrace) return;

    const id = `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const span: Span = {
      id,
      traceId: this.activeTrace.id,
      name,
      startTime: Date.now(),
      endTime: null,
      status: 'running',
      attributes: attributes ?? {},
    };

    this.activeSpans.set(id, span);
    this.spanStack.push(id);
  }

  private endTopSpan(status: 'ok' | 'error', extraAttrs?: Record<string, unknown>): void {
    const spanId = this.spanStack.pop();
    if (!spanId) return;

    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;
    if (extraAttrs) {
      Object.assign(span.attributes, extraAttrs);
    }

    this.activeSpans.delete(spanId);
    this.pendingSpans.push(span);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set session/pet context on the active trace.
   */
  setTraceContext(sessionId: string, petId: string): void {
    if (this.activeTrace) {
      this.activeTrace.sessionId = sessionId;
      this.activeTrace.petId = petId;
    }
  }

  /**
   * Get the active trace ID.
   */
  getActiveTraceId(): string | null {
    return this.activeTrace?.id ?? null;
  }

  /**
   * Prune traces older than the given number of days.
   */
  pruneOldTraces(maxAgeDays: number = 7): void {
    if (!this.db || !this.stmtDeleteOldTraces) return;
    try {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      this.stmtDeleteOldTraces.run(cutoff);
    } catch (err) {
      console.error('[tracer] Failed to prune traces:', err);
    }
  }

  /**
   * Clean up subscriptions.
   */
  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.activeSpans.clear();
    this.spanStack = [];
    this.pendingSpans = [];
    this.activeTrace = null;
  }
}
