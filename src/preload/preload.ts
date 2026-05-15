import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the pet BrowserWindow.
 * Uses IPC for all communication with main process (no MessagePort).
 */

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
};

contextBridge.exposeInMainWorld('electronAPI', api);
