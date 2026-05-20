# Design System Token Migration

## Goal

Align the Clawd renderer codebase with the design system defined in `.impeccable.md`. Replace all hardcoded inline style values with CSS variable tokens, establishing a maintainable design layer.

## Context

- `.impeccable.md` defines a complete design system (colors, spacing, typography, motion, glass effects)
- Current codebase has **zero CSS infrastructure** — all styles are inline `React.CSSProperties` with hardcoded hex/rgba values
- ~235 hardcoded values across 6 TSX components + 4 HTML entry points
- No existing CSS files, no CSS variables, no design tokens

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token delivery | CSS variables (`var(--token)`) | Works in both React inline styles and HTML `<style>` blocks; future-proof for theming |
| File architecture | Single `tokens.css` + import in each entry TSX | Vite handles CSS import natively; zero config |
| HTML inline styles | Extract to `reset.css`, clear HTML `<style>` blocks | Eliminates 4x duplicated reset + font stack |
| Migration strategy | Incremental 4 phases | Controllable scope per phase; easier review and rollback |
| Color values | Strict document token values | Unify to Slate-tinted dark palette; accept visual change |
| Main process colors | Extract to shared constants | Prevent flash of old color during window load |
| Lucide icons | Phase 4, separate from token migration | Decouple concerns; token PR diffs stay clean |
| Glass effect | Full glass on transparent windows + ChatPanel | ChatPanel gets `transparent: true` + `blur(16px)`; Settings keeps native frame |
| File structure | Pure token replacement, no refactoring | Keep diff focused; file splits are separate concern |
| Verification | Manual walkthrough of 4 windows | 5 minutes per phase; no test framework needed |

## Implementation Plan

### Phase 1: Infrastructure (zero-risk, add-only)

Create files, wire imports, no component changes.

- [ ] Create `src/renderer/styles/tokens.css` — all CSS custom properties (colors, spacing, radii, typography, motion, glass)
- [ ] Create `src/renderer/styles/reset.css` — global reset, font-family, base typography, scrollbar styles
- [ ] Add `import '../styles/tokens.css'` and `import '../styles/reset.css'` in all 4 entry TSX files
- [ ] Clear `<style>` blocks in all 4 HTML entry files (keep only `@keyframes blink` in chat/index.html if needed, or move to reset.css)
- [ ] Create/update `src/shared/theme-constants.ts` — named color constants for main process (page bg, card bg, success, etc.)
- [ ] Update main process `windows.ts` — replace hardcoded `backgroundColor` literals with theme constants
- [ ] Update `tray.ts` — replace hardcoded `rgb(80, 180, 120)` with theme constant
- [ ] Update ChatPanel BrowserWindow config: add `transparent: true`, remove `backgroundColor`
- [ ] Verify: `npm run build` passes, app launches without errors

### Phase 2: Color tokens (~102 replacements)

Replace all hardcoded hex/rgba colors with `var(--*)` tokens.

- [ ] `ChatPanel.tsx` — ~32 color replacements (backgrounds, text, semantic colors, borders)
- [ ] `ChatBubble.tsx` — ~16 color replacements (bubble bg, text, status colors)
- [ ] `PetWindow.tsx` — ~10 color replacements (tooltip bg, role colors, status badge)
- [ ] `SettingsWindow.tsx` — ~40 color replacements (sidebar, content, inputs, buttons, role indicators)
- [ ] `QuickInput.tsx` — ~4 color replacements
- [ ] Apply glass effect: ChatBubble and QuickInput `backdrop-filter` → `blur(16px)`
- [ ] Apply glass to ChatPanel: add `backdrop-filter: blur(16px)` to panel background
- [ ] Verify: launch app, walk through all 4 windows, confirm colors render correctly

### Phase 3: Spacing + Radius + Typography + Motion tokens (~133 replacements)

- [ ] All components: padding/margin/gap → `var(--space-*)`
- [ ] All components: borderRadius → `var(--radius-*)`
- [ ] All components: fontSize/fontWeight → token references
- [ ] ChatPanel: transition durations → token references
- [ ] Verify: launch app, check layout integrity across all windows

### Phase 4: Lucide Icons (separate concern)

- [ ] `npm install lucide-react`
- [ ] Add icons to buttons: Save (Save), Test (Plug), Send (Send), Stop (Square)
- [ ] Add icons to Settings navigation items
- [ ] Add status indicator icons where applicable
- [ ] Verify: full walkthrough of all windows

## Key Files

| File | Role | Approx. replacements |
|------|------|---------------------|
| `src/renderer/chat/ChatPanel.tsx` | Chat UI | ~80 |
| `src/renderer/pet/ChatBubble.tsx` | Speech bubble | ~36 |
| `src/renderer/pet/PetWindow.tsx` | Pet overlay | ~18 |
| `src/renderer/quick-input/QuickInput.tsx` | Floating input | ~10 |
| `src/renderer/settings/SettingsWindow.tsx` | Settings (983 lines) | ~90 |
| `src/renderer/settings/index.html` | Settings HTML entry | cleanup |
| `src/renderer/chat/index.html` | Chat HTML entry | cleanup |
| `src/renderer/index.html` | Pet HTML entry | cleanup |
| `src/renderer/quick-input/index.html` | Quick input HTML | cleanup |
| `src/main/windows.ts` | BrowserWindow configs | ~3 |
| `src/main/tray.ts` | Tray icon | 1 |

## Constraints

- Do NOT change component file structure or split files
- Do NOT add new components (except CSS files)
- Do NOT change business logic or IPC interfaces
- All 4 windows must function identically after each phase
- Settings window keeps native title bar (`frame: true`)
