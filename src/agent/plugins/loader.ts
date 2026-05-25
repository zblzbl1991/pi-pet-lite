/**
 * Plugin loader: scans, loads, validates, and manages plugin lifecycle.
 *
 * Scans the ~/.clawd/plugins/ directory for plugin directories,
 * each containing a plugin.json manifest and an index.js entry point.
 * Uses require() for CommonJS loading (D1 decision).
 *
 * All operations are wrapped in try-catch so that a bad plugin
 * never crashes the application.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PluginManifest,
  ToolPlugin,
  LoadedPlugin,
} from './types';
import type { PluginSummary } from '../../shared/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map of loaded plugins keyed by their unique name */
const loadedPlugins = new Map<string, LoadedPlugin>();

/** Active filesystem watchers */
const watchers: fs.FSWatcher[] = [];

/** Path to the plugins directory */
let pluginsDir = '';

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the plugins directory path.
 * Uses CLAWD_USER_DATA env var (set by main process from app.getPath('userData')),
 * falling back to ~/.clawd/ if not available.
 */
function resolvePluginsDir(): string {
  const userData = process.env.CLAWD_USER_DATA;
  if (userData) {
    return path.join(userData, 'plugins');
  }
  // Fallback: home directory
  const home = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH || '';
  return path.join(home, '.clawd', 'plugins');
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/** Required fields in plugin.json */
const REQUIRED_MANIFEST_FIELDS = ['name', 'version', 'displayName', 'description', 'entry'] as const;

/**
 * Validate that a manifest object has all required fields and correct types.
 * Returns an error message or null if valid.
 */
function validateManifest(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return 'plugin.json is not a valid JSON object';
  }

  const manifest = raw as Record<string, unknown>;

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (typeof manifest[field] !== 'string' || (manifest[field] as string).length === 0) {
      return `Missing or invalid required field: "${field}"`;
    }
  }

  // Validate permissions array if present
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      return '"permissions" must be an array';
    }
    for (const perm of manifest.permissions) {
      if (typeof perm !== 'string') {
        return 'Each permission must be a string';
      }
    }
  }

  // Validate timeout if present
  if (manifest.timeout !== undefined) {
    if (typeof manifest.timeout !== 'number' || manifest.timeout <= 0) {
      return '"timeout" must be a positive number';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin validation
// ---------------------------------------------------------------------------

/**
 * Validate that a loaded module matches the ToolPlugin interface.
 * Returns an error message or null if valid.
 */
function validatePlugin(mod: unknown): string | null {
  if (!mod || typeof mod !== 'object') {
    return 'Plugin module does not export an object';
  }

  const plugin = mod as Record<string, unknown>;

  if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
    return 'Plugin must export a "name" string';
  }

  if (typeof plugin.description !== 'string' || plugin.description.length === 0) {
    return 'Plugin must export a "description" string';
  }

  if (typeof plugin.displayName !== 'string' || plugin.displayName.length === 0) {
    return 'Plugin must export a "displayName" string';
  }

  if (!Array.isArray(plugin.parameters)) {
    return 'Plugin must export a "parameters" array';
  }

  if (typeof plugin.execute !== 'function') {
    return 'Plugin must export an "execute" function';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load a single plugin from its directory.
 * Returns the LoadedPlugin or null on failure.
 */
function loadPluginFromDir(dirPath: string): LoadedPlugin | null {
  const manifestPath = path.join(dirPath, 'plugin.json');

  // Read and parse manifest
  let manifestRaw: unknown;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifestRaw = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugins] Failed to read ${manifestPath}: ${msg}`);
    return null;
  }

  // Validate manifest
  const manifestError = validateManifest(manifestRaw);
  if (manifestError) {
    console.warn(`[plugins] Invalid manifest in ${dirPath}: ${manifestError}`);
    return null;
  }

  const manifest = manifestRaw as PluginManifest;

  // Load entry point via require()
  const entryPath = path.resolve(dirPath, manifest.entry);
  if (!fs.existsSync(entryPath)) {
    console.warn(`[plugins] Entry point not found: ${entryPath}`);
    return null;
  }

  let pluginModule: unknown;
  try {
    // Clear require cache to support hot reload
    delete require.cache[require.resolve(entryPath)];
    pluginModule = require(entryPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugins] Failed to load ${entryPath}: ${msg}`);
    return null;
  }

  // Handle potential { default: ... } exports
  const mod = pluginModule && typeof pluginModule === 'object' && 'default' in (pluginModule as object)
    ? (pluginModule as { default: unknown }).default
    : pluginModule;

  // Validate plugin interface
  const pluginError = validatePlugin(mod);
  if (pluginError) {
    console.warn(`[plugins] Invalid plugin in ${dirPath}: ${pluginError}`);
    return null;
  }

  const plugin = mod as ToolPlugin;

  // Verify name matches manifest
  if (plugin.name !== manifest.name) {
    console.warn(`[plugins] Plugin name "${plugin.name}" does not match manifest name "${manifest.name}" in ${dirPath}`);
    return null;
  }

  console.log(`[plugins] Loaded plugin: ${plugin.name} v${manifest.version}`);

  return {
    manifest,
    plugin,
    enabled: true,
    directory: dirPath,
  };
}

/**
 * Scan the plugins directory and load all valid plugins.
 * Called once at startup. Errors are logged but do not crash the app.
 */
export function loadPlugins(): void {
  pluginsDir = resolvePluginsDir();

  // Ensure plugins directory exists
  if (!fs.existsSync(pluginsDir)) {
    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[plugins] Could not create plugins directory ${pluginsDir}: ${msg}`);
    }
    return;
  }

  // Scan subdirectories
  let entries: string[];
  try {
    entries = fs.readdirSync(pluginsDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugins] Could not read plugins directory: ${msg}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(pluginsDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    const loaded = loadPluginFromDir(fullPath);
    if (loaded) {
      loadedPlugins.set(loaded.manifest.name, loaded);
    }
  }

  console.log(`[plugins] Loaded ${loadedPlugins.size} plugin(s) from ${pluginsDir}`);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Get all loaded plugins (including disabled) */
export function getLoadedPlugins(): Map<string, LoadedPlugin> {
  return loadedPlugins;
}

/** Get only enabled plugins */
export function getEnabledPlugins(): LoadedPlugin[] {
  const result: LoadedPlugin[] = [];
  for (const lp of loadedPlugins.values()) {
    if (lp.enabled) {
      result.push(lp);
    }
  }
  return result;
}

/** Get plugin summaries for IPC communication */
export function getPluginSummaries(): PluginSummary[] {
  const summaries: PluginSummary[] = [];
  for (const lp of loadedPlugins.values()) {
    summaries.push({
      name: lp.manifest.name,
      displayName: lp.manifest.displayName,
      description: lp.manifest.description,
      version: lp.manifest.version,
      author: lp.manifest.author ?? lp.plugin.author ?? '',
      enabled: lp.enabled,
      permissions: lp.manifest.permissions ?? [],
    });
  }
  return summaries;
}

/** Get a single plugin by name */
export function getPlugin(name: string): LoadedPlugin | undefined {
  return loadedPlugins.get(name);
}

// ---------------------------------------------------------------------------
// Enable / Disable
// ---------------------------------------------------------------------------

/** Enable a plugin by name. Returns true if found and enabled. */
export function enablePlugin(name: string): boolean {
  const lp = loadedPlugins.get(name);
  if (!lp) return false;
  lp.enabled = true;
  console.log(`[plugins] Enabled: ${name}`);
  return true;
}

/** Disable a plugin by name. Returns true if found and disabled. */
export function disablePlugin(name: string): boolean {
  const lp = loadedPlugins.get(name);
  if (!lp) return false;
  lp.enabled = false;
  console.log(`[plugins] Disabled: ${name}`);
  return true;
}

// ---------------------------------------------------------------------------
// Unload
// ---------------------------------------------------------------------------

/** Unload a plugin by name (remove from registry). Returns true if found. */
export function unloadPlugin(name: string): boolean {
  const lp = loadedPlugins.get(name);
  if (!lp) return false;
  loadedPlugins.delete(name);
  console.log(`[plugins] Unloaded: ${name}`);
  return true;
}

// ---------------------------------------------------------------------------
// Install from path
// ---------------------------------------------------------------------------

/**
 * Install a plugin by copying it from a source directory.
 * The source directory must contain a valid plugin.json.
 * Returns the plugin name on success or an error message on failure.
 */
export function installPluginFromPath(sourcePath: string): { success: boolean; name?: string; error?: string } {
  if (!pluginsDir) {
    pluginsDir = resolvePluginsDir();
  }

  // Validate source
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Source path not found: ${sourcePath}` };
  }

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(sourcePath);
  } catch {
    return { success: false, error: `Cannot read source path: ${sourcePath}` };
  }

  if (!sourceStat.isDirectory()) {
    return { success: false, error: 'Source path must be a directory' };
  }

  // Read and validate manifest
  const manifestPath = path.join(sourcePath, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    return { success: false, error: 'Source directory does not contain plugin.json' };
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return { success: false, error: 'Failed to parse plugin.json' };
  }

  const manifestError = validateManifest(manifestRaw);
  if (manifestError) {
    return { success: false, error: `Invalid manifest: ${manifestError}` };
  }

  const manifest = manifestRaw as PluginManifest;

  // Create target directory
  const targetDir = path.join(pluginsDir, manifest.name);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    return { success: false, error: `Failed to create plugin directory: ${targetDir}` };
  }

  // Copy plugin directory recursively (handles subdirectories like lib/, assets/, etc.)
  try {
    fs.cpSync(sourcePath, targetDir, { recursive: true, force: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to copy plugin files: ${msg}` };
  }

  // Load the newly installed plugin
  const loaded = loadPluginFromDir(targetDir);
  if (!loaded) {
    return { success: false, error: 'Plugin installed but failed to load. Check plugin format.' };
  }

  loadedPlugins.set(loaded.manifest.name, loaded);
  console.log(`[plugins] Installed and loaded: ${manifest.name}`);

  return { success: true, name: manifest.name };
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

/**
 * Uninstall a plugin by name. Removes the directory and unloads from registry.
 */
export function uninstallPlugin(name: string): { success: boolean; error?: string } {
  const lp = loadedPlugins.get(name);
  if (!lp) {
    return { success: false, error: `Plugin not found: ${name}` };
  }

  // Remove directory
  try {
    fs.rmSync(lp.directory, { recursive: true, force: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to remove plugin directory: ${msg}` };
  }

  loadedPlugins.delete(name);
  console.log(`[plugins] Uninstalled: ${name}`);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Hot reload
// ---------------------------------------------------------------------------

/**
 * Watch the plugins directory for changes and reload plugins automatically.
 * Should be called after loadPlugins().
 */
export function watchForChanges(): void {
  if (!pluginsDir) return;

  // Close existing watchers
  stopWatching();

  try {
    const watcher = fs.watch(pluginsDir, { recursive: false }, (eventType, filename) => {
      if (!filename) return;

      const fullPath = path.join(pluginsDir, filename);

      // Small delay to let file writes complete
      setTimeout(() => {
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isDirectory()) return;
        } catch {
          // Directory might have been removed
          const existing = [...loadedPlugins.values()].find(
            (lp) => path.basename(lp.directory) === filename
          );
          if (existing) {
            loadedPlugins.delete(existing.manifest.name);
            console.log(`[plugins] Removed (dir deleted): ${filename}`);
          }
          return;
        }

        // Try to reload plugin from this directory
        const existing = loadedPlugins.get(filename);
        const wasEnabled = existing?.enabled ?? true;

        const loaded = loadPluginFromDir(fullPath);
        if (loaded) {
          loaded.enabled = wasEnabled;
          loadedPlugins.set(loaded.manifest.name, loaded);
          console.log(`[plugins] Reloaded: ${loaded.manifest.name}`);
        }
      }, 500);
    });

    watchers.push(watcher);
    console.log(`[plugins] Watching ${pluginsDir} for changes`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugins] Failed to watch plugins directory: ${msg}`);
  }
}

/** Stop all filesystem watchers */
export function stopWatching(): void {
  for (const w of watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers.length = 0;
}

/** Get the plugins directory path */
export function getPluginsDir(): string {
  return pluginsDir || resolvePluginsDir();
}
