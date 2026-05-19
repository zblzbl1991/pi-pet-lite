import { contextBridge, ipcRenderer } from 'electron';

// Sandbox mode cannot resolve relative requires; inline the IPC channel names.
const IPC_PET_STATUS_UPDATE = 'pet:status-update';
const IPC_PET_TOOLTIP = 'pet:tooltip';

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
  setIgnoreMouseEvents(ignore: boolean, petId?: string): void {
    ipcRenderer.send('set-ignore-mouse-events', ignore, petId ?? getPetConfigFromUrl().petId);
  },

  moveWindow(deltaX: number, deltaY: number, petId?: string): void {
    ipcRenderer.send('move-window', deltaX, deltaY, petId ?? getPetConfigFromUrl().petId);
  },

  getWindowPosition(petId?: string): Promise<{ x: number; y: number }> {
    return ipcRenderer.invoke('get-window-position', petId ?? getPetConfigFromUrl().petId) as Promise<{
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

  petDragStart(offset: { x: number; y: number }, petId?: string): void {
    ipcRenderer.send('pet-drag-start', offset, petId ?? getPetConfigFromUrl().petId);
  },

  petDragEnd(petId?: string): void {
    ipcRenderer.send('pet-drag-end', petId ?? getPetConfigFromUrl().petId);
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
