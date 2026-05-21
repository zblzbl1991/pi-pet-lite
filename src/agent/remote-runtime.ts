/**
 * Remote agent runtime for A2A (Agent-to-Agent) protocol.
 *
 * Implements the same AgentRuntime interface as local agents,
 * but delegates execution to a remote A2A-compatible agent server.
 * Uses @a2a-js/sdk for card discovery and JSON-RPC communication.
 */

import type { PetProfile, AgentCardInfo } from '../shared/types';
import { REMOTE_DEFAULT_TIMEOUT_MS } from '../shared/constants';
import type { AgentRuntime, AgentEventCallback, ConfirmationHandler } from './runtime';

/** Dynamic import helper for ESM-only @a2a-js/sdk from CommonJS context */
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as <T>(
  modulePath: string
) => Promise<T>;

type A2AClient = import('@a2a-js/sdk/client').Client;
type A2AClientFactory = import('@a2a-js/sdk/client').ClientFactory;

/** A2A SendMessage response: either a direct Message or a Task */
interface A2AMessage {
  kind: 'message';
  parts: { kind: string; text?: string }[];
}
interface A2ATask {
  kind: 'task';
  id: string;
  status: { state: string; message?: { parts?: { kind: string; text?: string }[] } };
  artifacts?: { parts: { kind: string; text?: string }[] }[];
}
type A2AResponse = A2AMessage | A2ATask;

let clientModule: typeof import('@a2a-js/sdk/client') | null = null;

async function loadClientModule() {
  if (!clientModule) {
    clientModule = await dynamicImport<typeof import('@a2a-js/sdk/client')>('@a2a-js/sdk/client');
  }
  return clientModule;
}

/**
 * Fetch AgentCard from a remote A2A agent.
 * Used by Settings UI to discover agent capabilities before saving.
 */
export async function fetchAgentCard(url: string): Promise<AgentCardInfo> {
  const { ClientFactory } = await loadClientModule();
  const baseUrl = url.replace(/\/+$/, '') + '/';
  const factory = new (ClientFactory as new () => A2AClientFactory)();
  const client = await factory.createFromUrl(baseUrl);
  const card = await client.getAgentCard();

  return {
    name: card.name ?? 'Unknown Agent',
    description: card.description ?? undefined,
    url: card.url ?? url,
    skills: card.skills?.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
  };
}

/**
 * Create a RemoteAgentRuntime that communicates via A2A protocol.
 */
export async function createRemoteAgentRuntime(
  onEvent: AgentEventCallback,
  _getConfirmation: ConfirmationHandler,
  profile: PetProfile
): Promise<AgentRuntime> {
  const a2aConfig = profile.a2a;
  if (!a2aConfig) {
    throw new Error(`Profile "${profile.id}" has no A2A configuration`);
  }

  const timeoutMs = a2aConfig.timeoutMs ?? REMOTE_DEFAULT_TIMEOUT_MS;
  console.log(`[a2a] Creating remote runtime for "${profile.name}" (id=${profile.id})`);

  const { ClientFactory } = await loadClientModule();

  // Ensure trailing slash so SDK's new URL() resolves .well-known path correctly
  const baseUrl = a2aConfig.url.replace(/\/+$/, '') + '/';
  console.log(`[a2a] Base URL: ${baseUrl}`);

  const factory = new (ClientFactory as new () => A2AClientFactory)();
  const client: A2AClient = await factory.createFromUrl(baseUrl);
  console.log(`[a2a] Client created`);

  let currentAbortController: AbortController | null = null;

  return {
    async prompt(text: string): Promise<string> {
      currentAbortController = new AbortController();
      const abortSignal = currentAbortController.signal;

      onEvent({ type: 'state-change', state: 'thinking' as const });
      console.log(`[a2a] sendMessage to "${profile.name}": ${text.slice(0, 80)}...`);

      try {
        const result = await Promise.race([
          client.sendMessage({
            message: {
              kind: 'message',
              messageId: `clawd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'user',
              parts: [{ kind: 'text' as const, text }],
            },
          }),
          new Promise<A2AResponse>((_, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`远程 agent 超时（${timeoutMs / 1000}秒）`)),
              timeoutMs
            );
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('远程 agent 调用已取消'));
            }, { once: true });
          }),
        ]);

        console.log(`[a2a] Response received from "${profile.name}"`);
        return extractTextFromResponse(result as A2AResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`远程 agent "${profile.name}" 错误：${message}`);
      } finally {
        currentAbortController = null;
      }
    },

    abort(): void {
      currentAbortController?.abort();
      currentAbortController = null;
    },

    setConfirmationHandler(_handler: ConfirmationHandler): void {
      // No-op: remote agents don't need local tool confirmation
    },

    dispose(): void {
      currentAbortController?.abort();
      currentAbortController = null;
    },
  };
}

/**
 * Extract text content from an A2A response (Message or Task).
 */
function extractTextFromResponse(result: A2AResponse): string {
  if (result.kind === 'message') {
    return result.parts
      .filter((p: { kind: string }) => p.kind === 'text')
      .map((p: { kind: string; text?: string }) => p.text ?? '')
      .join('\n');
  }

  if (result.kind === 'task') {
    const task = result;

    if (task.status.state === 'failed') {
      const errorMsg = task.status.message?.parts
        ?.filter((p: { kind: string }) => p.kind === 'text')
        .map((p: { kind: string; text?: string }) => p.text ?? '')
        .join('\n') ?? '任务执行失败';
      throw new Error(errorMsg);
    }

    if (task.status.state === 'canceled') {
      throw new Error('远程 agent 已取消任务');
    }

    // Extract from artifacts (primary)
    if (task.artifacts && task.artifacts.length > 0) {
      const text = task.artifacts
        .flatMap((a: { parts: { kind: string; text?: string }[] }) => a.parts)
        .filter((p: { kind: string }) => p.kind === 'text')
        .map((p: { kind: string; text?: string }) => p.text ?? '')
        .join('\n');
      if (text) return text;
    }

    // Fallback: extract from status message parts
    return task.status.message?.parts
      ?.filter((p: { kind: string }) => p.kind === 'text')
      .map((p: { kind: string; text?: string }) => p.text ?? '')
      .join('\n') ?? '';
  }

  return JSON.stringify(result);
}
