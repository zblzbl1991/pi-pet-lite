import { contextBridge, ipcRenderer } from 'electron';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, PetProfile, PluginSummary, WorkflowDefinition, WorkflowRunSnapshot, TraceRow, Trace, Span, WorkspaceInfo, InstalledAgentSummaryIPC, AgentManifestIPC, NodeInfoIPC, RemoteAgentInfoIPC, ExposedAgentIPC } from '../shared/types';

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

  // Workflow management IPC
  listWorkflows(): Promise<WorkflowDefinition[]> {
    return ipcRenderer.invoke('workflow:list') as Promise<WorkflowDefinition[]>;
  },

  runWorkflow(workflowName: string, inputs: Record<string, unknown>): Promise<{ runId: string; success: boolean; error?: string }> {
    return ipcRenderer.invoke('workflow:run', workflowName, inputs) as Promise<{
      runId: string;
      success: boolean;
      error?: string;
    }>;
  },

  pauseWorkflow(runId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workflow:pause', runId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  resumeWorkflow(runId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workflow:resume', runId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  cancelWorkflow(runId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workflow:cancel', runId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  getWorkflowStatus(runId: string): Promise<{ run: WorkflowRunSnapshot | null }> {
    return ipcRenderer.invoke('workflow:status', runId) as Promise<{
      run: WorkflowRunSnapshot | null;
    }>;
  },

  getWorkflowHistory(): Promise<{ runs: WorkflowRunSnapshot[] }> {
    return ipcRenderer.invoke('workflow:history') as Promise<{
      runs: WorkflowRunSnapshot[];
    }>;
  },

  // Trace query IPC
  traceList(options: { offset: number; limit: number; status?: string; petId?: string }): Promise<{ traces: TraceRow[]; total: number }> {
    return ipcRenderer.invoke('trace:list', options) as Promise<{ traces: TraceRow[]; total: number }>;
  },

  traceDetail(traceId: string): Promise<{ trace: Trace; spans: Span[] } | null> {
    return ipcRenderer.invoke('trace:detail', traceId) as Promise<{ trace: Trace; spans: Span[] } | null>;
  },

  onTraceCompleted(callback: (payload: { traceId: string; status: string }) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: { traceId: string; status: string }) => callback(payload);
    ipcRenderer.on('trace:completed', listener);
    return () => ipcRenderer.removeListener('trace:completed', listener);
  },

  // Marketplace IPC
  marketplaceListInstalled(): Promise<InstalledAgentSummaryIPC[]> {
    return ipcRenderer.invoke('marketplace:list-installed') as Promise<InstalledAgentSummaryIPC[]>;
  },

  marketplaceInstall(packagePath: string): Promise<{ success: boolean; name?: string; error?: string; warnings?: string[] }> {
    return ipcRenderer.invoke('marketplace:install', packagePath) as Promise<{
      success: boolean;
      name?: string;
      error?: string;
      warnings?: string[];
    }>;
  },

  marketplaceUninstall(name: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('marketplace:uninstall', name) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  marketplaceGetPackageInfo(packagePath: string): Promise<{ success: boolean; manifest?: AgentManifestIPC; error?: string }> {
    return ipcRenderer.invoke('marketplace:get-package-info', packagePath) as Promise<{
      success: boolean;
      manifest?: AgentManifestIPC;
      error?: string;
    }>;
  },

  // Workspace management IPC
  listWorkspaces(): Promise<{ success: boolean; error?: string; data?: WorkspaceInfo[] }> {
    return ipcRenderer.invoke('workspace:list') as Promise<{
      success: boolean;
      error?: string;
      data?: WorkspaceInfo[];
    }>;
  },

  createWorkspace(name: string, setAsDefault?: boolean): Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }> {
    return ipcRenderer.invoke('workspace:create', name, setAsDefault) as Promise<{
      success: boolean;
      error?: string;
      data?: WorkspaceInfo;
    }>;
  },

  deleteWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workspace:delete', workspaceId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  renameWorkspace(workspaceId: string, newName: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workspace:rename', workspaceId, newName) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  switchWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }> {
    return ipcRenderer.invoke('workspace:switch', workspaceId) as Promise<{
      success: boolean;
      error?: string;
      data?: WorkspaceInfo;
    }>;
  },

  exportWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workspace:export', workspaceId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  importWorkspace(): Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }> {
    return ipcRenderer.invoke('workspace:import') as Promise<{
      success: boolean;
      error?: string;
      data?: WorkspaceInfo;
    }>;
  },

  setDefaultWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('workspace:set-default', workspaceId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  getActiveWorkspace(): Promise<{ success: boolean; error?: string; data?: WorkspaceInfo }> {
    return ipcRenderer.invoke('workspace:get-active') as Promise<{
      success: boolean;
      error?: string;
      data?: WorkspaceInfo;
    }>;
  },

  // Distributed Runtime Node IPC
  nodeList(): Promise<{ nodes: NodeInfoIPC[] }> {
    return ipcRenderer.invoke('node:list') as Promise<{ nodes: NodeInfoIPC[] }>;
  },

  nodeAdd(label: string, url: string, apiKey: string): Promise<{ success: boolean; nodeId?: string; error?: string }> {
    return ipcRenderer.invoke('node:add', label, url, apiKey) as Promise<{
      success: boolean;
      nodeId?: string;
      error?: string;
    }>;
  },

  nodeRemove(nodeId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('node:remove', nodeId) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  nodeStatus(): Promise<{ nodes: NodeInfoIPC[] }> {
    return ipcRenderer.invoke('node:status') as Promise<{ nodes: NodeInfoIPC[] }>;
  },

  nodeDiscover(nodeId: string): Promise<{ success: boolean; agents?: RemoteAgentInfoIPC[]; error?: string }> {
    return ipcRenderer.invoke('node:discover', nodeId) as Promise<{
      success: boolean;
      agents?: RemoteAgentInfoIPC[];
      error?: string;
    }>;
  },

  nodeListExposed(): Promise<{ exposedAgents: ExposedAgentIPC[] }> {
    return ipcRenderer.invoke('node:list-exposed-agents') as Promise<{ exposedAgents: ExposedAgentIPC[] }>;
  },

  nodeToggleExpose(petId: string, exposed: boolean): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('node:toggle-expose', petId, exposed) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  nodeUpdateExposure(config: { enabled?: boolean; port?: number; apiKey?: string }): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('node:update-exposure-config', config) as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  closeWindow(): void {
    ipcRenderer.send('settings:close');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', api);
