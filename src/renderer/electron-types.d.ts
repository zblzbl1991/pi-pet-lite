/**
 * Type declarations for the electronAPI exposed via contextBridge.
 * The preload script uses Record<string, unknown> for portability,
 * but we assert the proper types here for the renderer.
 */

import type {
  AgentToRendererMessage,
  RendererToAgentMessage,
  LLMConfig,
} from '../shared/types';

export interface RendererElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => void;
  moveWindow: (deltaX: number, deltaY: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number }>;
  openSettings: () => void;
  onAgentMessage: (callback: (msg: AgentToRendererMessage) => void) => () => void;
  sendToAgent: (msg: RendererToAgentMessage) => void;
}

/**
 * API exposed to the settings window via its own preload script.
 */
export interface SettingsElectronAPI {
  loadConfig: () => Promise<LLMConfig>;
  saveConfig: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>;
  testConnection: (config: LLMConfig) => Promise<{ success: boolean; error?: string }>;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: RendererElectronAPI;
    settingsAPI: SettingsElectronAPI;
  }
}
