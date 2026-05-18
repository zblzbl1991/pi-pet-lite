# Chief Coordinator

## Goal

Enable the Chief pet to decompose user tasks and delegate subtasks to specialist pets (Coder/Scout/Analyst), collect results, and synthesize a response.

## What I already know

* Grill decisions: v1 single-shot delegation (no milestone/multi-round); Chief decomposes, sends task, waits for result
* M2 provides profiles, M3 provides shared storage, M4 provides PetManager
* Reference: OpenAkita's `org_delegate_task` + `org_wait_for_deliverable`
* Chief needs special tools: `delegate_task`, `read_blackboard`, `write_blackboard`
* Chief does NOT execute regular tools (no bash, no browser) — only coordinates

## Requirements

1. **Delegate tool**: Chief gets a `delegate_task` tool that accepts: target pet role, task description, context (optional references to blackboard entries)
2. **Wait for result**: After delegation, Chief waits for the sub-pet to complete and return a result
3. **Blackboard tools**: Chief can `read_blackboard` and `write_blackboard` to share context and read sub-pet outputs
4. **Task decomposition**: Chief's system prompt instructs it to break complex tasks into subtasks and assign to the right specialist
5. **Result synthesis**: Chief receives sub-pet results and synthesizes a coherent response for the user
6. **Timeout**: Each delegated task has a timeout (default 5 minutes). On timeout, Chief reports failure and suggests alternatives
7. **Serial execution**: v1 only — tasks are delegated one at a time (no parallel delegation)
8. **Fallback**: If a specialist pet fails, Chief can retry once, then report to user

## Acceptance Criteria

* [ ] `delegate_task` tool registered for Chief profile
* [ ] `read_blackboard` / `write_blackboard` tools registered for Chief profile
* [ ] Chief can decompose a task like "research X and write a script for it" into Scout + Coder subtasks
* [ ] Sub-pet results are collected and synthesized
* [ ] Timeout triggers after 5 minutes with user-facing message
* [ ] Failed delegation triggers one retry before reporting to user
* [ ] Chief never directly executes bash/browser tools

## Definition of Done

* Integration test: end-to-end delegation flow (Chief → Scout → result → user)
* Typecheck passes
* System prompt tested with decomposition examples

## Out of Scope

* Parallel delegation (future)
* Multi-round monitoring (future)
* User-driven delegation (user directly commanding sub-pets)
* Sub-pet to sub-pet delegation (only Chief delegates)

## Technical Approach

### Delegate flow

```
User: "Research React 19 features and write a summary script"
  → Chief decomposes:
    1. delegate_task(role="scout", task="Research React 19 new features")
    2. Wait for Scout result → write to blackboard
    3. delegate_task(role="coder", task="Write a Node.js script summarizing: {blackboard ref}")
    4. Wait for Coder result → synthesize response
  → User sees: "Done! Scout found X features, Coder wrote the script at Y"
```

### New tools

```typescript
// delegate_task — Chief only
{
  name: 'delegate_task',
  parameters: {
    target_role: string,    // 'coder' | 'scout' | 'analyst'
    task_description: string,
    context_refs?: string[], // blackboard keys to pass as context
  },
  execute: async (params) => {
    // 1. Look up which petId has this role
    // 2. If pet not active, PetManager creates it
    // 3. PetManager.delegate(chiefId, targetPetId, task)
    // 4. Wait for result (with timeout)
    // 5. Return result to Chief
  }
}
```

### System prompt for Chief

```
You are Chief, the coordinator of a team of AI pets. You receive user requests
and delegate them to specialists:
- Coder: writes code, edits files, runs commands
- Scout: browses the web, searches for information, takes screenshots
- Analyst: reads files, analyzes data, summarizes information

Break complex tasks into steps, delegate each to the right specialist,
and synthesize the results into a clear response for the user.
Use write_blackboard to share context, read_blackboard to access specialist outputs.
```

### New files

* `src/agent/tools/delegate.ts` — delegate_task, read_blackboard, write_blackboard tools
* Update `src/agent/profiles.ts` — Chief profile gets delegate tools
* Update `src/agent/runtime.ts` — handle delegation result events

## Technical Notes

* Depends on M2 (profiles), M3 (blackboard), M4 (PetManager)
* `pet-manager.ts:delegate()` is the underlying mechanism
* Timeout via `Promise.race([petManager.delegate(), sleep(5min)])`
