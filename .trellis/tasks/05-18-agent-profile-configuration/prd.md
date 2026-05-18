# Agent Profile Configuration

## Goal

Replace the hardcoded tool/skill/system-prompt setup with a profile-driven configuration system, so each pet gets a differentiated identity, tool set, and behavior from a declarative config.

## What I already know

* Current tools are registered flat in `registry.ts:getAllTools()` — all tools loaded for every agent
* System prompt is a static string in `runtime.ts:151`
* Trust policy is a flat map in `constants.ts:TRUST_POLICY`
* Config stored in `clawd-config.json` via `config-store.ts`
* Grill decisions: 4 fixed pets (Chief/Coder/Scout/Analyst), each with different tool sets, different LLM models (configurable), different system prompts
* Reference: OpenAkita's `AgentProfile` controls skills, tools, MCP servers, identity, memory, permissions per agent

## Requirements

1. **PetProfile type**: Define a TypeScript interface with: id, name, role (chief/coder/scout/analyst), systemPrompt, toolNames (allowlist), llm override (optional model/provider), skillList (L1/L2 for future M15)
2. **Default profiles**: Ship 4 built-in profiles for Chief/Coder/Scout/Analyst
3. **Profile-aware tool loading**: `getToolsForProfile(profile)` returns only the tools matching `profile.toolNames`
4. **Profile-aware system prompt**: Each profile has its own system prompt template
5. **Profile-aware trust policy**: Each profile can override the global trust policy for its tools
6. **Profile-aware LLM config**: Each profile can specify a different model/provider/apiKey (falls back to global config)
7. **Profile persistence**: Profiles stored in config file, user can customize them in settings UI
8. **Backward compatible**: If no profile is specified, behave like current flat setup

## Acceptance Criteria

* [ ] `PetProfile` interface defined in `shared/types.ts`
* [ ] 4 built-in profiles defined as defaults
* [ ] `getToolsForProfile()` returns filtered tool array
* [ ] `createAgentRuntime()` accepts a profile parameter
* [ ] Each pet gets its own system prompt, tool set, and LLM config
* [ ] Existing single-agent mode still works (default to Chief profile)
* [ ] Typecheck passes

## Definition of Done

* Tests for profile loading, tool filtering, prompt selection
* Typecheck passes
* Settings UI updated to show profile config (basic)

## Out of Scope

* Multi-pet runtime management (M4)
* Skill L1/L2 progressive disclosure (M15 — but field is reserved in profile)
* Plugin sandbox (future)
* Dynamic profile creation at runtime (fixed profiles only)

## Technical Approach

### PetProfile interface

```typescript
interface PetProfile {
  id: string;           // e.g. "chief", "coder"
  name: string;         // e.g. "Chief"
  role: 'chief' | 'coder' | 'scout' | 'analyst';
  systemPrompt: string;
  toolNames: string[];  // allowlist of tool names
  trustOverrides?: Partial<Record<string, TrustLevel>>;
  llm?: Partial<LLMConfig>;  // override global LLM config
  skills?: string[];    // reserved for M15 skill L1/L2
  icon?: string;        // pet icon/gif name
}
```

### Built-in profiles

| Profile | Tools | System Prompt Focus |
|---------|-------|-------------------|
| Chief | chat only + delegate tools | Task decomposition, delegation, reporting |
| Coder | read, write, edit, bash, grep, find, ls | Code writing, file manipulation |
| Scout | browser_action, web search, screenshot | Web browsing, information gathering |
| Analyst | read, grep, find, ls, memory tools | Data analysis, summarization, comparison |

### New files

* `src/agent/profiles.ts` — profile definitions, loading, filtering
* Update `src/shared/types.ts` — add PetProfile
* Update `src/agent/runtime.ts` — accept profile param
* Update `src/agent/tools/registry.ts` — add `getToolsForProfile()`

## Technical Notes

* `registry.ts:getAllTools()` — currently loads all tools, will add filter function
* `runtime.ts:createAgentRuntime()` — currently hardcodes system prompt + tools
* `config-store.ts` — will add `profiles` section to AppConfig
* `constants.ts:TRUST_POLICY` — global defaults, profiles override per-tool
