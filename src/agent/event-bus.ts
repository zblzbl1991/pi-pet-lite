/**
 * Lightweight event bus for the agent utility process.
 *
 * Node.js EventEmitter is not available in Electron utility processes,
 * so this provides a minimal pub/sub implementation with:
 * - try-catch isolation per handler (one failing handler won't break others)
 * - unsubscribe functions returned from on/once
 * - removeAllListeners for clean shutdown
 */

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const AgentEvents = {
  // Agent lifecycle
  AGENT_START: 'agent:start',
  AGENT_END: 'agent:end',
  STATE_CHANGE: 'agent:state-change',

  // LLM messages
  MESSAGE_START: 'message:start',
  MESSAGE_DELTA: 'message:delta',
  MESSAGE_END: 'message:end',

  // Tool execution
  TOOL_START: 'tool:start',
  TOOL_UPDATE: 'tool:update',
  TOOL_END: 'tool:end',

  // Session lifecycle
  SESSION_CREATED: 'session:created',
  SESSION_RESTORED: 'session:restored',
  SESSION_DISPOSED: 'session:disposed',
} as const;

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

type Handler = (payload: unknown) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  /**
   * Emit an event. All registered handlers are called synchronously.
   * Each handler is try-caught so a failing handler does not affect others.
   */
  emit(event: string, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[event-bus] handler error on "${event}":`, err);
      }
    }
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /**
   * Subscribe to an event once. Auto-unsubscribes after first call.
   */
  once(event: string, handler: Handler): () => void {
    const wrapper: Handler = (payload) => {
      unsub();
      handler(payload);
    };
    const unsub = this.on(event, wrapper);
    return unsub;
  }

  /**
   * Remove a specific handler for an event.
   */
  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * Remove all handlers for a specific event, or all events if no event specified.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
