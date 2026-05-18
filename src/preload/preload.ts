import { contextBridge, ipcRenderer } from 'electron';
import { IPC_PET_STATUS_UPDATE, IPC_PET_TOOLTIP } from '../shared/constants';

/**
 * Preload script for the pet BrowserWindow.
 * Uses IPC for all communication with main process (no MessagePort).
 *
 * Supports both single-pet (legacy) and multi-pet modes.
 * In multi-pet mode, query parameters (petId, petName, petRole, roleColor, interactive)
 * are read from the window URL to identify which pet this window represents.
 */

// Read pet config from URL query parameters (set by PetWindowManager)
function getPetConfigFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    petId: params.get('petId') ?? 'chief',
    petName: params.get('petName') ?? 'Chief',
    petRole: params.get('petRole') ?? 'chief',
    roleColor: params.get('roleColor') ?? '#e8912d',
    interactive: params.get('interactive') !== '0',
  };
}

const api = {
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },

  moveWindow(deltaX: number, deltaY: number): void {
    ipcRenderer.send('move-window', deltaX, deltaY);
  },

  getWindowPosition(): Promise<{ x: number; y: number }> {
    return ipcRenderer.invoke('get-window-position') as Promise<{
      x: number;
      y: number;
    }>;
  },

  openSettings(): void {
    ipcRenderer.send('open-settings');
  },

  openChat(): void {
    ipcRenderer.send('open-chat');
  },

  openQuickInput(): void {
    ipcRenderer.send('open-quick-input');
  },

  petDragStart(offset: { x: number; y: number }): void {
    ipcRenderer.send('pet-drag-start', offset);
  },

  petDragEnd(): void {
    ipcRenderer.send('pet-drag-end');
  },

  onAgentMessage(
    callback: (msg: Record<string, unknown>) => void
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      msg: Record<string, unknown>
    ) => {
      callback(msg);
    };
    ipcRenderer.on('agent-message', listener);
    return () => {
      ipcRenderer.removeListener('agent-message', listener);
    };
  },

  sendToAgent(msg: Record<string, unknown>): void {
    ipcRenderer.send('renderer-to-agent', msg);
  },

  /**
   * Listen for pet status updates from main process.
   * These are per-pet status changes (idle, busy, error, offline).
   */
  onPetStatusUpdate(
    callback: (data: { petId: string; status: string; animation: string }) => void
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { petId: string; status: string; animation: string }
    ) => {
      callback(data);
    };
    ipcRenderer.on(IPC_PET_STATUS_UPDATE, listener);
    return () => {
      ipcRenderer.removeListener(IPC_PET_STATUS_UPDATE, listener);
    };
  },

  /**
   * Get this pet's configuration (identity, role, color, interactivity).
   */
  getPetConfig() {
    return getPetConfigFromUrl();
  },

  /**
   * Show a tooltip for non-interactive pets (unused in main process for now,
   * but available for future tooltip IPC).
   */
  showPetTooltip(text: string): void {
    ipcRenderer.send(IPC_PET_TOOLTIP, text);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
