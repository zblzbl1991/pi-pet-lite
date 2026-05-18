# State Management

> How state is managed in this project.

---

## Overview

No external state management library. All state is local to components via React hooks. Data flows from Electron IPC to component state.

---

## State Categories

### Local UI state

`useState` for component-local data like form fields, toggle states, collapse state:

```typescript
const [provider, setProvider] = useState('');
const [apiKey, setApiKey] = useState('');
```

### IPC-driven state

Agent messages flow from main process → renderer via IPC listeners:

```typescript
useEffect(() => {
  const cleanup = api.onAgentMessage((msg) => {
    if (msg.type === 'chat-message') {
      setEntries(prev => [...prev, { type: 'chat', message: msg.message }]);
    }
  });
  return cleanup;
}, []);
```

### Mutable state (no re-render)

`useRef` for drag state, timers, DOM references:

```typescript
const dragRef = useRef({ isDragging: false, startX: 0, startY: 0 });
```

---

## Data Flow Architecture

```
Agent Utility Process
       ↕ (MessageChannelMain)
Main Process (message buffer)
       ↕ (ipcMain / ipcRenderer)
Renderer (useState via useEffect listeners)
```

- **Agent → Main**: `MessageChannelMain` ports
- **Main → Renderer**: `webContents.send()` for broadcasts
- **Renderer → Main**: `ipcRenderer.invoke()` for request-response
- **Renderer → Agent**: renderer → main → agent port relay

---

## History Sync

New chat windows sync history on mount:
```typescript
useEffect(() => {
  api.syncHistory().then(setEntries);
}, []);
```

Main process maintains a ring buffer (`messageBuffer: ChatEntry[]`, max 200).

---

## Common Mistakes

- Don't add Redux/Zustand/Context — local useState is sufficient for this app's scope
- Don't store IPC listeners in state — use `useEffect` cleanup
- Don't forget to clean up IPC listeners on unmount (memory leaks)
