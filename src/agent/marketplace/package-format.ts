/**
 * Agent package format utilities.
 *
 * A .clawd-agent file is a ZIP archive containing:
 *   - manifest.json  (AgentManifest metadata + profile)
 *   - README.md      (optional documentation)
 *
 * Since Node.js does not have built-in ZIP support and we want to avoid
 * native dependencies, we use a simple directory-based format for MVP:
 * a .clawd-agent file is actually a directory containing manifest.json.
 * The "pack" operation copies the profile into a directory structure,
 * and "unpack" reads from a directory path.
 *
 * Future: upgrade to actual ZIP using archiver/extract-zip when needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentManifest } from './types';

/** Required fields in manifest.json */
const REQUIRED_MANIFEST_FIELDS = [
  'name', 'version', 'author', 'description', 'category', 'tags', 'dependencies', 'profile',
] as const;

/** Current package format version */
const FORMAT_VERSION = 1;

/**
 * Validate that a manifest object has all required fields and correct types.
 * Returns an error message or null if valid.
 */
export function validateManifest(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return 'manifest.json is not a valid JSON object';
  }

  const manifest = raw as Record<string, unknown>;

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      return `Missing required field: "${field}"`;
    }
  }

  // Validate string fields
  const stringFields = ['name', 'version', 'author', 'description', 'category'] as const;
  for (const field of stringFields) {
    if (typeof manifest[field] !== 'string' || (manifest[field] as string).length === 0) {
      return `Field "${field}" must be a non-empty string`;
    }
  }

  // Validate tags is a string array
  if (!Array.isArray(manifest.tags)) {
    return '"tags" must be an array';
  }
  for (const tag of manifest.tags as unknown[]) {
    if (typeof tag !== 'string') {
      return 'Each tag must be a string';
    }
  }

  // Validate dependencies is an array
  if (!Array.isArray(manifest.dependencies)) {
    return '"dependencies" must be an array';
  }
  for (const dep of manifest.dependencies as unknown[]) {
    if (!dep || typeof dep !== 'object') {
      return 'Each dependency must be an object with "pluginName"';
    }
    const depObj = dep as Record<string, unknown>;
    if (typeof depObj.pluginName !== 'string' || depObj.pluginName.length === 0) {
      return 'Each dependency must have a non-empty "pluginName" string';
    }
    if (depObj.minVersion !== undefined && typeof depObj.minVersion !== 'string') {
      return 'Dependency "minVersion" must be a string if provided';
    }
  }

  // Validate profile object
  if (!manifest.profile || typeof manifest.profile !== 'object') {
    return '"profile" must be a PetProfile object';
  }
  const profile = manifest.profile as Record<string, unknown>;
  if (typeof profile.id !== 'string' || profile.id.length === 0) {
    return '"profile.id" must be a non-empty string';
  }
  if (typeof profile.name !== 'string' || profile.name.length === 0) {
    return '"profile.name" must be a non-empty string';
  }
  if (typeof profile.role !== 'string' || profile.role.length === 0) {
    return '"profile.role" must be a non-empty string';
  }
  if (typeof profile.systemPrompt !== 'string') {
    return '"profile.systemPrompt" must be a string';
  }
  if (!Array.isArray(profile.toolNames)) {
    return '"profile.toolNames" must be an array';
  }

  return null;
}

/**
 * Read and validate a manifest from a .clawd-agent package directory.
 * Returns the manifest or an error message.
 */
export function readPackageManifest(packagePath: string): { manifest: AgentManifest; error?: never } | { manifest?: never; error: string } {
  const manifestPath = path.join(packagePath, 'manifest.json');

  if (!fs.existsSync(packagePath)) {
    return { error: `Package path not found: ${packagePath}` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(packagePath);
  } catch {
    return { error: `Cannot stat package path: ${packagePath}` };
  }

  // Package path can be a directory (our format) or a JSON file itself
  let manifestRaw: unknown;
  if (stat.isDirectory()) {
    if (!fs.existsSync(manifestPath)) {
      return { error: 'Package directory does not contain manifest.json' };
    }
    try {
      manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      return { error: 'Failed to parse manifest.json' };
    }
  } else if (stat.isFile() && packagePath.endsWith('.json')) {
    // Allow reading manifest directly from a JSON file
    try {
      manifestRaw = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    } catch {
      return { error: 'Failed to parse manifest file' };
    }
  } else {
    return { error: 'Package path must be a directory containing manifest.json or a .json manifest file' };
  }

  const validationError = validateManifest(manifestRaw);
  if (validationError) {
    return { error: `Invalid manifest: ${validationError}` };
  }

  return { manifest: manifestRaw as AgentManifest };
}

/**
 * Pack a profile into a .clawd-agent package directory.
 * Creates a directory at the target path with manifest.json.
 * Returns the path to the created package directory or an error.
 */
export function packAgentPackage(
  targetDir: string,
  manifest: AgentManifest,
  readme?: string,
): { success: boolean; packagePath?: string; error?: string } {
  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to create target directory: ${msg}` };
    }
  }

  // Create package subdirectory named after the package
  const packageDir = path.join(targetDir, `${manifest.name}.clawd-agent`);
  try {
    fs.mkdirSync(packageDir, { recursive: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create package directory: ${msg}` };
  }

  // Write manifest.json with format version
  const manifestWithVersion = { ...manifest, formatVersion: FORMAT_VERSION };
  try {
    fs.writeFileSync(
      path.join(packageDir, 'manifest.json'),
      JSON.stringify(manifestWithVersion, null, 2),
      'utf-8',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write manifest.json: ${msg}` };
  }

  // Write README.md if provided
  if (readme) {
    try {
      fs.writeFileSync(
        path.join(packageDir, 'README.md'),
        readme,
        'utf-8',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to write README.md: ${msg}` };
    }
  }

  return { success: true, packagePath: packageDir };
}

/**
 * Read the README.md from a package directory if it exists.
 */
export function readPackageReadme(packagePath: string): string | null {
  const readmePath = path.join(packagePath, 'README.md');
  try {
    if (fs.existsSync(readmePath)) {
      return fs.readFileSync(readmePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}
