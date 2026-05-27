/**
 * Local installed-agent registry.
 *
 * Maintains a JSON file (clawd-marketplace-registry.json) in the userData
 * directory that tracks all installed agent packages, their versions,
 * sources, and dependency status.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PetProfile } from '../../shared/types';
import type {
  LocalRegistry,
  InstalledAgentEntry,
  InstalledAgentSummary,
  AgentManifest,
} from './types';
import { getPluginSummaries } from '../plugins';

/** Registry filename in userData directory */
const REGISTRY_FILENAME = 'clawd-marketplace-registry.json';

/** Current registry format version */
const REGISTRY_VERSION = 1;

/**
 * Resolve the userData path from environment.
 * In utility process, CLAWD_USER_DATA is set by main.ts.
 */
function getUserDataPath(): string {
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) return envPath;
  // Fallback for main process (shouldn't normally happen)
  const home = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH || '';
  return path.join(home, '.clawd');
}

function getRegistryPath(): string {
  return path.join(getUserDataPath(), REGISTRY_FILENAME);
}

/** Create an empty registry */
function createEmptyRegistry(): LocalRegistry {
  return { version: REGISTRY_VERSION, agents: {} };
}

/**
 * Read the local registry from disk.
 * Returns an empty registry if file does not exist or is invalid.
 */
export function readRegistry(): LocalRegistry {
  const registryPath = getRegistryPath();
  try {
    if (!fs.existsSync(registryPath)) {
      return createEmptyRegistry();
    }
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LocalRegistry>;
    return {
      version: parsed.version ?? REGISTRY_VERSION,
      agents: parsed.agents ?? {},
    };
  } catch {
    return createEmptyRegistry();
  }
}

/**
 * Write the local registry to disk.
 */
function writeRegistry(registry: LocalRegistry): void {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Add an installed agent entry to the registry.
 * Overwrites any existing entry with the same name.
 */
export function addInstalledAgent(entry: InstalledAgentEntry): void {
  const registry = readRegistry();
  registry.agents[entry.manifest.name] = entry;
  writeRegistry(registry);
}

/**
 * Remove an installed agent entry from the registry by package name.
 * Returns true if the entry was found and removed.
 */
export function removeInstalledAgent(name: string): boolean {
  const registry = readRegistry();
  if (!registry.agents[name]) return false;
  delete registry.agents[name];
  writeRegistry(registry);
  return true;
}

/**
 * Get a specific installed agent entry by name.
 */
export function getInstalledAgent(name: string): InstalledAgentEntry | undefined {
  const registry = readRegistry();
  return registry.agents[name];
}

/**
 * Get all installed agent entries.
 */
export function getAllInstalledAgents(): InstalledAgentEntry[] {
  const registry = readRegistry();
  return Object.values(registry.agents);
}

/**
 * Check if an agent with the given name is already installed.
 */
export function isAgentInstalled(name: string): boolean {
  const registry = readRegistry();
  return name in registry.agents;
}

/**
 * Resolve dependency status: check which required plugins are installed.
 * Returns the list of missing plugin names.
 */
export function resolveMissingDeps(manifest: AgentManifest): string[] {
  if (!manifest.dependencies || manifest.dependencies.length === 0) return [];

  const installedPlugins = getPluginSummaries();
  const installedPluginNames = new Set(installedPlugins.map((p) => p.name));

  return manifest.dependencies
    .filter((dep) => !installedPluginNames.has(dep.pluginName))
    .map((dep) => dep.pluginName);
}

/**
 * Generate summaries of all installed agents for IPC transport.
 * Includes dependency resolution and active-status checks.
 */
export function getInstalledAgentSummaries(
  configProfiles?: PetProfile[],
): InstalledAgentSummary[] {
  const entries = getAllInstalledAgents();

  return entries.map((entry) => {
    const missingDeps = resolveMissingDeps(entry.manifest);
    const profileId = entry.manifest.profile.id;

    // Check if the profile is active in config
    let active = false;
    if (configProfiles) {
      active = configProfiles.some(
        (p) => p.id === profileId && p.enabled !== false,
      );
    }

    return {
      name: entry.manifest.name,
      version: entry.manifest.version,
      author: entry.manifest.author,
      description: entry.manifest.description,
      category: entry.manifest.category,
      tags: entry.manifest.tags,
      depsOk: missingDeps.length === 0,
      missingDeps,
      active,
      profileId,
      installedAt: entry.installedAt,
    };
  });
}
