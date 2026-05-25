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

**Language**: All documentation should be written in **English**.
