# PRD: Chat Sidebar Slide-In from Right

## Goal
Transform the ChatWindow from a floating popup positioned near the pet into a full-height sidebar that slides in from the right edge of the screen.

## Design Decisions (grilled & confirmed)

| Decision | Choice |
|----------|--------|
| Height | Full screen work area height |
| Width | 400px (unchanged) |
| Title bar | Frameless (no native title bar) |
| Close behavior | Hide (not destroy) — window persists in memory |
| Animation | CSS `transform: translateX` on renderer layer |
| Animation timing | 250ms ease-out |
| Close button | X button on right side of custom header |
| QuickInput | Keep both entry points (left-click → QuickInput, right-click → sidebar) |
| Confirmation auto-popup | Auto slide-out on confirmation-request |
| Taskbar | `skipTaskbar: true` |
| Z-order | Normal (not always-on-top) |
| Left border | 1px solid divider line |

## Scope (4 files, no new files)

### 1. `src/shared/constants.ts`
- Remove `CHAT_WINDOW_HEIGHT` (height now derived from `screen.workArea`)

### 2. `src/main/windows.ts` — `createChatWindow()`
- Add `frame: false` to BrowserWindow options
- Add `skipTaskbar: true`
- Position: right edge of primary display, full work area height
- Replace `show()` logic: initial state hidden, IPC triggers slide-in via renderer
- Change close behavior: intercept `'close'` event → send IPC to renderer for slide-out animation → `hide()` after animation completes
- Add `focus`/`blur` handling if needed
- Expose `showChatWindow()` / `hideChatWindow()` helpers

### 3. `src/main/main.ts`
- Remove `computeChatPosition()` — no longer needed
- Update `IPC_OPEN_CHAT` handler: call `showChatWindow()` + send IPC to trigger slide-in
- Update confirmation-request handler: same pattern
- Add IPC handlers for slide-out complete (`chat:slide-out-complete`) → `hide()` window

### 4. `src/renderer/chat/ChatPanel.tsx`
- Add CSS transition: `transform: translateX(100%)` → `translateX(0)` with 250ms ease-out
- Add `slide-in` / `slide-out` class toggling driven by IPC from main process
- Add close (X) button to header right side
- Add `border-left: 1px solid #444` to container
- Make header draggable with `-webkit-app-region: drag`
- On close button click: send IPC to main → main sends back slide-out trigger → animate → send complete → hide
- Add `@keyframes` or transition-based slide animation

## IPC Changes

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `chat:slide-in` | main → renderer | Trigger slide-in animation |
| `chat:slide-out` | main → renderer | Trigger slide-out animation |
| `chat:slide-out-complete` | renderer → main | Animation done, safe to hide |

## Non-Goals
- Resizing the sidebar width (future enhancement)
- Keyboard shortcut to toggle sidebar (future enhancement)
- Always-on-top toggle (future enhancement)
- Any changes to QuickInput window
