import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppConfig, LLMConfig } from '../shared/types';
import { CONFIG_FILENAME } from '../shared/constants';

/**
 * Simple JSON config file reader/writer for application settings.
 * Config file is stored in the user data directory.
 */

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
  },
};

/**
 * Read the application config from disk.
 * Returns default config if file does not exist or is invalid.
 */
export function readConfig(): AppConfig {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      llm: {
        ...DEFAULT_CONFIG.llm,
        ...parsed.llm,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the application config to disk.
 */
export function writeConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Update only the LLM config section.
 */
export function updateLLMConfig(llm: Partial<LLMConfig>): AppConfig {
  const current = readConfig();
  const updated: AppConfig = {
    llm: {
      ...current.llm,
      ...llm,
    },
  };
  writeConfig(updated);
  return updated;
}
