# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

## Architecture: AgentBackend Abstraction Layer

The agent layer uses a **backend abstraction** pattern to decouple the runtime from any specific LLM engine.

### Design Decision: Agent class-level abstraction

**Context**: The runtime could be abstracted at the `AgentRuntime` level or at the inner `Agent` class level.

**Decision**: Abstract at `Agent` class level (`AgentBackend` interface). The `AgentRuntime` keeps ownership of tool registry, trust policy, session persistence, EventBus integration, and experience logging. Only the LLM engine interaction is delegated to a backend.

**Consequences**:
- Switching engines only requires a new `AgentBackend` implementation
- Tool registration, confirmation flow, session persistence are all reused
- `runtime.ts` is a thin orchestration layer, not an engine wrapper

### How it works

```
PetManager → createAgentRuntime() → createBackend(factory) → AgentBackend impl
                                         ↓
                                   PiAgentBackend (default)
                                         ↓
                                   pi-agent-core Agent
```

1. **`AgentBackend` interface** (`src/agent/backends/types.ts`): `prompt()`, `abort()`, `dispose()`, `subscribe()`, `state`, `setMessages()`
2. **`BackendEvent` union type**: Engine-agnostic events (start, end, message_*, tool_*, turn_*, error)
3. **`PiAgentBackend`** (`src/agent/backends/pi-agent-backend.ts`): Default backend wrapping pi-agent-core, converts `PiAgentEvent → BackendEvent` internally
4. **Factory** (`src/agent/backends/factory.ts`): `createBackend(type, config)` selects backend by `PetProfile.backend` field (defaults to `'pi-agent-core'`)

### Adding a new backend

1. Implement `AgentBackend` interface in `src/agent/backends/<name>-backend.ts`
2. Emit `BackendEvent` events via `subscribe()`
3. Register in `factory.ts`'s `createBackend()` switch
4. Add `backend: '<name>'` to desired `PetProfile`

---

## Architecture: TaskScheduler

Per-pet priority-based task scheduler replacing the original FIFO `TaskQueue`.

### Key concepts

- **Priority levels** (const object, NOT enum): `critical` (0) > `user` (1) > `scheduled` (2) > `background` (3)
- **No preemption** (D1): high-priority tasks go to queue head; current task finishes first
- **Task dependencies**: `dependsOn: string[]` referencing task IDs; `dependencyPolicy: 'skip' | 'retry'`; timeout-based auto-resolution
- **Blackboard watchers**: `watchBlackboard(ns, key, handler)` triggers task creation on key changes

### Integration points

- `PetManager.delegate()` → `TaskPriority.user` (backward compat)
- `PetManager.delegateWithPriority()` → explicit priority
- `agent-process.ts` routes user input as `critical`, cron as `scheduled`
- `BlackboardStore.watchKey()` provides the watcher mechanism (cross-process wiring is a future integration point)

---

## Architecture: Agent Direct Messaging

Local agents can send messages directly to each other without Chief relaying.

### Key concepts

- **AgentChannel** (`src/agent/agent-channel.ts`): in-memory per-recipient inbox, max 20 messages, max 4000 chars payload
- **Async fire-and-forget** (D1): sender never blocks; recipient replies via another `send_message`
- **No persistence** (D2): inbox cleared on agent dispose
- **Security** (R5): remote/A2A agents cannot be targets; offline targets rejected

### Integration points

- `PetManager.routeMessage()` validates target, sends via channel, emits `agent:message` EventBus event
- `send_message` / `check_inbox` tools registered for all local profiles
- System prompt injection notifies agents of unread messages on next prompt

---

**Language**: All documentation should be written in **English**.
