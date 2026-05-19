# Clawd — Desktop AI Pet Agent

## Design Context

> Full design system: `.impeccable.md`

**Brand personality:** Precise. Warm. Forward.

**Theme:** Dark-only. Slate-tinted darks (`#0f172a` base), never pure black.

**Brand color:** `#2563eb` (general UI) + role colors (Chief=orange, Coder=blue, Scout=green, Analyst=purple).

**Font:** `"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`. Mono: `Cascadia Code, Consolas, monospace`.

**Icons:** Lucide React (stroke style, `stroke-width: 1.5-2`).

**Key rules:**
- All colors/spacing/radii via CSS variables — no hardcoded hex in components
- Glass effect: `backdrop-filter: blur(16px)` on panels and floating elements
- Border radius: surfaces 12px+, interactive 8-14px, pills 999px
- Motion: 150ms for interactions, 250ms max for transitions
- 4px spacing grid
- WCAG AA contrast, reduced-motion support

**Window types:** Pet overlay (160×160 transparent), Chat panel (400px glass sidebar), Settings (680×520 standard), Quick input (320×48 glass).
