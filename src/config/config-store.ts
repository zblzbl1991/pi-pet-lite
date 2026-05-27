import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppConfig, LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, ThinkingLevel, PetProfile, NodesPersistConfig } from '../shared/types';
import { CONFIG_FILENAME } from '../shared/constants';

/**
 * Simple JSON config file reader/writer for application settings.
 * Config file is stored in the user data directory.
 * Supports workspace-scoped paths via setConfigBasePath().
 */

/** Active config base path override (set when switching workspaces) */
let configBasePathOverride: string | null = null;

/**
 * Set a custom base path for config file operations.
 * Used by the workspace system to scope config to a specific workspace directory.
 */
export function setConfigBasePath(basePath: string): void {
  configBasePathOverride = basePath;
}

/**
 * Get the current config base path.
 * Returns the workspace override if set, otherwise the default userData path.
 */
export function getConfigBasePath(): string {
  if (configBasePathOverride) {
    return configBasePathOverride;
  }
  return getUserDataPath();
}

function getUserDataPath(): string {
  // app.getPath('userData') is only available in the main process.
  // In utility processes, read the path from the env var set by main.ts.
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return envPath;
  }
  throw new Error('Cannot determine userData path: not in main process and CLAWD_USER_DATA env not set');
}

function getConfigPath(): string {
  return path.join(getConfigBasePath(), CONFIG_FILENAME);
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    thinkingLevel: 'low' as ThinkingLevel,
  },
  notifications: {
    systemToast: true,
    petBubble: true,
    petAnimation: true,
  },
  browser: {
    chromePath: '',
    cdpPort: 9222,
  },
  riskLevel: 'medium' as RiskLevel,
  profiles: [],
  nodes: {
    nodes: [],
    exposure: {
      enabled: false,
      port: 3100,
      apiKey: '',
      exposedAgents: [],
    },
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
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...parsed.notifications,
      },
      browser: {
        ...DEFAULT_CONFIG.browser,
        ...parsed.browser,
      },
      riskLevel: parsed.riskLevel ?? DEFAULT_CONFIG.riskLevel,
      profiles: parsed.profiles ?? DEFAULT_CONFIG.profiles,
      nodes: parsed.nodes ?? DEFAULT_CONFIG.nodes,
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
    ...current,
    llm: {
      ...current.llm,
      ...llm,
    },
  };
  writeConfig(updated);
  return updated;
}

/**
 * Update only the notification config section.
 */
export function updateNotificationConfig(notifications: Partial<NotificationConfig>): AppConfig {
  const current = readConfig();
  const updated: AppConfig = {
    ...current,
    notifications: {
      ...current.notifications,
      ...notifications,
    },
  };
  writeConfig(updated);
  return updated;
}

/**
 * Update only the browser config section.
 */
export function updateBrowserConfig(browser: Partial<BrowserConfig>): AppConfig {
  const current = readConfig();
  const updated: AppConfig = {
    ...current,
    browser: {
      ...current.browser,
      ...browser,
    },
  };
  writeConfig(updated);
  return updated;
}

/**
 * Update only the risk level setting.
 */
export function updateRiskLevel(riskLevel: RiskLevel): AppConfig {
  const current = readConfig();
  const updated: AppConfig = { ...current, riskLevel };
  writeConfig(updated);
  return updated;
}

/**
 * Update only the profiles section.
 */
export function updateProfilesConfig(profiles: PetProfile[]): AppConfig {
  const current = readConfig();
  const updated: AppConfig = { ...current, profiles };
  writeConfig(updated);
  return updated;
}

/**
 * Reset profiles to empty (removes all custom profile overrides).
 */
export function resetProfilesConfig(): AppConfig {
  const current = readConfig();
  const updated: AppConfig = { ...current, profiles: [] };
  writeConfig(updated);
  return updated;
}

/**
 * Update only the nodes section.
 */
export function updateNodesConfig(nodes: NodesPersistConfig): AppConfig {
  const current = readConfig();
  const updated: AppConfig = { ...current, nodes };
  writeConfig(updated);
  return updated;
}
