/**
 * LLM interface for the Clawd agent.
 *
 * Uses dynamic import() to load @earendil-works/pi-ai (ESM-only package)
 * from the CommonJS agent utility process.
 *
 * Reads API key + provider config from the config store and returns
 * the appropriate Model instance.
 */

import { readConfig } from '../config/config-store';
import type { LLMConfig } from '../shared/types';

/** Type aliases for pi-ai types (resolved at runtime via dynamic import) */
type PiKnownProvider = import('@earendil-works/pi-ai').KnownProvider;
type PiModel = import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>;

/** Cached dynamic imports */
let piAiModule: typeof import('@earendil-works/pi-ai') | null = null;

/**
 * Dynamically import pi-ai (ESM module).
 * Caches the module reference after first import.
 */
async function loadPiAi(): Promise<typeof import('@earendil-works/pi-ai')> {
  if (!piAiModule) {
    piAiModule = await import('@earendil-works/pi-ai');
  }
  return piAiModule;
}

/**
 * Create a model instance from the current config.
 *
 * Reads the LLM config from disk (provider, model, apiKey)
 * and calls pi-ai's getModel() to create the appropriate Model.
 *
 * @throws Error if no API key is configured
 */
export async function createModel(): Promise<{ model: PiModel; apiKey: string; provider: string }> {
  const config = readConfig();
  const { provider, apiKey, model: modelId } = config.llm;

  if (!apiKey) {
    throw new Error(
      'No API key configured. Open Settings from the system tray to set your LLM API key.'
    );
  }

  const piAi = await loadPiAi();
  const model = piAi.getModel(
    provider as PiKnownProvider,
    modelId as Parameters<typeof piAi.getModel>[1]
  );

  return { model, apiKey, provider };
}

/**
 * Get the current LLM config without creating a model instance.
 */
export function getLLMConfig(): LLMConfig {
  return readConfig().llm;
}
