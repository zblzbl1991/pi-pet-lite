import { contextBridge, ipcRenderer } from 'electron';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, PetProfile, PluginSummary } from '../shared/types';

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

  loadProfiles(): Promise<PetProfile[]> {
    return ipcRenderer.invoke('settings:load-profiles') as Promise<PetProfile[]>;
  },

  saveProfiles(profiles: PetProfile[]): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save-profiles', profiles) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  resetProfiles(): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:reset-profiles') as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  // Plugin management IPC
  listPlugins(): Promise<PluginSummary[]> {
    return ipcRenderer.invoke('plugin:list') as Promise<PluginSummary[]>;
  },

  enablePlugin(name: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('plugin:enable', name) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  disablePlugin(name: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('plugin:disable', name) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  installPlugin(sourcePath: string): Promise<{ success: boolean; name?: string; error?: string }> {
    return ipcRenderer.invoke('plugin:install', sourcePath) as Promise<{
      success: boolean;
      name?: string;
      error?: string;
    }>;
  },

  uninstallPlugin(name: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('plugin:uninstall', name) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  closeWindow(): void {
    ipcRenderer.send('settings:close');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', api);
