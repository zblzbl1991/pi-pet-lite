/**
 * Delegation and blackboard tools for the Chief coordinator profile.
 *
 * delegate_task:   Chief delegates a subtask to a specialist pet (Coder/Scout/Analyst).
 * read_blackboard: Chief reads shared context from the blackboard store.
 * write_blackboard: Chief writes shared context to the blackboard store.
 *
 * v1: Serial delegation only. Each delegated task runs one at a time with a
 * 5-minute timeout and single-retry fallback on failure.
 *
 * The PetManager singleton is injected via setPetManagerForDelegation() so
 * these tools can access the delegation API without importing the agent-process
 * module (which would create a circular dependency).
 */

import { Type } from 'typebox';
import { PetRole } from '../../shared/types';
import { DELEGATION_TIMEOUT_MS } from '../../shared/constants';
import { getBlackboardStore } from '../../storage/blackboard';
import type { PetManager } from '../pet-manager';
import type { TaskResult } from '../task-queue';

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
 * Inject the PetManager instance so delegate_task can access it.
 * Called once during agent-process initialization.
 */
export function setPetManagerForDelegation(pm: PetManager): void {
  petManagerInstance = pm;
}

/**
 * Get the injected PetManager. Throws if not set.
 */
function getPetManager(): PetManager {
  if (!petManagerInstance) {
    throw new Error('PetManager not initialized for delegation tools');
  }
  return petManagerInstance;
}

// ---------------------------------------------------------------------------
// Delegate timeout helper
// ---------------------------------------------------------------------------

/**
 * Race a delegation promise against a timeout.
 * Returns the TaskResult on success, or a timeout error result.
 */
function withTimeout(
  promise: Promise<TaskResult>,
  timeoutMs: number,
  role: string
): Promise<TaskResult> {
  return new Promise<TaskResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        success: false,
        output: `Delegation to ${role} timed out after ${timeoutMs / 1000} seconds. The specialist pet did not complete the task in time.`,
        durationMs: timeoutMs,
      });
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: getErrorMessage(err),
          durationMs: 0,
        });
      });
  });
}

// ---------------------------------------------------------------------------
// Role validation
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set<string>([PetRole.CODER, PetRole.SCOUT, PetRole.ANALYST]);

function validateRole(role: string): string | null {
  if (!VALID_ROLES.has(role)) {
    return `Invalid target role "${role}". Must be one of: coder, scout, analyst.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool: delegate_task
// ---------------------------------------------------------------------------

function buildDelegateTaskTool(): PiAgentTool {
  return {
    name: 'delegate_task',
    label: 'Delegate Task',
    description:
      'Delegate a subtask to a specialist pet. ' +
      'Use "coder" for writing/editing code and running commands, ' +
      '"scout" for web browsing and information gathering, ' +
      '"analyst" for reading files, data analysis, and summarization. ' +
      'The specialist will execute the task and return the result. ' +
      'Tasks are processed one at a time (serial). If the specialist fails, ' +
      'a single retry is attempted automatically.',
    parameters: Type.Object({
      target_role: Type.String({
        description: 'The specialist pet role to delegate to: "coder", "scout", or "analyst"',
      }),
      task_description: Type.String({
        description: 'Clear, detailed description of the subtask for the specialist to execute',
      }),
      context_refs: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Optional blackboard keys to include as context for the specialist. The values of these keys will be appended to the task description.',
        })
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { target_role, task_description, context_refs } = params as {
        target_role: string;
        task_description: string;
        context_refs?: string[];
      };

      // Validate role
      const roleError = validateRole(target_role);
      if (roleError) {
        return errorResult(roleError, { target_role });
      }

      let pm: PetManager;
      try {
        pm = getPetManager();
      } catch (err: unknown) {
        return errorResult(
          `Cannot delegate: ${getErrorMessage(err)}`,
          { target_role }
        );
      }

      // Build the full prompt with optional context from blackboard
      let fullPrompt = task_description;
      if (context_refs && context_refs.length > 0) {
        const store = getBlackboardStore();
        const contextParts: string[] = [];
        for (const key of context_refs) {
          const entry = store.get('global', key);
          if (entry) {
            contextParts.push(`[${key}]: ${entry.value}`);
          }
        }
        if (contextParts.length > 0) {
          fullPrompt += '\n\n--- Context ---\n' + contextParts.join('\n\n');
        }
      }

      // Check if the target pet is already busy
      const status = pm.getStatus(target_role);
      if (status === 'busy') {
        return errorResult(
          `Cannot delegate to ${target_role}: the specialist is currently busy with another task. Please wait and try again.`,
          { target_role, status }
        );
      }

      // First attempt
      try {
        const result = await withTimeout(
          pm.delegate(target_role, fullPrompt),
          DELEGATION_TIMEOUT_MS,
          target_role
        );

        if (result.success) {
          return textResult(
            `${target_role} completed the task successfully.\n\nResult: ${result.output}`,
            {
              target_role,
              success: true,
              durationMs: result.durationMs,
            }
          );
        }

        // First attempt failed -- retry once
        const retryResult = await withTimeout(
          pm.delegate(target_role, fullPrompt),
          DELEGATION_TIMEOUT_MS,
          target_role
        );

        if (retryResult.success) {
          return textResult(
            `${target_role} completed the task on retry.\n\nResult: ${retryResult.output}`,
            {
              target_role,
              success: true,
              retried: true,
              durationMs: retryResult.durationMs,
            }
          );
        }

        // Both attempts failed
        return errorResult(
          `${target_role} failed to complete the task after two attempts.\n\nLast error: ${retryResult.output}\n\nConsider breaking the task into smaller pieces or trying a different approach.`,
          {
            target_role,
            success: false,
            retried: true,
            lastError: retryResult.output,
          }
        );
      } catch (err: unknown) {
        return errorResult(
          `Delegation to ${target_role} failed: ${getErrorMessage(err)}`,
          { target_role, error: getErrorMessage(err) }
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: read_blackboard
// ---------------------------------------------------------------------------

function buildReadBlackboardTool(): PiAgentTool {
  return {
    name: 'read_blackboard',
    label: 'Read Blackboard',
    description:
      'Read a value from the shared blackboard store by key. ' +
      'Use this to retrieve context written by other pets or by yourself. ' +
      'Returns the value, creation time, and last update time.',
    parameters: Type.Object({
      key: Type.String({
        description: 'The blackboard key to read',
      }),
      namespace: Type.Optional(
        Type.String({
          description: 'Namespace to read from (default: "global")',
        })
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { key, namespace } = params as { key: string; namespace?: string };
      const ns = namespace ?? 'global';

      try {
        const store = getBlackboardStore();
        const entry = store.get(ns, key);

        if (!entry) {
          return textResult(
            `No entry found for key "${key}" in namespace "${ns}".`,
            { key, namespace: ns, found: false }
          );
        }

        return textResult(
          `Key: ${entry.key}\nValue: ${entry.value}\nCreated: ${new Date(entry.createdAt).toISOString()}\nUpdated: ${new Date(entry.updatedAt).toISOString()}${entry.expiresAt ? `\nExpires: ${new Date(entry.expiresAt).toISOString()}` : ''}`,
          { key, namespace: ns, found: true, value: entry.value }
        );
      } catch (err: unknown) {
        return errorResult(
          `Failed to read blackboard: ${getErrorMessage(err)}`,
          { key, namespace: ns }
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: write_blackboard
// ---------------------------------------------------------------------------

function buildWriteBlackboardTool(): PiAgentTool {
  return {
    name: 'write_blackboard',
    label: 'Write Blackboard',
    description:
      'Write a key-value pair to the shared blackboard store. ' +
      'Use this to share context between yourself and specialist pets. ' +
      'Specialist pets can read these values during their tasks. ' +
      'Values can optionally have a TTL (time-to-live) in milliseconds.',
    parameters: Type.Object({
      key: Type.String({
        description: 'The blackboard key to write',
      }),
      value: Type.String({
        description: 'The value to store. Use JSON strings for structured data.',
      }),
      ttl_ms: Type.Optional(
        Type.Number({
          description: 'Optional time-to-live in milliseconds. Entry expires after this duration.',
        })
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { key, value, ttl_ms } = params as { key: string; value: string; ttl_ms?: number };

      try {
        const store = getBlackboardStore();
        // Chief writes to the 'global' namespace so all pets can read it
        store.set('global', key, value, ttl_ms ? { ttlMs: ttl_ms } : undefined);

        return textResult(
          `Successfully wrote to blackboard: "${key}"`,
          { key, namespace: 'global', ttl_ms: ttl_ms ?? null }
        );
      } catch (err: unknown) {
        return errorResult(
          `Failed to write blackboard: ${getErrorMessage(err)}`,
          { key }
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Build all delegation and blackboard tools for the Chief profile.
 */
export function buildDelegateTools(): PiAgentTool[] {
  return [
    buildDelegateTaskTool(),
    buildReadBlackboardTool(),
    buildWriteBlackboardTool(),
  ];
}
