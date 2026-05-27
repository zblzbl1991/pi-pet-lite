/**
 * Cross-node delegation: Route tasks from local Chief to remote node agents.
 *
 * Provides:
 * - HTTP-based delegation to remote runtime nodes
 * - Timeout handling
 * - Result aggregation from remote execution
 * - Integration with PetManager for transparent cross-node delegation
 */

import type {
  RuntimeNode,
  CrossNodeDelegateRequest,
  CrossNodeDelegateResponse,
} from './types';
import { getNodes } from './node-discovery';

// ---------------------------------------------------------------------------
// Default timeout
// ---------------------------------------------------------------------------

const DEFAULT_DELEGATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Cross-node Delegation
// ---------------------------------------------------------------------------

/**
 * Delegate a task to an agent on a remote node via HTTP.
 *
 * @param node - The target runtime node
 * @param agentId - The agent id on the remote node
 * @param prompt - The task prompt
 * @param options - Optional configuration
 * @returns The delegation response
 */
export async function delegateToRemoteNode(
  node: RuntimeNode,
  agentId: string,
  prompt: string,
  options?: {
    context?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<CrossNodeDelegateResponse> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS;
  const startTime = Date.now();

  const request: CrossNodeDelegateRequest = {
    agentId,
    prompt,
    context: options?.context,
    timeoutMs,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${node.url}/api/node/delegate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${node.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        error: `Remote node returned HTTP ${response.status}: ${text}`,
        durationMs: Date.now() - startTime,
        nodeId: node.id,
        agentId,
      };
    }

    const data = await response.json() as CrossNodeDelegateResponse;
    return {
      ...data,
      durationMs: data.durationMs || (Date.now() - startTime),
      nodeId: node.id,
      agentId,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect abort/timeout
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: `Remote delegation timed out after ${timeoutMs / 1000} seconds`,
        durationMs: Date.now() - startTime,
        nodeId: node.id,
        agentId,
      };
    }

    return {
      success: false,
      error: `Remote delegation failed: ${message}`,
      durationMs: Date.now() - startTime,
      nodeId: node.id,
      agentId,
    };
  }
}

// ---------------------------------------------------------------------------
// Find Remote Agent
// ---------------------------------------------------------------------------

/**
 * Find the best node for a given agent role or id.
 * Searches all registered nodes for a matching agent.
 *
 * @param agentRoleOrId - The agent role or id to find
 * @returns The node and agent info, or null if not found
 */
export function findRemoteAgent(
  agentRoleOrId: string
): { node: RuntimeNode; agentId: string } | null {
  const nodes = getAvailableNodes();

  for (const node of nodes) {
    // Check by agent id
    const byId = node.agents.find((a) => a.id === agentRoleOrId);
    if (byId) {
      return { node, agentId: byId.id };
    }

    // Check by agent role
    const byRole = node.agents.find((a) => a.role === agentRoleOrId);
    if (byRole) {
      return { node, agentId: byRole.id };
    }
  }

  return null;
}

/**
 * Get all nodes that are online and have discovered agents.
 */
function getAvailableNodes(): RuntimeNode[] {
  return getNodes().filter(
    (n) => n.status === 'online' && n.agents.length > 0
  );
}

/**
 * Get all remote agents across all online nodes.
 */
export function getAllRemoteAgents(): Array<{ node: RuntimeNode; agentId: string; agentName: string; agentRole: string }> {
  const nodes = getAvailableNodes();
  const result: Array<{ node: RuntimeNode; agentId: string; agentName: string; agentRole: string }> = [];

  for (const node of nodes) {
    for (const agent of node.agents) {
      result.push({
        node,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
      });
    }
  }

  return result;
}
