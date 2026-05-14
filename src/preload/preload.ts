import { contextBridge, ipcRenderer } from 'electron';
import { AGENT_MESSAGE_PORT } from '../shared/constants';

let agentPort: MessagePort | null = null;

/**
 * Preload script for the pet BrowserWindow.
 * Exposes ElectronAPI via contextBridge.
 *
 * NOTE: This file is compiled separately as CommonJS (not bundled by Vite).
 * It runs in the preload context with Node.js access.
 */

const api = {
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },

  moveWindow(deltaX: number, deltaY: number): void {
    ipcRenderer.send('move-window', deltaX, deltaY);
  },

  getWindowPosition(): Promise<{ x: number; y: number }> {
    return ipcRenderer.invoke('get-window-position') as Promise<{ x: number; y: number }>;
  },

  openSettings(): void {
    ipcRenderer.send('open-settings');
  },

  onAgentMessage(
    callback: (msg: Record<string, unknown>) => void
  ): () => void {
    const listener = (event: MessageEvent) => {
      callback(event.data as Record<string, unknown>);
    };

    // Listen for the MessagePort transfer from main process
    ipcRenderer.on(AGENT_MESSAGE_PORT, (_event: Electron.IpcRendererEvent) => {
      const ports = (_event as unknown as MessageEvent).ports;
      if (ports && ports.length > 0) {
        agentPort = ports[0];
        agentPort.onmessage = listener;
        agentPort.start();
      }
    });

    // Return unsubscribe function
    return () => {
      if (agentPort) {
        agentPort.close();
        agentPort = null;
      }
    };
  },

  sendToAgent(msg: Record<string, unknown>): void {
    if (agentPort) {
      agentPort.postMessage(msg);
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
