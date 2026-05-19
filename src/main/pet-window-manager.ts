/**
 * PetWindowManager — manages multiple pet BrowserWindows on the desktop.
 *
 * Each active pet (Chief, Coder, Scout, Analyst) gets its own transparent,
 * always-on-top BrowserWindow. Windows are positioned using a smart layout
 * algorithm to avoid overlap. Only the Chief pet is interactive (draggable,
 * opens chat); other pets are display-only with tooltips.
 *
 * Lifecycle:
 * - spawnPet(): creates a BrowserWindow for a pet profile
 * - despawnPet(): destroys the BrowserWindow for a petId
 * - layoutPets(): repositions all pet windows to avoid overlap
 * - updatePetStatus(): sends status animation update to a specific pet window
 * - routeEvent(): sends an agent event to the correct pet window by petId
 */

import { BrowserWindow, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { PET_SIZE, IPC_AGENT_MESSAGE, IPC_PET_STATUS_UPDATE } from '../shared/constants';
import type { PetProfile, PetRole } from '../shared/types';

/** Window dimensions for each pet */
const PET_WINDOW_WIDTH = 160;
const PET_WINDOW_HEIGHT = 160;

/** Gap between pet windows in pixels */
const PET_GAP = 12;

/** Color themes per pet role (used for CSS border) */
export const PET_ROLE_COLORS: Record<PetRole, string> = {
  chief: '#e8912d',   // Orange
  coder: '#4a90d9',   // Blue
  scout: '#50b478',   // Green
  analyst: '#9b6dd7', // Purple
  custom: '#888888',  // Gray
};

/** Status-based animation label for the renderer */
export type PetStatusAnimation = 'idle' | 'thinking' | 'executing' | 'success' | 'error';

/** Map from PetStatus to animation label */
export function statusToAnimation(status: string): PetStatusAnimation {
  switch (status) {
    case 'busy':
      return 'executing';
    case 'error':
      return 'error';
    case 'idle':
      return 'idle';
    case 'offline':
      return 'idle';
    default:
      return 'idle';
  }
}

/** Info about a managed pet window */
interface ManagedPetWindow {
  petId: string;
  profile: PetProfile;
  window: BrowserWindow;
  roleColor: string;
}

/**
 * PetWindowManager handles multi-window lifecycle, placement, and event routing.
 */
export class PetWindowManager {
  private windows: Map<string, ManagedPetWindow> = new Map();
  private readonly rendererHtmlPath: string;
  private readonly preloadPath: string;
  private readonly gifsBasePath: string;

  constructor(rendererHtmlPath: string, preloadPath: string, gifsBasePath: string) {
    this.rendererHtmlPath = rendererHtmlPath;
    this.preloadPath = preloadPath;
    this.gifsBasePath = gifsBasePath;
  }

  /**
   * Spawn a BrowserWindow for a pet profile.
   * If a window already exists for this petId, returns the existing window.
   */
  spawnPet(profile: PetProfile): BrowserWindow {
    const existing = this.windows.get(profile.id);
    if (existing && !existing.window.isDestroyed()) {
      return existing.window;
    }

    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.workArea;

    const roleColor = PET_ROLE_COLORS[profile.role] ?? '#888888';
    const isInteractive = profile.role === 'chief';

    const win = new BrowserWindow({
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      x: 0, // Will be repositioned by layoutPets()
      y: 0,
      transparent: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: isInteractive,
      thickFrame: false,
      title: '',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // All pets start as click-through; renderer toggles based on hit-testing
    win.setIgnoreMouseEvents(true, { forward: true });

    // Use 'floating' level so pet stays above normal windows but below taskbar
    win.setAlwaysOnTop(true, 'floating');
    win.setTitle('');
    win.setSkipTaskbar(true);

    // Resolve gifs path: if profile has a gifPrefix, look for a matching subdirectory
    let gifsPath = this.gifsBasePath;
    if (profile.gifPrefix && profile.gifPrefix !== 'clawd') {
      const parentDir = path.dirname(this.gifsBasePath);
      const altPath = path.join(parentDir, 'gifs', `${profile.gifPrefix}-gifs`);
      if (fs.existsSync(altPath)) {
        gifsPath = altPath;
      }
    }

    // Build the URL with query params for the renderer
    const rendererUrl = pathToFileURL(this.rendererHtmlPath);
    rendererUrl.searchParams.set('gifsPath', gifsPath);
    rendererUrl.searchParams.set('petId', profile.id);
    rendererUrl.searchParams.set('petName', profile.name);
    rendererUrl.searchParams.set('petRole', profile.role);
    rendererUrl.searchParams.set('roleColor', roleColor);
    rendererUrl.searchParams.set('interactive', isInteractive ? '1' : '0');
    if (profile.gifPrefix) {
      rendererUrl.searchParams.set('gifPrefix', profile.gifPrefix);
    }

    win.loadURL(rendererUrl.toString());

    // Clean up on close
    win.on('closed', () => {
      this.windows.delete(profile.id);
    });

    const managed: ManagedPetWindow = {
      petId: profile.id,
      profile,
      window: win,
      roleColor,
    };

    this.windows.set(profile.id, managed);

    // Reposition all pets to avoid overlap
    this.layoutPets();

    return win;
  }

  /**
   * Despawn (destroy) a pet's BrowserWindow.
   */
  despawnPet(petId: string): void {
    const managed = this.windows.get(petId);
    if (managed) {
      if (!managed.window.isDestroyed()) {
        managed.window.destroy();
      }
      this.windows.delete(petId);
      // Re-layout remaining pets
      this.layoutPets();
    }
  }

  /**
   * Get the BrowserWindow for a petId. Returns null if not spawned.
   */
  getWindow(petId: string): BrowserWindow | null {
    const managed = this.windows.get(petId);
    if (managed && !managed.window.isDestroyed()) {
      return managed.window;
    }
    return null;
  }

  /**
   * Get the "chief" pet window (convenience accessor).
   */
  getChiefWindow(): BrowserWindow | null {
    return this.getWindow('chief');
  }

  /**
   * Get all managed pet IDs.
   */
  getActivePetIds(): string[] {
    return Array.from(this.windows.keys());
  }

  /**
   * Send an agent message to a specific pet window via IPC.
   */
  routeEvent(petId: string, msg: unknown): void {
    const managed = this.windows.get(petId);
    if (managed && !managed.window.isDestroyed()) {
      managed.window.webContents.send(IPC_AGENT_MESSAGE, msg);
    }
  }

  /**
   * Broadcast a message to ALL pet windows.
   */
  broadcastToAll(msg: unknown): void {
    for (const managed of this.windows.values()) {
      if (!managed.window.isDestroyed()) {
        managed.window.webContents.send(IPC_AGENT_MESSAGE, msg);
      }
    }
  }

  /**
   * Send a pet status update to a specific pet window.
   */
  updatePetStatus(petId: string, status: string): void {
    const managed = this.windows.get(petId);
    if (managed && !managed.window.isDestroyed()) {
      managed.window.webContents.send(IPC_PET_STATUS_UPDATE, {
        petId,
        status,
        animation: statusToAnimation(status),
      });
    }
  }

  /**
   * Reposition all pet windows to avoid overlap.
   *
   * Strategy:
   * - All pets are placed in one horizontal row at the same Y level
   * - Chief is centered; sub-pets spread left and right with spacing
   */
  layoutPets(): void {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.workArea;

    const entries = Array.from(this.windows.values());
    if (entries.length === 0) return;

    // Separate chief from sub-pets
    const chief = entries.find((e) => e.profile.role === 'chief');
    const subPets = entries.filter((e) => e.profile.role !== 'chief');

    const centerX = Math.round(width * 0.45);
    const baseY = Math.round(height * 0.65);
    const petLocalY = PET_WINDOW_HEIGHT - PET_SIZE;

    // Total count for horizontal centering
    const totalCount = 1 + subPets.length;
    const totalWidth = totalCount * PET_WINDOW_WIDTH + (totalCount - 1) * PET_GAP;
    const startX = centerX - Math.round(totalWidth / 2);

    // Position Chief at the center slot of the row
    if (chief && !chief.window.isDestroyed()) {
      const chiefIndex = Math.floor(totalCount / 2);
      const chiefX = startX + chiefIndex * (PET_WINDOW_WIDTH + PET_GAP);
      chief.window.setPosition(
        Math.max(0, Math.min(chiefX, width - PET_WINDOW_WIDTH)),
        Math.round(baseY - petLocalY)
      );
    }

    // Position sub-pets: half left of chief, half right of chief
    if (subPets.length > 0) {
      const halfLeft = Math.floor(subPets.length / 2);
      const halfRight = subPets.length - halfLeft;

      subPets.forEach((entry, i) => {
        if (!entry.window.isDestroyed()) {
          let slotIndex: number;
          if (i < halfLeft) {
            slotIndex = Math.floor(totalCount / 2) - halfLeft + i;
          } else {
            slotIndex = Math.floor(totalCount / 2) + 1 + (i - halfLeft);
          }
          const x = startX + slotIndex * (PET_WINDOW_WIDTH + PET_GAP);
          entry.window.setPosition(
            Math.max(0, Math.min(x, width - PET_WINDOW_WIDTH)),
            Math.round(baseY - petLocalY)
          );
        }
      });
    }
  }

  /**
   * Despawn all pet windows.
   */
  despawnAll(): void {
    for (const [petId, managed] of this.windows) {
      if (!managed.window.isDestroyed()) {
        managed.window.destroy();
      }
    }
    this.windows.clear();
  }

  /**
   * Show all pet windows.
   */
  showAll(): void {
    for (const managed of this.windows.values()) {
      if (!managed.window.isDestroyed()) {
        managed.window.show();
      }
    }
  }

  /**
   * Hide all pet windows.
   */
  hideAll(): void {
    for (const managed of this.windows.values()) {
      if (!managed.window.isDestroyed()) {
        managed.window.hide();
      }
    }
  }

  /**
   * Check if any pet windows exist and are visible.
   */
  isAnyVisible(): boolean {
    for (const managed of this.windows.values()) {
      if (!managed.window.isDestroyed() && managed.window.isVisible()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Toggle visibility of all pet windows.
   */
  toggleVisibility(): void {
    if (this.isAnyVisible()) {
      this.hideAll();
    } else {
      this.showAll();
    }
  }

  /**
   * Get the position of the chief window (for chat/quick-input placement).
   */
  getChiefPosition(): { x: number; y: number } | null {
    const win = this.getChiefWindow();
    if (!win) return null;
    const [x, y] = win.getPosition();
    return { x, y };
  }
}
