/**
 * Backend factory — creates AgentBackend instances based on type string.
 *
 * Currently only supports 'pi-agent-core' (the default).
 * New backends can be registered here as the system evolves.
 */

import type { AgentBackend, BackendConfig } from './types';
import { createPiAgentBackend } from './pi-agent-backend';

/** Known backend type identifiers */
export const BackendType = {
  PI_AGENT_CORE: 'pi-agent-core',
} as const;

export type BackendType = (typeof BackendType)[keyof typeof BackendType];

/**
 * Create an AgentBackend instance based on the type string.
 *
 * @param type - Backend identifier (defaults to 'pi-agent-core')
 * @param config - Configuration for the backend
 * @returns A fully initialized AgentBackend
 * @throws Error if the backend type is not recognized
 */
export async function createBackend(
  type: string | undefined,
  config: BackendConfig
): Promise<AgentBackend> {
  const backendType = type ?? BackendType.PI_AGENT_CORE;

  switch (backendType) {
    case BackendType.PI_AGENT_CORE:
      return createPiAgentBackend(config);

    default:
      throw new Error(
        `Unknown backend type: "${backendType}". ` +
        `Available backends: ${Object.values(BackendType).join(', ')}`
      );
  }
}
