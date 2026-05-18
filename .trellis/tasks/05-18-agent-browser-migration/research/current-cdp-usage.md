# Research: Current CDP Usage

- **Query**: Explore how Chrome DevTools Protocol (CDP) is currently used for browser automation in the project
- **Scope**: internal
- **Date**: 2026-05-18

## Findings

### Overview

The project ("Clawd Desktop Pet Agent") is an Electron app that uses Playwright's CDP (Chrome DevTools Protocol) integration to automate the user's existing Chrome or Edge browser. The CDP bridge connects to an already-running browser instance (or launches one) and provides a single `browser_action` tool to the AI agent with sub-actions for navigation, clicking, typing, screenshots, and content extraction.

No browser binary is bundled -- the tool reuses whatever Chrome or Edge is installed on the system. This is Windows-specific (standard installation paths are searched).

### Key Files and Their Roles

| File Path | Description |
|---|---|
| `src/agent/tools/browser.ts` | Main browser automation tool. Defines `browser_action` tool with 7 sub-actions. Manages singleton CDP connection via Playwright. |
| `src/agent/tools/browser-launch.ts` | Browser launcher helper. Finds Chrome/Edge on disk, spawns with `--remote-debugging-port`, waits for CDP port readiness. |
| `src/agent/tools/registry.ts` | Tool registry. Combines pi-coding-agent tools with custom tools including `browser_action`. Dynamically imports browser tool at line 69. |
| `src/config/config-store.ts` | Configuration persistence. Stores `BrowserConfig` (chromePath, cdpPort) in JSON file at `{userData}/clawd-config.json`. |
| `src/shared/types.ts` | Shared type definitions. Defines `BrowserConfig` interface (lines 111-114) with `chromePath` and `cdpPort` fields. |
| `src/shared/constants.ts` | Application constants. Maps `browser_action` to `TrustLevel.CONFIRM_STEP` (line 50). |
| `src/main/main.ts` | Electron main process. Registers IPC handlers for browser config CRUD and CDP connection testing (lines 612-701). |
| `src/renderer/settings/SettingsWindow.tsx` | Settings UI with `BrowserSection` component (lines 359-433). Chrome path input, CDP port input, Save/Test buttons. |
| `src/preload/settings-preload.ts` | Settings window preload. Exposes `loadBrowserConfig`, `saveBrowserConfig`, `testBrowserConnection` via IPC (lines 45-66). |
| `src/electron-shim.d.ts` | Type declarations for Playwright. Declares `chromium.connectOverCDP()` and other Playwright types (lines 295-336). |

### How CDP Is Configured and Initialized

**Configuration flow:**

1. `BrowserConfig` in `src/shared/types.ts` (line 111-114) defines two fields:
   - `chromePath: string` -- path to browser executable (empty = auto-detect)
   - `cdpPort: number` -- CDP remote debugging port (default: 9222)

2. `config-store.ts` stores this in `AppConfig.browser` (line 118) with defaults at lines 41-44:
   ```typescript
   browser: {
     chromePath: '',
     cdpPort: 9222,
   },
   ```

3. `updateBrowserConfig()` (line 125-136) performs a merge-update on the browser section only.

**Connection flow (in `browser.ts`, `getOrConnectBrowser()` at line 67):**

1. Reads config via `readConfig()` to get `cdpPort` and `chromePath`
2. Reuses existing singleton connection if still alive and port unchanged (line 73)
3. Tries `pw.chromium.connectOverCDP("http://localhost:{cdpPort}")` (line 85) to connect to already-running browser
4. If connection fails, calls `findBrowserPath(configuredChromePath)` to locate Chrome/Edge (line 98)
5. Calls `launchBrowserWithCDP(browserPath, cdpPort)` to spawn browser with `--remote-debugging-port` flag (line 108)
6. Waits for CDP port to become available (up to 15 seconds, polling every 500ms)
7. Connects via `connectOverCDP` to the newly launched browser

**Browser launch details (in `browser-launch.ts`):**

- `findBrowserPath()` (line 44): Checks configured path first, then searches Windows standard paths in order: Edge (x86), Edge (Program Files), Chrome (Program Files), Chrome (x86)
- `launchBrowserWithCDP()` (line 125): Spawns browser with flags:
  - `--remote-debugging-port={port}`
  - `--no-first-run`
  - `--no-default-browser-check`
- Process is unref'd so it doesn't block agent exit
- `waitForPort()` polls TCP connection every 500ms for up to 15 seconds

**Settings UI (in `SettingsWindow.tsx`, `BrowserSection` at line 359):**

- Chrome/Edge path text input (empty = auto-detect)
- CDP port number input (1-65535, default 9222)
- Save button -> writes to config file via IPC
- Test Connection button -> main process makes HTTP GET to `http://127.0.0.1:{port}/json/version` to verify CDP is reachable

**Connection test in main process (main.ts, lines 630-701):**

- Validates port range
- Validates Chrome path exists if provided
- Uses Electron's `net.request` to hit `/json/version` endpoint
- Returns browser info (Browser name, User-Agent) on success
- 5-second timeout on the HTTP request

### What Automation Tasks CDP Currently Performs

The `browser_action` tool (defined in `browser.ts`, `buildBrowserTool()` at line 382) supports these sub-actions:

| Action | Description | Key Parameters |
|---|---|---|
| `navigate` | Navigate to URL | `url` (required), 30s timeout |
| `click` | Click an element | `selector`, `selector_type` (css or text) |
| `type` | Type text into input field | `selector`, `text`, `selector_type` |
| `screenshot` | Capture page screenshot as base64 PNG | No params, returns `image` content |
| `get_content` | Get text content of page or element | `selector` (optional), truncates at 10,000 chars |
| `go_back` | Navigate browser history back | No params, 15s timeout |
| `go_forward` | Navigate browser history forward | No params, 15s timeout |

**Page selection strategy** (`getOrCreatePage()` at line 136): Uses the first context's first page from the CDP-connected browser. If no pages exist, creates a new one. Does not close existing tabs.

**Selector types**: Both CSS selectors and text-based matching (via Playwright's `getByText`) are supported.

**Trust level**: `CONFIRM_STEP` -- every action requires user confirmation before execution (set in `constants.ts` line 50).

### Current Limitations or Pain Points Visible in the Code

1. **Single page operation**: Always operates on the first page of the first browser context. No way to target specific tabs, create new tabs, or switch between them.

2. **No tab management**: No actions for creating, closing, or switching tabs. The agent cannot open links in new tabs.

3. **Singleton connection**: One browser connection shared across all invocations (`browserConnection` module-level variable at line 41). If the browser disconnects, the next call re-establishes. Port changes silently discard the stale reference.

4. **Windows-only browser detection**: `BROWSER_PATHS` in `browser-launch.ts` only lists Windows paths. No macOS or Linux support.

5. **No cookie/session management**: The tool operates on whatever browser session exists. No way to manage cookies, handle logins specifically, or isolate sessions.

6. **No file download/upload**: No actions for downloading files or uploading files to web forms.

7. **No wait/interaction helpers**: No explicit wait-for-element, hover, scroll, drag, or keyboard shortcut actions.

8. **Content truncation**: `get_content` truncates at 10,000 characters, which may lose important page content for complex pages.

9. **Playwright ESM-only import**: Uses dynamic `import('playwright')` (line 49-54) because Playwright is ESM-only in recent versions. This works but adds async overhead.

10. **No iframe support**: No way to interact with content inside iframes.

11. **CDP port conflict risk**: Default port 9222 may conflict with other CDP-using tools or Chrome DevTools instances.

12. **Browser launch does not auto-start**: Per the PRD, "user needs to start Chrome with --remote-debugging-port themselves." However, `launchBrowserWithCDP` does attempt to launch if nothing is listening -- but if Chrome is already running (without CDP), the launch may fail or open a new window that cannot claim the port.

13. **`connectOverCDP` vs `launch` duality**: The code uses `connectOverCDP` exclusively -- it never uses Playwright's `chromium.launch()`. This means the browser's lifecycle is managed externally (by the user or by `launchBrowserWithCDP`).

### Architecture Context (Electron App)

This is an Electron desktop application named "Clawd" (package `pi-agent-tool`). Key architecture:

- **Main process** (`src/main/main.ts`): Creates windows, handles IPC, routes messages between renderer and agent.
- **Agent process**: Runs in an Electron `utilityProcess` (forked from `src/agent/agent-process.js`). Communicates with main via `MessageChannelMain`. The browser tool lives here.
- **Renderer windows**: Multiple BrowserWindows -- pet overlay, chat sidebar, settings, quick input. Each has its own preload script.
- **Config**: JSON file stored at Electron `userData` path. Agent process accesses config via `CLAWD_USER_DATA` environment variable.
- **Tool system**: Uses `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent` packages. Custom tools follow the `AgentTool` interface from pi-agent-core.
- **Playwright dependency**: Version `^1.52.0` listed in `dependencies`. Playwright types are shimmed in `electron-shim.d.ts`.

### Related Specs

- `.trellis/tasks/archive/2026-05/05-18-integrate-chrome-cdp-bridge/prd.md` -- Original PRD for making CDP configurable (completed)

### Caveats / Not Found

- No spec files found under `.trellis/spec/` that specifically address CDP or browser automation.
- The `chat-preload.ts` file does not reference CDP directly -- it handles IPC for chat messages, slide-in/out animations, and history sync.
- No MCP (Model Context Protocol) server or browser server implementation was found. The CDP integration is purely tool-based (agent calls `browser_action`, which connects to the browser).
- No tests were found for the browser automation code.
