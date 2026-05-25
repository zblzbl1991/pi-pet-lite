/**
 * Agent-to-agent direct messaging tools.
 *
 * send_message:   Send a direct message from the current agent to another agent.
 * check_inbox:    Check the current agent's inbox for unread messages.
 *
 * These tools use the PetManager injection pattern (same as delegate.ts)
 * to avoid circular dependencies with agent-process.
 *
 * Per R5: Remote (A2A) agents cannot use direct messaging.
 */

import { Type } from 'typebox';
import { getEnabledSpecialistProfiles } from '../profiles';
import type { PetManager } from '../pet-manager';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    details: { error: true, ...details },
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// PetManager injection (avoids circular dependency with agent-process)
// ---------------------------------------------------------------------------

let petManagerInstance: PetManager | null = null;

/**
 * Inject the PetManager instance so messaging tools can access it.
 * Called once during agent-process initialization.
 */
export function setPetManagerForMessaging(pm: PetManager): void {
  petManagerInstance = pm;
}

/**
 * Get the injected PetManager. Throws if not set.
 */
function getPetManager(): PetManager {
  if (!petManagerInstance) {
    throw new Error('PetManager not initialized for messaging tools');
  }
  return petManagerInstance;
}

/** The petId of the current agent (set by agent-process at tool registration time) */
let currentPetId: string = '';

/**
 * Set the current pet's ID for messaging tool context.
 * Called by agent-process when creating tools for a specific pet.
 */
export function setCurrentPetId(petId: string): void {
  currentPetId = petId;
}

/**
 * Get the current pet ID. Falls back to 'chief' for backward compat.
 */
function getCurrentPetId(): string {
  return currentPetId || 'chief';
}

// ---------------------------------------------------------------------------
// Dynamic description for send_message
// ---------------------------------------------------------------------------

function buildSendMessageDescription(): string {
  const specialists = getEnabledSpecialistProfiles();
  const parts = specialists.map((p) => `"${p.role}" (${p.name})`);
  const targets = parts.length > 0 ? `Available agents: ${parts.join(', ')}. ` : '';

  return (
    'Send a direct message to another agent without going through Chief. ' +
    'Use this to ask questions, share information, or notify other agents. ' +
    targets +
    'The message will appear in the target agent\'s inbox immediately. ' +
    'For large data, use write_blackboard instead and send a notification here.'
  );
}

// ---------------------------------------------------------------------------
// Tool: send_message
// ---------------------------------------------------------------------------

function buildSendMessageTool(): PiAgentTool {
  return {
    name: 'send_message',
    label: 'Send Message',
    description: buildSendMessageDescription(),
    parameters: Type.Object({
      to: Type.String({
        description: 'The target agent role or petId to send the message to (e.g. "coder", "scout", "analyst")',
      }),
      type: Type.String({
        description: 'Message type: "question", "answer", "notification", or a custom type',
      }),
      payload: Type.String({
        description: 'The message content. Keep it concise — max 4000 characters.',
      }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { to, type, payload } = params as {
        to: string;
        type: string;
        payload: string;
      };

      let pm: PetManager;
      try {
        pm = getPetManager();
      } catch (err: unknown) {
        return errorResult(`Cannot send message: ${getErrorMessage(err)}`, { to });
      }

      try {
        const from = getCurrentPetId();
        const message = pm.routeMessage(from, to, type, payload);

        return textResult(
          `Message sent to "${to}" (type: ${type}). Message ID: ${message.id}`,
          {
            messageId: message.id,
            from,
            to: message.to,
            type,
            timestamp: message.timestamp,
          }
        );
      } catch (err: unknown) {
        return errorResult(
          `Failed to send message: ${getErrorMessage(err)}`,
          { to, type }
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: check_inbox
// ---------------------------------------------------------------------------

function buildCheckInboxTool(): PiAgentTool {
  return {
    name: 'check_inbox',
    label: 'Check Inbox',
    description:
      'Check your inbox for messages from other agents. ' +
      'Returns a list of unread messages. Use this to see if other agents ' +
      'have sent you questions, answers, or notifications. ' +
      'By default, messages are marked as read after checking.',
    parameters: Type.Object({
      mark_read: Type.Optional(
        Type.Boolean({
          description: 'Whether to mark messages as read after checking (default: true)',
        })
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { mark_read } = params as { mark_read?: boolean };
      const shouldMarkRead = mark_read !== false;

      let pm: PetManager;
      try {
        pm = getPetManager();
      } catch (err: unknown) {
        return errorResult(`Cannot check inbox: ${getErrorMessage(err)}`);
      }

      try {
        const petId = getCurrentPetId();
        const inbox = pm.getInbox(petId);
        const unread = inbox.filter((m) => !m.read);

        if (unread.length === 0) {
          return textResult('Your inbox is empty. No unread messages.', {
            total: inbox.length,
            unread: 0,
          });
        }

        // Format messages for display
        const lines = unread.map((m, idx) => {
          const time = new Date(m.timestamp).toLocaleTimeString();
          return `[${idx + 1}] From: ${m.from} | Type: ${m.type} | Time: ${time}\n    ${m.payload}`;
        });

        const summary = `You have ${unread.length} unread message(s):\n\n${lines.join('\n\n')}`;

        if (shouldMarkRead) {
          pm.markInboxRead(petId);
        }

        return textResult(summary, {
          total: inbox.length,
          unread: unread.length,
          markedRead: shouldMarkRead,
        });
      } catch (err: unknown) {
        return errorResult(`Failed to check inbox: ${getErrorMessage(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Build messaging tools for agent-to-agent direct communication.
 */
export function buildMessagingTools(): PiAgentTool[] {
  return [
    buildSendMessageTool(),
    buildCheckInboxTool(),
  ];
}
