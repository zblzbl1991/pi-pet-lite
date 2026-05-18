# Logging Guidelines

> How logging is done in this project.

---

## Overview

No logging library is used. The project uses raw `console.error()`, `console.warn()`, and `console.log()`.

---

## Log Levels

| Level | When to use | Example |
|---|---|---|
| `console.error()` | Failures that affect functionality | Agent runtime crash, browser process error, scheduled task failure |
| `console.warn()` | Unexpected but recoverable situations | Unknown message type, deprecated API usage |
| `console.log()` | Dev-only informational output | Build progress in `scripts/dev.js` |

---

## Patterns

```typescript
// Error with context
console.error('Failed to initialize agent runtime:', errorMessage);

// Warning for unexpected input
console.warn('Unknown message type from renderer:', msgType);

// Error in catch block
console.error(`Browser process error: ${err.message}`);
```

---

## What NOT to Log

- API keys or tokens
- User chat content (privacy)
- File system paths containing username on Windows (`C:\Users\...`)

---

## Future Consideration

If structured logging is added later, wrap console calls in a logger module. Current pattern is intentionally simple for a single-developer desktop app.
