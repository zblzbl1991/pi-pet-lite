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
  TOOL: 'tool',
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
  /** For tool result messages: whether the tool execution was an error */
  isError?: boolean;
}

/** Trust level for tool execution confirmation */
export const TrustLevel = {
  AUTO: 'auto',
  CONFIRM_ONCE: 'once',
  CONFIRM_STEP: 'step',
} as const;

export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

/** LLM configuration stored in config file */
export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Notification method configuration */
export interface NotificationConfig {
  systemToast: boolean;
  petBubble: boolean;
  petAnimation: boolean;
}

/** Application configuration */
export interface AppConfig {
  llm: LLMConfig;
  notifications: NotificationConfig;
}

/** Messages sent from renderer to agent via MessagePort */
export type RendererToAgentMessage =
  | { type: 'user-input'; text: string }
  | { type: 'ping' }
  | { type: 'confirmation-response'; toolCallId: string; approved: boolean };

/** Messages sent from agent to renderer via MessagePort */
export type AgentToRendererMessage =
  | { type: 'state-change'; state: AgentState }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'chat-message-update'; id: string; delta: string }
  | { type: 'chat-message-end'; id: string }
  | { type: 'pong' }
  | { type: 'confirmation-request'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-execution'; toolCallId: string; toolName: string; status: 'running' | 'done' | 'error'; result?: string }
  | { type: 'error'; message: string };

/** IPC channels between main process and renderer */
export interface MainIPCChannels {
  'set-ignore-mouse-events': (ignore: boolean) => void;
  'move-window': (deltaX: number, deltaY: number) => void;
  'get-window-position': () => { x: number; y: number };
  'open-settings': () => void;
}

/** Exposed via contextBridge in pet preload */
export interface PetElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => void;
  moveWindow: (deltaX: number, deltaY: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number }>;
  openSettings: () => void;
  openChat: () => void;
  onAgentMessage: (callback: (msg: AgentToRendererMessage) => void) => () => void;
  sendToAgent: (msg: RendererToAgentMessage) => void;
  petDragStart: (offset: { x: number; y: number }) => void;
  petDragEnd: () => void;
}

/** Exposed via contextBridge in chat preload */
export interface ChatElectronAPI {
  onAgentMessage: (callback: (msg: AgentToRendererMessage) => void) => () => void;
  sendToAgent: (msg: RendererToAgentMessage) => void;
  syncHistory: () => Promise<ChatMessage[]>;
}
