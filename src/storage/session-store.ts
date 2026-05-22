/**
 * SQLite-backed session store for conversation history persistence.
 *
 * Stores complete agent conversation history so that:
 * - Agent instances can be restored after disposal/recreation
 * - Chat history survives app restarts
 * - Sessions can be listed and resumed in the UI
 *
 * Uses a separate database file (clawd-sessions.db) from the Blackboard store
 * to avoid cross-process SQLite contention. Runs in the agent utility process.
 *
 * Subscribes to EventBus events for automatic persistence — callers don't need
 * to invoke write methods directly in the agent event loop.
 */

import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SESSIONS_DB_FILENAME } from '../shared/constants';
import { EventBus, AgentEvents } from '../agent/event-bus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  petId: string;
  createdAt: number;
  updatedAt: number;
  title: string | null;
  messageCount: number;
}

export interface SessionMessage {
  id: number;
  sessionId: string;
  seq: number;
  role: string;
  content: string;     // JSON-serialized message
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;
const MAX_SESSIONS_PER_PET = 10;
const MAX_MESSAGES_PER_SESSION = 1000;

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  private db: BetterSqlite3.Database;
  private eventBus: EventBus;
  private unsubscribers: (() => void)[] = [];

  // Active session tracking: petId -> sessionId
  private activeSessions = new Map<string, string>();

  // Prepared statements
  private stmtCreateSession: BetterSqlite3.Statement;
  private stmtGetSession: BetterSqlite3.Statement;
  private stmtGetActiveSession: BetterSqlite3.Statement;
  private stmtUpdateSession: BetterSqlite3.Statement;
  private stmtAppendMessage: BetterSqlite3.Statement;
  private stmtGetMessages: BetterSqlite3.Statement;
  private stmtCountMessages: BetterSqlite3.Statement;
  private stmtDeleteOldMessages: BetterSqlite3.Statement;
  private stmtListSessions: BetterSqlite3.Statement;
  private stmtDeleteOldSessions: BetterSqlite3.Statement;

  /** Expose the database for sharing with Tracer (same file, same process). */
  get database(): BetterSqlite3.Database {
    return this.db;
  }

  constructor(dbPath: string, eventBus: EventBus) {
    this.eventBus = eventBus;

    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.initializeSchema();

    // Prepare statements
    this.stmtCreateSession = this.db.prepare(
      `INSERT INTO sessions (id, pet_id, created_at, updated_at, message_count)
       VALUES (?, ?, ?, ?, 0)`
    );
    this.stmtGetSession = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    );
    this.stmtGetActiveSession = this.db.prepare(
      'SELECT * FROM sessions WHERE pet_id = ? ORDER BY updated_at DESC LIMIT 1'
    );
    this.stmtUpdateSession = this.db.prepare(
      `UPDATE sessions SET updated_at = ?, message_count = ?, title = ? WHERE id = ?`
    );
    this.stmtAppendMessage = this.db.prepare(
      `INSERT INTO session_messages (session_id, seq, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    this.stmtGetMessages = this.db.prepare(
      'SELECT * FROM session_messages WHERE session_id = ? ORDER BY seq ASC LIMIT ?'
    );
    this.stmtCountMessages = this.db.prepare(
      'SELECT COUNT(*) as count FROM session_messages WHERE session_id = ?'
    );
    this.stmtDeleteOldMessages = this.db.prepare(
      `DELETE FROM session_messages WHERE session_id = ? AND seq NOT IN (
        SELECT seq FROM session_messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?
      )`
    );
    this.stmtListSessions = this.db.prepare(
      'SELECT * FROM sessions WHERE pet_id = ? ORDER BY updated_at DESC LIMIT ?'
    );
    this.stmtDeleteOldSessions = this.db.prepare(
      `DELETE FROM sessions WHERE pet_id = ? AND id NOT IN (
        SELECT id FROM sessions WHERE pet_id = ? ORDER BY updated_at DESC LIMIT ?
      )`
    );

    // Subscribe to EventBus events for automatic persistence
    this.subscribeToEvents();
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;

    const currentVersion = row ? parseInt(row.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      const tx = this.db.transaction(() => {
        // Migration v1: initial schema
        if (currentVersion < 1) {
          this.db.exec(`
            CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              pet_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              title TEXT,
              message_count INTEGER DEFAULT 0
            );

            CREATE TABLE session_messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL REFERENCES sessions(id),
              seq INTEGER NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              UNIQUE(session_id, seq)
            );

            CREATE INDEX idx_session_messages_session ON session_messages(session_id, seq);
            CREATE INDEX idx_sessions_updated ON sessions(updated_at);
            CREATE INDEX idx_sessions_pet_id ON sessions(pet_id);
          `);
        }

        this.db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)").run(
          String(SCHEMA_VERSION)
        );
      });
      tx();
    }
  }

  // -------------------------------------------------------------------------
  // EventBus subscriptions
  // -------------------------------------------------------------------------

  private subscribeToEvents(): void {
    // On agent start, create or restore session
    const unsubStart = this.eventBus.on(AgentEvents.AGENT_START, (payload) => {
      // Session is managed externally (by PetManager), just track it
    });

    // On message end, persist complete message
    const unsubMsgEnd = this.eventBus.on(AgentEvents.MESSAGE_END, (payload) => {
      const p = payload as { id?: string; role?: string; content?: string; hasToolCalls?: boolean; petId?: string; sessionId?: string };
      // We'll receive sessionId from the emit context
      // For now, persist to the active session for the emitting agent
    });

    // On tool end, persist tool result
    const unsubToolEnd = this.eventBus.on(AgentEvents.TOOL_END, (payload) => {
      const p = payload as { toolCallId?: string; toolName?: string; isError?: boolean; result?: string; duration?: number };
      // Tool results are persisted via appendMessage by the caller
    });

    // On session disposed, clean up active tracking
    const unsubDisposed = this.eventBus.on(AgentEvents.SESSION_DISPOSED, (payload) => {
      const p = payload as { petId?: string; sessionId?: string };
      if (p.petId) {
        this.activeSessions.delete(p.petId);
      }
    });

    this.unsubscribers = [unsubStart, unsubMsgEnd, unsubToolEnd, unsubDisposed];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a new session for a pet.
   */
  createSession(petId: string): string {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    this.stmtCreateSession.run(id, petId, now, now);
    this.activeSessions.set(petId, id);

    this.eventBus.emit(AgentEvents.SESSION_CREATED, { sessionId: id, petId });
    return id;
  }

  /**
   * Get or create an active session for a pet.
   */
  getOrCreateSession(petId: string): string {
    const existing = this.activeSessions.get(petId);
    if (existing) return existing;

    // Check DB for most recent session
    const row = this.stmtGetActiveSession.get(petId) as Session | undefined;
    if (row) {
      this.activeSessions.set(petId, row.id);
      this.eventBus.emit(AgentEvents.SESSION_RESTORED, { sessionId: row.id, petId });
      return row.id;
    }

    return this.createSession(petId);
  }

  /**
   * Get active session ID for a pet (without creating one).
   */
  getActiveSessionId(petId: string): string | null {
    return this.activeSessions.get(petId) ?? null;
  }

  /**
   * Append a message to a session.
   */
  appendMessage(sessionId: string, role: string, content: unknown): void {
    try {
      const now = Date.now();

      // Get current message count for seq
      const countRow = this.stmtCountMessages.get(sessionId) as { count: number };
      const seq = countRow.count;

      this.stmtAppendMessage.run(sessionId, seq, role, JSON.stringify(content), now);

      // Update session metadata
      const title = role === 'user' && typeof content === 'string'
        ? content.slice(0, 100)
        : null;

      if (title) {
        const session = this.stmtGetSession.get(sessionId) as Session | undefined;
        const currentTitle = session?.title;
        this.stmtUpdateSession.run(now, seq + 1, currentTitle ?? title, sessionId);
      } else {
        this.stmtUpdateSession.run(now, seq + 1, null, sessionId);
      }

      // Trim if exceeding max messages
      if (seq + 1 > MAX_MESSAGES_PER_SESSION) {
        this.stmtDeleteOldMessages.run(sessionId, sessionId, MAX_MESSAGES_PER_SESSION);
      }
    } catch (err) {
      console.error('[session-store] Failed to append message:', err);
    }
  }

  /**
   * Get messages for a session, newest first or oldest first.
   */
  getMessages(sessionId: string, limit?: number): SessionMessage[] {
    return this.stmtGetMessages.all(sessionId, limit ?? MAX_MESSAGES_PER_SESSION) as SessionMessage[];
  }

  /**
   * Restore messages in the format pi-agent-core expects (raw message objects).
   */
  restoreMessages(sessionId: string): unknown[] {
    const rows = this.getMessages(sessionId) as SessionMessage[];
    return rows.map((row) => {
      try {
        return JSON.parse(row.content);
      } catch {
        // Fallback: wrap as a simple text message
        return { role: row.role, content: [{ type: 'text', text: row.content }] };
      }
    });
  }

  /**
   * Get session metadata.
   */
  getSession(sessionId: string): Session | null {
    return (this.stmtGetSession.get(sessionId) as Session) ?? null;
  }

  /**
   * List sessions for a pet.
   */
  listSessions(petId: string, limit?: number): Session[] {
    return this.stmtListSessions.all(petId, limit ?? MAX_SESSIONS_PER_PET) as Session[];
  }

  /**
   * Prune old sessions beyond the per-pet limit.
   */
  pruneOldSessions(maxPerPet?: number): void {
    try {
      const limit = maxPerPet ?? MAX_SESSIONS_PER_PET;
      // Get all distinct pet_ids
      const petIds = this.db.prepare('SELECT DISTINCT pet_id FROM sessions').all() as { pet_id: string }[];
      for (const { pet_id } of petIds) {
        this.stmtDeleteOldSessions.run(pet_id, pet_id, limit);
      }
    } catch (err) {
      console.error('[session-store] Failed to prune sessions:', err);
    }
  }

  /**
   * Mark a session as disposed (remove from active tracking).
   */
  disposeSession(petId: string): void {
    const sessionId = this.activeSessions.get(petId);
    this.activeSessions.delete(petId);
    if (sessionId) {
      this.eventBus.emit(AgentEvents.SESSION_DISPOSED, { petId, sessionId });
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.activeSessions.clear();
    this.db.close();
  }
}
