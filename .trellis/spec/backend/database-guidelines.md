# Database Guidelines

> Storage patterns for this Electron desktop app.

---

## Overview

This project currently has **no database**. Configuration is stored as a JSON file (`clawd-config.json`) in the Electron userData directory. A SQLite-backed blackboard store is planned for multi-agent coordination (see `05-18-sqlite-blackboard-shared-store` task).

---

## Current Storage Pattern

**JSON file config store** (`src/config/config-store.ts`):

```typescript
// Synchronous read
export function readConfig(): AppConfig {
  // fs.readFileSync -> JSON.parse
}

// Synchronous write
export function writeConfig(config: AppConfig): void {
  // JSON.stringify -> fs.writeFileSync
}

// Merge update
export function updateLLMConfig(llm: Partial<LLMConfig>): AppConfig {
  const current = readConfig();
  const updated = { ...current, llm: { ...current.llm, ...llm } };
  writeConfig(updated);
  return updated;
}
```

**Location**: `app.getPath('userData')/clawd-config.json` (main process) or `process.env.CLAWD_USER_DATA/clawd-config.json` (utility process).

---

## Adding New Storage

When adding SQLite (or any database):

- Place storage modules in `src/storage/` (new directory)
- Keep sync read/write pattern for simple cases; use async for DB operations
- Namespace data by context (e.g., per-pet isolation for multi-agent)
- Add corresponding types to `src/shared/types.ts`

---

## Common Mistakes

- Don't store secrets in plain JSON — use Electron's `safeStorage` API for sensitive data
- Don't assume `app.getPath()` is available in utility processes — use `process.env.CLAWD_USER_DATA`
