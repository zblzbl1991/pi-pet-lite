# Pet Profile Configuration — PRD

## Goal

将 pet profile 从硬编码改为完整可配置，用户可通过 Settings UI 创建自定义 profile、编辑 systemPrompt/toolNames/gifPrefix/enabled，配置持久化到 `clawd-config.json`。

## Design Decisions (from grill-me session)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | systemPrompt/toolNames in UI | Yes |
| Q2 | systemPrompt editor | Markdown preview + textarea toggle |
| Q3 | toolNames UI | Grouped checkbox with friendly names |
| Q4 | Create new custom profiles | Supported |
| Q5 | Custom profile role | `"custom"` value, identify by id |
| Q6 | Default system prompt for new profiles | Generic template "You are {name}..." |
| Q7 | Default tools for new profiles | `['read','grep','find','ls']` |
| Q8 | gifPrefix default | `"clawd"` |
| Q9 | New profile creation UX | "+" button at card list bottom, inline expand |
| Q10 | Deletion policy | Built-in: disable only. Custom: can delete with confirmation |
| Q11 | Config change propagation | Auto dispose + rebuild on next delegate |
| Q12-13 | Chief awareness of specialists | Auto-inject specialist list at agent startup |
| Q14 | delegate_task validation | Dynamic description + dynamic execute validation |
| Q15 | Profile count limit | No hard limit, use enabled toggle |

## Requirements

- [R1] PetProfile type supports `enabled?: boolean` and `gifPrefix?: string`
- [R2] PetRole includes `CUSTOM: 'custom'` for user-created profiles
- [R3] AppConfig includes `profiles?: PetProfile[]` persisted to config.json
- [R4] Tool groups mapping: TOOL_GROUPS constant with friendly names for Settings UI
- [R5] config-store: updateProfilesConfig() and resetProfilesConfig()
- [R6] profiles.ts: resolveProfile() merges built-in base with config overrides
- [R7] getProfileById() returns undefined for disabled profiles
- [R8] getEnabledSpecialistProfiles() returns all non-chief enabled profiles
- [R9] runtime.ts: Chief agent startup auto-injects specialist list into system prompt
- [R10] delegate.ts: VALID_ROLES is dynamic, tool description lists available roles
- [R11] PET_ROLE_COLORS includes custom: '#888888'
- [R12] Full IPC chain: settings:load/save/reset-profiles
- [R13] Settings UI: ProfilesSection with card list, grouped checkboxes, Markdown preview
- [R14] New profile creation via inline "+" button
- [R15] Built-in profiles can only be disabled (Chief cannot be disabled)
- [R16] Custom profiles can be deleted with confirmation dialog
- [R17] Config save triggers auto-dispose of affected agents

## Acceptance Criteria

- [ ] `npx tsc --noEmit` passes
- [ ] Settings > Pets tab visible with 4 built-in profile cards
- [ ] Can edit Scout gifPrefix to "ikun", save, Scout window disappears then rebuilds with new skin
- [ ] Can create new custom profile "Researcher" with default prompt/tools
- [ ] Chief's injected specialist list includes custom profile
- [ ] Can delegate_task to custom profile by id
- [ ] Disabling Analyst removes it from Chief's specialist list and delegate validation
- [ ] Reset to Defaults restores built-in profiles
- [ ] Deleting custom profile removes it with confirmation

## Implementation Plan (9 subtasks)

### T1: types.ts extensions
PetRole + CUSTOM, PetProfile + enabled, AppConfig + profiles

### T2: constants.ts additions
TOOL_GROUPS, CUSTOM_PROFILE_DEFAULT_PROMPT, CUSTOM_PROFILE_DEFAULT_TOOLS

### T3: config-store.ts
profiles default, readConfig merge, updateProfilesConfig(), resetProfilesConfig()

### T4: profiles.ts merge logic
resolveProfile(), dynamic getProfileById/getProfileIds/getAllProfiles, getEnabledSpecialistProfiles()

### T5: runtime.ts specialist injection
Chief startup: append specialist list to system prompt

### T6: delegate.ts dynamic roles
Dynamic VALID_ROLES, dynamic tool description, dynamic validateRole()

### T7: pet-window-manager.ts
PET_ROLE_COLORS + custom: '#888888'

### T8: IPC chain
preload + electron-types + main.ts handlers for load/save/reset profiles

### T9: SettingsWindow ProfilesSection
Card list, Markdown preview + textarea, grouped checkboxes, create/delete/disable/save/reset

## Dependency Graph

```
T1 (types)
├── T2 (constants)
├── T3 (config-store)
│   └── T4 (profiles.ts)
│       ├── T5 (runtime)
│       └── T6 (delegate)
├── T7 (pet-window colors)
└── T8 (IPC)
    └── T9 (Settings UI) ← final deliverable
```

## Related Files

- `src/shared/types.ts` — PetProfile, PetRole, AppConfig
- `src/shared/constants.ts` — TOOL_GROUPS, GIF mappings
- `src/config/config-store.ts` — config persistence
- `src/agent/profiles.ts` — profile registry
- `src/agent/runtime.ts` — agent creation + specialist injection
- `src/agent/tools/delegate.ts` — delegation validation
- `src/main/pet-window-manager.ts` — pet windows
- `src/preload/settings-preload.ts` — settings IPC bridge
- `src/renderer/electron-types.d.ts` — type declarations
- `src/main/main.ts` — IPC handlers
- `src/renderer/settings/SettingsWindow.tsx` — Settings UI
