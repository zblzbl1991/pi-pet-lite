/**
 * Database schema definition and migration for the Blackboard store.
 * Uses better-sqlite3 (synchronous API) in the main process.
 */

import type BetterSqlite3 from 'better-sqlite3';

/** Current schema version */
const SCHEMA_VERSION = 1;

/**
 * Initialize the database schema. Creates tables and indexes if they
 * do not exist, and runs migrations for older schema versions.
 */
export function initializeSchema(db: BetterSqlite3.Database): void {
  // Create a metadata table for tracking schema version
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Check current schema version
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
    | { value: string }
    | undefined;

  const currentVersion = row ? parseInt(row.value, 10) : 0;

  if (currentVersion < SCHEMA_VERSION) {
    runMigrations(db, currentVersion, SCHEMA_VERSION);
  }
}

/**
 * Run migrations from `fromVersion` to `toVersion` (inclusive).
 * Each migration step is wrapped in a transaction.
 */
function runMigrations(db: BetterSqlite3.Database, fromVersion: number, toVersion: number): void {
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const migration = getMigration(v);
    if (migration) {
      const transaction = db.transaction(() => {
        migration(db);
        db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)").run(
          String(v)
        );
      });
      transaction();
    }
  }
}

/**
 * Get the migration function for a given version.
 */
function getMigration(version: number): ((db: BetterSqlite3.Database) => void) | null {
  switch (version) {
    case 1:
      return (db: BetterSqlite3.Database) => {
        db.exec(`
          CREATE TABLE entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER,
            UNIQUE(namespace, key)
          );

          CREATE INDEX idx_entries_namespace ON entries(namespace);
          CREATE INDEX idx_entries_expires ON entries(expires_at) WHERE expires_at IS NOT NULL;
        `);
      };
    default:
      return null;
  }
}
