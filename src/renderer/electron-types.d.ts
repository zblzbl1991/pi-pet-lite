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
  TraceRow,
  Trace,
  Span,
  WorkspaceInfo,
  InstalledAgentSummaryIPC,
  AgentManifestIPC,
  NodeInfoIPC,
  RemoteAgentInfoIPC,
  ExposedAgentIPC,
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
  traceList: (options: { offset: number; limit: number; status?: string; petId?: string }) => Promise<{ traces: TraceRow[]; total: number }>;
  traceDetail: (traceId: string) => Promise<{ trace: Trace; spans: Span[] } | null>;
  onTraceCompleted: (callback: (payload: { traceId: string; status: string }) => void) => () => void;
  marketplaceListInstalled: () => Promise<InstalledAgentSummaryIPC[]>;
  marketplaceInstall: (packagePath: string) => Promise<{ success: boolean; name?: string; error?: string; warnings?: string[] }>;
  marketplaceUninstall: (name: string) => Promise<{ success: boolean; error?: string }>;
  marketplaceGetPackageInfo: (packagePath: string) => Promise<{ success: boolean; manifest?: AgentManifestIPC; error?: string }>;
  // Workspace management
  listWorkspaces: () => Promise<{ success: boolean; error?: string; data?: WorkspaceInfo[] }>;
  createWorkspace: (name: string, setAsDefault?: boolean) => Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }>;
  deleteWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  renameWorkspace: (workspaceId: string, newName: string) => Promise<{ success: boolean; error?: string }>;
  switchWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }>;
  exportWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  importWorkspace: () => Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }>;
  setDefaultWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  getActiveWorkspace: () => Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }>;
  // Distributed runtime node management
  nodeList: () => Promise<{ nodes: NodeInfoIPC[] }>;
  nodeAdd: (label: string, url: string, apiKey: string) => Promise<{ success: boolean; nodeId?: string; error?: string }>;
  nodeRemove: (nodeId: string) => Promise<{ success: boolean; error?: string }>;
  nodeStatus: () => Promise<{ nodes: NodeInfoIPC[] }>;
  nodeDiscover: (nodeId: string) => Promise<{ success: boolean; agents?: RemoteAgentInfoIPC[]; error?: string }>;
  nodeListExposed: () => Promise<{ exposedAgents: ExposedAgentIPC[] }>;
  nodeToggleExpose: (petId: string, exposed: boolean) => Promise<{ success: boolean; error?: string }>;
  nodeUpdateExposure: (config: { enabled?: boolean; port?: number; apiKey?: string }) => Promise<{ success: boolean; error?: string }>;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: PetElectronAPI | ChatElectronAPI | QuickInputElectronAPI;
    settingsAPI: SettingsElectronAPI;
  }
}
