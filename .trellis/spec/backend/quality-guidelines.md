# Quality Guidelines

> Code quality standards for backend (main/agent) development.

---

## Overview

This is a single-developer Electron desktop app. No linter, formatter, test framework, or CI/CD is configured. Quality is enforced through TypeScript strict mode and consistent code patterns.

---

## Required Patterns

- **TypeScript strict mode** — all tsconfigs use `"strict": true`
- **`err: unknown`** in catch blocks — never `err: Error` or `err: any`
- **Const objects as enums** — not TypeScript `enum` keyword
- **`textResult()` / `errorResult()`** helpers for tool return values
- **TypeBox** for tool parameter schemas — not Zod or manual JSON schema
- **Dynamic ESM import** via `new Function('modulePath', 'return import(modulePath)')` for ESM-only packages
- **Module-level `let` caching** for dynamically imported modules

---

## Forbidden Patterns

- `any` type (use `unknown` and narrow)
- TypeScript `enum` (use const object pattern)
- `eval()` (the `new Function('modulePath', ...)` dynamic import is an intentional exception)
- `child_process.exec()` (use `spawn()` with explicit args)
- `nodeIntegration: true` in BrowserWindow options

---

## Build Verification

Before considering work done, run:
```bash
npm run typecheck
npm run build
```

Both must pass with zero errors.

---

## Tool Definition Standard

Every tool follows this pattern:
```typescript
function buildXxxTool(): PiAgentTool[] {
  return [{
    name: 'tool_name',
    label: 'Human Label',
    description: 'What it does',
    parameters: Type.Object({ ... }),
    execute: async (_toolCallId, params, signal?, onUpdate?): Promise<PiAgentToolResult> => {
      try { return textResult(...); }
      catch (err: unknown) { return errorResult(getErrorMessage(err)); }
    },
  }];
}
```

Register in `src/agent/tools/registry.ts` `getCustomTools()`.
