import { contextBridge, ipcRenderer } from 'electron';
import type { LLMConfig } from '../shared/types';

/**
 * Preload script for the settings BrowserWindow.
 * Exposes settingsAPI via contextBridge for reading/writing config,
 * testing LLM connections, and closing the window.
 *
 * NOTE: This file is compiled separately as CommonJS (not bundled by Vite).
 * It runs in the preload context with Node.js access.
 */

const api = {
  /**
   * Read the current LLM config from disk.
   */
  loadConfig(): Promise<LLMConfig> {
    return ipcRenderer.invoke('settings:load-config') as Promise<LLMConfig>;
  },

  /**
   * Save the LLM config to disk and notify the agent process.
   */
  saveConfig(config: LLMConfig): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-config', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  /**
   * Test the LLM connection by sending a minimal request.
   */
  testConnection(
    config: LLMConfig
  ): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:test-connection', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  /**
   * Close the settings window.
   */
  closeWindow(): void {
    ipcRenderer.send('settings:close');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', api);
