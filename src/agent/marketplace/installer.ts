/**
 * Agent package installer/uninstaller.
 *
 * Handles:
 * - Installing an agent from a .clawd-agent package directory
 * - Uninstalling an agent (removing from registry and config)
 * - Adding the agent's profile to the app config
 * - Dependency checking against installed plugins
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PetProfile } from '../../shared/types';
import type { AgentManifest } from './types';
import {
  readPackageManifest,
} from './package-format';
import {
  addInstalledAgent,
  removeInstalledAgent,
  isAgentInstalled,
  resolveMissingDeps,
  getInstalledAgent,
} from './registry';

/**
 * Resolve the userData path.
 */
function getUserDataPath(): string {
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) return envPath;
  const home = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH || '';
  return path.join(home, '.clawd');
}

/** Directory where installed agent packages are stored */
function getAgentsDir(): string {
  return path.join(getUserDataPath(), 'agents');
}

/**
 * Install an agent from a .clawd-agent package path.
 *
 * Steps:
 * 1. Read and validate the manifest
 * 2. Check plugin dependencies
 * 3. Copy package to userData/agents/<name>/
 * 4. Register in local registry
 * 5. Add profile to app config
 *
 * Returns success or error. If deps are missing, still installs but reports warnings.
 */
export function installAgent(
  packagePath: string,
  addProfileToConfig: (profile: PetProfile) => boolean,
): { success: boolean; name?: string; error?: string; warnings?: string[] } {
  // 1. Read and validate manifest
  const result = readPackageManifest(packagePath);
  if (result.error || !result.manifest) {
    return { success: false, error: result.error || 'Invalid manifest' };
  }
  const manifest: AgentManifest = result.manifest;

  // 2. Check dependencies
  const warnings: string[] = [];
  const missingDeps = resolveMissingDeps(manifest);
  if (missingDeps.length > 0) {
    warnings.push(`Missing plugin dependencies: ${missingDeps.join(', ')}. Install them for full functionality.`);
  }

  // 3. Copy package to agents directory
  const agentsDir = getAgentsDir();
  try {
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create agents directory: ${msg}` };
  }

  const installPath = path.join(agentsDir, manifest.name);

  // If already installed, remove old version first
  if (fs.existsSync(installPath)) {
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to remove old version: ${msg}` };
    }
  }

  // Copy package files
  try {
    fs.mkdirSync(installPath, { recursive: true });

    // If source is a directory, copy its contents
    const srcStat = fs.statSync(packagePath);
    if (srcStat.isDirectory()) {
      // Copy manifest.json
      const manifestSrc = path.join(packagePath, 'manifest.json');
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, path.join(installPath, 'manifest.json'));
      }
      // Copy README.md if present
      const readmeSrc = path.join(packagePath, 'README.md');
      if (fs.existsSync(readmeSrc)) {
        fs.copyFileSync(readmeSrc, path.join(installPath, 'README.md'));
      }
    } else if (srcStat.isFile() && packagePath.endsWith('.json')) {
      // Source is a manifest JSON file - just copy it
      fs.copyFileSync(packagePath, path.join(installPath, 'manifest.json'));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to copy package files: ${msg}` };
  }

  // 4. Register in local registry
  addInstalledAgent({
    manifest,
    installedAt: Date.now(),
    source: 'local-file',
    installPath,
  });

  // 5. Add profile to config
  const profileAdded = addProfileToConfig(manifest.profile);
  if (!profileAdded) {
    warnings.push(`Profile ${manifest.profile.id} already exists in config. The package is installed but the profile was not overwritten.`);
  }

  console.log(`[marketplace] Installed agent: ${manifest.name} v${manifest.version}`);

  return {
    success: true,
    name: manifest.name,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Uninstall an agent by package name.
 *
 * Steps:
 * 1. Look up the entry in the registry
 * 2. Remove the installed files
 * 3. Remove from registry
 * 4. Optionally remove profile from config
 *
 * Returns the profile ID of the uninstalled agent (for config cleanup).
 */
export function uninstallAgent(
  name: string,
  removeProfileFromConfig: (profileId: string) => boolean,
): { success: boolean; error?: string; profileId?: string } {
  const entry = getInstalledAgent(name);
  if (!entry) {
    return { success: false, error: `Agent "${name}" is not installed` };
  }

  const profileId = entry.manifest.profile.id;

  // Remove installed files
  try {
    if (fs.existsSync(entry.installPath)) {
      fs.rmSync(entry.installPath, { recursive: true, force: true });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to remove agent files: ${msg}` };
  }

  // Remove from registry
  removeInstalledAgent(name);

  // Remove profile from config
  removeProfileFromConfig(profileId);

  console.log(`[marketplace] Uninstalled agent: ${name}`);

  return { success: true, profileId };
}

/**
 * Check if an update is available for an installed agent.
 * Compares the version in the package manifest with the installed version.
 */
export function checkForUpdate(
  packagePath: string,
): { updateAvailable: boolean; installedVersion?: string; newVersion?: string; error?: string } {
  const result = readPackageManifest(packagePath);
  if (result.error || !result.manifest) {
    return { updateAvailable: false, error: result.error || 'Invalid manifest' };
  }
  const packageManifest: AgentManifest = result.manifest;

  const installed = getInstalledAgent(packageManifest.name);
  if (!installed) {
    return { updateAvailable: false, error: 'Agent is not currently installed' };
  }

  return {
    updateAvailable: installed.manifest.version !== packageManifest.version,
    installedVersion: installed.manifest.version,
    newVersion: packageManifest.version,
  };
}

/**
 * Package the current profile as a .clawd-agent package.
 * This is used by the "Create Package" feature in the UI.
 */
export function packageCurrentProfile(
  profile: PetProfile,
  options: {
    name: string;
    version: string;
    author: string;
    description: string;
    category: string;
    tags: string[];
    dependencies: Array<{ pluginName: string; minVersion?: string }>;
    targetDir: string;
    readme?: string;
  },
): { success: boolean; packagePath?: string; error?: string } {
  const { packAgentPackage } = require('./package-format') as typeof import('./package-format');

  const manifest: AgentManifest = {
    name: options.name,
    version: options.version,
    author: options.author,
    description: options.description,
    category: options.category as AgentManifest['category'],
    tags: options.tags,
    dependencies: options.dependencies,
    profile,
    readme: options.readme,
    formatVersion: 1,
  };

  return packAgentPackage(options.targetDir, manifest, options.readme);
}
