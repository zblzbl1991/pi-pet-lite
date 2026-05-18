/**
 * Type declarations for the electronAPI exposed via contextBridge.
 * Different windows receive different API shapes.
 */

import type {
  AgentToRendererMessage,
  RendererToAgentMessage,
  ChatMessage,
  LLMConfig,
  NotificationConfig,
  BrowserConfig,
  PetElectronAPI,
  ChatElectronAPI,
  QuickInputElectronAPI,
  PetConfig,
  PetStatusUpdateData,
} from '../shared/types';

/**
 * API exposed to the settings window via its own preload script.
 */
export interface SettingsElectronAPI {
  loadConfig: () => Promise<LLMConfig>;
  saveConfig: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>;
  testConnection: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>;
  loadNotificationConfig: () => Promise<NotificationConfig>;
  saveNotificationConfig: (config: NotificationConfig) => Promise<{ success: boolean; error?: string }>;
  loadBrowserConfig: () => Promise<BrowserConfig>;
  saveBrowserConfig: (config: BrowserConfig) => Promise<{ success: boolean; error?: string }>;
  testBrowserConnection: (config: BrowserConfig) => Promise<{ success: boolean; error?: string; browserInfo?: string }>;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: PetElectronAPI | ChatElectronAPI | QuickInputElectronAPI;
    settingsAPI: SettingsElectronAPI;
  }
}
