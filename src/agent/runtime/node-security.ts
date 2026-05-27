/**
 * Node security: API key authentication and exposure allowlist.
 *
 * Provides:
 * - API key validation for incoming node requests
 * - Agent exposure allowlist management
 * - Request authentication middleware
 */

import type { NodeExposureConfig, ExposedAgent } from './types';

// ---------------------------------------------------------------------------
// API Key Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a provided API key matches the expected key.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateApiKey(providedKey: string, expectedKey: string): boolean {
  if (!providedKey || !expectedKey) return false;
  if (providedKey.length !== expectedKey.length) return false;

  let result = 0;
  for (let i = 0; i < providedKey.length; i++) {
    result |= providedKey.charCodeAt(i) ^ expectedKey.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Agent Exposure Allowlist
// ---------------------------------------------------------------------------

/**
 * Check if a local agent is allowed to be exposed remotely.
 */
export function isAgentExposed(config: NodeExposureConfig, petId: string): boolean {
  if (!config.enabled) return false;

  const entry = config.exposedAgents.find((a) => a.petId === petId);
  return entry?.exposed === true;
}

/**
 * Get all exposed agent pet IDs from the config.
 */
export function getExposedAgentIds(config: NodeExposureConfig): string[] {
  if (!config.enabled) return [];
  return config.exposedAgents
    .filter((a) => a.exposed)
    .map((a) => a.petId);
}

/**
 * Toggle the exposure of a local agent.
 * If the agent is not in the list, it is added.
 * Returns the updated config.
 */
export function toggleAgentExposure(
  config: NodeExposureConfig,
  petId: string,
  exposed: boolean
): NodeExposureConfig {
  const existing = config.exposedAgents.find((a) => a.petId === petId);
  if (existing) {
    existing.exposed = exposed;
  } else {
    config.exposedAgents.push({ petId, exposed });
  }
  return config;
}

/**
 * Filter a list of agent profiles to only those that are exposed.
 */
export function filterExposedAgents(
  config: NodeExposureConfig,
  allPetIds: string[]
): ExposedAgent[] {
  return allPetIds.map((petId) => ({
    petId,
    exposed: isAgentExposed(config, petId),
  }));
}

// ---------------------------------------------------------------------------
// Request Authentication
// ---------------------------------------------------------------------------

/**
 * Extract and validate API key from request headers.
 * Expects "Authorization: Bearer <key>" header format.
 */
export function extractApiKeyFromHeaders(headers: Record<string, string>): string | null {
  const auth = headers['authorization'] ?? headers['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

/**
 * Authenticate an incoming node request.
 * Returns true if the request is valid, false otherwise.
 */
export function authenticateNodeRequest(
  headers: Record<string, string>,
  expectedApiKey: string
): boolean {
  const providedKey = extractApiKeyFromHeaders(headers);
  if (!providedKey) return false;
  return validateApiKey(providedKey, expectedApiKey);
}
