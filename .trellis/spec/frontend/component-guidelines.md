# Component Guidelines

> How components are built in this project.

---

## Overview

All components are functional React components using named exports. No class components, no default exports. Styling uses inline `style` objects that reference **CSS custom property tokens** (`var(--*)`) defined in `src/renderer/styles/tokens.css`. The design system source of truth is `.impeccable.md`.

---

## Component Structure

```typescript
// 1. Imports
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { someType } from '@shared/types';

// 2. Props interface (same file, above component)
interface MyComponentProps {
  required: string;
  optional?: number;
}

// 3. Named export with React.FC
export const MyComponent: React.FC<MyComponentProps> = ({ required, optional = 42 }) => {
  // hooks
  // handlers
  // return JSX
};
```

---

## Props Conventions

- Interfaces defined above the component in the same file
- Destructured in the function signature
- Optional props use `?` with default values in destructuring

```typescript
interface PetAnimatorProps {
  state: AgentState;
  size?: number;
}
export const PetAnimator: React.FC<PetAnimatorProps> = ({ state, size = 128 }) => { ... };
```

---

## Sub-Components

Private helper components defined in the same file, **not exported**:

```typescript
// File-private helper
function StatusBlock({ status, message }: { status: string; message: string }) {
  return <div>...</div>;
}
```

---

## Styling Patterns

**Pattern 1**: Top-level constant style objects with token references
```typescript
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: 'var(--bg-page)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
};
```

**Pattern 2**: Style factory functions for dynamic styles
```typescript
const bubbleStyle = (role: string): React.CSSProperties => ({
  maxWidth: '85%',
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-lg)',
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
  background: role === MessageRole.USER ? 'var(--color-brand)' : 'var(--bg-card)',
});
```

**Pattern 3**: Inline in JSX for one-off dynamic values
```typescript
style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
```

**CSS animations**: Keyframe animations defined in `src/renderer/styles/reset.css` and referenced via `animation` property.

---

## Design Tokens

All design values (colors, spacing, radii, typography, motion, glass effects) are defined as CSS custom properties in `src/renderer/styles/tokens.css`. Reference them via `var(--token-name)` in inline styles.

**Source of truth**: `.impeccable.md`

### Token Categories

| Category | Examples | Prefix |
|----------|----------|--------|
| Background colors | `var(--bg-page)`, `var(--bg-card)`, `var(--bg-elevated)` | `--bg-*` |
| Text colors | `var(--text-primary)`, `var(--text-secondary)`, `var(--text-tertiary)` | `--text-*` |
| Brand & semantic | `var(--color-brand)`, `var(--color-success)`, `var(--color-warning)`, `var(--color-danger)` | `--color-*` |
| Role colors | `var(--role-chief)`, `var(--role-coder)`, `var(--role-scout)`, `var(--role-analyst)` | `--role-*` |
| Spacing (4px grid) | `var(--space-1)`(4px) through `var(--space-12)`(48px) | `--space-*` |
| Border radius | `var(--radius-sm)`, `var(--radius-md)`, `var(--radius-lg)`, `var(--radius-pill)` | `--radius-*` |
| Typography | `var(--font-body)`, `var(--font-mono)`, `var(--text-sm)`, `var(--font-semibold)` | `--font-*`, `--text-*` |
| Motion | `var(--duration-fast)`, `var(--duration-normal)`, `var(--ease-out)` | `--duration-*`, `--ease-*` |
| Glass effects | `var(--glass-blur)`, `var(--glass-bg)`, `var(--glass-border)` | `--glass-*` |
| Borders | `var(--border)`, `var(--border-subtle)` | `--border*` |

### Main Process Colors

For main process code (BrowserWindow configs, tray), use named constants from `src/shared/theme-constants.ts`:
```typescript
import { THEME_PAGE_BG, THEME_TRAY_ICON } from '../shared/theme-constants';
```

---

## Common Mistakes

- Don't hardcode hex/rgba colors or pixel spacing — use `var(--*)` tokens from `tokens.css`
- Don't add CSS files beyond `tokens.css` and `reset.css` — no Tailwind, no CSS modules
- Don't use default exports — always named exports
- Don't create shared component libraries across windows — each window is independent
- Don't use class components
- Don't use pure black (`#000`) — use slate-tinted darks from the design system
