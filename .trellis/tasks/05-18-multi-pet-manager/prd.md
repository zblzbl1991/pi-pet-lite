# Multi-Pet Manager

## Goal

Build a centralized agent manager in the main process that creates, tracks, and disposes agent instances for multiple pets, with on-demand session lifecycle.

## What I already know

* Grill decisions: Agent runtime in main process, Windows only render; on-demand LLM session creation; 4 fixed pets; auto retry (3x exponential backoff)
* Current: single agent created in `agent-process.ts`, one BrowserWindow (PetWindow)
* Reference: OpenAkita's `AgentFactory` + `AgentInstancePool` (30min idle reaper)
* M2 provides PetProfile, M3 provides Blackboard store

## Requirements

1. **PetManager**: Central class in main process that manages all pet agent instances
2. **On-demand creation**: When Chief delegates a task, PetManager creates the target pet's agent (if not active)
3. **Idle reaper**: Agents idle for N minutes (default 15) are disposed (LLM session released, context cleared)
4. **Max concurrent limit**: No more than 3 active agents simultaneously (to manage API costs)
5. **Health tracking**: Track success rate, latency, error count per pet (for future error resilience)
6. **State reporting**: Report each pet's status (idle/busy/waiting/error/offline) to UI via events
7. **Abort capability**: Ability to abort a specific pet's current task
8. **Queue**: If a pet is busy, new tasks for it are queued (FIFO, max 5)

## Acceptance Criteria

* [ ] PetManager creates agent instances from PetProfile
* [ ] On-demand: agent created only when task delegated
* [ ] Idle reaper disposes agents after 15 minutes of inactivity
* [ ] Max 3 concurrent active agents enforced
* [ ] Pet status reported to UI (idle/busy/error/offline)
* [ ] Individual pet abort works without affecting others
* [ ] Task queue per pet with max 5 depth

## Definition of Done

* Unit tests for lifecycle (create/dispose/reaper)
* Integration test with mock agents
* Typecheck passes

## Out of Scope

* Chief's delegation logic (M5)
* Multi-pet UI windows (M6)
* Event streaming with petId (M13)
* LLM provider failover (M17)

## Technical Approach

### PetManager

```typescript
class PetManager {
  private agents: Map<string, ManagedPet>;     // petId -> active agent
  private taskQueues: Map<string, Task[]>;      // petId -> pending tasks
  private timers: Map<string, NodeJS.Timeout>;  // petId -> idle reaper timer

  async delegate(fromPetId: string, toPetId: string, task: Task): Promise<TaskResult>;
  getStatus(petId: string): PetStatus;
  abort(petId: string): void;
  dispose(petId: string): void;
  disposeAll(): void;
}
```

### ManagedPet

```typescript
interface ManagedPet {
  profile: PetProfile;
  agent: AgentRuntime;
  status: PetStatus;
  lastActivity: number;
  errorCount: number;
  successCount: number;
}
```

### Integration with existing code

* `agent-process.ts` currently creates a single agent — will be refactored to use PetManager
* PetManager is initialized in `main.ts`
* IPC handlers added for pet status queries from renderer

### New files

* `src/agent/pet-manager.ts` — core manager class
* `src/agent/task-queue.ts` — per-pet FIFO task queue
* Update `src/main/main.ts` — initialize PetManager
* Update `src/agent/agent-process.ts` — delegate to PetManager

## Technical Notes

* `agent-process.ts` — current single-agent entry point, will become a thin wrapper
* `runtime.ts:createAgentRuntime()` — already supports profile (after M2), PetManager calls this per-profile
* OpenAkita's `AgentInstancePool` uses 30-min reaper; we use 15-min for tighter cost control
