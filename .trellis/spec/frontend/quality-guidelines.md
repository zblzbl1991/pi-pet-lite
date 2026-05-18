# Quality Guidelines

> Code quality standards for frontend (renderer) development.

---

## Overview

No linter, formatter, test framework, or CI/CD configured. Quality is enforced through TypeScript strict mode and consistent code patterns.

---

## Required Patterns

- **Functional components only** — `React.FC<Props>` type, named exports
- **Inline styles only** — no CSS files, no Tailwind, no CSS modules
- **Dark theme colors** — use the established palette (see component-guidelines.md)
- **IPC via preload bridge** — all renderer ↔ main communication through `window.electronAPI` / `window.settingsAPI`
- **`useEffect` cleanup** — always clean up IPC listeners on unmount
- **TypeScript strict** — all tsconfigs use `strict: true`

---

## Forbidden Patterns

- `any` type — use `unknown` and narrow
- CSS files / Tailwind / CSS modules — inline styles only
- `dangerouslySetInnerHTML` — never needed for this app
- `nodeIntegration: true` — all windows use `contextIsolation: true`, `sandbox: true`
- Default exports — always named exports
- Class components — functional only

---

## Build Verification

```bash
npm run typecheck   # tsc --noEmit for both node and renderer configs
npm run build       # Full build (tsc + vite)
```

Both must pass with zero errors.

---

## Renderer Build

- **Vite** with multi-page config: 4 HTML entries
- **`@shared`** alias maps to `src/shared/`
- Base path is `'./'` for `file://` protocol compatibility
- Output goes to `dist/renderer/`, does NOT clear tsc output (`emptyOutDir: false`)

---

## Adding New UI

1. Create component file in the appropriate `src/renderer/<window>/` directory
2. Import types from `@shared/types` (alias for `src/shared/`)
3. Use inline styles matching the existing dark theme palette
4. Add IPC calls through the window's preload API (never direct Electron imports)
