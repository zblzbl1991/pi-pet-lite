/**
 * Distributed runtime type definitions.
 *
 * Types for node discovery, cross-node delegation, load balancing,
 * and security for distributed Clawd runtime instances.
 */

// ---------------------------------------------------------------------------
// Node Definition
// ---------------------------------------------------------------------------

/** Status of a runtime node */
export const NodeStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  CHECKING: 'checking',
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

/** A registered remote runtime node */
export interface RuntimeNode {
  /** Unique node identifier (generated on registration) */
  id: string;
  /** Human-readable label */
  label: string;
  /** Base URL for the remote node (e.g. "http://192.168.1.50:3100") */
  url: string;
  /** API key for authentication */
  apiKey: string;
  /** Current status */
  status: NodeStatus;
  /** Last known latency in ms (null if never checked) */
  latencyMs: number | null;
  /** Timestamp of last successful health check */
  lastCheckedAt: number | null;
  /** Remote agents available on this node (cached from discovery) */
  agents: RemoteAgentInfo[];
  /** Timestamp of last agent discovery */
  lastDiscoveredAt: number | null;
}

/** Information about a remote agent on a node */
export interface RemoteAgentInfo {
  /** Agent profile id on the remote node */
  id: string;
  /** Display name */
  name: string;
  /** Role identifier */
  role: string;
  /** Brief description */
  description?: string;
  /** Available skills */
  skills?: { id: string; name: string; description?: string }[];
}

// ---------------------------------------------------------------------------
// Local Node Exposure
// ---------------------------------------------------------------------------

/** Configuration for which local agents are exposed to remote nodes */
export interface ExposedAgent {
  /** Local profile id */
  petId: string;
  /** Whether this agent is available for remote delegation */
  exposed: boolean;
}

/** Local node exposure config */
export interface NodeExposureConfig {
  /** Whether this node exposes itself as a runtime node */
  enabled: boolean;
  /** Port to listen on for incoming node connections */
  port: number;
  /** API key that remote nodes must provide */
  apiKey: string;
  /** Which local agents are exposed */
  exposedAgents: ExposedAgent[];
}

// ---------------------------------------------------------------------------
// Cross-node Delegation
// ---------------------------------------------------------------------------

/** Request to delegate a task to a remote node */
export interface CrossNodeDelegateRequest {
  /** Target agent id on the remote node */
  agentId: string;
  /** Task prompt */
  prompt: string;
  /** Optional context from blackboard */
  context?: Record<string, string>;
  /** Timeout in ms */
  timeoutMs: number;
}

/** Response from a cross-node delegation */
export interface CrossNodeDelegateResponse {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  /** Node id that executed the task */
  nodeId: string;
  /** Agent id that executed the task */
  agentId: string;
}

// ---------------------------------------------------------------------------
// Node Discovery Protocol
// ---------------------------------------------------------------------------

/** Response from a remote node's /api/node/info endpoint */
export interface NodeInfoResponse {
  /** Node identifier */
  nodeId: string;
  /** Node label */
  label: string;
  /** Available agents */
  agents: RemoteAgentInfo[];
  /** Node version */
  version?: string;
}

/** Health check response */
export interface NodeHealthResponse {
  status: 'ok' | 'error';
  latencyMs?: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// IPC Message Types
// ---------------------------------------------------------------------------

/** Messages from renderer to agent for node operations */
export type NodeRendererMessage =
  | { type: 'node:list' }
  | { type: 'node:add'; label: string; url: string; apiKey: string }
  | { type: 'node:remove'; nodeId: string }
  | { type: 'node:status' }
  | { type: 'node:discover'; nodeId: string }
  | { type: 'node:list-exposed-agents' }
  | { type: 'node:toggle-expose'; petId: string; exposed: boolean }
  | { type: 'node:update-exposure-config'; config: Partial<NodeExposureConfig> };

/** Responses from agent to renderer for node operations */
export type NodeAgentResponse =
  | { type: 'node-list-response'; nodes: RuntimeNode[] }
  | { type: 'node-add-response'; success: boolean; nodeId?: string; error?: string }
  | { type: 'node-remove-response'; success: boolean; error?: string }
  | { type: 'node-status-response'; nodes: RuntimeNode[] }
  | { type: 'node-discover-response'; success: boolean; agents?: RemoteAgentInfo[]; error?: string }
  | { type: 'node-list-exposed-response'; exposedAgents: ExposedAgent[] }
  | { type: 'node-toggle-expose-response'; success: boolean; error?: string }
  | { type: 'node-update-exposure-response'; success: boolean; error?: string };

// ---------------------------------------------------------------------------
// Persisted Config
// ---------------------------------------------------------------------------

/** Persisted node configuration stored in config file */
export interface NodesConfig {
  /** Registered remote nodes */
  nodes: Array<{
    id: string;
    label: string;
    url: string;
    apiKey: string;
  }>;
  /** Node exposure settings */
  exposure: NodeExposureConfig;
}
