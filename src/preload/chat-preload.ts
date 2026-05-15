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
};

contextBridge.exposeInMainWorld('electronAPI', api);
