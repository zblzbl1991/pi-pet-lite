import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the Chat BrowserWindow.
 * Uses IPC (not MessagePort) for all communication with main process.
 */

const api = {
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

  syncHistory(): Promise<unknown> {
    return ipcRenderer.invoke('chat:sync-history');
  },

  onSlideIn(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on('chat:slide-in', listener);
    return () => ipcRenderer.removeListener('chat:slide-in', listener);
  },

  onSlideOut(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on('chat:slide-out', listener);
    return () => ipcRenderer.removeListener('chat:slide-out', listener);
  },

  slideOutComplete(): void {
    ipcRenderer.send('chat:slide-out-complete');
  },

  closeChat(): void {
    ipcRenderer.send('close-chat');
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
