# Tool Experience — Failure Tracking

## Goal

Record every tool execution outcome (success/failure, duration, error type) and inject aggregated failure patterns into the agent's system prompt, so the LLM avoids repeating the same mistakes.

## What I already know

* Current tools: read, bash, edit, write, grep, find, ls, create_directory, delete_file, scheduler tools, browser_action (~14 total)
* Tool execution events already flow through `runtime.ts` via `tool_execution_start` / `tool_execution_end` with duration tracking
* `AgentToolResult` has an `error` flag in `details`
* System prompt is a static string in `runtime.ts:151`
* Reference: OpenAkita's `ToolExperienceTracker` records JSONL + `summarize_recent_failures()` aggregates with sliding window (200 entries, min 2 failures, min 50% failure rate)
* Storage for multi-pet future: SQLite (decided in grill session, will be built in M3). For M1, use a lightweight file-based approach that migrates easily.

## Assumptions (temporary)

* M1 runs in single-agent mode (no multi-pet yet)
* Experience data is local to this machine, no sync needed
* Failure patterns are injected at the start of each new agent run, not mid-conversation

## Requirements

1. **Tool execution recording**: After each tool call completes, record a JSONL entry with: timestamp, tool name, success/failure, duration (ms), error message (if failed), truncated args (redacted secrets)
2. **Secret redaction**: Before recording, strip API keys, tokens, passwords from args and results
3. **Failure aggregation**: Provide a function that reads recent JSONL entries and returns a summarized list of failure patterns (tool name + error type + count + example message)
4. **Prompt injection**: Append failure patterns to the system prompt as a "Lessons learned" section, so the LLM sees known pitfalls before acting
5. **Sliding window**: Only consider the most recent N entries (default 200) for aggregation
6. **Auto-rotate**: When the JSONL file exceeds a size limit (e.g. 1MB), truncate old entries

## Acceptance Criteria

* [ ] Every tool call (success or failure) produces a JSONL entry in the experience log
* [ ] Secrets (API keys, tokens, passwords) are redacted from recorded args/results
* [ ] `summarizeRecentFailures()` returns aggregated failure patterns with tool name, error count, failure rate, and example error message
* [ ] System prompt includes a "Known issues" section when failure patterns exist
* [ ] System prompt is unchanged when no failures are recorded
* [ ] JSONL file auto-rotates when exceeding size limit
* [ ] No performance degradation visible in tool execution latency (< 5ms overhead per call)

## Definition of Done

* Tests added for: recording, redaction, aggregation, prompt injection, rotation
* Typecheck passes
* No new dependencies beyond what's already in package.json (use Node.js fs/path)

## Out of Scope

* Multi-agent experience sharing (M3/M4 territory)
* Per-pet experience isolation (M2 territory)
* UI display of failure history (future)
* Self-evolution / auto-skill generation (M16 decision: passive learning only)
* SQLite migration (M3)

## Technical Approach

### Storage

JSONL file at `%APPDATA%/clawd/experience.jsonl`. One line per tool execution:
```json
{"ts":"2026-05-18T10:30:00Z","tool":"bash","ok":true,"ms":120}
{"ts":"2026-05-18T10:30:05Z","tool":"browser_action","ok":false,"ms":5000,"err":"Timeout 5000ms","args":{"action":"navigate","url":"https://..."}}
```

### Injection point

In `runtime.ts`, before creating the Agent, call `summarizeRecentFailures()` and append to system prompt:
```
## Recent tool failures to avoid
- browser_action: 3/4 recent calls failed with "Timeout" — consider adding wait time or using a different approach
- bash: 2/3 recent calls failed with "ENOENT" — double-check file paths before executing
```

### Secret redaction

Regex-based: match common patterns like `sk-...`, `ghp_...`, `xoxb-...`, `Bearer ...`, fields named `apiKey`/`password`/`token`/`secret`.

### File structure

New file: `src/agent/experience.ts` — contains:
- `recordExperience(entry)` — append JSONL
- `summarizeRecentFailures(window?, minCount?, minRate?)` — read + aggregate
- `redactSecrets(obj)` — deep redaction
- `rotateIfNeeded(maxBytes?)` — truncate old entries

### Integration

In `runtime.ts:createAgentRuntime()`:
1. Subscribe to `tool_execution_end` events (already subscribed)
2. After each event, call `recordExperience()`
3. Before agent creation, call `summarizeRecentFailures()` and append to system prompt

## Technical Notes

* `runtime.ts:308-328` — `tool_execution_end` handler already has toolName, result, duration, isError
* `runtime.ts:164` — `toolStartTimes` map already tracks timing
* OpenAkita reference: `experience.py` uses JSONL with `summarize_recent_failures(window=200, min_failures=2, min_failure_rate=0.5)`
* Config dir: `%APPDATA%/clawd/` (already used by config-store.ts)
