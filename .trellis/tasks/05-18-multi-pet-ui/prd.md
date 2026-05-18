# Multi-Pet UI

## Goal

Display multiple pet windows on the desktop, each with its own appearance, animation state, and status. Only the Chief pet accepts direct user interaction; other pets are visible but not directly interactive.

## What I already know

* Grill decisions: see all pets, interact with Chief only; single WebSocket + petId routing; sub-pets show busy/idle/error animations
* Current: single PetWindow (160x160), one agent event stream
* M4 provides PetManager with per-pet status
* M5 provides delegation events with petId
* Reference: OpenAkita's Tauri app renders multiple agent states in sidebar
* Electron BrowserWindow per pet is the natural model (matches current PetWindow pattern)

## Requirements

1. **Multiple PetWindows**: Each active pet has its own BrowserWindow on the desktop
2. **Differentiated appearance**: Each pet profile has a distinct icon/color/animation set
3. **Status animations**: Pets animate based on their status (idle/busy/thinking/success/error)
4. **Chief is interactive**: Clicking Chief opens the chat sidebar; clicking other pets shows a tooltip with their current task
5. **Layout management**: Pets are positioned on screen without overlapping (smart placement)
6. **Pet spawning/despawning**: PetWindows created when agents activate (M4 on-demand), closed when agents are disposed (idle reaper)
7. **Event routing**: Single event stream from main process, each event tagged with petId, routed to correct PetWindow
8. **Chat window shows all activity**: Chat sidebar shows Chief's messages + delegation status + sub-pet results (all in one stream)

## Acceptance Criteria

* [ ] Multiple PetWindows visible on desktop simultaneously
* [ ] Each pet has distinct visual appearance
* [ ] Pet animations reflect real-time agent status
* [ ] Chief is clickable (opens chat), other pets show tooltip on click
* [ ] Pets don't overlap (smart placement algorithm)
* [ ] PetWindows created/destroyed as agents activate/dispose
* [ ] Chat sidebar shows combined activity from all pets

## Definition of Done

* Visual test: 2+ pets visible with correct animations
* Typecheck passes
* No memory leaks when pets spawn/despawn repeatedly

## Out of Scope

* Drag-to-reposition sub-pets (Chief only)
* Per-pet chat windows (all through Chief)
* Pet customization UI (future)
* Sound effects per pet (future)
* Mobile layout (desktop only)

## Technical Approach

### Window management

```typescript
class PetWindowManager {
  private windows: Map<string, BrowserWindow>;  // petId -> window

  spawnPet(profile: PetProfile): BrowserWindow;
  despawnPet(petId: string): void;
  updatePetStatus(petId: string, status: PetStatus): void;
  layoutPets(): void;  // reposition all pets to avoid overlap
}
```

### Smart placement

Position pets in a row along the bottom of the screen:
- Chief at center (default position)
- Sub-pets spread left and right with spacing
- If screen is too narrow, stack in 2 rows

### Event routing

Main process holds a single event stream. Each event has `petId`. `PetWindowManager` routes events to the correct BrowserWindow via IPC.

### Pet visual differentiation

| Pet | Color Theme | Idle GIF | Busy GIF |
|-----|-------------|----------|----------|
| Chief | Orange | clawd-idle.gif | clawd-running.gif |
| Coder | Blue | coder-idle.gif | coder-coding.gif |
| Scout | Green | scout-idle.gif | scout-browsing.gif |
| Analyst | Purple | analyst-idle.gif | analyst-analyzing.gif |

For MVP: reuse existing clawd GIFs with colored border/overlay to differentiate. Custom GIFs later.

### New files

* `src/main/pet-window-manager.ts` — multi-window lifecycle
* Update `src/main/windows.ts` — integrate PetWindowManager
* Update `src/preload/pet-preload.ts` — add petId-aware event handling
* New pet renderer components for differentiated appearance

## Technical Notes

* `windows.ts` currently creates a single PetWindow — will be refactored to use PetWindowManager
* Each BrowserWindow loads the same pet HTML but with different config (petId, theme)
* IPC channel per pet: `agent-message-{petId}` or single channel with petId field
