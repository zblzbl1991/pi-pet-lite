/**
 * AgentBackend interface and unified event/state types.
 *
 * Provides an engine-agnostic abstraction so the AgentRuntime can
 * delegate LLM interactions to any backend (pi-agent-core, LangChain,
 * custom implementations) without changing upper-level code.
 *
 * Design decisions (ADR):
 * - D1: Abstract at Agent class level. Runtime concerns (tool registry,
 *   trust policy, session persistence) stay in AgentRuntime.
 * - D2: Each backend emits unified BackendEvent format. Conversion from
 *   engine-specific events happens inside the backend implementation.
 */

// ---------------------------------------------------------------------------
// BackendEvent — unified event format
// ---------------------------------------------------------------------------

/** Event types emitted by all backend implementations */
export const BackendEventType = {
  // Agent lifecycle
  START: 'start',
  END: 'end',

  // Message stream
  MESSAGE_START: 'message_start',
  MESSAGE_DELTA: 'message_delta',
  MESSAGE_END: 'message_end',

  // Thinking stream
  THINKING_DELTA: 'thinking_delta',

  // Tool execution
  TOOL_START: 'tool_start',
  TOOL_UPDATE: 'tool_update',
  TOOL_END: 'tool_end',

  // Turn tracking
  TURN_START: 'turn_start',
  TURN_END: 'turn_end',

  // Errors
  ERROR: 'error',
} as const;

export type BackendEventType = (typeof BackendEventType)[keyof typeof BackendEventType];

/** Base shape shared by all backend events */
interface BackendEventBase {
  readonly type: BackendEventType;
}

/** Agent started a new run */
export interface BackendStartEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.START;
}

/** Agent finished a run */
export interface BackendEndEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.END;
  /** Stop reason from the last assistant message */
  readonly stopReason: string;
  /** Last assistant text (if any) */
  readonly lastAssistantText: string;
}

/** A new message started streaming */
export interface BackendMessageStartEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.MESSAGE_START;
  readonly id: string;
  readonly role: string;
  readonly text: string;
}

/** A text delta for the current streaming message */
export interface BackendMessageDeltaEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.MESSAGE_DELTA;
  readonly id: string;
  readonly delta: string;
}

/** A thinking content delta for the current streaming message */
export interface BackendThinkingDeltaEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.THINKING_DELTA;
  readonly id: string;
  readonly delta: string;
}

/** The current message finished streaming */
export interface BackendMessageEndEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.MESSAGE_END;
  readonly id: string;
  readonly role: string;
  readonly text: string;
  /** Whether the message contains tool calls */
  readonly hasToolCalls: boolean;
  /** The raw message object for session persistence */
  readonly rawMessage: unknown;
}

/** A tool execution started */
export interface BackendToolStartEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.TOOL_START;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

/** A tool execution progress update */
export interface BackendToolUpdateEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.TOOL_UPDATE;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly partialResult: string;
}

/** A tool execution finished */
export interface BackendToolEndEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.TOOL_END;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly resultText: string;
  readonly duration: number | undefined;
  readonly args: Record<string, unknown> | undefined;
}

/** A turn started (agent-agentic loop iteration) */
export interface BackendTurnStartEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.TURN_START;
}

/** A turn ended */
export interface BackendTurnEndEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.TURN_END;
}

/** An error occurred */
export interface BackendErrorEvent extends BackendEventBase {
  readonly type: typeof BackendEventType.ERROR;
  readonly error: string;
}

/** Union of all backend events */
export type BackendEvent =
  | BackendStartEvent
  | BackendEndEvent
  | BackendMessageStartEvent
  | BackendMessageDeltaEvent
  | BackendThinkingDeltaEvent
  | BackendMessageEndEvent
  | BackendToolStartEvent
  | BackendToolUpdateEvent
  | BackendToolEndEvent
  | BackendTurnStartEvent
  | BackendTurnEndEvent
  | BackendErrorEvent;

// ---------------------------------------------------------------------------
// BackendState — snapshot of backend state
// ---------------------------------------------------------------------------

/** Read-only state snapshot from the backend */
export interface BackendState {
  /** Conversation messages in engine-native format */
  readonly messages: unknown[];
  /** Whether the backend is currently streaming a response */
  readonly isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// AgentBackend interface
// ---------------------------------------------------------------------------

/**
 * Engine-agnostic agent backend interface.
 *
 * Each implementation wraps a specific LLM engine (pi-agent-core, LangChain,
 * etc.) and emits unified BackendEvent instances via subscribe().
 */
export interface AgentBackend {
  /**
   * Send a user prompt and return the final assistant text response.
   * The backend runs its agentic loop internally and emits events.
   */
  prompt(text: string): Promise<string>;

  /**
   * Abort the current agent run.
   */
  abort(): void;

  /**
   * Clean up resources held by the backend.
   */
  dispose(): void;

  /**
   * Subscribe to unified backend events.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (event: BackendEvent) => void): () => void;

  /**
   * Current state snapshot (messages, streaming status).
   */
  readonly state: BackendState;

  /**
   * Replace the message history (used for session restore).
   */
  setMessages(messages: unknown[]): void;
}

// ---------------------------------------------------------------------------
// BackendConfig — factory configuration
// ---------------------------------------------------------------------------

/** Configuration for creating a backend via the factory */
export interface BackendConfig {
  /** System prompt */
  systemPrompt: string;
  /** LLM model instance (engine-specific) */
  model: unknown;
  /** API key for the LLM provider */
  apiKey: string;
  /** Thinking level for the agent */
  thinkingLevel: unknown;
  /** Tool definitions to register */
  tools: unknown[];
  /** Tool execution mode (e.g. 'sequential') */
  toolExecution: string;
  /** Trust policy handler — called before each tool execution */
  beforeToolCall: (context: unknown, signal: AbortSignal | undefined) => Promise<unknown>;
  /** Stream function for the LLM */
  streamFn: unknown;
  /** Function to retrieve API key per provider */
  getApiKey: (provider: string) => Promise<string>;
}
