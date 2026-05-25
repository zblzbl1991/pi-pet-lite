# Directory Structure

> How backend (main/agent/config) code is organized in this Electron project.

---

## Overview

This is an Electron desktop app with a **main process**, a **utility process** (agent), and shared code. There is no traditional backend server — the "backend" is the Electron main process and the agent utility process.

---

## Directory Layout

```
src/
├── main/                    # Electron main process
│   ├── main.ts              # Entry: bootstrap(), IPC handlers, message buffer
│   ├── tray.ts              # System tray icon
│   └── windows.ts           # BrowserWindow factories (pet, settings, chat, quick-input)
├── agent/                   # Agent utility process
│   ├── agent-process.ts     # Utility process entry: MessagePort relay
│   ├── llm.ts               # Dynamic ESM import wrapper for pi-ai
│   ├── runtime.ts           # Agent runtime: thin wrapper over AgentBackend
│   ├── agent-channel.ts     # Agent direct messaging (in-memory inbox, send/receive)
│   ├── task-scheduler.ts    # Priority scheduler with deps and Blackboard watchers
│   ├── task-queue.ts        # Legacy: TaskResult type only (scheduler replaced the queue)
│   ├── state-machine.ts     # State transitions + GIF mapping
│   ├── backends/            # AgentBackend implementations (engine abstraction)
│   │   ├── types.ts         # AgentBackend interface, BackendEvent, BackendConfig
│   │   ├── pi-agent-backend.ts  # Default backend wrapping pi-agent-core
│   │   └── factory.ts       # createBackend() factory function
│   ├── plugins/             # Plugin system (community tools)
│   │   ├── types.ts         # ToolPlugin, PluginManifest, ToolContext interfaces
│   │   ├── loader.ts        # Directory scanner, load/unload, hot reload
│   │   ├── adapters.ts      # ToolPlugin → AgentTool conversion
│   │   └── index.ts         # Barrel export
│   ├── workflow/            # Workflow DSL engine
│   │   ├── types.ts         # WorkflowDefinition, WorkflowRun, DAGNode
│   │   ├── parser.ts        # YAML/JSON parser, DAG builder, template resolver
│   │   ├── engine.ts        # DAG execution engine (parallel, lifecycle)
│   │   ├── loader.ts        # ~/.clawd/workflows/ scanner, hot reload
│   │   └── index.ts         # Barrel export
│   └── tools/               # Agent tools
│       ├── registry.ts      # Central tool registry
│       ├── browser.ts       # Browser automation tool
│       ├── browser-launch.ts # Chrome/Edge CDP launcher
│       └── scheduler.ts     # Cron scheduled task tool
├── config/                  # Configuration
│   └── config-store.ts      # JSON file read/write for AppConfig
├── preload/                 # Preload scripts (one per window)
│   ├── preload.ts           # Pet window
│   ├── settings-preload.ts  # Settings window
│   ├── chat-preload.ts      # Chat window
│   └── quick-input-preload.ts # Quick input
├── shared/                  # Shared between all processes
│   ├── types.ts             # All shared types and interfaces
│   └── constants.ts         # IPC channel names, dimensions, trust policy
├── electron-shim.d.ts       # Type declarations for Electron, playwright, etc.
```

---

## Module Organization

- **`src/main/`** — Main process only. Window lifecycle, IPC routing, tray.
- **`src/agent/`** — Agent utility process only. Runs in separate process via `utilityProcess.fork()`.
- **`src/config/`** — Config read/write shared between main and agent.
- **`src/preload/`** — One preload per BrowserWindow. Each exposes a specific API shape.
- **`src/shared/`** — Types and constants imported by all processes. No runtime logic.
- **`src/agent/tools/`** — Each tool file exports a `buildXxxTool()` function returning `PiAgentTool[]`.

New features that add tools go in `src/agent/tools/`. New LLM engine backends go in `src/agent/backends/`. New windows add entries to `src/main/windows.ts`, a preload in `src/preload/`, and a renderer in `src/renderer/`.

---

## Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Files | kebab-case | `agent-process.ts`, `config-store.ts` |
| Directories | kebab-case | `quick-input/`, `shared/` |
| Constants | UPPER_SNAKE_CASE | `IPC_AGENT_MESSAGE`, `MESSAGE_BUFFER_MAX` |
| Functions | camelCase | `createPetWindow()`, `readConfig()` |
| IPC channels | kebab-case, namespaced | `'agent-message'`, `'chat:sync-history'` |
| Type aliases (dynamic imports) | `Pi` prefix | `PiAgentTool`, `PiAgentToolResult` |
| Backend event types | `Backend` prefix | `BackendEvent`, `BackendState`, `BackendConfig` |

---

## Examples

- Well-organized tool module: `src/agent/tools/scheduler.ts` — single `buildSchedulerTool()` export, TypeBox parameters, `textResult`/`errorResult` helpers.
- Config pattern: `src/config/config-store.ts` — sync read/write, merge-on-update.
- IPC handler pattern: `src/main/main.ts` — `ipcMain.handle()` for request-response, `ipcMain.on()` for fire-and-forget.
