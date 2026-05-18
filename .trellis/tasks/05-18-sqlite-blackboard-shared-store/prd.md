# SQLite Blackboard — Shared Store

## Goal

Build a shared key-value/document store backed by SQLite, enabling multiple agents (pets) to read/write intermediate work products and persistent memory.

## What I already know

* Grill decisions: IPC for real-time control, shared state (Blackboard) for work products
* SQLite chosen as storage (better-sqlite3 or sql.js for Electron compatibility)
* Reference: OpenAkita's Blackboard has 3 tiers (org/department/private) with capacity limits
* Current project has no database dependency yet
* Electron main process is the natural place for the SQLite instance (single writer, multiple readers via IPC)
* This store will also serve the Memory system (M12 — persistent memory)

## Requirements

1. **SQLite database**: Create a `clawd-blackboard.db` in user data directory on first launch
2. **Schema**: Tables for key-value entries with namespace support (global/petId-private)
3. **CRUD API**: get, set, delete, list, query by namespace/prefix
4. **Namespace isolation**: Each pet can only write to its own namespace + global; can read all
5. **Capacity limits**: Configurable max entries per namespace (default: global=200, pet=50)
6. **TTL support**: Optional expiry on entries (auto-cleanup on read)
7. **IPC bridge**: Expose Blackboard operations to renderer via IPC handlers
8. **Migration from JSONL**: When M1 experience.jsonl needs to migrate, provide a bulk-import utility

## Acceptance Criteria

* [ ] SQLite database created automatically on first launch
* [ ] CRUD operations work via IPC from renderer
* [ ] Namespace isolation enforced (pet can't write to another pet's namespace)
* [ ] Capacity limits enforced (oldest entries evicted)
* [ ] TTL entries auto-expire on read
* [ ] No performance degradation (< 10ms for any operation)

## Definition of Done

* Unit tests for all CRUD operations
* Typecheck passes
* Database file is created in correct location

## Out of Scope

* Multi-pet runtime (M4) — this is just the storage layer
* Memory consolidation / retrieval engine (separate future task)
* Semantic search / embedding-based recall
* Blackboard UI display

## Technical Approach

### Schema

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,      -- 'global', 'chief', 'coder', etc.
  key TEXT NOT NULL,
  value TEXT NOT NULL,         -- JSON string
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,          -- NULL = no expiry
  UNIQUE(namespace, key)
);

CREATE INDEX idx_namespace ON entries(namespace);
CREATE INDEX idx_expires ON entries(expires_at) WHERE expires_at IS NOT NULL;
```

### API surface (in main process)

```typescript
interface BlackboardStore {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string, ttlMs?: number): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string, prefix?: string): Promise<Array<{key: string, value: string}>>;
  query(namespace: string, filter: object): Promise<Array<{key: string, value: string}>>;
}
```

### New files

* `src/storage/blackboard.ts` — SQLite store implementation
* `src/storage/schema.ts` — database schema + migrations
* `src/main/blackboard-ipc.ts` — IPC handlers for renderer access

### Dependencies

* `better-sqlite3` (native, faster) or `sql.js` (WASM, no native build). Recommend `better-sqlite3` for Electron — it's synchronous which simplifies main process code.

## Technical Notes

* Database path: `app.getPath('userData')/clawd-blackboard.db`
* OpenAkita reference: `unified_store.py` uses SQLite + SearchBackend
* `config-store.ts` already uses `app.getPath('userData')` for config location
