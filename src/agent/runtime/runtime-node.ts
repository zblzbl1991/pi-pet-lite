/**
 * Runtime Node: Exposes the local Clawd instance as a runtime node.
 *
 * Provides:
 * - HTTP endpoint for node info/capabilities
 * - Agent discovery based on A2A AgentCard extension
 * - Incoming cross-node delegation handling
 *
 * Uses Node.js built-in http module for the server since we run in
 * an Electron utility process.
 */

import http from 'http';
import type { NodeExposureConfig, RemoteAgentInfo, NodeInfoResponse, NodeHealthResponse, CrossNodeDelegateRequest, CrossNodeDelegateResponse } from './types';
import { authenticateNodeRequest } from './node-security';
import { getEnabledSpecialistProfiles } from '../profiles';
import type { PetManager } from '../pet-manager';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let server: http.Server | null = null;
let petManagerInstance: PetManager | null = null;
let exposureConfig: NodeExposureConfig | null = null;

/**
 * Inject the PetManager instance for handling incoming delegations.
 */
export function setPetManagerForRuntimeNode(pm: PetManager): void {
  petManagerInstance = pm;
}

/**
 * Set the current exposure configuration.
 */
export function setExposureConfig(config: NodeExposureConfig): void {
  exposureConfig = config;
}

// ---------------------------------------------------------------------------
// Agent Info Building
// ---------------------------------------------------------------------------

/**
 * Build the list of exposed local agents.
 * Only includes agents that are marked as exposed in the config.
 */
function buildExposedAgents(): RemoteAgentInfo[] {
  if (!exposureConfig || !exposureConfig.enabled) return [];

  const profiles = getEnabledSpecialistProfiles();
  const exposedIds = new Set(
    exposureConfig.exposedAgents
      .filter((a) => a.exposed)
      .map((a) => a.petId)
  );

  // Include Chief if exposed (it's not a specialist, but can be exposed)
  const allExposed = profiles.filter((p) => exposedIds.has(p.id));

  return allExposed.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    description: p.a2a?.agentCard?.description,
    skills: p.a2a?.agentCard?.skills,
  }));
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

/**
 * Handle incoming HTTP requests on the runtime node server.
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // CORS headers for local network access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Authenticate all non-health-check endpoints
  if (url !== '/api/node/health') {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
    if (!exposureConfig?.apiKey || !authenticateNodeRequest(headers, exposureConfig.apiKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  // Route: Health check (no auth required for basic connectivity test)
  if (url === '/api/node/health' && method === 'GET') {
    const health: NodeHealthResponse = {
      status: 'ok',
      timestamp: Date.now(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  // Route: Node info (capabilities)
  if (url === '/api/node/info' && method === 'GET') {
    const agents = buildExposedAgents();
    const info: NodeInfoResponse = {
      nodeId: `local-${Date.now()}`,
      label: 'Clawd Local Node',
      agents,
      version: '1.0.0',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // Route: Delegate task
  if (url === '/api/node/delegate' && method === 'POST') {
    handleDelegateRequest(req, res);
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Handle an incoming delegation request.
 */
function handleDelegateRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const request = JSON.parse(body) as CrossNodeDelegateRequest;

      if (!petManagerInstance) {
        const response: CrossNodeDelegateResponse = {
          success: false,
          error: 'PetManager not initialized',
          durationMs: 0,
          nodeId: 'local',
          agentId: request.agentId,
        };
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      }

      const startTime = Date.now();

      // Build prompt with optional context
      let prompt = request.prompt;
      if (request.context && Object.keys(request.context).length > 0) {
        const contextParts = Object.entries(request.context)
          .map(([k, v]) => `[${k}]: ${v}`)
          .join('\n');
        prompt += '\n\n--- Context ---\n' + contextParts;
      }

      try {
        const result = await petManagerInstance.delegate(request.agentId, prompt);
        const response: CrossNodeDelegateResponse = {
          success: result.success,
          output: result.output,
          durationMs: Date.now() - startTime,
          nodeId: 'local',
          agentId: request.agentId,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const response: CrossNodeDelegateResponse = {
          success: false,
          error: message,
          durationMs: Date.now() - startTime,
          nodeId: 'local',
          agentId: request.agentId,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid request: ${message}` }));
    }
  });
}

// ---------------------------------------------------------------------------
// Server Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the runtime node HTTP server.
 */
export function startRuntimeNode(config: NodeExposureConfig): void {
  if (server) {
    console.log('[runtime-node] Server already running');
    return;
  }

  if (!config.enabled) {
    console.log('[runtime-node] Node exposure disabled, not starting server');
    return;
  }

  exposureConfig = config;

  server = http.createServer(handleRequest);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[runtime-node] HTTP server listening on port ${config.port}`);
  });

  server.on('error', (err: Error) => {
    console.error(`[runtime-node] Server error: ${err.message}`);
  });
}

/**
 * Stop the runtime node HTTP server.
 */
export function stopRuntimeNode(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[runtime-node] Server stopped');
  }
}

/**
 * Restart the runtime node server with updated config.
 */
export function restartRuntimeNode(config: NodeExposureConfig): void {
  stopRuntimeNode();
  startRuntimeNode(config);
}
