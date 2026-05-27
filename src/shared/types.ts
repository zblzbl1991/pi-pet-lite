/**
 * Shared types for the Clawd Desktop Pet Agent.
 * Used across main, renderer, and agent processes.
 *
 * Uses const objects + type unions instead of TypeScript enums
 * to ensure compatibility with both Vite (ESM bundler) and
 * Node.js (CommonJS) without export resolution issues.
 */

/** Agent states that map to Clawd GIF animations */
export const AgentState = {
  IDLE: 'idle',
  GREETING: 'greeting',
  THINKING: 'thinking',
  EXECUTING: 'executing',
  WAITING: 'waiting',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

export type AgentState = (typeof AgentState)[keyof typeof AgentState];

/** Chat message direction */
export const MessageRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** A single chat message */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** For streaming: true while the message is still being generated */
  streaming?: boolean;
  /** Thinking content from the assistant, displayed as light italic block */
  thinking?: string;
}

/** A tool execution card entry */
export interface ToolCardEntry {
  type: 'tool-card';
  id: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  toolStatus: 'running' | 'done' | 'error';
  timestamp: number;
  duration?: number;
}

/** A turn indicator entry */
export interface TurnIndicatorEntry {
  type: 'turn-indicator';
  id: string;
  turn: number;
}

/** Union type for all chat entries */
export type ChatEntry = ChatMessage | ToolCardEntry | TurnIndicatorEntry;

/** Type guard to check if a ChatEntry is a ToolCardEntry */
export function isToolCardEntry(entry: ChatEntry): entry is ToolCardEntry {
  return 'type' in entry && entry.type === 'tool-card';
}

/** Type guard to check if a ChatEntry is a TurnIndicatorEntry */
export function isTurnIndicatorEntry(entry: ChatEntry): entry is TurnIndicatorEntry {
  return 'type' in entry && entry.type === 'turn-indicator';
}

/** Trust level for tool execution confirmation */
export const TrustLevel = {
  AUTO: 'auto',
  CONFIRM_ONCE: 'once',
  CONFIRM_STEP: 'step',
} as const;

export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

/** Risk level controlling how aggressively tools can execute without confirmation */
export const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Pet profile role identifiers */
export const PetRole = {
  CHIEF: 'chief',
  CODER: 'coder',
  SCOUT: 'scout',
  ANALYST: 'analyst',
  CUSTOM: 'custom',
  REMOTE: 'remote',
} as const;

export type PetRole = (typeof PetRole)[keyof typeof PetRole];

/** Pet agent status (managed by PetManager) */
export const PetStatus = {
  OFFLINE: 'offline',
  IDLE: 'idle',
  BUSY: 'busy',
  ERROR: 'error',
} as const;

export type PetStatus = (typeof PetStatus)[keyof typeof PetStatus];

/** A2A remote agent connection configuration */
export interface A2AConfig {
  /** Remote agent base URL (e.g. "https://agent.example.com") */
  url: string;
  /** Bearer token / API key for authentication (plaintext, stored in config) */
  apiKey?: string;
  /** Cached AgentCard from /.well-known/agent-card.json */
  agentCard?: AgentCardInfo;
  /** Timeout for remote calls in ms. Default: REMOTE_DEFAULT_TIMEOUT_MS */
  timeoutMs?: number;
}

/** Subset of AgentCard data cached locally for display and routing */
export interface AgentCardInfo {
  name: string;
  description?: string;
  url: string;
  skills?: { id: string; name: string; description?: string }[];
  authentication?: { schemes: string[] };
}

/** Profile-driven agent configuration.
 *  Each pet gets a differentiated identity, tool set, and behavior
 *  from a declarative profile config. */
export interface PetProfile {
  /** Unique profile identifier, e.g. "chief", "coder" */
  id: string;
  /** Display name, e.g. "Chief" */
  name: string;
  /** Role determines the profile's specialization */
  role: PetRole;
  /** System prompt template for this profile */
  systemPrompt: string;
  /** Allowlist of tool names this profile can use */
  toolNames: string[];
  /** Per-tool trust level overrides (merges over global TRUST_POLICY) */
  trustOverrides?: Partial<Record<string, TrustLevel>>;
  /** Optional LLM config overrides (falls back to global config) */
  llm?: Partial<LLMConfig>;
  /** Reserved for future M15 skill L1/L2 progressive disclosure */
  skills?: string[];
  /** Pet icon or GIF name for this profile */
  icon?: string;
  /** GIF prefix for state animations (e.g. "clawd", "ikun"). Defaults to "clawd". */
  gifPrefix?: string;
  /** Whether this profile is active. Disabled profiles are excluded from runtime. */
  enabled?: boolean;
  /** A2A remote agent connection. When present, this profile uses RemoteAgentRuntime. */
  a2a?: A2AConfig;
  /** Backend engine identifier. Defaults to 'pi-agent-core' if not specified. */
  backend?: string;
}

/** Thinking level for agent reasoning */
export const ThinkingLevel = {
  OFF: 'off',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

/** LLM configuration stored in config file */
export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  thinkingLevel?: ThinkingLevel;
}

/** Notification method configuration */
export interface NotificationConfig {
  systemToast: boolean;
  petBubble: boolean;
  petAnimation: boolean;
}

/** Browser CDP configuration */
export interface BrowserConfig {
  chromePath: string;
  cdpPort: number;
}

/** Application configuration */
export interface AppConfig {
  llm: LLMConfig;
  notifications: NotificationConfig;
  browser: BrowserConfig;
  riskLevel: RiskLevel;
  /** User-defined profile overrides. Merged over built-in profiles at runtime. */
  profiles?: PetProfile[];
}

/** Messages sent from renderer to agent via MessagePort */
export type RendererToAgentMessage =
  | { type: 'user-input'; text: string }
  | { type: 'ping' }
  | { type: 'confirmation-response'; toolCallId: string; approved: boolean }
  | { type: 'abort' }
  | { type: 'pet-delegate'; petId: string; prompt: string }
  | { type: 'pet-abort'; petId: string }
  | { type: 'pet-status-request' }
  | { type: 'profiles-updated' }
  | { type: 'plugin-list' }
  | { type: 'plugin-enable'; name: string }
  | { type: 'plugin-disable'; name: string }
  | { type: 'plugin-install'; sourcePath: string }
  | { type: 'plugin-uninstall'; name: string }
  | { type: 'session-branch'; petId: string; branchPointSeq: number }
  | { type: 'session-create-checkpoint'; petId: string; label?: string }
  | { type: 'session-restore-checkpoint'; petId: string; checkpointId: string }
  | { type: 'session-list-checkpoints'; petId: string }
  | { type: 'session-delete-checkpoint'; checkpointId: string }
  | { type: 'session-export'; petId: string; includeCheckpoints?: boolean }
  | { type: 'session-export-range'; petId: string; fromSeq: number; toSeq: number }
  | { type: 'session-import'; petId: string; data: ExportedSession }
  | { type: 'session-list-branches'; petId: string }
  | { type: 'session-get-tree'; petId: string }
  | { type: 'workflow:list' }
  | { type: 'workflow:run'; workflowName: string; inputs: Record<string, unknown> }
  | { type: 'workflow:pause'; runId: string }
  | { type: 'workflow:resume'; runId: string }
  | { type: 'workflow:cancel'; runId: string }
  | { type: 'workflow:status'; runId: string }
  | { type: 'workflow:history' }
  | { type: 'trace:list'; offset: number; limit: number; status?: string; petId?: string }
  | { type: 'trace:detail'; traceId: string };

/** Messages sent from agent to renderer via MessagePort */
export type AgentToRendererMessage =
  | { type: 'state-change'; state: AgentState }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'chat-message-update'; id: string; delta: string }
  | { type: 'chat-message-end'; id: string }
  | { type: 'pong' }
  | { type: 'confirmation-request'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-execution'; toolCallId: string; toolName: string; status: 'running' | 'done' | 'error'; args?: Record<string, unknown>; partialResult?: string; result?: string; duration?: number }
  | { type: 'chat-thinking'; id: string; delta: string }
  | { type: 'turn-indicator'; turn: number; event: 'start' | 'end' }
  | { type: 'error'; message: string }
  | { type: 'pet-status'; petId: string; status: PetStatus }
  | { type: 'pet-statuses'; statuses: PetStatusReportMessage[] }
  | { type: 'plugin-list-response'; plugins: PluginSummary[] }
  | { type: 'plugin-enable-response'; name: string; success: boolean; error?: string }
  | { type: 'plugin-disable-response'; name: string; success: boolean; error?: string }
  | { type: 'plugin-install-response'; success: boolean; name?: string; error?: string }
  | { type: 'plugin-uninstall-response'; name: string; success: boolean; error?: string }
  | { type: 'session-branch-response'; success: boolean; sessionId?: string; error?: string }
  | { type: 'session-checkpoint-response'; success: boolean; checkpointId?: string; error?: string }
  | { type: 'session-restore-checkpoint-response'; success: boolean; sessionId?: string; error?: string }
  | { type: 'session-checkpoints-list'; checkpoints: Checkpoint[] }
  | { type: 'session-delete-checkpoint-response'; success: boolean; error?: string }
  | { type: 'session-export-response'; data: ExportedSession | null; error?: string }
  | { type: 'session-import-response'; success: boolean; sessionId?: string; error?: string }
  | { type: 'session-branches-list'; branches: SessionInfo[] }
  | { type: 'session-tree'; tree: SessionTreeNode[] }
  | { type: 'workflow-list-response'; workflows: WorkflowDefinition[] }
  | { type: 'workflow-run-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-pause-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-resume-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-cancel-response'; runId: string; success: boolean; error?: string }
  | { type: 'workflow-status-response'; run: WorkflowRunSnapshot | null }
  | { type: 'workflow-history-response'; runs: WorkflowRunSnapshot[] }
  | { type: 'trace-list-response'; traces: TraceRow[]; total: number }
  | { type: 'trace-detail-response'; detail: { trace: Trace; spans: Span[] } | null }
  | { type: 'trace-completed'; traceId: string; status: string };

/** Pet status report for IPC communication */
export interface PetStatusReportMessage {
  petId: string;
  status: PetStatus;
  queueLength: number;
  successCount: number;
  errorCount: number;
  lastActivity: number;
}

/** IPC channels between main process and renderer */
export interface MainIPCChannels {
  'set-ignore-mouse-events': (ignore: boolean) => void;
  'move-window': (deltaX: number, deltaY: number) => void;
  'get-window-position': () => { x: number; y: number };
  'open-settings': () => void;
}

/** Exposed via contextBridge in pet preload */
export interface PetElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean, petId?: string) => void;
  moveWindow: (deltaX: number, deltaY: number, petId?: string) => void;
  getWindowPosition: (petId?: string) => Promise<{ x: number; y: number }>;
  openSettings: () => void;
  openChat: () => void;
  openQuickInput: () => void;
  onAgentMessage: (callback: (msg: AgentToRendererMessage) => void) => () => void;
  sendToAgent: (msg: RendererToAgentMessage) => void;
  petDragStart: (offset: { x: number; y: number }, petId?: string) => void;
  petDragEnd: (petId?: string) => void;
  /** Listen for pet status updates from main process */
  onPetStatusUpdate: (callback: (data: PetStatusUpdateData) => void) => () => void;
  /** Get this pet's identity (petId, name, role, roleColor, interactive) */
  getPetConfig: () => PetConfig;
  /** Show a tooltip for non-interactive pets */
  showPetTooltip: (text: string) => void;
}

/** Pet identity configuration passed from main to renderer via preload */
export interface PetConfig {
  petId: string;
  petName: string;
  petRole: PetRole;
  roleColor: string;
  interactive: boolean;
}

/** Pet status update data sent via IPC */
export interface PetStatusUpdateData {
  petId: string;
  status: PetStatus;
  animation: string;
}

/** Exposed via contextBridge in quick-input preload */
export interface QuickInputElectronAPI {
  submit: (text: string) => void;
  cancel: () => void;
}

/** Exposed via contextBridge in chat preload */
export interface ChatElectronAPI {
  onAgentMessage: (callback: (msg: AgentToRendererMessage) => void) => () => void;
  sendToAgent: (msg: RendererToAgentMessage) => void;
  syncHistory: () => Promise<ChatEntry[]>;
  onSlideIn: (callback: () => void) => () => void;
  onSlideOut: (callback: () => void) => () => void;
  slideOutComplete: () => void;
  closeChat: () => void;
}

// ---- Blackboard Store Types ----

/** A single entry from the blackboard store */
export interface BlackboardEntryItem {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

/** IPC response wrapper for blackboard operations */
export interface BlackboardResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

/** IPC API surface exposed to renderer for blackboard operations */
export interface BlackboardIPC {
  get(namespace: string, key: string): Promise<BlackboardResponse<BlackboardEntryItem | null>>;
  set(namespace: string, key: string, value: string, ttlMs?: number): Promise<BlackboardResponse<void>>;
  delete(namespace: string, key: string): Promise<BlackboardResponse<boolean>>;
  list(namespace: string, prefix?: string): Promise<BlackboardResponse<BlackboardEntryItem[]>>;
  query(namespace: string, filter: Record<string, unknown>): Promise<BlackboardResponse<BlackboardEntryItem[]>>;
}

/** Summary of a plugin for IPC communication to the renderer */
export interface PluginSummary {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  permissions: string[];
}

// ---- Session Branching & Checkpoint Types ----

/** A checkpoint snapshot of agent state at a point in time */
export interface Checkpoint {
  id: string;
  sessionId: string;
  label: string | null;
  createdAt: number;
}

/** A node in the session branch tree (for UI display) */
export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

/** Lightweight session info used in tree nodes and export */
export interface SessionInfo {
  id: string;
  petId: string;
  title: string | null;
  createdAt: number;
  parentSessionId: string | null;
  branchPointSeq: number | null;
}

/** Exported session data for cross-device migration */
export interface ExportedSession {
  version: number;
  session: { petId: string; title: string | null; createdAt: number };
  messages: Array<{ seq: number; role: string; content: string }>;
  checkpoints?: Array<{ id: string; label: string | null; snapshot: string; createdAt: number }>;
}

// ---- Workflow Types ----

/** A single input parameter for a workflow */
export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: unknown;
}

/** A single step in a workflow definition */
export interface WorkflowStepDef {
  id: string;
  agent: string;
  prompt: string;
  dependsOn?: string[];
  outputKey?: string;
  condition?: string;
}

/** Full workflow definition for IPC transport */
export interface WorkflowDefinition {
  name: string;
  description: string;
  inputs: WorkflowInput[];
  steps: WorkflowStepDef[];
}

/** Status of a workflow run */
export const WorkflowRunStatus = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type WorkflowRunStatus = (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];

/** Status of an individual step */
export const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

/** Result of a single step execution */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Serializable workflow run snapshot for IPC */
export interface WorkflowRunSnapshot {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  inputs: Record<string, unknown>;
  stepResults: Array<[string, StepResult]>;
  startedAt: number;
  completedAt?: number;
}

// ---- Trace Types ----

/** Trace row returned by list queries (flat view from SQL join) */
export interface TraceRow {
  id: string;
  session_id: string | null;
  pet_id: string | null;
  start_time: number;
  end_time: number | null;
  status: string;
  span_count: number;
}

/** Full trace record */
export interface Trace {
  id: string;
  sessionId: string | null;
  petId: string | null;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ok' | 'error' | 'aborted';
  attributes: Record<string, unknown>;
}

/** A single span within a trace */
export interface Span {
  id: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ok' | 'error';
  attributes: Record<string, unknown>;
}
