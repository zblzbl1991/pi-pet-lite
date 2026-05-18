# Component Guidelines

> How components are built in this project.

---

## Overview

All components are functional React components using named exports. No class components, no default exports. Styling is done entirely with inline `style` objects — no CSS files, Tailwind, or CSS modules.

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

**Pattern 1**: Top-level constant style objects
```typescript
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: '#1e1f22',
};
```

**Pattern 2**: Style factory functions for dynamic styles
```typescript
const bubbleStyle = (role: string): React.CSSProperties => ({
  maxWidth: '85%',
  padding: '8px 12px',
  borderRadius: 12,
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
});
```

**Pattern 3**: Inline in JSX for one-off dynamic values
```typescript
style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
```

**CSS animations**: Injected via `<style>` tags in JSX.

---

## Color Palette

```typescript
const colors = {
  bgDarkest: '#1a1c1f',
  bgDark: '#1e1f22',
  bgMid: '#25262a',
  bgLight: '#2a2c30',
  textPrimary: '#F0F1F2',
  textSecondary: 'rgba(200, 200, 210, 0.8)',
  green: '#50b478',
  greenLight: '#5cb85c',
  warning: '#f0ad4e',
  error: '#d9534f',
  border: 'rgba(255, 255, 255, 0.08)',
  font: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
};
```

---

## Common Mistakes

- Don't add CSS files or Tailwind — this project uses inline styles exclusively
- Don't use default exports — always named exports
- Don't create shared component libraries across windows — each window is independent
- Don't use class components
