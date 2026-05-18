/**
 * Agent runtime for the Clawd desktop pet.
 *
 * Wraps pi-agent-core's Agent class with:
 * - LLM model creation from config
 * - Tool registration via the centralized tool registry
 * - beforeToolCall hook for trust policy enforcement
 * - Scheduled task restoration on startup
 * - Event subscription that forwards to a callback (for IPC to renderer)
 *
 * Uses dynamic import() to load ESM-only pi-agent-core from CommonJS context.
 *
 * NOTE: We avoid using namespace-qualified types (e.g. `core.AgentEvent`)
 * because the dynamic import returns a module object without module-level
 * namespace merging. Instead we define local type aliases from the imported
 * module's types.
 */

import { AgentState, TrustLevel, ThinkingLevel } from '../shared/types';
import { TRUST_POLICY } from '../shared/constants';
import { createModel } from './llm';
import { getLLMConfig } from './llm';
import { getAllTools, restoreSchedules, setScheduleFireCallback } from './tools/registry';

/** Type aliases for pi-agent-core types (resolved at runtime via dynamic import) */
type PiAgentEvent = import('@earendil-works/pi-agent-core').AgentEvent;
type PiAssistantMessage = import('@earendil-works/pi-ai').AssistantMessage;
type PiToolResultMessage = import('@earendil-works/pi-ai').ToolResultMessage;
type PiAssistantMessageEvent = import('@earendil-works/pi-ai').AssistantMessageEvent;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiThinkingLevel = import('@earendil-works/pi-agent-core').ThinkingLevel;
type PiToolExecutionMode = import('@earendil-works/pi-agent-core').ToolExecutionMode;

/** Cached dynamic imports */
let piAgentCoreModule: typeof import('@earendil-works/pi-agent-core') | null = null;
let piAiModule: typeof import('@earendil-works/pi-ai') | null = null;

/**
 * True dynamic import that bypasses TypeScript's CJS transpilation.
 * See llm.ts for explanation.
 */
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as <T>(
  modulePath: string
) => Promise<T>;

async function loadPiAgentCore() {
  if (!piAgentCoreModule) {
    piAgentCoreModule = await dynamicImport<typeof import('@earendil-works/pi-agent-core')>('@earendil-works/pi-agent-core');
  }
  return piAgentCoreModule;
}

async function loadPiAi() {
  if (!piAiModule) {
    piAiModule = await dynamicImport<typeof import('@earendil-works/pi-ai')>('@earendil-works/pi-ai');
  }
  return piAiModule;
}

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
  /** Send a user message to the agent */
  prompt(text: string): Promise<void>;
  /** Abort the current agent run */
  abort(): void;
  /** Set the handler for confirmation requests from the renderer */
  setConfirmationHandler(handler: ConfirmationHandler): void;
  /** Clean up the agent */
  dispose(): void;
}

/**
 * Extract text content from an AssistantMessage's content array.
 */
function getAssistantText(content: PiAssistantMessage['content']): string {
  return content
    .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/**
 * Extract text content from a ToolResultMessage's content array.
 * Tool results use (TextContent | ImageContent)[] which differs from AssistantMessage.
 */
function getToolResultText(content: PiToolResultMessage['content']): string {
  return content
    .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/**
 * Check if an AssistantMessage contains tool call blocks.
 */
function hasToolCalls(content: PiAssistantMessage['content']): boolean {
  return content.some((c) => c.type === 'toolCall');
}

/**
 * Initialize and return the Clawd agent runtime.
 *
 * @param onEvent - Callback for agent events forwarded to the renderer
 * @param getConfirmation - Function that sends confirmation to renderer and returns the user's response
 */
export async function createAgentRuntime(
  onEvent: AgentEventCallback,
  getConfirmation: ConfirmationHandler
): Promise<AgentRuntime> {
  const core = await loadPiAgentCore();
  const ai = await loadPiAi();

  // Create the LLM model from config
  const { model, apiKey } = await createModel();

  // Read thinkingLevel from config
  const llmConfig = getLLMConfig();
  const thinkingLevel = (llmConfig.thinkingLevel || 'off') as PiThinkingLevel;

  // Build tools from the centralized registry
  // getAllTools() is async because it dynamically imports pi-coding-agent (ESM-only)
  const tools = await getAllTools();

  // Track the current confirmation handler
  let confirmationHandler = getConfirmation;

  // System prompt for Clawd
  const systemPrompt = `You are Clawd, a helpful desktop AI assistant in the form of a cat character.
You help users complete tasks on their computer. You can read and write files, edit files,
list directories, search for files and text patterns, execute shell commands, manage scheduled tasks,
and automate web browser actions (navigate, click, type, screenshot, read page content).
Be concise, friendly, and helpful.

When a user asks you to do something, use the available tools to accomplish the task.
If you need clarification, ask the user. Always explain what you're doing.`;

  // Track streaming message IDs for the renderer
  let currentAssistantMessageId: string | null = null;
  let currentThinkingId: string | null = null;
  let messageCounter = 0;
  let turnCounter = 0;
  const toolStartTimes = new Map<string, number>();

  // Create the Agent
  const agent = new core.Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
      messages: [],
    },
    streamFn: ai.streamSimple,
    getApiKey: async (_provider: string) => apiKey,
    toolExecution: 'sequential' as PiToolExecutionMode,
    beforeToolCall: async (context, signal) => {
      const toolName = context.toolCall.name;
      const trustLevel = TRUST_POLICY[toolName] ?? TrustLevel.CONFIRM_ONCE;
      const args = context.args as Record<string, unknown>;

      if (trustLevel === TrustLevel.AUTO) {
        // Allow execution without confirmation
        return undefined;
      }

      // Race the confirmation against abort signal so we don't block on a dead run
      const approved = await Promise.race([
        confirmationHandler(
          context.toolCall.id,
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
  });

  // Subscribe to agent events and forward to renderer
  agent.subscribe((event: PiAgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        onEvent({ type: 'state-change', state: AgentState.GREETING });
        break;

      case 'message_start': {
        const msg = event.message;
        if (msg.role === 'assistant') {
          const assistantMsg = msg as PiAssistantMessage;
          currentAssistantMessageId = `msg-${++messageCounter}-${Date.now()}`;
          const text = getAssistantText(assistantMsg.content);
          onEvent({
            type: 'chat-message',
            chatMessage: {
              id: currentAssistantMessageId,
              role: 'assistant',
              content: text,
              streaming: true,
            },
          });
        }
        break;
      }

      case 'message_update': {
        if (currentAssistantMessageId) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta' && 'delta' in ame) {
            onEvent({
              type: 'chat-message-update',
              chatDelta: {
                id: currentAssistantMessageId,
                delta: (ame as Extract<PiAssistantMessageEvent, { type: 'text_delta' }>).delta,
              },
            });
          } else if (ame.type === 'thinking_delta' && 'delta' in ame) {
            // Forward thinking delta
            if (!currentThinkingId) {
              currentThinkingId = currentAssistantMessageId;
            }
            onEvent({
              type: 'chat-thinking',
              chatThinking: {
                id: currentThinkingId,
                delta: (ame as { type: 'thinking_delta'; delta: string }).delta,
              },
            });
          }
        }
        break;
      }

      case 'message_end': {
        const msg = event.message;
        if (msg.role === 'assistant' && currentAssistantMessageId) {
          const assistantMsg = msg as PiAssistantMessage;
          if (hasToolCalls(assistantMsg.content)) {
            onEvent({
              type: 'chat-message-end',
              chatEnd: { id: currentAssistantMessageId },
            });
            onEvent({
              type: 'state-change',
              state: AgentState.EXECUTING,
            });
          } else {
            onEvent({
              type: 'chat-message-end',
              chatEnd: { id: currentAssistantMessageId },
            });
          }
          currentAssistantMessageId = null;
          currentThinkingId = null;
        }
        // Tool result messages are no longer forwarded as chat messages;
        // they appear in the ToolCardEntry via tool_execution_end instead.
        break;
      }

      case 'tool_execution_start':
        toolStartTimes.set(event.toolCallId, Date.now());
        onEvent({
          type: 'tool-execution',
          toolExecution: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            args: event.args as Record<string, unknown>,
          },
        });
        break;

      case 'tool_execution_end': {
        const result = event.result as PiAgentToolResult | undefined;
        const resultContent = result?.content;
        const resultText = resultContent
          ?.filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
          ?.map((c) => c.text)
          ?.join('') ?? '';
        const startTime = toolStartTimes.get(event.toolCallId);
        const duration = startTime ? Date.now() - startTime : undefined;
        toolStartTimes.delete(event.toolCallId);
        onEvent({
          type: 'tool-execution',
          toolExecution: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: event.isError ? 'error' : 'done',
            result: resultText,
            duration,
          },
        });
        break;
      }

      case 'tool_execution_update': {
        // Forward partial result updates
        const partial = (event as { partialResult?: unknown }).partialResult;
        onEvent({
          type: 'tool-execution',
          toolExecution: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            partialResult: typeof partial === 'string' ? partial : JSON.stringify(partial),
          },
        });
        break;
      }

      case 'agent_end': {
        const msgs = event.messages;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && 'stopReason' in lastMsg) {
          const stopReason = (lastMsg as PiAssistantMessage).stopReason;
          if (stopReason === 'error' || stopReason === 'aborted') {
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
        } else {
          // No messages or last message is not an assistant message; treat as success
          onEvent({ type: 'state-change', state: AgentState.SUCCESS });
          setTimeout(() => {
            onEvent({ type: 'state-change', state: AgentState.IDLE });
          }, 2000);
        }
        break;
      }

      case 'turn_start':
        turnCounter++;
        onEvent({
          type: 'turn-indicator',
          turnIndicator: { turn: turnCounter, event: 'start' },
        });
        break;

      case 'turn_end':
        onEvent({
          type: 'turn-indicator',
          turnIndicator: { turn: turnCounter, event: 'end' },
        });
        break;

      default:
        break;
    }
  });

  // Restore persisted scheduled tasks and wire up the fire callback
  setScheduleFireCallback((promptText: string) => {
    // Send the prompt to the agent as if the user typed it
    agent.prompt(promptText).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Scheduled task prompt failed: ${errorMessage}`);
    });
  });
  restoreSchedules();

  return {
    async prompt(text: string): Promise<void> {
      await agent.prompt(text);
    },

    abort(): void {
      agent.abort();
    },

    setConfirmationHandler(handler: ConfirmationHandler): void {
      confirmationHandler = handler;
    },

    dispose(): void {
      agent.abort();
      agent.reset();
    },
  };
}
