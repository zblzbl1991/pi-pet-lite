/**
 * Workflow file loader.
 *
 * Scans the ~/.clawd/workflows/ directory for .yaml, .yml, and .json files,
 * parses each into a WorkflowDefinition, and caches the results.
 * Supports hot reload via fs.watch.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflowFile, validateWorkflow } from './parser';
import type { WorkflowDefinition } from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Cached loaded workflows keyed by name */
const loadedWorkflows = new Map<string, WorkflowDefinition>();

/** Active filesystem watchers */
const watchers: fs.FSWatcher[] = [];

/** Path to the workflows directory */
let workflowsDir = '';

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the workflows directory path.
 * Uses CLAWD_USER_DATA env var (set by main process), falling back to ~/.clawd/.
 */
function resolveWorkflowsDir(): string {
  const userData = process.env.CLAWD_USER_DATA;
  if (userData) {
    return path.join(userData, 'workflows');
  }
  const home = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH || '';
  return path.join(home, '.clawd', 'workflows');
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Supported file extensions */
const SUPPORTED_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

/**
 * Scan the workflows directory and load all valid workflow files.
 * Called once at startup. Errors are logged but do not crash the app.
 */
export function loadWorkflows(): void {
  workflowsDir = resolveWorkflowsDir();

  // Ensure workflows directory exists
  if (!fs.existsSync(workflowsDir)) {
    try {
      fs.mkdirSync(workflowsDir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workflow] Could not create workflows directory ${workflowsDir}: ${msg}`);
    }
    return;
  }

  // Scan for workflow files
  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workflow] Could not read workflows directory: ${msg}`);
    return;
  }

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(workflowsDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) continue;

    const definition = parseWorkflowFile(fullPath);
    if (definition) {
      // Validate
      const errors = validateWorkflow(definition);
      if (errors.length > 0) {
        console.warn(
          `[workflow] Validation errors in ${entry}: ${errors.map((e) => e.message).join('; ')}`
        );
        // Still load it but log the warnings
      }
      loadedWorkflows.set(definition.name, definition);
      console.log(`[workflow] Loaded: "${definition.name}" (${definition.steps.length} steps) from ${entry}`);
    }
  }

  console.log(`[workflow] Loaded ${loadedWorkflows.size} workflow(s) from ${workflowsDir}`);
}

/**
 * Reload all workflows from disk.
 */
export function reloadWorkflows(): WorkflowDefinition[] {
  loadedWorkflows.clear();
  loadWorkflows();
  return getWorkflowDefinitions();
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Get all loaded workflow definitions */
export function getWorkflowDefinitions(): WorkflowDefinition[] {
  return Array.from(loadedWorkflows.values());
}

/** Get a single workflow by name */
export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return loadedWorkflows.get(name);
}

/** Get the workflows directory path */
export function getWorkflowsDir(): string {
  return workflowsDir || resolveWorkflowsDir();
}

// ---------------------------------------------------------------------------
// Hot reload
// ---------------------------------------------------------------------------

/**
 * Watch the workflows directory for changes and reload automatically.
 */
export function watchForChanges(): void {
  if (!workflowsDir) return;

  stopWatching();

  try {
    const watcher = fs.watch(workflowsDir, { recursive: false }, (_eventType, filename) => {
      if (!filename) return;

      const ext = path.extname(filename).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) return;

      // Small delay to let file writes complete
      setTimeout(() => {
        const fullPath = path.join(workflowsDir, filename!);
        try {
          if (!fs.existsSync(fullPath)) {
            // File was deleted - find and remove the workflow
            for (const [name, def] of loadedWorkflows) {
              if (fullPath.endsWith(`${path.sep}${filename}`)) {
                loadedWorkflows.delete(name);
                console.log(`[workflow] Removed: "${name}" (file deleted)`);
                break;
              }
            }
            return;
          }

          const definition = parseWorkflowFile(fullPath);
          if (definition) {
            loadedWorkflows.set(definition.name, definition);
            console.log(`[workflow] Reloaded: "${definition.name}"`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[workflow] Error reloading ${filename}: ${msg}`);
        }
      }, 500);
    });

    watchers.push(watcher);
    console.log(`[workflow] Watching ${workflowsDir} for changes`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workflow] Failed to watch workflows directory: ${msg}`);
  }
}

/** Stop all filesystem watchers */
export function stopWatching(): void {
  for (const w of watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers.length = 0;
}
