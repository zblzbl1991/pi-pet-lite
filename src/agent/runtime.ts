/**
 * Agent runtime for the Clawd desktop pet.
 *
 * Wraps an AgentBackend (default: pi-agent-core) with:
 * - LLM model creation from config
 * - Tool registration via the centralized tool registry
 * - beforeToolCall hook for trust policy enforcement
 * - Scheduled task restoration on startup
 * - Event subscription that forwards to a callback (for IPC to renderer)
 * - EventBus, SessionStore, Tracer integrations
 *
 * The runtime delegates engine-specific work to the AgentBackend.
 * The backend handles Agent creation, event conversion, and the
 * prompt/abort/dispose lifecycle.
 */

import { AgentState, TrustLevel, RiskLevel } from '../shared/types';
import type { PetProfile } from '../shared/types';
import { RISK_TRUST_POLICIES } from '../shared/constants';
import { createModel } from './llm';
import { getLLMConfig } from './llm';
import { readConfig } from '../config/config-store';
import { getToolsForProfile, restoreSchedules, setScheduleFireCallback } from './tools/registry';
import { getDefaultProfile, getEnabledSpecialistProfiles } from './profiles';
import { recordExperience, summarizeRecentFailures, buildKnownIssuesText } from './experience';
import { EventBus, AgentEvents } from './event-bus';
import type { SessionStore } from '../storage/session-store';
import { createBackend } from './backends/factory';
import type { AgentBackend, BackendEvent, BackendConfig } from './backends/types';
import { BackendEventType } from './backends/types';

/** Type alias for pi-agent-core thinking level */
type PiThinkingLevel = import('@earendil-works/pi-agent-core').ThinkingLevel;

/** Callback type for events forwarded to the renderer */
export interface AgentEventCallback {
  (event: {
    type: string;
    state?: AgentState;
    chatMessage?: { id: string; role: string; content: string; streaming?: boolean };
    chatDelta?: { id: string; delta: string };
    chatEnd?: { id: string };
    chatThinking?: { id: string; delta: string };
    confirmationRequest?: { toolCallId: string; toolName: string; args: Record<string, unknown> };
    toolExecution?: { toolCallId: string; toolName: string; status: string; args?: Record<string, unknown>; partialResult?: string; result?: string; duration?: number };
    turnIndicator?: { turn: number; event: 'start' | 'end' };
    error?: string;
  }): void;
}

/** Callback for requesting user confirmation (resolves promise when answered) */
export type ConfirmationHandler = (
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
) => Promise<boolean>;

/** The running agent instance and associated state */
export interface AgentRuntime {
  /** Send a user message to the agent, returns the last assistant text response */
  prompt(text: string): Promise<string>;
  /** Abort the current agent run */
  abort(): void;
  /** Set the handler for confirmation requests from the renderer */
  setConfirmationHandler(handler: ConfirmationHandler): void;
  /** Clean up the agent */
  dispose(): void;
}

/**
 * Initialize and return the Clawd agent runtime.
 *
 * @param onEvent - Callback for agent events forwarded to the renderer
 * @param getConfirmation - Function that sends confirmation to renderer and returns the user's response
 * @param profile - Optional PetProfile to configure tools, system prompt, and trust policy.
 *                  Defaults to the Chief profile if not specified (backward compatible).
 * @param eventBus - Optional event bus for decoupled event distribution
 * @param sessionStore - Optional session store for conversation persistence
 * @param sessionId - Optional session ID for restoring conversation history
 */
export async function createAgentRuntime(
  onEvent: AgentEventCallback,
  getConfirmation: ConfirmationHandler,
  profile?: PetProfile,
  eventBus?: EventBus,
  sessionStore?: SessionStore,
  sessionId?: string
): Promise<AgentRuntime> {
  // Resolve profile: use provided profile or default to Chief
  const resolvedProfile = profile ?? getDefaultProfile();

  // Create the LLM model from config
  const { model, apiKey } = await createModel();

  // Read thinkingLevel from config (profile override takes precedence if set)
  const globalLlmConfig = getLLMConfig();
  const thinkingLevel = (
    resolvedProfile.llm?.thinkingLevel ?? globalLlmConfig.thinkingLevel ?? 'off'
  ) as PiThinkingLevel;

  // Build tools filtered by the profile's tool allowlist
  const tools = await getToolsForProfile(resolvedProfile);

  // Build the effective trust policy based on configured risk level,
  // then merge with profile-specific overrides
  const configRiskLevel = readConfig().riskLevel ?? 'medium';
  const baseTrustPolicy = RISK_TRUST_POLICIES[configRiskLevel as RiskLevel] ?? RISK_TRUST_POLICIES.medium;
  const overrides = resolvedProfile.trustOverrides ?? {};
  const effectiveTrustPolicy: Record<string, TrustLevel> = { ...baseTrustPolicy };
  for (const [tool, level] of Object.entries(overrides)) {
    if (level !== undefined) {
      effectiveTrustPolicy[tool] = level;
    }
  }

  // Track the current confirmation handler
  let confirmationHandler = getConfirmation;

  // Use the profile's system prompt, augmented with known failure patterns from experience log
  const knownIssues = buildKnownIssuesText(summarizeRecentFailures());
  let systemPrompt = resolvedProfile.systemPrompt + knownIssues;

  // For Chief profile, inject the current specialist list
  if (resolvedProfile.role === 'chief') {
    const specialists = getEnabledSpecialistProfiles();
    if (specialists.length > 0) {
      const specialistList = specialists
        .map((s) => {
          const isRemote = s.role === 'remote';
          const remoteTag = isRemote ? ' (远程)' : '';
          const desc = isRemote && s.a2a?.agentCard?.description
            ? s.a2a.agentCard.description
            : `tools [${s.toolNames.join(', ')}]`;
          return `- **${s.name}**${remoteTag} (id: "${s.id}", role: "${s.role}"): ${desc}`;
        })
        .join('\n');
      systemPrompt += `\n\n**Currently available specialists:**\n${specialistList}`;
    }
  }

  // Track state for event handling
  let turnCounter = 0;
  const toolStartTimes = new Map<string, number>();
  const toolStartArgs = new Map<string, Record<string, unknown>>();

  // Build the backend configuration
  const backendConfig: BackendConfig = {
    systemPrompt,
    model,
    apiKey,
    thinkingLevel,
    tools,
    toolExecution: 'sequential',
    streamFn: await loadStreamFn(),
    getApiKey: async (_provider: string) => apiKey,
    beforeToolCall: async (context: unknown, signal: AbortSignal | undefined) => {
      const ctx = context as {
        toolCall: { name: string; id: string };
        args: unknown;
      };
      const toolName = ctx.toolCall.name;
      const trustLevel = effectiveTrustPolicy[toolName] ?? TrustLevel.CONFIRM_ONCE;
      const args = ctx.args as Record<string, unknown>;

      if (trustLevel === TrustLevel.AUTO) {
        return undefined;
      }

      // Race the confirmation against abort signal so we don't block on a dead run
      const approved = await Promise.race([
        confirmationHandler(
          ctx.toolCall.id,
          toolName,
          args
        ),
        new Promise<boolean>((resolve) => {
          if (signal?.aborted) {
            resolve(false);
            return;
          }
          const onAbort = () => resolve(false);
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);

      if (!approved) {
        return { block: true, reason: 'User denied the tool call.' };
      }

      return undefined;
    },
  };

  // Create the backend via the factory
  const backend: AgentBackend = await createBackend(resolvedProfile.backend, backendConfig);

  // Restore session history if available
  if (sessionStore && sessionId) {
    try {
      const restored = sessionStore.restoreMessages(sessionId);
      if (restored.length > 0) {
        backend.setMessages(restored);
        console.log(`[runtime] Restored ${restored.length} messages for session ${sessionId}`);
      }
    } catch (err) {
      console.error('[runtime] Failed to restore session messages:', err);
    }
  }

  // Subscribe to backend events and forward to renderer / EventBus / etc.
  backend.subscribe((event: BackendEvent) => {
    handleBackendEvent(event, onEvent, eventBus, sessionStore, sessionId, toolStartTimes, toolStartArgs, (turn: number) => {
      turnCounter = turn;
    }, () => turnCounter);
  });

  // Restore persisted scheduled tasks and wire up the fire callback
  setScheduleFireCallback((promptText: string) => {
    backend.prompt(promptText).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Scheduled task prompt failed: ${errorMessage}`);
    });
  });
  restoreSchedules();

  return {
    async prompt(text: string): Promise<string> {
      // Persist user message before sending to agent
      if (sessionStore && sessionId) {
        try {
          sessionStore.appendMessage(sessionId, 'user', {
            role: 'user',
            content: [{ type: 'text', text }],
          });
        } catch (err) {
          console.error('[runtime] Failed to persist user message:', err);
        }
      }
      const result = await backend.prompt(text);
      return result;
    },

    abort(): void {
      backend.abort();
    },

    setConfirmationHandler(handler: ConfirmationHandler): void {
      confirmationHandler = handler;
    },

    dispose(): void {
      backend.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Backend event handler
// ---------------------------------------------------------------------------

/**
 * Handle a unified BackendEvent, forwarding to renderer, EventBus, etc.
 *
 * This is the shared event handling logic that was previously inline in
 * the pi-agent-core event subscription. Now it operates on the engine-
 * agnostic BackendEvent format.
 */
function handleBackendEvent(
  event: BackendEvent,
  onEvent: AgentEventCallback,
  eventBus: EventBus | undefined,
  sessionStore: SessionStore | undefined,
  sessionId: string | undefined,
  toolStartTimes: Map<string, number>,
  toolStartArgs: Map<string, Record<string, unknown>>,
  setTurnCounter: (turn: number) => void,
  getTurnCounter: () => number,
): void {
  switch (event.type) {
    case BackendEventType.START:
      onEvent({ type: 'state-change', state: AgentState.GREETING });
      eventBus?.emit(AgentEvents.AGENT_START);
      break;

    case BackendEventType.MESSAGE_START:
      onEvent({
        type: 'chat-message',
        chatMessage: {
          id: event.id,
          role: event.role,
          content: event.text,
          streaming: true,
        },
      });
      eventBus?.emit(AgentEvents.MESSAGE_START, { id: event.id, role: event.role, text: event.text });
      break;

    case BackendEventType.MESSAGE_DELTA:
      onEvent({
        type: 'chat-message-update',
        chatDelta: {
          id: event.id,
          delta: event.delta,
        },
      });
      eventBus?.emit(AgentEvents.MESSAGE_DELTA, { id: event.id, delta: event.delta });
      break;

    case BackendEventType.THINKING_DELTA:
      onEvent({
        type: 'chat-thinking',
        chatThinking: {
          id: event.id,
          delta: event.delta,
        },
      });
      // Thinking deltas are not emitted to EventBus currently
      break;

    case BackendEventType.MESSAGE_END:
      if (event.hasToolCalls) {
        onEvent({
          type: 'chat-message-end',
          chatEnd: { id: event.id },
        });
        onEvent({
          type: 'state-change',
          state: AgentState.EXECUTING,
        });
      } else {
        onEvent({
          type: 'chat-message-end',
          chatEnd: { id: event.id },
        });
      }
      eventBus?.emit(AgentEvents.MESSAGE_END, {
        id: event.id,
        role: event.role,
        content: event.text,
        hasToolCalls: event.hasToolCalls,
      });
      // Persist assistant message to session store
      if (sessionStore && sessionId) {
        try {
          sessionStore.appendMessage(sessionId, 'assistant', event.rawMessage);
        } catch (err) {
          console.error('[runtime] Failed to persist assistant message:', err);
        }
      }
      break;

    case BackendEventType.TOOL_START:
      toolStartTimes.set(event.toolCallId, Date.now());
      toolStartArgs.set(event.toolCallId, event.args);
      onEvent({
        type: 'tool-execution',
        toolExecution: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'running',
          args: event.args,
        },
      });
      eventBus?.emit(AgentEvents.TOOL_START, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
      break;

    case BackendEventType.TOOL_UPDATE:
      onEvent({
        type: 'tool-execution',
        toolExecution: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'running',
          partialResult: event.partialResult,
        },
      });
      eventBus?.emit(AgentEvents.TOOL_UPDATE, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      });
      break;

    case BackendEventType.TOOL_END: {
      const startTime = toolStartTimes.get(event.toolCallId);
      const duration = event.duration ?? (startTime ? Date.now() - startTime : undefined);
      const toolArgs = event.args ?? toolStartArgs.get(event.toolCallId);
      toolStartTimes.delete(event.toolCallId);
      toolStartArgs.delete(event.toolCallId);
      onEvent({
        type: 'tool-execution',
        toolExecution: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? 'error' : 'done',
          result: event.resultText,
          duration,
        },
      });

      // Record tool execution outcome to experience log
      recordExperience({
        ts: new Date().toISOString(),
        tool: event.toolName,
        ok: !event.isError,
        ms: duration ?? 0,
        ...(event.isError && event.resultText ? { err: event.resultText } : {}),
        ...(event.isError && toolArgs ? { args: toolArgs } : {}),
      });

      eventBus?.emit(AgentEvents.TOOL_END, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        result: event.resultText,
        duration,
      });
      break;
    }

    case BackendEventType.END:
      eventBus?.emit(AgentEvents.AGENT_END, {
        stopReason: event.stopReason,
      });
      if (event.stopReason === 'error' || event.stopReason === 'aborted') {
        onEvent({ type: 'state-change', state: AgentState.FAILED });
        setTimeout(() => {
          onEvent({ type: 'state-change', state: AgentState.IDLE });
        }, 2000);
      } else {
        onEvent({ type: 'state-change', state: AgentState.SUCCESS });
        setTimeout(() => {
          onEvent({ type: 'state-change', state: AgentState.IDLE });
        }, 2000);
      }
      break;

    case BackendEventType.TURN_START: {
      const turn = getTurnCounter() + 1;
      setTurnCounter(turn);
      onEvent({
        type: 'turn-indicator',
        turnIndicator: { turn, event: 'start' },
      });
      eventBus?.emit(AgentEvents.STATE_CHANGE, { turn, event: 'turn_start' });
      break;
    }

    case BackendEventType.TURN_END: {
      const turn = getTurnCounter();
      onEvent({
        type: 'turn-indicator',
        turnIndicator: { turn, event: 'end' },
      });
      eventBus?.emit(AgentEvents.STATE_CHANGE, { turn, event: 'turn_end' });
      break;
    }

    case BackendEventType.ERROR:
      console.error(`[runtime] Backend error: ${event.error}`);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load the streamSimple function from pi-ai for use in BackendConfig.
 * Caches the module so repeated calls do not re-import.
 */
let cachedStreamFn: unknown | null = null;

async function loadStreamFn(): Promise<unknown> {
  if (cachedStreamFn !== null) return cachedStreamFn;
  const dynamicImport = new Function('modulePath', 'return import(modulePath)') as <T>(
    modulePath: string
  ) => Promise<T>;
  const ai = await dynamicImport<typeof import('@earendil-works/pi-ai')>('@earendil-works/pi-ai');
  cachedStreamFn = ai.streamSimple;
  return cachedStreamFn;
}
