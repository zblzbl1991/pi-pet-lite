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
  RiskLevel,
  PetProfile,
  PetElectronAPI,
  ChatElectronAPI,
  QuickInputElectronAPI,
  PetConfig,
  PetStatusUpdateData,
  PluginSummary,
  WorkflowDefinition,
  WorkflowRunSnapshot,
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
  loadRiskLevel: () => Promise<RiskLevel>;
  saveRiskLevel: (level: RiskLevel) => Promise<{ success: boolean; error?: string }>;
  loadProfiles: () => Promise<PetProfile[]>;
  saveProfiles: (profiles: PetProfile[]) => Promise<{ success: boolean; error?: string }>;
  resetProfiles: () => Promise<{ success: boolean; error?: string }>;
  listPlugins: () => Promise<PluginSummary[]>;
  enablePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  disablePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  installPlugin: (sourcePath: string) => Promise<{ success: boolean; name?: string; error?: string }>;
  uninstallPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  listWorkflows: () => Promise<WorkflowDefinition[]>;
  runWorkflow: (workflowName: string, inputs: Record<string, unknown>) => Promise<{ runId: string; success: boolean; error?: string }>;
  pauseWorkflow: (runId: string) => Promise<{ success: boolean; error?: string }>;
  resumeWorkflow: (runId: string) => Promise<{ success: boolean; error?: string }>;
  cancelWorkflow: (runId: string) => Promise<{ success: boolean; error?: string }>;
  getWorkflowStatus: (runId: string) => Promise<{ run: WorkflowRunSnapshot | null }>;
  getWorkflowHistory: () => Promise<{ runs: WorkflowRunSnapshot[] }>;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: PetElectronAPI | ChatElectronAPI | QuickInputElectronAPI;
    settingsAPI: SettingsElectronAPI;
  }
}
