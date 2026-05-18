# Research: Codebase Conventions

- **Query**: Scan pi-pet-lite project for actual coding conventions (backend, frontend, shared, tooling)
- **Scope**: Internal (full codebase scan)
- **Date**: 2026-05-18

## Findings

---

### 1. Project Overview

**pi-pet-lite** (npm name: `pi-agent-tool`, product name: **Clawd**) is an Electron desktop pet application -- an AI-powered desktop assistant rendered as an animated cat character. The app has a transparent overlay pet window, a chat sidebar, a quick-input bubble, and a settings window.

**Key dependencies**:
- `electron` v42, `electron-builder` v26 (packaging)
- `react` v19 + `react-dom` v19 + `vite` v6 + `@vitejs/plugin-react` (renderer)
- `typescript` v5.8 (strict mode)
- `@earendil-works/pi-ai` (LLM abstraction), `@earendil-works/pi-agent-core` (agent runtime), `@earendil-works/pi-coding-agent` (built-in tools)
- `playwright` (browser automation via CDP)
- `node-cron` (scheduled tasks)
- `typebox` (JSON schema / parameter validation)

---

### 2. Existing Convention Docs

| File | Status |
|---|---|
| `AGENTS.md` | Trellis-managed block only -- points to `.trellis/` resources |
| `CLAUDE.md` | Does not exist |
| `.cursorrules` | Does not exist |
| `CONTRIBUTING.md` | Does not exist |
| `.editorconfig` | Does not exist |
| `.trellis/spec/backend/*.md` | All templates -- "To be filled by the team" |
| `.trellis/spec/frontend/*.md` | All templates -- "To be filled by the team" |
| `.trellis/spec/guides/*.md` | Exist, content not yet read |

---

### 3. Backend Patterns (src/main/, src/agent/, src/config/)

#### 3.1 Directory Structure

```
src/
  main/
    main.ts          -- Entry point: bootstrap(), window creation, IPC routing, message buffer
    tray.ts          -- System tray icon creation
    windows.ts       -- BrowserWindow factory functions (pet, settings, chat, quick-input)
  agent/
    agent-process.ts  -- Utility process entry: MessagePort relay, confirmation handler
    llm.ts            -- Dynamic ESM import wrapper for pi-ai model creation
    runtime.ts        -- Agent runtime: wraps pi-agent-core Agent, subscribes to events, tool orchestration
    state-machine.ts  -- State transition validation + GIF mapping
    tools/
      registry.ts     -- Central tool registry: combines pi-coding-agent + custom tools
      browser.ts      -- Browser automation tool (Playwright CDP)
      browser-launch.ts -- Chrome/Edge launcher with CDP
      scheduler.ts    -- Cron-based scheduled task tool
  config/
    config-store.ts  -- JSON file read/write for AppConfig
  preload/
    preload.ts              -- Pet window preload (electronAPI)
    settings-preload.ts     -- Settings window preload (settingsAPI)
    chat-preload.ts         -- Chat window preload (electronAPI)
    quick-input-preload.ts  -- Quick input preload (electronAPI)
  shared/
    types.ts         -- Shared types: AgentState, ChatMessage, IPC interfaces, ElectronAPI shapes
    constants.ts     -- Shared constants: IPC channel names, dimensions, trust policy, GIF map
  electron-shim.d.ts -- Type declarations for Electron, playwright, node-cron, glob
```

**Files found**:
| File | Description |
|---|---|
| `src/main/main.ts` | Main process: 719 lines, bootstrap(), all IPC handlers, message buffer |
| `src/main/tray.ts` | System tray creation |
| `src/main/windows.ts` | 4 BrowserWindow factories |
| `src/agent/agent-process.ts` | Utility process entry point |
| `src/agent/runtime.ts` | Agent runtime wrapper (~420 lines) |
| `src/agent/llm.ts` | LLM model factory |
| `src/agent/state-machine.ts` | State machine + GIF map |
| `src/config/config-store.ts` | JSON config read/write |

#### 3.2 Error Handling

**Pattern**: Try/catch with `instanceof Error` checks, returning error result objects.

```typescript
// From src/main/main.ts:533-538 (IPC handler)
try {
  updateLLMConfig(llm);
  return { success: true };
} catch (err: unknown) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  return { success: false, error: errorMessage };
}
```

```typescript
// From src/agent/tools/registry.ts:99-115 (tool results)
function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return { content: [{ type: 'text' as const, text }], details: details ?? {} };
}
function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return { content: [{ type: 'text' as const, text: message }], details: { error: true, ...details } };
}
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

**Convention**:
- Errors typed as `err: unknown`, always narrowed with `instanceof Error`
- IPC handlers return `{ success: boolean; error?: string }` pattern
- Tool execute functions return `errorResult()` with `{ details: { error: true } }`
- Silent catches use empty `catch {}` blocks (e.g., non-critical operations)

#### 3.3 Logging

**No logging library is used.** The project uses raw `console.error()`, `console.warn()`, and `console.log()`.

| Pattern | Where |
|---|---|
| `console.error('Failed to initialize agent runtime:', errorMessage)` | `src/agent/agent-process.ts:168` |
| `console.warn('Unknown message type from renderer:', ...)` | `src/agent/agent-process.ts:212` |
| `console.error(`Scheduled task prompt failed: ${errorMessage}`)` | `src/agent/runtime.ts:397` |
| `console.error(`Browser process error: ${err.message}`)` | `src/agent/tools/browser-launch.ts:148` |
| `console.log('[dev] Step 1/3: ...')` | `scripts/dev.js` |

**Convention**: Plain `console.error` / `console.warn`. No structured logging, no log levels, no log formatting.

#### 3.4 IPC Patterns

**Architecture**: Three-layer communication:

1. **Agent Utility Process <-> Main Process**: `MessageChannelMain` ports (bidirectional, structured clone)
2. **Main Process <-> Renderer Windows**: `ipcMain` / `ipcRenderer` (Electron IPC)
3. **Main Process -> Renderer**: `webContents.send()` for broadcasting agent messages

**IPC channel naming**:
- Agent messages: `'agent-message'` (main -> renderer broadcast)
- Renderer to agent: `'renderer-to-agent'` (renderer -> main -> agent port)
- Feature channels: prefixed with domain, e.g., `'chat:sync-history'`, `'chat:slide-in'`, `'chat:slide-out'`, `'chat:slide-out-complete'`
- Settings: namespaced `'settings:load-config'`, `'settings:save-config'`, `'settings:test-connection'`
- Window control: kebab-case `'set-ignore-mouse-events'`, `'move-window'`, `'open-settings'`
- Quick input: `'quick-input-submit'`, `'quick-input-cancel'`

**Channel constants**: Defined in `src/shared/constants.ts`:
```typescript
export const IPC_AGENT_MESSAGE = 'agent-message';
export const IPC_RENDERER_TO_AGENT = 'renderer-to-agent';
export const IPC_CHAT_SYNC = 'chat:sync-history';
```

**Two IPC styles**:
- `ipcMain.on()` for fire-and-forget (send)
- `ipcMain.handle()` for request-response (invoke)

**Message types**: Typed unions in `src/shared/types.ts`:
```typescript
export type AgentToRendererMessage =
  | { type: 'state-change'; state: AgentState }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'chat-message-update'; id: string; delta: string }
  | ... ;

export type RendererToAgentMessage =
  | { type: 'user-input'; text: string }
  | { type: 'ping' }
  | { type: 'confirmation-response'; toolCallId: string; approved: boolean };
```

**Message buffer**: Main process maintains a ring buffer (`messageBuffer: ChatEntry[]`, max 200) for chat history sync with newly-opened chat windows.

#### 3.5 Process Management

**Agent process**: Uses `utilityProcess.fork()` (Electron utility process, not Node.js child_process):
```typescript
// src/main/main.ts:262-265
const agentProc = utilityProcess.fork(getAgentEntryPath(), [], {
  env: { ...process.env, CLAWD_USER_DATA: app.getPath('userData') },
});
agentProc.postMessage({ type: 'init' }, [agentPort]);
```

**Browser process**: Uses `child_process.spawn()` with `detached: false`, `stdio: 'ignore'`, then `childProc.unref()`:
```typescript
// src/agent/tools/browser-launch.ts:129-143
const childProc = spawn(browserPath, [...args], { detached: false, stdio: 'ignore', windowsHide: false });
childProc.unref();
```

**Window lifecycle**:
- Pet window: always alive, show/hide toggle
- Settings window: singleton, destroy on close, recreate on open
- Chat window: singleton, hide (not destroy) on close, persists in memory
- Quick input: destroy and recreate each time (fresh state)

#### 3.6 Config Patterns

**Storage**: JSON file at `app.getPath('userData')/clawd-config.json`.

**Pattern**: Synchronous read, synchronous write, merge-on-update:
```typescript
// src/config/config-store.ts
export function readConfig(): AppConfig { ... fs.readFileSync ... }
export function writeConfig(config: AppConfig): void { ... fs.writeFileSync ... }
export function updateLLMConfig(llm: Partial<LLMConfig>): AppConfig {
  const current = readConfig();
  const updated = { ...current, llm: { ...current.llm, ...llm } };
  writeConfig(updated);
  return updated;
}
```

**UserData path resolution**: Works in both main process (`app.getPath`) and utility process (`process.env.CLAWD_USER_DATA`).

**Config shape** (`AppConfig`):
```typescript
interface AppConfig {
  llm: LLMConfig;              // provider, apiKey, model, thinkingLevel
  notifications: NotificationConfig; // systemToast, petBubble, petAnimation
  browser: BrowserConfig;       // chromePath, cdpPort
}
```

#### 3.7 Dynamic ESM Import Pattern

A recurring pattern for importing ESM-only packages from CommonJS context:
```typescript
// Used in: src/agent/llm.ts, src/agent/runtime.ts, src/agent/tools/registry.ts
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as <T>(
  modulePath: string
) => Promise<T>;
```

Module references are cached in module-level `let` variables:
```typescript
let piAiModule: typeof import('@earendil-works/pi-ai') | null = null;
async function loadPiAi() {
  if (!piAiModule) { piAiModule = await dynamicImport(...); }
  return piAiModule;
}
```

---

### 4. Frontend Patterns (src/renderer/)

#### 4.1 Directory Structure

```
src/renderer/
  index.html              -- Pet window HTML entry
  index.tsx               -- Pet window React entry (renders PetWindow)
  env.d.ts                -- Vite client types reference
  electron-types.d.ts     -- Global Window type declarations for electronAPI/settingsAPI
  pet/
    PetWindow.tsx         -- Main pet component: drag, click-through, agent state display
    PetAnimator.tsx       -- GIF display based on AgentState
    ChatBubble.tsx        -- Mini speech bubble above pet (read-only)
  chat/
    index.html            -- Chat window HTML entry
    index.tsx             -- Chat window React entry (renders ChatPanel)
    ChatPanel.tsx         -- Full chat sidebar: messages, tool cards, confirmations, input
  settings/
    index.html            -- Settings window HTML entry
    index.tsx             -- Settings window React entry (renders SettingsWindow)
    SettingsWindow.tsx    -- Settings with sidebar nav: LLM, Browser, Notifications sections
  quick-input/
    index.html            -- Quick input HTML entry
    index.tsx             -- Quick input React entry (renders QuickInput)
    QuickInput.tsx        -- Single text input bubble
```

**Pattern**: Each window is a self-contained Electron BrowserWindow with its own:
- `index.html` entry (in its own directory or root for pet)
- `index.tsx` React bootstrap (createRoot + StrictMode)
- Component file(s) with the actual UI

#### 4.2 Component Patterns

**All components are functional components** (no class components). Named exports, no default exports.

```typescript
export const PetWindow: React.FC = () => { ... };
export const ChatPanel: React.FC = () => { ... };
export const SettingsWindow: React.FC = () => { ... };
export const QuickInput: React.FC = () => { ... };
export const PetAnimator: React.FC<PetAnimatorProps> = ({ state, size = 128 }) => { ... };
export const ChatBubble: React.FC<ChatBubbleProps> = ({ ... }) => { ... };
```

**Props conventions**:
- Interfaces defined above the component in the same file
- Destructured in the function signature
- Optional props use `?` with default values in destructuring

```typescript
interface PetAnimatorProps {
  state: AgentState;
  size?: number;
}
export const PetAnimator: React.FC<PetAnimatorProps> = ({ state, size = 128 }) => { ... };
```

**Sub-components** within the same file (SettingsWindow.tsx):
```typescript
function LLMSection() { ... }
function BrowserSection() { ... }
function NotificationsSection() { ... }
function StatusBlock({ status, message }: { ... }) { ... }
function SaveStatus({ message }: { message: string }) { ... }
```
These are NOT exported -- they are file-private helper components.

#### 4.3 State Management

**No external state management library** (no Redux, Zustand, MobX, Jotai, etc.).

**Pattern**: Local `useState` + `useEffect` + `useCallback` + `useRef` per component.

State flows:
1. **Agent messages**: `api.onAgentMessage()` (IPC listener) -> `useState` -> re-render
2. **Chat entries**: `useState<ChatEntry[]>([])` accumulated via `setEntries(prev => [...prev, newEntry])`
3. **Streaming**: `useState<string | null>(streamingId)` for cursor indicator
4. **Drag**: `useRef` for mutable drag state (avoids re-renders during drag)
5. **Tool card collapse**: `useState<Map<string, CardCollapseState>>(new Map())`
6. **Settings form**: Individual `useState` per field, loaded on mount via `useEffect`

**History sync**: ChatPanel calls `api.syncHistory()` on mount (IPC invoke -> main process returns buffer).

#### 4.4 Styling

**No CSS modules, no Tailwind, no CSS files**. All styling is **inline `style` objects** defined as:
1. Constants at the bottom of the file (e.g., `containerStyle`, `headerStyle`)
2. Shared style objects in `sharedStyles` record (SettingsWindow.tsx)
3. Inline objects in JSX for dynamic styles

```typescript
// Pattern 1: Top-level constant styles (ChatPanel.tsx)
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: '#1e1f22',
  color: '#e0e0e0',
  fontFamily: "'Segoe UI', -apple-system, sans-serif",
};

// Pattern 2: Function that returns styles based on props
const bubbleStyle = (role: string): React.CSSProperties => ({
  maxWidth: '85%',
  padding: '8px 12px',
  borderRadius: 12,
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
  background: role === MessageRole.USER ? '#3a6b4f' : '#2a2c30',
});

// Pattern 3: Inline in JSX
style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
```

**CSS animations**: Injected via `<style>` tags in JSX:
```typescript
<style>{`
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`}</style>
```

**Design system colors** (extracted from usage):
- Background dark: `#1a1c1f`, `#1e1f22`, `#25262a`, `#2a2c30`
- Text primary: `#F0F1F2`, `#e0e0e0`
- Text secondary: `rgba(200, 200, 210, 0.8)`, `rgba(200, 200, 210, 0.5)`
- Green accent: `#50b478`, `rgba(80, 180, 120, ...)`, `#5cb85c`
- Warning: `#f0ad4e`
- Error: `#d9534f`
- Border: `rgba(255, 255, 255, 0.08)`, `rgba(255, 255, 255, 0.12)`, `#333`, `#444`
- Font: `'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`

#### 4.5 HTML/Preload Patterns

**Each window** has:
1. Its own HTML entry (`index.html`) with `<div id="root">` and `<script type="module" src="./index.tsx">`
2. Its own preload script that exposes a specific API shape via `contextBridge.exposeInMainWorld()`
3. Its own TypeScript type interface for the exposed API

**Preload API shapes** (all in `src/shared/types.ts`):
- `PetElectronAPI`: `setIgnoreMouseEvents`, `moveWindow`, `getWindowPosition`, `openSettings`, `openChat`, `openQuickInput`, `onAgentMessage`, `sendToAgent`, `petDragStart`, `petDragEnd`
- `ChatElectronAPI`: `onAgentMessage`, `sendToAgent`, `syncHistory`, `onSlideIn`, `onSlideOut`, `slideOutComplete`, `closeChat`
- `QuickInputElectronAPI`: `submit`, `cancel`
- `SettingsElectronAPI` (defined in `src/renderer/electron-types.d.ts`): `loadConfig`, `saveConfig`, `testConnection`, `loadNotificationConfig`, `saveNotificationConfig`, `loadBrowserConfig`, `saveBrowserConfig`, `testBrowserConnection`, `closeWindow`

**Global type declarations** in `src/renderer/electron-types.d.ts`:
```typescript
declare global {
  interface Window {
    electronAPI: PetElectronAPI | ChatElectronAPI | QuickInputElectronAPI;
    settingsAPI: SettingsElectronAPI;
  }
}
```

**Security**: All windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

---

### 5. Shared Patterns

#### 5.1 TypeScript Config

**Root `tsconfig.json`**: References only (no compilation):
```json
{ "files": [], "references": [
  { "path": "./tsconfig.main.json" },
  { "path": "./tsconfig.agent.json" },
  { "path": "./tsconfig.renderer.json" },
  { "path": "./tsconfig.preload.json" }
] }
```

**Configs**:
| Config | Target | Module | Includes | Used by |
|---|---|---|---|---|
| `tsconfig.node.json` | ES2022 | commonjs | main + agent + preload + shared + config | `npm run build:node` (produces dist/) |
| `tsconfig.main.json` | ES2022 | commonjs | main + shared + config | IDE only (noEmit) |
| `tsconfig.agent.json` | ES2022 | commonjs | agent + shared + config | IDE only (noEmit) |
| `tsconfig.renderer.json` | ES2022 | ESNext (bundler) | renderer + shared | Vite, IDE (noEmit) |
| `tsconfig.preload.json` | ES2022 | commonjs | preload + shared | IDE only (noEmit) |

**Common compiler options** (all configs): `strict: true`, `esModuleInterop: true`, `skipLibCheck: true`, `sourceMap: true`, `resolveJsonModule: true`.

**Renderer-specific**: `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`.

**Node-specific**: `module: "commonjs"`, `moduleResolution: "node"`, `types: ["node"]`.

#### 5.2 Build Tooling

**Two build pipelines**:
1. **Node.js sources** (main, agent, preload, shared, config): `tsc -p tsconfig.node.json` -> `dist/`
2. **Renderer**: `vite build --config vite.renderer.config.ts` -> `dist/renderer/`

**Vite config** (`vite.renderer.config.ts`):
- `root: src/renderer` (HTML entries relative to this)
- `base: './'` (relative paths for file:// protocol)
- Multi-page: 4 HTML entries (main, settings, chat, quick-input)
- `@shared` path alias -> `src/shared`
- `emptyOutDir: false` (preserves tsc output)

**Dev script** (`scripts/dev.js`): Sequential build (tsc -> vite -> electron).

**Packaging**: `electron-builder` with NSIS installer, Windows x64 only.

**Scripts** (from package.json):
```
"dev": "node scripts/dev.js"          -- Build + launch
"dev:quick": "electron ."             -- Launch with existing build
"build": "npm run build:node && npm run build:renderer"
"build:node": "tsc -p tsconfig.node.json"
"build:renderer": "vite build --config vite.renderer.config.ts"
"typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.renderer.json"
"clean": "node -e ..."                 -- Removes dist/ and release/
"pack": "npm run build && electron-builder --dir"
"dist": "npm run build && electron-builder"
```

#### 5.3 Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Files | kebab-case | `agent-process.ts`, `config-store.ts`, `browser-launch.ts` |
| Directories | kebab-case | `quick-input/`, `shared/` |
| React components | PascalCase | `PetWindow.tsx`, `ChatPanel.tsx`, `QuickInput.tsx` |
| Type/Interface names | PascalCase | `AgentState`, `ChatMessage`, `AppConfig` |
| Constants | UPPER_SNAKE_CASE | `IPC_AGENT_MESSAGE`, `MESSAGE_BUFFER_MAX`, `CHAT_WINDOW_WIDTH` |
| Const objects (as enums) | PascalCase keys | `AgentState.IDLE`, `MessageRole.USER` |
| Functions | camelCase | `createPetWindow()`, `readConfig()`, `handleAgentEvent()` |
| CSS style objects | camelCase | `containerStyle`, `headerStyle`, `bubbleStyle` |
| IPC channels | kebab-case | `'agent-message'`, `'open-settings'`, `'chat:sync-history'` |
| Type aliases for dynamic imports | `Pi` prefix | `PiAgentTool`, `PiAgentToolResult`, `PiKnownProvider` |

#### 5.4 TypeScript Patterns

**Const enums pattern** (not actual TypeScript enums):
```typescript
export const AgentState = {
  IDLE: 'idle',
  GREETING: 'greeting',
  THINKING: 'thinking',
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];
```

**Exhaustive switch checking**:
```typescript
default: {
  const _exhaustive: never = msg;
  console.warn('Unhandled agent message:', (_exhaustive as Record<string, unknown>).type);
  break;
}
```

**Type guards**:
```typescript
export function isToolCardEntry(entry: ChatEntry): entry is ToolCardEntry {
  return 'type' in entry && entry.type === 'tool-card';
}
```

**Type aliases for dynamic imports** (avoid namespace-qualified types):
```typescript
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
```

**Electron shim** (`src/electron-shim.d.ts`): Provides type declarations for Electron APIs, playwright, node-cron, and glob when the actual packages are not installed (e.g., CI).

#### 5.5 Tool Definition Pattern

Custom tools follow a consistent pattern:
```typescript
function buildXxxTool(): PiAgentTool[] {
  return [{
    name: 'tool_name',
    label: 'Human Label',
    description: 'What the tool does...',
    parameters: Type.Object({ ... }),    // Uses TypeBox for JSON schema
    execute: async (_toolCallId, params, signal?, onUpdate?): Promise<PiAgentToolResult> => {
      // Implementation
      return textResult(...) or errorResult(...);
    },
  }];
}
```

Parameters use `TypeBox` (`Type.Object`, `Type.String`, `Type.Optional`, `Type.Union`, `Type.Literal`).

#### 5.6 Singleton Window Management

Windows are managed via module-level `let` variables with null checks:
```typescript
let settingsWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let quickInputWindow: BrowserWindow | null = null;
```

Factory functions check for existing instance and either return/reuse it or create new.

---

### 6. File-by-File Index

| File Path | Lines | Description |
|---|---|---|
| `src/main/main.ts` | 719 | Main process entry, IPC routing, message buffer |
| `src/main/tray.ts` | 79 | System tray creation |
| `src/main/windows.ts` | 319 | BrowserWindow factories (pet, settings, chat, quick-input) |
| `src/agent/agent-process.ts` | 274 | Utility process entry, MessagePort relay |
| `src/agent/llm.ts` | 74 | LLM model factory via dynamic ESM import |
| `src/agent/runtime.ts` | 420 | Agent runtime wrapper, event forwarding |
| `src/agent/state-machine.ts` | 44 | State transitions, GIF mapping |
| `src/agent/tools/registry.ts` | 186 | Central tool registry + custom tools |
| `src/agent/tools/browser.ts` | 474 | Browser automation tool |
| `src/agent/tools/browser-launch.ts` | 155 | Chrome/Edge launcher with CDP |
| `src/agent/tools/scheduler.ts` | 342 | Cron scheduled task tool |
| `src/config/config-store.ts` | 136 | JSON config read/write |
| `src/preload/preload.ts` | 64 | Pet window preload |
| `src/preload/settings-preload.ts` | 73 | Settings window preload |
| `src/preload/chat-preload.ts` | 53 | Chat window preload |
| `src/preload/quick-input-preload.ts` | 18 | Quick input preload |
| `src/shared/types.ts` | 181 | All shared types and interfaces |
| `src/shared/constants.ts` | 83 | All shared constants |
| `src/renderer/pet/PetWindow.tsx` | 193 | Pet overlay component |
| `src/renderer/pet/PetAnimator.tsx` | 54 | GIF animator component |
| `src/renderer/pet/ChatBubble.tsx` | 237 | Mini speech bubble |
| `src/renderer/chat/ChatPanel.tsx` | 832 | Full chat sidebar |
| `src/renderer/settings/SettingsWindow.tsx` | 572 | Settings with sidebar nav |
| `src/renderer/quick-input/QuickInput.tsx` | 60 | Quick input bubble |
| `src/electron-shim.d.ts` | 337 | Type declarations for Electron/playwright/etc |

---

## Caveats / Not Found

1. **No linter config** (`.eslintrc`, `biome.json`, etc.) found in the project.
2. **No formatter config** (`.prettierrc`, etc.) found.
3. **No `.editorconfig`** found (only in node_modules).
4. **No test files** found anywhere in the project. No test framework configured.
5. **No CI/CD configuration** found.
6. **All `.trellis/spec/` files** are empty templates.
7. **No logging library** -- only raw `console.error`/`console.warn`.
8. **Single developer project** (`zblzbl1991`) -- no code review artifacts.
