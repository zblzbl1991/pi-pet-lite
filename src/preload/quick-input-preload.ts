import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for the Quick Input BrowserWindow.
 * Minimal API: submit text or cancel.
 */

const api = {
  submit(text: string): void {
    ipcRenderer.send('quick-input-submit', text);
  },

  cancel(): void {
    ipcRenderer.send('quick-input-cancel');
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
