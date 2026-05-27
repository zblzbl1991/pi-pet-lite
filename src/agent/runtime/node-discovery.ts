/**
 * Node discovery: manual registration, health checks, and status tracking.
 *
 * Provides:
 * - Manual node registration and removal
 * - Periodic health checks (ping endpoint)
 * - Node status tracking (online/offline/latency)
 * - Agent discovery from remote nodes
 */

import type { RuntimeNode, RemoteAgentInfo, NodeInfoResponse, NodeHealthResponse } from './types';
import { NodeStatus } from './types';
import { validateApiKey } from './node-security';

// ---------------------------------------------------------------------------
// Dynamic import for HTTP client (Node.js built-in)
// ---------------------------------------------------------------------------

// We use Node.js built-in fetch (available in Electron utility process)

// ---------------------------------------------------------------------------
// Node Registry (in-memory)
// ---------------------------------------------------------------------------

/** Registered nodes keyed by id */
const nodeRegistry = new Map<string, RuntimeNode>();

/** Health check interval handle */
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/** Callback for node status changes */
let onNodeStatusChange: ((nodeId: string, status: NodeStatus) => void) | null = null;

/**
 * Set a callback that fires when a node's status changes.
 */
export function setNodeStatusCallback(cb: (nodeId: string, status: NodeStatus) => void): void {
  onNodeStatusChange = cb;
}

// ---------------------------------------------------------------------------
// Node Registration
// ---------------------------------------------------------------------------

/**
 * Generate a unique node ID.
 */
function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register a new remote node.
 * Does not persist - persistence is handled by config store.
 */
export function registerNode(label: string, url: string, apiKey: string): RuntimeNode {
  const id = generateNodeId();
  const node: RuntimeNode = {
    id,
    label,
    url: url.replace(/\/+$/, ''),
    apiKey,
    status: NodeStatus.OFFLINE,
    latencyMs: null,
    lastCheckedAt: null,
    agents: [],
    lastDiscoveredAt: null,
  };
  nodeRegistry.set(id, node);
  console.log(`[node-discovery] Registered node "${label}" (${id}) at ${url}`);
  return node;
}

/**
 * Load nodes from persisted configuration.
 * Called on startup to restore previously registered nodes.
 */
export function loadNodes(nodes: Array<{ id: string; label: string; url: string; apiKey: string }>): void {
  for (const n of nodes) {
    const node: RuntimeNode = {
      id: n.id,
      label: n.label,
      url: n.url.replace(/\/+$/, ''),
      apiKey: n.apiKey,
      status: NodeStatus.OFFLINE,
      latencyMs: null,
      lastCheckedAt: null,
      agents: [],
      lastDiscoveredAt: null,
    };
    nodeRegistry.set(n.id, node);
  }
  console.log(`[node-discovery] Loaded ${nodes.length} persisted nodes`);
}

/**
 * Remove a registered node.
 */
export function removeNode(nodeId: string): boolean {
  const removed = nodeRegistry.delete(nodeId);
  if (removed) {
    console.log(`[node-discovery] Removed node ${nodeId}`);
  }
  return removed;
}

/**
 * Get all registered nodes.
 */
export function getNodes(): RuntimeNode[] {
  return Array.from(nodeRegistry.values());
}

/**
 * Get a specific node by id.
 */
export function getNode(nodeId: string): RuntimeNode | undefined {
  return nodeRegistry.get(nodeId);
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * Ping a remote node to check if it's reachable and measure latency.
 */
export async function pingNode(node: RuntimeNode): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${node.url}/api/node/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${node.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = await response.json() as NodeHealthResponse;
      return { ok: data.status === 'ok', latencyMs };
    }

    return { ok: false, latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

/**
 * Perform a health check on a single node and update its status.
 */
export async function checkNodeHealth(nodeId: string): Promise<void> {
  const node = nodeRegistry.get(nodeId);
  if (!node) return;

  node.status = NodeStatus.CHECKING;
  onNodeStatusChange?.(nodeId, NodeStatus.CHECKING);

  const { ok, latencyMs } = await pingNode(node);

  node.latencyMs = latencyMs;
  node.lastCheckedAt = Date.now();
  node.status = ok ? NodeStatus.ONLINE : NodeStatus.OFFLINE;
  onNodeStatusChange?.(nodeId, node.status);

  console.log(`[node-discovery] Health check ${nodeId}: ${node.status} (${latencyMs}ms)`);
}

/**
 * Perform health checks on all registered nodes.
 */
export async function checkAllNodes(): Promise<void> {
  const nodes = Array.from(nodeRegistry.keys());
  await Promise.all(nodes.map((id) => checkNodeHealth(id)));
}

/**
 * Start periodic health checks.
 */
export function startHealthChecks(intervalMs: number = 30000): void {
  stopHealthChecks();
  // Initial check
  checkAllNodes().catch((err: unknown) => {
    console.error('[node-discovery] Initial health check failed:', err);
  });
  healthCheckInterval = setInterval(() => {
    checkAllNodes().catch((err: unknown) => {
      console.error('[node-discovery] Periodic health check failed:', err);
    });
  }, intervalMs);
  console.log(`[node-discovery] Started health checks (interval: ${intervalMs}ms)`);
}

/**
 * Stop periodic health checks.
 */
export function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Agent Discovery
// ---------------------------------------------------------------------------

/**
 * Discover available agents on a remote node.
 * Calls the remote node's /api/node/info endpoint.
 */
export async function discoverNodeAgents(node: RuntimeNode): Promise<RemoteAgentInfo[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${node.url}/api/node/info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${node.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Node returned status ${response.status}`);
    }

    const data = await response.json() as NodeInfoResponse;
    const agents: RemoteAgentInfo[] = data.agents ?? [];

    // Cache the discovered agents
    node.agents = agents;
    node.lastDiscoveredAt = Date.now();

    console.log(`[node-discovery] Discovered ${agents.length} agents on node ${node.id}`);
    return agents;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[node-discovery] Failed to discover agents on node ${node.id}: ${message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up all resources (stop health checks, clear registry).
 */
export function disposeDiscovery(): void {
  stopHealthChecks();
  nodeRegistry.clear();
  onNodeStatusChange = null;
}

/**
 * Get the serializable node list for config persistence.
 */
export function getNodesForPersistence(): Array<{ id: string; label: string; url: string; apiKey: string }> {
  return Array.from(nodeRegistry.values()).map((n) => ({
    id: n.id,
    label: n.label,
    url: n.url,
    apiKey: n.apiKey,
  }));
}
