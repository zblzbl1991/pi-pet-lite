# Research: Electron Desktop Pet

- **Query**: How to build a desktop pet (always-on-top draggable animated character) using Electron
- **Scope**: Mixed (external docs + open-source project analysis)
- **Date**: 2026-05-14

## Findings

### 1. Frameless, Transparent, Always-On-Top BrowserWindow

The core of a desktop pet is a special BrowserWindow configuration. Two approaches exist, each used by real projects.

#### Approach A: Full-Screen Transparent Overlay (Desktop-Virtual-buddy)

The window covers the entire work area and is click-through by default. The pet is rendered at a specific (x,y) within the canvas. This is the approach used by the `spyderweb47/Desktop-Virtual-buddy` project.

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/window.ts
const primaryDisplay = screen.getPrimaryDisplay();
const workArea = primaryDisplay.workArea;

const win = new BrowserWindow({
  width: workArea.width,
  height: workArea.height,
  x: workArea.x,
  y: workArea.y,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  focusable: false,   // Critical: prevents stealing focus from other apps
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
});

// Make entire window click-through by default
win.setIgnoreMouseEvents(true, { forward: true });
// Use 'floating' level so it stays above normal windows but below dock/taskbar
win.setAlwaysOnTop(true, 'floating');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

**Key BrowserWindow options for desktop pets:**

| Option | Value | Purpose |
|--------|-------|---------|
| `transparent` | `true` | Enables background transparency (alpha channel) |
| `frame` | `false` | Removes window titlebar/border chrome |
| `alwaysOnTop` | `true` | Stays above all normal windows |
| `skipTaskbar` | `true` | Hides from taskbar (use tray instead) |
| `resizable` | `false` | Prevents user resize |
| `hasShadow` | `false` | Removes OS window shadow |
| `focusable` | `false` | Prevents stealing focus from other apps |
| `thickFrame` | `false` | (Windows) Removes WS_THICKFRAME, no shadow/animation |

**Critical: `app.disableHardwareAcceleration()`** must be called before creating the window on Windows, as some GPU drivers cause rendering artifacts in transparent windows. Both projects use this.

```typescript
// Must be called before any window is created
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
```

#### Approach B: Small Window Matching Pet Size (electron-desktop-pet)

The window is exactly the size of the pet character (e.g., 64x64). The window itself is moved around the screen.

```typescript
// From: samejima-ai/electron-desktop-pet/electron/main.ts
mainWindow = new BrowserWindow({
  width: 64,
  height: 64,
  useContentSize: true,
  transparent: true,
  frame: false,
  resizable: false,
  alwaysOnTop: true,
  hasShadow: false,
  skipTaskbar: false,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
  },
});
```

**Trade-offs between approaches:**

| Aspect | Full-Screen Overlay | Small Window |
|--------|--------------------|--------------| `setIgnoreMouseEvents` complexity | Simpler (always on) | Not needed |
| Multi-monitor support | Need per-display windows | Window moves freely |
| Chat bubble / overlay | Easy (same canvas) | Need separate window or resize |
| Performance | Renders full-screen canvas | Minimal rendering area |
| Window dragging | Must be implemented in JS | Can use `-webkit-app-region: drag` or JS |

### 2. Rendering Animated Sprites with Transparency

#### Sprite Sheet Approach (preferred)

Both projects use sprite sheets rendered via CSS or Canvas rather than animated GIFs.

**CSS Background-based (electron-desktop-pet):**

```tsx
// From: samejima-ai/electron-desktop-pet/src/components/CharacterSprite.tsx
// Uses a PNG sprite sheet with rows=directions, cols=animation frames
const style: React.CSSProperties = {
  backgroundImage: `url(${spriteImage})`,
  backgroundSize: `${originalSpriteSize * 3 * scale}px ${originalSpriteSize * 4 * scale}px`,
  backgroundPosition: `${bgX}px ${bgY}px`,  // bgX = -(animStep * SPRITE_SIZE)
  width: `${SPRITE_SIZE}px`,
  height: `${SPRITE_SIZE}px`,
  imageRendering: "pixelated",  // Crisp pixel art scaling
};
```

**Canvas-based (Desktop-Virtual-buddy):**

The renderer uses an HTML `<canvas>` element for rendering. The `index.html` shows:

```html
<canvas id="pet-canvas"></canvas>
```

Canvas allows frame-by-frame drawing, animation state machines, and compositing with transparency.

**GIF support:** Electron supports animated GIFs natively through Chromium's `<img>` tag. The `webPreferences.imageAnimationPolicy` option controls behavior:

| Value | Behavior |
|-------|----------|
| `"animate"` | (Default) Loops animated images |
| `"animateOnce"` | Plays once then stops |
| `"noAnimation"` | Shows first frame only |

For a desktop pet, sprite sheets are strongly preferred over GIFs because:
- Frame timing control (variable FPS per animation state)
- No GIF transparency artifacts (binary alpha vs smooth alpha)
- Smaller file sizes for equivalent content
- Easier to implement state machines (idle/walk/sit/react)

### 3. Click-Through vs Interactive Regions

This is the most technically challenging part. The pattern used by Desktop-Virtual-buddy:

**Main process (window.ts):**

```typescript
// Window starts fully click-through
win.setIgnoreMouseEvents(true, { forward: true });
```

**Renderer process detects pixel alpha to toggle interactivity:**

The `{ forward: true }` option is critical. When `setIgnoreMouseEvents(true, { forward: true })` is set, mouse events pass through to windows below, BUT Chromium still receives `mousemove` and `mouseleave` events. This allows the renderer to detect when the cursor is over the pet's non-transparent pixels.

**IPC-based toggle pattern (preload.ts):**

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore),
});
```

**The standard algorithm for per-pixel hit testing:**

In the renderer, listen for `mousemove` events (which still fire due to `{ forward: true }`), check the pixel alpha at the cursor position on the canvas, and toggle `setIgnoreMouseEvents` accordingly:

```javascript
// Pseudocode for the renderer hit-test pattern:
canvas.addEventListener('mousemove', (e) => {
  const pixel = ctx.getImageData(e.offsetX, e.offsetY, 1, 1).data;
  const isOverPet = pixel[3] > 0; // Alpha > 0 means cursor is on the pet
  window.electronAPI.setIgnoreMouseEvents(!isOverPet);
});
```

**Alternative: Manual JS drag (electron-desktop-pet):**

For the small-window approach, dragging is handled entirely in the renderer:

```typescript
// From: samejima-ai/electron-desktop-pet/src/App.tsx
const handleMouseDown = (e: React.MouseEvent) => {
  if (e.ctrlKey) {  // Only drag with Ctrl held
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.screenX, y: e.screenY };
    const currentPos = getPosition();
    winStartRef.current = { x: currentPos.x, y: currentPos.y };
    e.preventDefault();
  }
};
// Then mousemove calculates delta and calls:
// window.electronAPI.moveWindow(newX, newY)
```

The main process clamps position to screen boundaries:

```typescript
// From: samejima-ai/electron-desktop-pet/electron/main.ts
ipcMain.on("update-position", (event, { x, y }) => {
  const display = screen.getDisplayNearestPoint({ x: currentX, y: currentY });
  const { x: workX, y: workY, width: workW, height: workH } = display.workArea;
  const clampedX = Math.max(workX, Math.min(newX, workX + workW - winW));
  const clampedY = Math.max(workY, Math.min(newY, workY + workH - winH));
  mainWindow.setPosition(clampedX, clampedY);
});
```

### 4. System Tray Integration

Both projects use Electron's `Tray` API. The Desktop-Virtual-buddy implementation is comprehensive:

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/tray.ts
import { Tray, Menu, app, nativeImage } from 'electron';

let tray: Tray | null = null;

export function createTray(onOpenDashboard: () => void): Tray {
  // Create icon programmatically (16x16 RGBA buffer)
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const offset = i * 4;
    buffer[offset] = 100;     // R
    buffer[offset + 1] = 200; // G
    buffer[offset + 2] = 100; // B
    buffer[offset + 3] = 255; // A
  }
  const trayIcon = nativeImage.createFromBuffer(buffer, { width: size, height: size });

  tray = new Tray(trayIcon);
  tray.setToolTip('Buddy');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Buddy v0.1', enabled: false },
    { type: 'separator' },
    { label: 'Dashboard', click: () => { onOpenDashboard(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}
```

**Keep app alive when all windows close:**

```typescript
// Desktop-Virtual-buddy approach (app stays in tray):
app.on('window-all-closed', () => {
  // no-op: app stays alive via tray
});

// electron-desktop-pet approach (macOS standard):
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

**Key Tray events available:**

| Event | Platforms | Use |
|-------|-----------|-----|
| `click` | All | Show/hide pet on left-click |
| `right-click` | macOS, Windows | Context menu |
| `double-click` | macOS, Windows | Open dashboard |
| `mouse-move` | macOS | Tooltip updates |

### 5. Chat Bubble / Input Popup Near the Pet

The Desktop-Virtual-buddy project implements this with a speech bubble overlay in the renderer HTML:

```html
<!-- From: spyderweb47/Desktop-Virtual-buddy/src/renderer/index.html -->
<div id="bubble"></div>
```

```css
#bubble {
  position: absolute;
  font-family: 'Inter', sans-serif;
  background: rgba(26, 28, 31, 0.95);
  color: #F0F1F2;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 10px 16px;
  font-size: 13px;
  max-width: 280px;
  pointer-events: none;  /* Does not interfere with click-through */
  opacity: 0;
  transform: translate(-50%, 0) scale(0.9);
  transition: opacity 0.25s ease, transform 0.25s ease;
  white-space: pre-wrap;
}
#bubble.visible {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
#bubble::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 12px; height: 12px;
  background: rgba(26, 28, 31, 0.95);
  /* Triangle pointer pointing down to pet */
}
```

The AI brain sends speech commands via IPC:

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/pet-ipc-relay.ts
case 'say':
  if (decision.text) {
    wc.send('buddy:say', decision.text, decision.durationMs || 5000);
  }
  break;
```

**For interactive input (not just display), the project uses a separate Dashboard window:**

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/dashboard-window.ts
dashboardWin = new BrowserWindow({
  width: 1000,
  height: 680,
  minWidth: 720,
  minHeight: 520,
  title: 'Buddy Dashboard',
  backgroundColor: '#0A0B0C',
  autoHideMenuBar: true,
  center: true,
  alwaysOnTop: false,  // Normal window behavior
  webPreferences: {
    preload: path.join(__dirname, 'dashboard-preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
});
```

This is the recommended pattern: the pet overlay is display-only (speech bubbles), while interactive controls (settings, chat input) live in a separate normal BrowserWindow accessed from the tray.

### 6. Keeping Electron Lightweight When Idle

**From Electron's own performance docs (electronjs.org/docs/latest/tutorial/performance):**

1. **Use `requestIdleCallback()`** for low-priority/background work instead of timers
2. **Use Web Workers** for long-running computations (animation math, AI inference)
3. **Bundle code** -- avoid loading unnecessary modules at runtime
4. **Disable unused features** in `webPreferences`

**Specific techniques for desktop pets:**

```typescript
// Disable what you don't need
const win = new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,        // Security + lighter
    contextIsolation: true,        // Security
    sandbox: true,                 // Lighter process
    webgl: false,                  // If not using WebGL
    plugins: false,                // No plugins needed
    webSecurity: true,             // Keep security
    images: true,                  // Needed for sprites
    imageAnimationPolicy: 'noAnimation',  // Control frames manually
  },
});
```

**`app.disableHardwareAcceleration()`** -- Both projects use this, which sounds counterintuitive but is necessary for transparent windows on some Windows GPU drivers. The trade-off is higher CPU usage for rendering.

**Window-probe optimization (Desktop-Virtual-buddy):**

The window-probe (detecting other app windows for the pet to walk on) uses PowerShell with a 2-second timeout and 800ms polling interval. The script is cached to a temp file to avoid re-generating it each time:

```typescript
// From: spyderweb47/Desktop-Virtual-buddy/src/main/window-probe.ts
export function startWindowProbe(
  intervalMs: number,  // 800ms in production
  callback: (rects: WindowRect[]) => void
): void {
  const tick = async () => {
    const rects = await probeWindowsOnce();
    callback(rects);
  };
  tick();
  pollTimer = setInterval(tick, intervalMs);
}
```

**Additional idle optimizations:**
- Use `requestAnimationFrame` for animations (auto-pauses when not visible)
- Throttle IPC messages (50ms debounce in electron-desktop-pet for position sync)
- Use `setTimeout` instead of `setInterval` for non-critical background tasks
- Minimize the number of BrowserWindows (ideally 1-2 total)
- Canvas-based rendering is more efficient than DOM for sprite animation
- Use `will-change: transform, opacity` CSS property for animated elements

### 7. Comparison of Existing Projects

| Project | Stars | Tech | Window Approach | Animation | AI |
|---------|-------|------|-----------------|-----------|-----|
| `spyderweb47/Desktop-Virtual-buddy` | 1 | Electron + TS (zero deps) | Full-screen overlay, click-through | Canvas, Shimeji behaviors | Yes (LLM brain) |
| `samejima-ai/electron-desktop-pet` | 0 | Electron + React + Vite | Small 64x64 window, JS drag | CSS sprite sheet | No (flee behavior) |
| `AlleyBo55/doraemon` | 36 | Electron | Unknown | Unknown | Unknown |
| `playerdecuple/Deskot` | 3 | Electron + TS | Shimeji-ee clone | Unknown | No |
| Desktop Goose (original) | N/A | C# (.NET) | Not Electron | Custom | No |

### 8. Recommended Architecture for pi-agent-tool

Based on the research, the full-screen overlay approach (Desktop-Virtual-buddy style) is better for a desktop pet that needs:

- Chat bubble overlays near the pet
- Shimeji-style behaviors (walking, sitting, interacting with windows)
- Click-through background with interactive pet region
- System tray with dashboard access

The small-window approach (electron-desktop-pet style) is simpler but limits overlay features.

**Minimal dependencies (Desktop-Virtual-buddy proves zero runtime deps is possible):**

```json
{
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^26.8.1",
    "typescript": "^5.8.0",
    "@types/node": "^22.0.0"
  },
  "dependencies": {}
}
```

### Files Found

| File Path | Description |
|---|---|
| `src/index.ts` | Current project entry (placeholder) |
| `package.json` | Project config (fresh, no Electron yet) |
| `tsconfig.json` | TypeScript config |

### External References

- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window) -- Main window creation and configuration
- [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray) -- System tray integration
- [Electron Performance Guide](https://www.electronjs.org/docs/latest/tutorial/performance) -- Idle optimization strategies
- [spyderweb47/Desktop-Virtual-buddy](https://github.com/spyderweb47/Desktop-Virtual-buddy) -- Best reference implementation; AI-powered desktop pet with Electron + TS, zero runtime deps
- [samejima-ai/electron-desktop-pet](https://github.com/samejima-ai/electron-desktop-pet) -- React + Vite + Electron; small-window approach with sprite animation
- [Electron Frameless Window Docs](https://www.electronjs.org/docs/latest/api/structures/base-window-options) -- `frame`, `transparent`, `thickFrame` options

### Related Specs

- `.trellis/spec/frontend/index.md` -- Frontend guidelines (empty template)
- `.trellis/spec/frontend/component-guidelines.md` -- Component patterns (empty template)

## Caveats / Not Found

- GitHub API rate limit prevented full analysis of the `AlleyBo55/doraemon` (36 stars) and `playerdecuple/Deskot` source code. These repos may contain additional patterns worth examining.
- The `app.disableHardwareAcceleration()` call is necessary for transparent windows on Windows but increases CPU usage. There may be per-GPU-driver workarounds but none were found in the reference projects.
- Linux support for transparent always-on-top windows varies by compositor (X11 vs Wayland). The Desktop-Virtual-buddy project appears Windows-focused based on its window-probe implementation using PowerShell.
- macOS has additional requirements for `setVisibleOnAllWorkspaces` and may need special handling for full-screen spaces.
- The `setIgnoreMouseEvents(true, { forward: true })` pattern has a known quirk: when `focusable: false` is also set, some keyboard-related events may not work as expected.
