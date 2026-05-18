import { contextBridge, ipcRenderer } from 'electron';
import type { LLMConfig, NotificationConfig, BrowserConfig } from '../shared/types';

/**
 * Preload script for the settings BrowserWindow.
 * Exposes settingsAPI via contextBridge for reading/writing config,
 * testing LLM connections, managing notification preferences,
 * and closing the window.
 */

const api = {
  loadConfig(): Promise<LLMConfig> {
    return ipcRenderer.invoke('settings:load-config') as Promise<LLMConfig>;
  },

  saveConfig(config: LLMConfig): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-config', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  testConnection(
    config: LLMConfig
  ): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:test-connection', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  loadNotificationConfig(): Promise<NotificationConfig> {
    return ipcRenderer.invoke('settings:load-notifications') as Promise<NotificationConfig>;
  },

  saveNotificationConfig(
    config: NotificationConfig
  ): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-notifications', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  loadBrowserConfig(): Promise<BrowserConfig> {
    return ipcRenderer.invoke('settings:load-browser-config') as Promise<BrowserConfig>;
  },

  saveBrowserConfig(
    config: BrowserConfig
  ): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-browser-config', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  testBrowserConnection(
    config: BrowserConfig
  ): Promise<{ success: boolean; error?: string; browserInfo?: string }> {
    return ipcRenderer.invoke('settings:test-browser-connection', config) as Promise<{
      success: boolean;
      error?: string;
      browserInfo?: string;
    }>;
  },

  closeWindow(): void {
    ipcRenderer.send('settings:close');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', api);
