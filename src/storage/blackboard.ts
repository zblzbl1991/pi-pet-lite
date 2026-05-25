/**
 * SQLite-backed key-value/document store for multi-agent coordination.
 *
 * Provides a Blackboard pattern: agents (pets) can read/write intermediate
 * work products and persistent memory. Namespace isolation ensures each
 * pet can only write to its own namespace + global, but can read all.
 *
 * Uses better-sqlite3 synchronous API in the Electron main process.
 */

import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { initializeSchema } from './schema';
import { BLACKBOARD_DB_FILENAME } from '../shared/constants';
import type { BlackboardEntryItem } from '../shared/types';

// Re-export shared type for consumers that import from this module
export type { BlackboardEntryItem } from '../shared/types';

/** Callback type for Blackboard key change watchers */
export type BlackboardWatchHandler = (change: {
  namespace: string;
  key: string;
  newValue: string;
  oldValue: string | null;
}) => void;

/** Default capacity limits per namespace */
const DEFAULT_CAPACITY = {
  global: 200,
  pet: 50,
} as const;

/** A single blackboard entry (internal row type) */
interface BlackboardEntry {
  id: number;
  namespace: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

/** Parameters for the set operation */
export interface SetOptions {
  ttlMs?: number;
}

/** Configuration for the BlackboardStore */
export interface BlackboardConfig {
  /** Max entries for the global namespace (default: 200) */
  globalCapacity: number;
  /** Max entries per pet namespace (default: 50) */
  petCapacity: number;
}

const DEFAULT_CONFIG: BlackboardConfig = {
  globalCapacity: DEFAULT_CAPACITY.global,
  petCapacity: DEFAULT_CAPACITY.pet,
};

/**
 * SQLite-backed Blackboard store.
 *
 * Single writer (main process), synchronous API.
 * All operations are fast (< 10ms) thanks to in-memory SQLite page cache.
 */
export class BlackboardStore {
  private db: BetterSqlite3.Database;
  private config: BlackboardConfig;
  /** Watchers keyed by "namespace:key" */
  private watchers: Map<string, Set<{ handler: BlackboardWatchHandler; persistent: boolean }>> = new Map();

  // Prepared statements (reused for performance)
  private stmtGet: BetterSqlite3.Statement;
  private stmtSet: BetterSqlite3.Statement;
  private stmtUpdate: BetterSqlite3.Statement;
  private stmtDelete: BetterSqlite3.Statement;
  private stmtList: BetterSqlite3.Statement;
  private stmtListPrefix: BetterSqlite3.Statement;
  private stmtCountNamespace: BetterSqlite3.Statement;
  private stmtDeleteOldest: BetterSqlite3.Statement;
  private stmtDeleteExpired: BetterSqlite3.Statement;
  private stmtGetExisting: BetterSqlite3.Statement;

  constructor(dbPath?: string, config?: Partial<BlackboardConfig>) {
    const resolvedPath = dbPath ?? getDefaultDbPath();

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new BetterSqlite3(resolvedPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    // Initialize schema
    initializeSchema(this.db);

    // Prepare statements
    this.stmtGet = this.db.prepare(
      'SELECT * FROM entries WHERE namespace = ? AND key = ?'
    );
    this.stmtSet = this.db.prepare(
      `INSERT INTO entries (namespace, key, value, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtUpdate = this.db.prepare(
      `UPDATE entries SET value = ?, updated_at = ?, expires_at = ?
       WHERE namespace = ? AND key = ?`
    );
    this.stmtDelete = this.db.prepare(
      'DELETE FROM entries WHERE namespace = ? AND key = ?'
    );
    this.stmtList = this.db.prepare(
      'SELECT key, value, created_at, updated_at, expires_at FROM entries WHERE namespace = ? ORDER BY updated_at DESC'
    );
    this.stmtListPrefix = this.db.prepare(
      'SELECT key, value, created_at, updated_at, expires_at FROM entries WHERE namespace = ? AND key LIKE ? ORDER BY updated_at DESC'
    );
    this.stmtCountNamespace = this.db.prepare(
      'SELECT COUNT(*) as count FROM entries WHERE namespace = ?'
    );
    this.stmtDeleteOldest = this.db.prepare(
      `DELETE FROM entries WHERE namespace = ? AND id IN (
        SELECT id FROM entries WHERE namespace = ? ORDER BY updated_at ASC LIMIT ?
      )`
    );
    this.stmtDeleteExpired = this.db.prepare(
      'DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?'
    );
    this.stmtGetExisting = this.db.prepare(
      'SELECT id FROM entries WHERE namespace = ? AND key = ?'
    );
  }

  /**
   * Get a value by namespace and key.
   * Returns null if not found or if the entry has expired (expired entries are deleted).
   */
  get(namespace: string, key: string): BlackboardEntryItem | null {
    this.cleanupExpired();

    const row = this.stmtGet.get(namespace, key) as
      | (Omit<BlackboardEntry, 'createdAt' | 'updatedAt' | 'expiresAt'> & {
          created_at: number;
          updated_at: number;
          expires_at: number | null;
        })
      | undefined;

    if (!row) return null;

    // Check TTL
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      // Auto-delete expired entry
      this.stmtDelete.run(namespace, key);
      return null;
    }

    return {
      key: row.key,
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Set a value by namespace and key.
   * If the entry already exists, it is updated.
   * Enforces capacity limits: oldest entries are evicted when the limit is exceeded.
   */
  set(namespace: string, key: string, value: string, options?: SetOptions): void {
    const now = Date.now();
    const expiresAt = options?.ttlMs ? now + options.ttlMs : null;

    // Read old value before the write (for watcher notification)
    const oldEntry = this.get(namespace, key);
    const oldValue = oldEntry?.value ?? null;

    const setTransaction = this.db.transaction(() => {
      const existing = this.stmtGetExisting.get(namespace, key) as
        | { id: number }
        | undefined;

      if (existing) {
        // Update existing entry
        this.stmtUpdate.run(value, now, expiresAt, namespace, key);
      } else {
        // Enforce capacity limit before inserting
        this.enforceCapacity(namespace);

        // Insert new entry
        this.stmtSet.run(namespace, key, value, now, now, expiresAt);
      }
    });

    setTransaction();

    // Notify watchers after the write
    this.notifyWatchers(namespace, key, value, oldValue);
  }

  /**
   * Delete a value by namespace and key.
   */
  delete(namespace: string, key: string): boolean {
    const result = this.stmtDelete.run(namespace, key);
    return result.changes > 0;
  }

  /**
   * List all entries in a namespace, optionally filtered by key prefix.
   */
  list(namespace: string, prefix?: string): BlackboardEntryItem[] {
    this.cleanupExpired();

    const rows = prefix
      ? (this.stmtListPrefix.all(namespace, prefix + '%') as Array<{
          key: string;
          value: string;
          created_at: number;
          updated_at: number;
          expires_at: number | null;
        }>)
      : (this.stmtList.all(namespace) as Array<{
          key: string;
          value: string;
          created_at: number;
          updated_at: number;
          expires_at: number | null;
        }>);

    // Filter out expired entries
    const now = Date.now();
    return rows
      .filter((row) => row.expires_at === null || row.expires_at > now)
      .map((row) => ({
        key: row.key,
        value: row.value,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      }));
  }

  /**
   * Query entries by namespace with a filter object.
   * The filter is applied against the parsed JSON value of each entry.
   * Only entries whose JSON value contains all filter key-value pairs are returned.
   */
  query(namespace: string, filter: Record<string, unknown>): BlackboardEntryItem[] {
    const allEntries = this.list(namespace);

    return allEntries.filter((entry) => {
      try {
        const parsed = JSON.parse(entry.value) as Record<string, unknown>;
        return Object.entries(filter).every(
          ([filterKey, filterValue]) => parsed[filterKey] === filterValue
        );
      } catch {
        // Non-JSON value, skip
        return false;
      }
    });
  }

  /**
   * Bulk import entries. Used for migration from JSONL or other sources.
   * Each entry is inserted or replaced if the namespace+key already exists.
   */
  bulkImport(
    entries: Array<{ namespace: string; key: string; value: string; ttlMs?: number }>
  ): number {
    const now = Date.now();
    let imported = 0;

    const importTransaction = this.db.transaction(() => {
      for (const entry of entries) {
        const expiresAt = entry.ttlMs ? now + entry.ttlMs : null;
        const existing = this.stmtGetExisting.get(entry.namespace, entry.key) as
          | { id: number }
          | undefined;

        if (existing) {
          this.stmtUpdate.run(entry.value, now, expiresAt, entry.namespace, entry.key);
        } else {
          this.stmtSet.run(entry.namespace, entry.key, entry.value, now, now, expiresAt);
        }
        imported++;
      }
    });

    importTransaction();
    return imported;
  }

  /**
   * Get the number of entries in a namespace.
   */
  count(namespace: string): number {
    const row = this.stmtCountNamespace.get(namespace) as { count: number };
    return row.count;
  }

  /**
   * Close the database connection and clear all watchers.
   */
  close(): void {
    this.watchers.clear();
    this.db.close();
  }

  /**
   * Register a watcher for a specific namespace:key.
   * When the key's value changes via set(), the handler is invoked.
   * If `persistent` is false, the watcher auto-removes after first invocation.
   * Returns an unsubscribe function.
   */
  watchKey(
    namespace: string,
    key: string,
    handler: BlackboardWatchHandler,
    persistent: boolean = true
  ): () => void {
    const watcherKey = `${namespace}:${key}`;
    let watcherSet = this.watchers.get(watcherKey);
    if (!watcherSet) {
      watcherSet = new Set();
      this.watchers.set(watcherKey, watcherSet);
    }

    const entry = { handler, persistent };
    watcherSet.add(entry);

    return () => {
      const ws = this.watchers.get(watcherKey);
      if (ws) {
        ws.delete(entry);
        if (ws.size === 0) {
          this.watchers.delete(watcherKey);
        }
      }
    };
  }

  /**
   * Notify registered watchers of a key value change.
   * Called internally after set() completes.
   */
  private notifyWatchers(
    namespace: string,
    key: string,
    newValue: string,
    oldValue: string | null
  ): void {
    const watcherKey = `${namespace}:${key}`;
    const watcherSet = this.watchers.get(watcherKey);
    if (!watcherSet) return;

    const change = { namespace, key, newValue, oldValue };

    // Copy to avoid mutation during iteration
    const entries = Array.from(watcherSet);
    for (const entry of entries) {
      // Remove one-shot watchers before invoking
      if (!entry.persistent) {
        watcherSet.delete(entry);
        if (watcherSet.size === 0) {
          this.watchers.delete(watcherKey);
        }
      }
      try {
        entry.handler(change);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[blackboard] Watcher error for ${watcherKey}: ${message}`);
      }
    }
  }

  /**
   * Enforce capacity limit for a namespace.
   * Deletes the oldest entries that exceed the limit.
   */
  private enforceCapacity(namespace: string): void {
    const capacity = this.getCapacity(namespace);
    const count = this.count(namespace);

    if (count >= capacity) {
      const excess = count - capacity + 1; // +1 for the new entry
      this.stmtDeleteOldest.run(namespace, namespace, excess);
    }
  }

  /**
   * Get the capacity limit for a namespace.
   */
  private getCapacity(namespace: string): number {
    if (namespace === 'global') {
      return this.config.globalCapacity;
    }
    return this.config.petCapacity;
  }

  /**
   * Delete all expired entries.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    this.stmtDeleteExpired.run(now);
  }
}

/**
 * Get the default database path in the Electron userData directory.
 */
function getDefaultDbPath(): string {
  if (app && typeof app.getPath === 'function') {
    return path.join(app.getPath('userData'), BLACKBOARD_DB_FILENAME);
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return path.join(envPath, BLACKBOARD_DB_FILENAME);
  }
  throw new Error(
    'Cannot determine database path: not in main process and CLAWD_USER_DATA env not set'
  );
}

/** Singleton instance (lazy-initialized) */
let storeInstance: BlackboardStore | null = null;

/**
 * Get the singleton BlackboardStore instance.
 * Creates it on first call.
 */
export function getBlackboardStore(config?: Partial<BlackboardConfig>): BlackboardStore {
  if (!storeInstance) {
    storeInstance = new BlackboardStore(undefined, config);
  }
  return storeInstance;
}

/**
 * Register a watcher on the singleton BlackboardStore for a specific namespace:key.
 * Convenience wrapper around BlackboardStore.watchKey().
 * Returns an unsubscribe function.
 */
export function watchBlackboardKey(
  namespace: string,
  key: string,
  handler: BlackboardWatchHandler,
  persistent: boolean = true
): () => void {
  return getBlackboardStore().watchKey(namespace, key, handler, persistent);
}

/**
 * Close and reset the singleton instance.
 * Used for testing or application shutdown.
 */
export function resetBlackboardStore(): void {
  if (storeInstance) {
    storeInstance.close();
    storeInstance = null;
  }
}
