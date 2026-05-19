import { contextBridge, ipcRenderer } from 'electron';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel } from '../shared/types';

/**
 * Preload script for the settings BrowserWindow.
 * Exposes settingsAPI via contextBridge for reading/writing config,
 * testing LLM connections, managing notification preferences,
 * managing risk level / permission settings,
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

  loadRiskLevel(): Promise<RiskLevel> {
    return ipcRenderer.invoke('settings:load-risk-level') as Promise<RiskLevel>;
  },

  saveRiskLevel(level: RiskLevel): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-risk-level', level) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  closeWindow(): void {
    ipcRenderer.send('settings:close');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', api);
