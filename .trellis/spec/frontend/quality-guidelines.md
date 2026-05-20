# Quality Guidelines

> Code quality standards for frontend (renderer) development.

---

## Overview

No linter, formatter, test framework, or CI/CD configured. Quality is enforced through TypeScript strict mode and consistent code patterns.

---

## Required Patterns

- **Functional components only** — `React.FC<Props>` type, named exports
- **CSS variable tokens for design values** — all colors, spacing, radii, typography, motion use `var(--*)` tokens defined in `src/renderer/styles/tokens.css`. No hardcoded hex/rgba/pixel values for design system properties.
- **Inline React styles referencing tokens** — component styles remain inline `React.CSSProperties` objects, but values reference CSS custom properties via `var(--token-name)`
- **Global styles via CSS files** — `tokens.css` (custom properties) and `reset.css` (global reset) are the only CSS files; imported in each entry TSX
- **Dark theme (Slate-tinted)** — base palette is `#0f172a` (slate-900), never pure black. Full design system in `.impeccable.md`.
- **IPC via preload bridge** — all renderer ↔ main communication through `window.electronAPI` / `window.settingsAPI`
- **`useEffect` cleanup** — always clean up IPC listeners on unmount
- **TypeScript strict** — all tsconfigs use `strict: true`

---

## Forbidden Patterns

- `any` type — use `unknown` and narrow
- Hardcoded design values in components — use `var(--*)` tokens (colors, spacing, radii, fonts, motion)
- Additional CSS files beyond `tokens.css` and `reset.css` — no Tailwind, no CSS modules
- `dangerouslySetInnerHTML` — never needed for this app
- `nodeIntegration: true` — all windows use `contextIsolation: true`, `sandbox: true`
- Default exports — always named exports
- Class components — functional only
- Pure black (`#000`) — use slate-tinted darks from the design system

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
3. Use `var(--*)` tokens for all design values — consult `src/renderer/styles/tokens.css` for available tokens and `.impeccable.md` for the design system
4. Use inline `React.CSSProperties` objects referencing CSS custom properties
5. Add IPC calls through the window's preload API (never direct Electron imports)
6. For icons, use `lucide-react` with `size={16-20}` and `strokeWidth={1.5}`
