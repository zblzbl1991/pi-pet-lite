# Hook Guidelines

> How hooks are used in this project.

---

## Overview

No custom hooks are currently extracted. All hook usage is inline within components using React's built-in hooks: `useState`, `useEffect`, `useCallback`, `useRef`.

---

## Hook Usage Patterns

### useState — component state

```typescript
const [entries, setEntries] = useState<ChatEntry[]>([]);
const [streamingId, setStreamingId] = useState<string | null>(null);
const [collapsed, setCollapsed] = useState<Map<string, CardCollapseState>>(new Map());
```

### useEffect — side effects

```typescript
// IPC listener setup on mount
useEffect(() => {
  const cleanup = api.onAgentMessage((msg) => { ... });
  return cleanup;
}, []);

// Load data on mount
useEffect(() => {
  api.syncHistory().then(setEntries);
}, []);
```

### useCallback — memoized handlers

```typescript
const handleSubmit = useCallback((text: string) => {
  api.sendToAgent({ type: 'user-input', text });
}, []);
```

### useRef — mutable state that doesn't trigger re-renders

```typescript
const dragRef = useRef({ isDragging: false, startX: 0, startY: 0 });
```

---

## When to Extract Custom Hooks

If stateful logic is shared across components or windows, extract to `useXxx()` in the same file or a co-located `hooks.ts`. Currently not needed — each window has its own independent state.

---

## Naming Conventions

- Custom hooks: `use` prefix (e.g., `useChatHistory`, `usePetDrag`)
- State setters: `set` + PascalCase variable name (e.g., `setEntries`, `setStreamingId`)
- Refs: `Ref` suffix (e.g., `dragRef`, `inputRef`)
