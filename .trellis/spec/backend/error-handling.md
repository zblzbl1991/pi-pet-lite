# Error Handling

> How errors are caught, logged, and returned in this project.

---

## Overview

Errors use TypeScript `unknown` type, narrowed with `instanceof Error`. No custom error classes. IPC handlers return result objects with success/error status.

---

## Error Handling Patterns

### Try/catch with type narrowing

```typescript
// Standard pattern (src/main/main.ts, src/agent/tools/registry.ts)
try {
  // operation
  return { success: true };
} catch (err: unknown) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  return { success: false, error: errorMessage };
}
```

### Tool error results

```typescript
// src/agent/tools/registry.ts
function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return { content: [{ type: 'text' as const, text: message }], details: { error: true, ...details } };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

### Silent catches

Non-critical operations use empty catch blocks:
```typescript
try { fs.unlinkSync(somePath); } catch {} // OK for cleanup
```

---

## IPC Error Responses

All `ipcMain.handle()` endpoints return:
```typescript
{ success: boolean; error?: string; data?: T }
```

Example: `src/main/main.ts` settings handlers, test-connection handler.

---

## Exhaustive Switch

Default case uses `_exhaustive: never` to catch unhandled union members at compile time:
```typescript
default: {
  const _exhaustive: never = msg;
  console.warn('Unhandled message:', (_exhaustive as Record<string, unknown>).type);
  break;
}
```

---

## Common Mistakes

- Don't type catch as `err: Error` — use `err: unknown` and narrow
- Don't swallow meaningful errors silently — only empty-catch for cleanup/temporary failures
- Don't throw in IPC handlers — return `{ success: false, error: ... }` instead
