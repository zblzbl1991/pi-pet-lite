/**
 * PiAgentBackend — AgentBackend implementation wrapping pi-agent-core.
 *
 * Encapsulates:
 * - Creating the pi-agent-core Agent instance
 * - Subscribing to PiAgentEvent and converting to BackendEvent
 * - prompt(), abort(), dispose(), subscribe(), state access
 *
 * This is the default backend when no other is specified.
 */

import type {
  AgentBackend,
  BackendEvent,
  BackendConfig,
} from './types';
import {
  BackendEventType,
} from './types';

/** Type aliases for pi-agent-core types (resolved at runtime via dynamic import) */
type PiAgentEvent = import('@earendil-works/pi-agent-core').AgentEvent;
type PiAssistantMessage = import('@earendil-works/pi-ai').AssistantMessage;
type PiAssistantMessageEvent = import('@earendil-works/pi-ai').AssistantMessageEvent;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgent = import('@earendil-works/pi-agent-core').Agent;
type PiToolExecutionMode = import('@earendil-works/pi-agent-core').ToolExecutionMode;

/** Cached dynamic import */
let piAgentCoreModule: typeof import('@earendil-works/pi-agent-core') | null = null;

/**
 * True dynamic import that bypasses TypeScript's CJS transpilation.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Check if an AssistantMessage contains tool call blocks.
 */
function hasToolCalls(content: PiAssistantMessage['content']): boolean {
  return content.some((c) => c.type === 'toolCall');
}

// ---------------------------------------------------------------------------
// PiAgentBackend
// ---------------------------------------------------------------------------

export class PiAgentBackend implements AgentBackend {
  private agent: PiAgent;
  private subscribers: Set<(event: BackendEvent) => void> = new Set();

  // Streaming state tracking for event conversion
  private currentAssistantMessageId: string | null = null;
  private messageCounter = 0;
  private lastAssistantText = '';

  constructor(config: BackendConfig) {
    const core = PiAgentBackend._core;
    if (!core) {
      throw new Error('PiAgentBackend: core module not set. Call PiAgentBackend.setModules() first.');
    }

    // Build the pi-agent-core AgentOptions from BackendConfig fields.
    // We cast individual fields to match pi-agent-core's expected types.
    this.agent = new core.Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        model: config.model as import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>,
        thinkingLevel: config.thinkingLevel as import('@earendil-works/pi-agent-core').ThinkingLevel,
        tools: config.tools as import('@earendil-works/pi-agent-core').AgentTool[],
        messages: [],
      },
      streamFn: config.streamFn as import('@earendil-works/pi-agent-core').StreamFn,
      getApiKey: config.getApiKey as (provider: string) => Promise<string | undefined>,
      toolExecution: config.toolExecution as PiToolExecutionMode,
      beforeToolCall: config.beforeToolCall as import('@earendil-works/pi-agent-core').AgentOptions['beforeToolCall'],
    });

    // Subscribe to pi-agent-core events and convert to BackendEvent
    this.agent.subscribe((event: PiAgentEvent) => {
      const backendEvents = this.convertEvent(event);
      for (const be of backendEvents) {
        for (const handler of this.subscribers) {
          try {
            handler(be);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[pi-agent-backend] subscriber error:`, msg);
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Static module registry (set by factory before instantiation)
  // -------------------------------------------------------------------------

  private static _core: typeof import('@earendil-works/pi-agent-core') | null = null;

  static setModules(
    core: typeof import('@earendil-works/pi-agent-core')
  ): void {
    PiAgentBackend._core = core;
  }

  // -------------------------------------------------------------------------
  // AgentBackend interface
  // -------------------------------------------------------------------------

  async prompt(text: string): Promise<string> {
    this.lastAssistantText = '';
    await this.agent.prompt(text);
    return this.lastAssistantText;
  }

  abort(): void {
    this.agent.abort();
  }

  dispose(): void {
    this.agent.abort();
    this.agent.reset();
    this.subscribers.clear();
  }

  subscribe(handler: (event: BackendEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  get state() {
    return {
      messages: this.agent.state.messages as unknown[],
      isStreaming: false,
    };
  }

  setMessages(messages: unknown[]): void {
    // Cast: messages are restored from session store in pi-agent-core message format
    (this.agent.state as { messages: unknown[] }).messages = messages;
  }

  // -------------------------------------------------------------------------
  // Event conversion: PiAgentEvent -> BackendEvent[]
  // -------------------------------------------------------------------------

  private convertEvent(event: PiAgentEvent): BackendEvent[] {
    const results: BackendEvent[] = [];

    switch (event.type) {
      case 'agent_start':
        results.push({ type: BackendEventType.START });
        break;

      case 'message_start': {
        const msg = event.message;
        if (msg.role === 'assistant') {
          const assistantMsg = msg as PiAssistantMessage;
          const id = `msg-${++this.messageCounter}-${Date.now()}`;
          this.currentAssistantMessageId = id;
          const text = getAssistantText(assistantMsg.content);
          results.push({
            type: BackendEventType.MESSAGE_START,
            id,
            role: 'assistant',
            text,
          });
        }
        break;
      }

      case 'message_update': {
        if (!this.currentAssistantMessageId) break;
        const ame = event.assistantMessageEvent;
        if (ame.type === 'text_delta' && 'delta' in ame) {
          const delta = (ame as Extract<PiAssistantMessageEvent, { type: 'text_delta' }>).delta;
          results.push({
            type: BackendEventType.MESSAGE_DELTA,
            id: this.currentAssistantMessageId,
            delta,
          });
        } else if (ame.type === 'thinking_delta' && 'delta' in ame) {
          const delta = (ame as { type: 'thinking_delta'; delta: string }).delta;
          results.push({
            type: BackendEventType.THINKING_DELTA,
            id: this.currentAssistantMessageId,
            delta,
          });
        }
        break;
      }

      case 'message_end': {
        const msg = event.message;
        if (msg.role === 'assistant' && this.currentAssistantMessageId) {
          const assistantMsg = msg as PiAssistantMessage;
          const id = this.currentAssistantMessageId;
          results.push({
            type: BackendEventType.MESSAGE_END,
            id,
            role: 'assistant',
            text: getAssistantText(assistantMsg.content),
            hasToolCalls: hasToolCalls(assistantMsg.content),
            rawMessage: assistantMsg,
          });
          this.currentAssistantMessageId = null;
        }
        break;
      }

      case 'tool_execution_start':
        results.push({
          type: BackendEventType.TOOL_START,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args as Record<string, unknown>,
        });
        break;

      case 'tool_execution_end': {
        const result = event.result as PiAgentToolResult | undefined;
        const resultContent = result?.content;
        const resultText = resultContent
          ?.filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
          ?.map((c) => c.text)
          ?.join('') ?? '';
        results.push({
          type: BackendEventType.TOOL_END,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          resultText,
          duration: undefined,
          args: undefined,
        });
        break;
      }

      case 'tool_execution_update': {
        const partial = (event as { partialResult?: unknown }).partialResult;
        const partialStr = typeof partial === 'string' ? partial : JSON.stringify(partial);
        results.push({
          type: BackendEventType.TOOL_UPDATE,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          partialResult: partialStr,
        });
        break;
      }

      case 'agent_end': {
        const msgs = event.messages;
        const lastMsg = msgs[msgs.length - 1];
        let stopReason = 'ok';
        let lastText = '';

        if (lastMsg && lastMsg.role === 'assistant') {
          const assistantMsg = lastMsg as PiAssistantMessage;
          lastText = getAssistantText(assistantMsg.content);
          if ('stopReason' in assistantMsg) {
            stopReason = assistantMsg.stopReason ?? 'ok';
          }
        }

        this.lastAssistantText = lastText;

        results.push({
          type: BackendEventType.END,
          stopReason,
          lastAssistantText: lastText,
        });
        break;
      }

      case 'turn_start':
        results.push({ type: BackendEventType.TURN_START });
        break;

      case 'turn_end':
        results.push({ type: BackendEventType.TURN_END });
        break;

      default:
        break;
    }

    return results;
  }
}

/**
 * Create a PiAgentBackend with async module loading.
 *
 * This is the async factory that loads pi-agent-core before
 * constructing the backend. The streamFn is passed via BackendConfig
 * and loaded separately by the runtime.
 */
export async function createPiAgentBackend(config: BackendConfig): Promise<PiAgentBackend> {
  const core = await loadPiAgentCore();
  PiAgentBackend.setModules(core);
  return new PiAgentBackend(config);
}
