# Type Safety

> TypeScript conventions and type organization in this project.

---

## Overview

TypeScript 5.8 with strict mode. Types are centralized in `src/shared/types.ts`. No runtime validation library for IPC boundaries — trust the preload bridge.

---

## Type Organization

- **`src/shared/types.ts`** — All shared types: `AgentState`, `ChatMessage`, `AppConfig`, IPC interfaces, `ElectronAPI` shapes
- **`src/shared/constants.ts`** — All shared constants: IPC channel names, dimensions, trust policy
- **`src/renderer/electron-types.d.ts`** — Global `Window` type declarations for `electronAPI`/`settingsAPI`
- **`src/electron-shim.d.ts`** — Type declarations for Electron, playwright, node-cron, glob
- **Component props** — Defined in the same file, above the component

---

## Const Object Enum Pattern

Not TypeScript `enum` — use const objects:

```typescript
export const AgentState = {
  IDLE: 'idle',
  THINKING: 'thinking',
  EXECUTING: 'executing',
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];
```

---

## Type Guards

```typescript
export function isToolCardEntry(entry: ChatEntry): entry is ToolCardEntry {
  return 'type' in entry && entry.type === 'tool-card';
}
```

---

## Dynamic Import Type Aliases

`Pi` prefix for types from dynamically imported ESM packages:

```typescript
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
```

---

## Exhaustive Switch

```typescript
default: {
  const _exhaustive: never = value;
  break;
}
```

Ensures all union members are handled at compile time.

---

## Tool Parameter Validation

Uses **TypeBox** (`@sinclair/typebox`), not Zod:

```typescript
import { Type } from '@sinclair/typebox';

parameters: Type.Object({
  url: Type.String({ description: 'URL to navigate to' }),
  timeout: Type.Optional(Type.Number({ default: 30000 })),
}),
```

---

## Common Mistakes

- Don't use TypeScript `enum` — use const object pattern
- Don't use `any` — use `unknown` and narrow with `instanceof` or type guards
- Don't define types in multiple places — add to `src/shared/types.ts`
- Don't import types from `node_modules` directly in component code — use `Pi`-prefixed aliases or shared types
