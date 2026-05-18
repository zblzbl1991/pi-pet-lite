# Directory Structure

> How frontend (renderer) code is organized in this Electron project.

---

## Overview

Each Electron BrowserWindow has its own self-contained renderer with its own HTML entry, React bootstrap, and components. There is no routing — each window is a standalone React app.

---

## Directory Layout

```
src/renderer/
├── index.html                  # Pet window HTML entry
├── index.tsx                   # Pet window React entry
├── env.d.ts                    # Vite client types
├── electron-types.d.ts         # Global Window type declarations
├── pet/
│   ├── PetWindow.tsx           # Main pet overlay component
│   ├── PetAnimator.tsx         # GIF display by agent state
│   └── ChatBubble.tsx          # Mini speech bubble
├── chat/
│   ├── index.html              # Chat window HTML entry
│   ├── index.tsx               # Chat window React entry
│   └── ChatPanel.tsx           # Full chat sidebar
├── settings/
│   ├── index.html              # Settings HTML entry
│   ├── index.tsx               # Settings React entry
│   └── SettingsWindow.tsx      # Settings with sidebar nav
└── quick-input/
    ├── index.html              # Quick input HTML entry
    ├── index.tsx               # Quick input React entry
    └── QuickInput.tsx           # Single text input bubble
```

---

## Per-Window Pattern

Each window follows the same structure:

1. **`<feature>/index.html`** — HTML entry with `<div id="root">` and `<script type="module" src="./index.tsx">`
2. **`<feature>/index.tsx`** — React bootstrap (`createRoot(document.getElementById('root')!).render(...)`)
3. **`<feature>/<Component>.tsx`** — Main component file (may contain sub-components)

Shared styles and types are NOT shared across windows — each window is independent.

---

## Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Component files | PascalCase | `PetWindow.tsx`, `ChatPanel.tsx` |
| Entry files | `index.tsx`, `index.html` | One per window |
| Style objects | camelCase | `containerStyle`, `headerStyle` |
| Functions | camelCase | `handleSubmit()`, `handleDrag()` |

---

## Adding a New Window

1. Create `<feature>/` directory under `src/renderer/`
2. Add `index.html`, `index.tsx`, and component file(s)
3. Add preload in `src/preload/<feature>-preload.ts`
4. Add BrowserWindow factory in `src/main/windows.ts`
5. Add Vite entry in `vite.renderer.config.ts` rollupOptions.input
6. Add types to `src/shared/types.ts` and `src/renderer/electron-types.d.ts`
