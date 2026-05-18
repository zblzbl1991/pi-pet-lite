# Research: agent-browser (vercel-labs) Evaluation

- **Query**: Evaluate the agent-browser library from https://github.com/vercel-labs/agent-browser for potential use in an Electron app that currently uses raw CDP via Playwright.
- **Scope**: External (GitHub repo analysis) + Internal (current project CDP usage)
- **Date**: 2026-05-18

## Findings

### Overview: What is agent-browser?

agent-browser is a **browser automation CLI for AI agents** built by Vercel Labs. It is a **native Rust binary** (not a Node.js library) that provides a high-level command-line interface for controlling Chromium-based browsers. It is designed specifically for AI agent workflows -- LLMs invoke CLI commands to interact with web pages.

- **Repository**: https://github.com/vercel-labs/agent-browser
- **Homepage**: https://agent-browser.dev
- **License**: Apache-2.0
- **Version**: 0.27.0
- **Platforms**: macOS ARM64/x64, Linux ARM64/x64, Windows x64 (native Rust binaries)
- **Installation**: npm, Homebrew (macOS), Cargo (Rust), or build from source

### Key Features and Capabilities

1. **Snapshot-based element discovery**: `agent-browser snapshot` returns an accessibility tree with stable element refs (`@e1`, `@e2`, etc.) -- designed for LLM consumption
2. **Annotated screenshots**: `screenshot --annotate` overlays numbered labels on interactive elements that map to refs
3. **AI Chat mode**: Built-in natural language control via `agent-browser chat` powered by Vercel AI Gateway
4. **Multiple selector types**: Refs (recommended), CSS selectors, text selectors, XPath, semantic locators (ARIA role, label, placeholder)
5. **Session management**: Isolated browser sessions, session persistence (cookies + localStorage), state save/load, Chrome profile reuse
6. **Security features**: Domain allowlists, action policies, content boundary markers, output length limits, auth vault with encryption
7. **Cloud browser providers**: Browserless, Browserbase, Browser Use, Kernel, AWS AgentCore -- same commands work with cloud browsers
8. **Network interception**: Route, mock, block, and record network requests; HAR recording
9. **React DevTools integration**: Component tree inspection, render profiling, Suspense boundary analysis, Web Vitals (LCP/CLS/TTFB/FCP/INP)
10. **Observability dashboard**: Local web dashboard for real-time session monitoring with live viewport streaming
11. **Batch execution**: Execute multiple commands in a single invocation to avoid per-command startup overhead
12. **CDP connect mode**: Can connect to an existing browser via `--cdp <port>` or `--auto-connect`
13. **Streaming**: WebSocket-based viewport streaming for live preview / "pair browsing"

### Architecture and API Design

**Client-Daemon Architecture:**
1. **Rust CLI** -- Parses commands, communicates with daemon via IPC
2. **Rust Daemon** -- Pure Rust daemon that uses direct CDP (no Node.js dependency). Starts automatically on first command, persists between commands for fast subsequent operations.

**Programming model**: CLI-first, not a library. Every interaction is a shell command:

```bash
agent-browser open example.com
agent-browser snapshot -i --json          # Get accessibility tree
agent-browser click @e2                   # Click by ref
agent-browser fill @e3 "test@test.com"    # Fill by ref
agent-browser screenshot page.png         # Screenshot
agent-browser close
```

**JSON output mode** (`--json`) returns structured data suitable for agent consumption:
```json
{"success":true,"data":{"snapshot":"...","refs":{"e1":{"role":"heading","name":"Title"},...}}}
```

**Key architectural notes:**
- The daemon uses CDP internally but wraps it in a much higher-level API
- No Node.js runtime is required for the daemon -- pure Rust
- The CLI communicates with the daemon via IPC (Unix socket / named pipe)
- Default timeout is 25 seconds for operations, with a 30-second IPC read timeout

### How it Relates to / Differs from Raw CDP

| Aspect | Raw CDP (current project approach) | agent-browser |
|--------|-----------------------------------|---------------|
| **Interface** | Programmatic API (Playwright `connectOverCDP`) | CLI commands (shell invocations) |
| **Language** | TypeScript/JavaScript (Playwright) | Rust binary invoked via shell |
| **Connection** | Direct CDP WebSocket to `localhost:9222` | Owns its own browser lifecycle; or connects via `--cdp` |
| **Element selection** | CSS selectors, Playwright locators | Accessibility tree refs (`@e1`), CSS, text, XPath, semantic locators |
| **AI friendliness** | Requires custom code to serialize state for LLMs | Built-in: `snapshot --json` returns AI-ready accessibility tree |
| **Page state** | Manual `page.evaluate()` calls | `snapshot` (accessibility tree), `get text/html/value`, `eval <js>` |
| **Dependencies** | Playwright (npm package, ~50MB+ with browsers) | Standalone Rust binary (~10MB), downloads its own Chrome |
| **Browser management** | Must find/launch browser manually | Auto-discovers or downloads Chrome for Testing |
| **Session persistence** | Manual cookie/state management | Built-in session persistence, state save/load, profile reuse |
| **Security** | Application-level enforcement | Built-in domain allowlists, action policies, content boundaries |

**CDP Connection mode**: agent-browser CAN connect to an existing browser via CDP (`--cdp 9222` or `--auto-connect`), meaning it could coexist with the current architecture where the Electron app launches Chrome with `--remote-debugging-port`. However, it would then manage the CDP connection itself rather than letting the Electron app control it directly.

### Dependencies and Requirements

**Runtime requirements:**
- Chrome/Chromium (auto-downloads Chrome for Testing via `agent-browser install`)
- No Node.js required for the daemon (pure Rust)
- Rust toolchain only needed if building from source

**npm package contents** (`agent-browser` on npm):
- Version: 0.27.0
- Ships platform-specific native binaries (macOS ARM64/x64, Linux ARM64/x64, Windows x64)
- `bin/agent-browser.js` as entry point, delegates to native binary
- Postinstall script (`node scripts/postinstall.js`)
- License: Apache-2.0

**For integration with an Electron app**, the key dependency concern is:
- Would need to spawn `agent-browser` as a child process from the Electron app
- Each command is a separate process invocation (though the daemon persists)
- JSON output parsing would be needed to feed results back to the agent

### Limitations and Caveats

1. **CLI-only, no programmatic API**: There is no Node.js SDK or library. The only way to use agent-browser is by spawning shell commands. The repo had a `packages/sdk` directory at some point but it returns 404 now -- the SDK appears to have been removed or is not on the main branch.

2. **No in-process integration**: Cannot be imported as a Node.js module. For an Electron app, every browser action would require a `child_process.exec()` or similar, adding latency per command (even though the daemon persists, the CLI process startup overhead exists).

3. **Batch mode mitigates latency**: `agent-browser batch` allows sending multiple commands in one invocation, which reduces per-command process startup overhead.

4. **Separate browser lifecycle**: By default, agent-browser launches and manages its own Chrome instance. To connect to an existing browser (like one the Electron app launched), you must use `--cdp` or `--auto-connect` on every command invocation (or `connect` once).

5. **No built-in Electron integration**: Unlike the current Playwright-based approach which can connect to any CDP endpoint, agent-browser is designed for CLI/agent workflows, not embedded library use.

6. **Windows support**: Available (Windows x64 native binary), but the README notes that Chrome profile files may be locked when Chrome is running on Windows.

7. **Overhead for simple use cases**: For the current project's needs (navigate, click, type, screenshot, get_content, go_back, go_forward), agent-browser adds significant complexity for what are relatively straightforward CDP operations.

8. **Daemon lifecycle**: The daemon starts automatically and persists. In an Electron app context, managing the daemon lifecycle (startup, shutdown, idle timeout) adds operational complexity.

### Current Project CDP Usage Summary

The project (pi-agent-tool / "Clawd") uses **Playwright's CDP connection** to automate the user's Chrome/Edge browser:

- **File**: `src/agent/tools/browser.ts` -- provides a `browser_action` tool
- **File**: `src/agent/tools/browser-launch.ts` -- finds and launches Chrome/Edge with `--remote-debugging-port`
- **Connection**: `playwright.chromium.connectOverCDP(`http://localhost:${cdpPort}`)` 
- **Actions**: navigate, click, type, screenshot, get_content, go_back, go_forward
- **Config**: `BrowserConfig` with `chromePath` and `cdpPort` (default 9222)
- **Integration**: Runs as an in-process tool within the agent's utility process

### Evaluation Summary for Electron App Use

| Criterion | Assessment |
|-----------|------------|
| **Fit for Electron** | Poor -- CLI-only, no in-process API. Requires spawning child processes for every browser action. |
| **Compared to current Playwright+CDP** | Adds complexity without clear benefit. Current approach is in-process, type-safe, and directly integrated. |
| **AI agent benefits** | Strong -- snapshot/accessibility tree, annotated screenshots, session persistence are excellent for LLM-driven workflows. |
| **Where it excels** | CLI-based agent workflows (Claude Code, Codex, etc.) where a tool can run shell commands. |
| **Migration effort** | High -- would require replacing the Playwright-based tool with child_process.exec() calls wrapping CLI commands. |
| **Possible hybrid approach** | Could use agent-browser alongside the current approach for specific features (e.g., accessibility tree snapshots) via `--cdp` connection to the same browser. |

### Links to Key Resources

- **GitHub Repository**: https://github.com/vercel-labs/agent-browser
- **Homepage / Docs**: https://agent-browser.dev
- **npm Package**: https://www.npmjs.com/package/agent-browser
- **Security Docs**: https://agent-browser.dev/security
- **JSON Schema**: https://agent-browser.dev/schema.json
- **Authentication Docs**: Referenced as `docs/src/app/sessions/page.mdx` in repo

### Related Project Files

| File Path | Relevance |
|---|---|
| `src/agent/tools/browser.ts` | Current browser automation tool using Playwright CDP |
| `src/agent/tools/browser-launch.ts` | Browser discovery and CDP launch logic |
| `src/shared/types.ts` | `BrowserConfig` interface (chromePath, cdpPort) |
| `src/shared/constants.ts` | Trust policy for `browser_action` tool |
| `src/config/config-store.ts` | Browser config read/write |

## Caveats / Not Found

- The `packages/sdk` directory returned 404 -- appears agent-browser no longer ships a programmatic SDK
- The `Cargo.toml` returned 404 -- the Rust source may be in a different path (`cli/Cargo.toml` based on package.json build scripts)
- No performance benchmarks were found comparing CLI invocation overhead vs in-process Playwright
- The streaming WebSocket protocol was documented but not tested
- Cloud browser provider features were documented but not evaluated (not relevant to local Electron use)
