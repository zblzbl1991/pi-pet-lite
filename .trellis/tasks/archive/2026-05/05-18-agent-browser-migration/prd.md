# Migrate Browser Automation: Playwright → agent-browser CLI

## Goal

Replace Playwright's in-process CDP page operations with agent-browser CLI (Vercel Labs). Gain AI-first browser interaction model: accessibility tree snapshots, dynamic element refs, annotated screenshots.

## Background

### Grill-me decisions (2026-05-18)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Motivation | Playwright too heavy + agent-browser design philosophy | agent-browser's snapshot+ref model fits exploration-based agent usage |
| Core value | Dynamic ref generation, no fixed DOM selectors | Agent discovers page elements before acting, rather than knowing selectors upfront |
| Usage pattern | Exploration-based | Agent first sees page structure, then decides what to do |
| Latency tolerance | Unlimited | Desktop pet use case, not latency-sensitive |
| Browser target | User's own Chrome via CDP | Preserve user's logged-in sessions, bookmarks |
| Launch layer | Keep `browser-launch.ts` | Already pure Node.js (spawn + net + fs), zero Playwright dependency |
| Risk | Accept v0.x instability | agent-browser v0.27.0, willing to debug Rust IPC issues |

### Research

- [agent-browser evaluation](research/agent-browser-evaluation.md) — features, architecture, CLI API
- [current CDP usage](research/current-cdp-usage.md) — existing Playwright integration, limitations

## What changes

### Keep (no modification)

- `browser-launch.ts` — Chrome/Edge discovery, `--remote-debugging-port` launch, port polling
- `config-store.ts` — `BrowserConfig` (chromePath, cdpPort)
- `SettingsWindow.tsx` — Browser section UI
- `main.ts` IPC — connection test, config CRUD
- Settings preload — IPC bridge

### Replace

- `browser.ts` — Rewrite all Playwright page operations → agent-browser CLI calls

### Add

- `agent-browser-client.ts` — CLI wrapper (exec, JSON parse, error handling, daemon lifecycle)
- `snapshot` action — New tool action returning accessibility tree + element refs

### Remove

- `playwright` npm dependency
- `electron-shim.d.ts` Playwright type declarations (lines 295-336)

## Architecture

### Before

```
Agent tool call
  → browser.ts (getOrConnectBrowser via Playwright connectOverCDP)
    → Playwright page.goto / page.locator / page.screenshot / page.evaluate
      → CDP WebSocket → Chrome
```

### After

```
Agent tool call
  → browser-launch.ts (find Chrome, launch with --remote-debugging-port) — UNCHANGED
  → agent-browser-client.ts (exec: agent-browser connect --cdp <port>)
    → agent-browser snapshot --json   → accessibility tree + refs
    → agent-browser click @e3         → click by ref
    → agent-browser fill @e5 "text"   → fill by ref
    → agent-browser screenshot --annotate page.png → annotated screenshot
      → Rust daemon → CDP → Chrome
```

## Tool actions

### New actions

| Action | agent-browser command | Description |
|--------|----------------------|-------------|
| `snapshot` | `agent-browser snapshot --json` | Return accessibility tree with element refs (`@e1`, `@e2`, ...) |
| `scroll` | `agent-browser scroll down` / `scroll up` | Scroll the page |
| `hover` | `agent-browser hover @e3` | Hover over element |

### Migrated actions

| Current (Playwright) | New (agent-browser CLI) |
|---------------------|------------------------|
| `page.goto(url)` | `agent-browser open <url>` |
| `page.locator(sel).click()` | `agent-browser click @ref` |
| `page.locator(sel).fill(text)` | `agent-browser fill @ref "text"` |
| `page.screenshot()` | `agent-browser screenshot --json` |
| `page.evaluate(() => document.body.innerText)` | `agent-browser get text` |
| `page.goBack()` | `agent-browser go back` |
| `page.goForward()` | `agent-browser go forward` |

### Selector model change

**Before**: Agent provides CSS selector or text match (`selector_type: "css" | "text"`)
**After**: Agent calls `snapshot` first to discover elements, then uses refs (`@e1`, `@e2`)

New tool parameter schema:

```typescript
action: 'snapshot' | 'open' | 'click' | 'type' | 'screenshot' | 'scroll' | 'hover' | 'get_text' | 'go_back' | 'go_forward'
ref?: string       // element ref from snapshot (e.g., "@e3")
url?: string       // for open action
text?: string      // for type action
direction?: 'up' | 'down'  // for scroll action
```

## Acceptance Criteria

- [ ] `playwright` removed from package.json dependencies
- [ ] All current browser operations work via agent-browser CLI
- [ ] New `snapshot` action returns accessibility tree with refs
- [ ] Agent can click/type using refs from snapshot
- [ ] Settings UI "Test Connection" still works (hits CDP port directly)
- [ ] Chrome launch via browser-launch.ts still works
- [ ] Error handling: CLI exec failures return meaningful error messages
- [ ] Daemon lifecycle: auto-start on first use, graceful shutdown on app exit

## Definition of Done

- All acceptance criteria met
- `npm run typecheck` passes
- Manual test: snapshot → click → type → screenshot flow works on user's Chrome
- Manual test: app exit cleans up agent-browser daemon

## Known Risks

1. **Windows daemon stability** — agent-browser's Rust daemon on Windows is untested by us
2. **v0.x API churn** — output format may change between versions
3. **Chrome profile lock** — README notes Windows profile file locking issues
4. **No TypeScript types** — CLI wrapper has no type safety from the tool itself
5. **JSON parsing fragility** — must handle malformed CLI output gracefully

## Out of Scope

- Tab management (create, switch, close) — future enhancement
- File upload/download — future enhancement
- Session persistence (cookies/localStorage) — agent-browser supports it but not in initial migration
- Cloud browser providers — not relevant to local Electron use
- macOS/Linux browser path detection — current scope is Windows only
