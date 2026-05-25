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
import type { Checkpoint, SessionInfo, SessionTreeNode, ExportedSession } from '../shared/types';

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
  parentSessionId: string | null;
  branchPointSeq: number | null;
}

export interface SessionMessage {
  id: number;
  sessionId: string;
  seq: number;
  role: string;
  content: string;     // JSON-serialized message
  createdAt: number;
}

/** Internal row type matching SQLite column names (snake_case) */
interface SessionRow {
  id: string;
  pet_id: string;
  created_at: number;
  updated_at: number;
  title: string | null;
  message_count: number;
  parent_session_id: string | null;
  branch_point_seq: number | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 2;
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

        // Migration v2: add branching and checkpoint support
        if (currentVersion < 2) {
          // Add columns idempotently (check if column exists)
          const sessionsCols = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
          const colNames = new Set(sessionsCols.map((c) => c.name));

          if (!colNames.has('parent_session_id')) {
            this.db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`);
          }
          if (!colNames.has('branch_point_seq')) {
            this.db.exec(`ALTER TABLE sessions ADD COLUMN branch_point_seq INTEGER`);
          }

          // Create checkpoints table (IF NOT EXISTS for idempotency)
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS checkpoints (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES sessions(id),
              label TEXT,
              snapshot TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
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

  // -------------------------------------------------------------------------
  // Branching
  // -------------------------------------------------------------------------

  /**
   * Create a new session branched from an existing session.
   * Copies all messages up to (and including) branchPointSeq into the new session.
   * Does NOT modify the source session.
   *
   * @param sourceSessionId - The session to branch from
   * @param branchPointSeq - The sequence number to branch at (messages 0..branchPointSeq are copied)
   * @returns The new session ID
   */
  branchFromSession(sourceSessionId: string, branchPointSeq: number): string {
    const sourceSession = this.stmtGetSession.get(sourceSessionId) as SessionRow | undefined;
    if (!sourceSession) {
      throw new Error(`Source session ${sourceSessionId} not found`);
    }

    const newId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const doBranch = this.db.transaction(() => {
      // Create new session with parent reference
      this.db.prepare(
        `INSERT INTO sessions (id, pet_id, created_at, updated_at, message_count, parent_session_id, branch_point_seq)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).run(newId, sourceSession.pet_id, now, now, sourceSessionId, branchPointSeq);

      // Copy messages up to branchPointSeq
      const messages = this.db.prepare(
        'SELECT * FROM session_messages WHERE session_id = ? AND seq <= ? ORDER BY seq ASC'
      ).all(sourceSessionId, branchPointSeq) as SessionMessage[];

      const stmtInsert = this.db.prepare(
        `INSERT INTO session_messages (session_id, seq, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const msg of messages) {
        stmtInsert.run(newId, msg.seq, msg.role, msg.content, msg.createdAt);
      }

      // Update message count on new session
      const count = messages.length;
      const title = sourceSession.title;
      this.stmtUpdateSession.run(now, count, title, newId);
    });

    doBranch();

    this.eventBus.emit(AgentEvents.SESSION_CREATED, { sessionId: newId, petId: sourceSession.pet_id });
    return newId;
  }

  /**
   * Get all sessions that were branched from a given parent session.
   */
  getBranches(parentSessionId: string): Session[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY created_at ASC'
    ).all(parentSessionId) as SessionRow[];
    return rows.map((r) => this.rowToSession(r));
  }

  /**
   * Build the session tree for a pet (all sessions organized as a tree).
   * Root sessions (no parent) are at the top level, branches are nested.
   */
  getSessionTree(petId: string): SessionTreeNode[] {
    const allRows = this.db.prepare(
      'SELECT * FROM sessions WHERE pet_id = ? ORDER BY created_at ASC'
    ).all(petId) as SessionRow[];

    const nodeMap = new Map<string, SessionTreeNode>();
    const roots: SessionTreeNode[] = [];

    // Create nodes for all sessions
    for (const row of allRows) {
      nodeMap.set(row.id, {
        session: this.rowToSessionInfo(row),
        children: [],
      });
    }

    // Build tree structure
    for (const row of allRows) {
      const node = nodeMap.get(row.id)!;
      if (row.parent_session_id && nodeMap.has(row.parent_session_id)) {
        nodeMap.get(row.parent_session_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  // -------------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------------

  /**
   * Create a checkpoint of the current session state.
   * Saves a snapshot of all messages as a JSON blob.
   *
   * @param sessionId - The session to checkpoint
   * @param label - Optional human-readable label
   * @returns The checkpoint ID
   */
  createCheckpoint(sessionId: string, label?: string): string {
    const session = this.stmtGetSession.get(sessionId) as Session | undefined;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Get all messages for the snapshot
    const messages = this.getMessages(sessionId);
    const snapshot = JSON.stringify(messages);

    const checkpointId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    this.db.prepare(
      `INSERT INTO checkpoints (id, session_id, label, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(checkpointId, sessionId, label ?? null, snapshot, now);

    return checkpointId;
  }

  /**
   * List all checkpoints for a session.
   */
  getCheckpoints(sessionId: string): Checkpoint[] {
    const rows = this.db.prepare(
      'SELECT id, session_id, label, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as Array<{ id: string; session_id: string; label: string | null; created_at: number }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      label: row.label,
      createdAt: row.created_at,
    }));
  }

  /**
   * Restore from a checkpoint: creates a new session with the checkpoint's snapshot messages.
   *
   * @param checkpointId - The checkpoint to restore from
   * @returns The new session ID
   */
  restoreCheckpoint(checkpointId: string): string {
    const row = this.db.prepare(
      'SELECT * FROM checkpoints WHERE id = ?'
    ).get(checkpointId) as { id: string; session_id: string; label: string | null; snapshot: string; created_at: number } | undefined;

    if (!row) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Get the source session for pet_id
    const sourceSession = this.stmtGetSession.get(row.session_id) as SessionRow | undefined;
    if (!sourceSession) {
      throw new Error(`Source session ${row.session_id} for checkpoint not found`);
    }

    const newId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const doRestore = this.db.transaction(() => {
      // Create new session
      this.db.prepare(
        `INSERT INTO sessions (id, pet_id, created_at, updated_at, message_count, parent_session_id, branch_point_seq)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).run(newId, sourceSession.pet_id, now, now, row.session_id, null);

      // Parse snapshot and insert messages
      const messages = JSON.parse(row.snapshot) as SessionMessage[];
      const stmtInsert = this.db.prepare(
        `INSERT INTO session_messages (session_id, seq, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const msg of messages) {
        stmtInsert.run(newId, msg.seq, msg.role, msg.content, msg.createdAt);
      }

      // Update message count
      const count = messages.length;
      const title = sourceSession.title;
      this.stmtUpdateSession.run(now, count, title, newId);
    });

    doRestore();

    this.eventBus.emit(AgentEvents.SESSION_CREATED, { sessionId: newId, petId: sourceSession.pet_id });
    return newId;
  }

  /**
   * Delete a checkpoint.
   */
  deleteCheckpoint(checkpointId: string): boolean {
    const result = this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(checkpointId);
    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  /**
   * Export a session as a JSON-serializable object.
   * Includes session metadata, all messages, and optionally checkpoints.
   */
  exportSession(sessionId: string, options?: { includeCheckpoints?: boolean }): ExportedSession {
    const session = this.stmtGetSession.get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const messages = this.getMessages(sessionId);

    const result: ExportedSession = {
      version: 1,
      session: {
        petId: session.pet_id,
        title: session.title,
        createdAt: session.created_at,
      },
      messages: messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
      })),
    };

    if (options?.includeCheckpoints) {
      const checkpointRows = this.db.prepare(
        'SELECT id, label, snapshot, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC'
      ).all(sessionId) as Array<{ id: string; label: string | null; snapshot: string; created_at: number }>;

      result.checkpoints = checkpointRows.map((cp) => ({
        id: cp.id,
        label: cp.label,
        snapshot: cp.snapshot,
        createdAt: cp.created_at,
      }));
    }

    return result;
  }

  /**
   * Export a range of messages from a session.
   */
  exportSessionRange(sessionId: string, fromSeq: number, toSeq: number): ExportedSession {
    const session = this.stmtGetSession.get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const messages = this.db.prepare(
      'SELECT * FROM session_messages WHERE session_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC'
    ).all(sessionId, fromSeq, toSeq) as SessionMessage[];

    return {
      version: 1,
      session: {
        petId: session.pet_id,
        title: session.title,
        createdAt: session.created_at,
      },
      messages: messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
      })),
    };
  }

  /**
   * Import a session from exported data.
   * Creates a new session with the imported messages and optional checkpoints.
   *
   * @param data - The exported session data
   * @param petId - The pet to associate the new session with
   * @returns The new session ID
   */
  importSession(data: ExportedSession, petId: string): string {
    const newId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const doImport = this.db.transaction(() => {
      // Create session
      this.db.prepare(
        `INSERT INTO sessions (id, pet_id, created_at, updated_at, message_count, parent_session_id, branch_point_seq)
         VALUES (?, ?, ?, ?, 0, NULL, NULL)`
      ).run(newId, petId, now, now);

      // Insert messages
      const stmtInsert = this.db.prepare(
        `INSERT INTO session_messages (session_id, seq, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const msg of data.messages) {
        stmtInsert.run(newId, msg.seq, msg.role, msg.content, now);
      }

      // Update message count and title
      const title = data.session.title ?? null;
      this.stmtUpdateSession.run(now, data.messages.length, title, newId);

      // Import checkpoints if present
      if (data.checkpoints && data.checkpoints.length > 0) {
        const stmtCp = this.db.prepare(
          `INSERT INTO checkpoints (id, session_id, label, snapshot, created_at)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const cp of data.checkpoints) {
          // Use a new checkpoint ID to avoid collisions
          const newCpId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          stmtCp.run(newCpId, newId, cp.label, cp.snapshot, cp.createdAt);
        }
      }
    });

    doImport();

    this.eventBus.emit(AgentEvents.SESSION_CREATED, { sessionId: newId, petId });
    return newId;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a SessionRow (snake_case from DB) to a Session object (camelCase).
   */
  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      petId: row.pet_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      title: row.title,
      messageCount: row.message_count,
      parentSessionId: row.parent_session_id,
      branchPointSeq: row.branch_point_seq,
    };
  }

  /**
   * Convert a SessionRow to a SessionInfo object.
   */
  private rowToSessionInfo(row: SessionRow): SessionInfo {
    return {
      id: row.id,
      petId: row.pet_id,
      title: row.title,
      createdAt: row.created_at,
      parentSessionId: row.parent_session_id,
      branchPointSeq: row.branch_point_seq,
    };
  }
}
