/**
 * Load balancer: Select the best node for cross-node delegation.
 *
 * Strategy: lowest-latency-first with failover.
 * When multiple nodes offer the same agent role, pick the one with the
 * lowest latency. If the selected node is unreachable, try the next.
 */

import type { RuntimeNode } from './types';
import { NodeStatus } from './types';
import { getNodes } from './node-discovery';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadBalancerOptions {
  /** Maximum timeout for remote execution in ms */
  timeoutMs: number;
  /** Maximum number of failover attempts */
  maxFailoverAttempts: number;
}

const DEFAULT_OPTIONS: LoadBalancerOptions = {
  timeoutMs: 5 * 60 * 1000, // 5 minutes
  maxFailoverAttempts: 3,
};

// ---------------------------------------------------------------------------
// Node Selection
// ---------------------------------------------------------------------------

/**
 * Find all nodes that offer a specific agent role or id.
 * Returns nodes sorted by latency (lowest first).
 */
export function findNodesForAgent(
  agentRoleOrId: string
): RuntimeNode[] {
  const nodes = getNodes().filter(
    (n) => n.status === NodeStatus.ONLINE && n.agents.length > 0
  );

  const matching = nodes.filter((n) =>
    n.agents.some(
      (a) => a.id === agentRoleOrId || a.role === agentRoleOrId
    )
  );

  // Sort by latency (lowest first, null latency goes last)
  matching.sort((a, b) => {
    const aLatency = a.latencyMs ?? Infinity;
    const bLatency = b.latencyMs ?? Infinity;
    return aLatency - bLatency;
  });

  return matching;
}

/**
 * Select the best node for a given agent role or id.
 * Returns the node with the lowest latency.
 * Returns null if no matching nodes are found.
 */
export function selectNode(
  agentRoleOrId: string
): RuntimeNode | null {
  const nodes = findNodesForAgent(agentRoleOrId);
  return nodes.length > 0 ? nodes[0] : null;
}

/**
 * Select the best node and return both node and agent id.
 */
export function selectNodeAndAgent(
  agentRoleOrId: string
): { node: RuntimeNode; agentId: string } | null {
  const node = selectNode(agentRoleOrId);
  if (!node) return null;

  const agent = node.agents.find(
    (a) => a.id === agentRoleOrId || a.role === agentRoleOrId
  );
  if (!agent) return null;

  return { node, agentId: agent.id };
}

// ---------------------------------------------------------------------------
// Failover Delegation
// ---------------------------------------------------------------------------

/**
 * Delegate a task with automatic failover.
 * Tries the best node first, then falls back to others on failure.
 */
export async function delegateWithFailover(
  agentRoleOrId: string,
  prompt: string,
  delegateFn: (node: RuntimeNode, agentId: string, prompt: string) => Promise<{ success: boolean; output?: string; error?: string }>,
  options?: Partial<LoadBalancerOptions>
): Promise<{ success: boolean; output?: string; error?: string; nodeId?: string }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const candidates = findNodesForAgent(agentRoleOrId);

  if (candidates.length === 0) {
    return {
      success: false,
      error: `No online nodes offer agent "${agentRoleOrId}"`,
    };
  }

  const maxAttempts = Math.min(opts.maxFailoverAttempts, candidates.length);
  const errors: string[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const node = candidates[i];
    const agent = node.agents.find(
      (a) => a.id === agentRoleOrId || a.role === agentRoleOrId
    );
    if (!agent) continue;

    try {
      const result = await delegateFn(node, agent.id, prompt);

      if (result.success) {
        return {
          success: true,
          output: result.output,
          nodeId: node.id,
        };
      }

      errors.push(`Node ${node.label} (${node.id}): ${result.error ?? 'Unknown error'}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Node ${node.label} (${node.id}): ${message}`);
    }
  }

  return {
    success: false,
    error: `All ${maxAttempts} node(s) failed for agent "${agentRoleOrId}": ${errors.join('; ')}`,
  };
}
