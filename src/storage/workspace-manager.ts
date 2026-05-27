/**
 * Workspace Manager for multi-workspace isolation.
 *
 * Each workspace is a separate data directory under userData/workspaces/.
 * A workspace contains its own config.json, sessions.db, blackboard.db, and plugins/.
 *
 * The workspace registry (workspace-registry.json) tracks all workspaces
 * and identifies the active (current) workspace and the default workspace.
 *
 * All operations are synchronous (matching the project's config-store pattern).
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';
import {
  CONFIG_FILENAME,
  BLACKBOARD_DB_FILENAME,
  SESSIONS_DB_FILENAME,
  WORKSPACE_DIR_NAME,
  WORKSPACE_REGISTRY_FILENAME,
} from '../shared/constants';
import type { WorkspaceInfo } from '../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The workspace registry persisted to disk */
interface WorkspaceRegistry {
  /** All registered workspaces */
  workspaces: WorkspaceInfo[];
  /** ID of the currently active workspace */
  activeWorkspaceId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the base path for all workspace directories.
 * Located at <userData>/workspaces/
 */
function getWorkspacesBasePath(): string {
  if (app && typeof app.getPath === 'function') {
    return path.join(app.getPath('userData'), WORKSPACE_DIR_NAME);
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return path.join(envPath, WORKSPACE_DIR_NAME);
  }
  throw new Error('Cannot determine userData path: not in main process and CLAWD_USER_DATA env not set');
}

/**
 * Get the path to the workspace registry file.
 */
function getRegistryPath(): string {
  if (app && typeof app.getPath === 'function') {
    return path.join(app.getPath('userData'), WORKSPACE_REGISTRY_FILENAME);
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return path.join(envPath, WORKSPACE_REGISTRY_FILENAME);
  }
  throw new Error('Cannot determine userData path');
}

/**
 * Generate a unique workspace directory name.
 * Uses a short random hex string prefixed with 'ws-'.
 */
function generateWorkspaceId(): string {
  const hex = crypto.randomBytes(4).toString('hex');
  return `ws-${hex}`;
}

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

/**
 * Manages workspace lifecycle: create, delete, rename, list, switch.
 *
 * The manager operates on the workspace registry file and the filesystem
 * directories that back each workspace.
 */
export class WorkspaceManager {
  private registryPath: string;
  private workspacesBasePath: string;
  private registry: WorkspaceRegistry;

  constructor() {
    this.registryPath = getRegistryPath();
    this.workspacesBasePath = getWorkspacesBasePath();
    this.registry = this.loadRegistry();
    this.ensureDefaultWorkspace();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * List all registered workspaces.
   */
  list(): WorkspaceInfo[] {
    return [...this.registry.workspaces];
  }

  /**
   * Get a workspace by its ID.
   */
  get(workspaceId: string): WorkspaceInfo | undefined {
    return this.registry.workspaces.find((w) => w.id === workspaceId);
  }

  /**
   * Get the currently active workspace.
   */
  getActive(): WorkspaceInfo {
    const active = this.registry.workspaces.find((w) => w.id === this.registry.activeWorkspaceId);
    if (active) return active;
    // Fallback: return the first workspace or the default
    const defaultWs = this.registry.workspaces.find((w) => w.isDefault);
    return defaultWs ?? this.registry.workspaces[0];
  }

  /**
   * Get the active workspace's data directory path.
   * This is the directory that should be used as the effective "userData"
   * for the current workspace's config, sessions, blackboard, etc.
   */
  getActiveDataPath(): string {
    return this.getActive().path;
  }

  /**
   * Create a new workspace.
   *
   * @param name - Human-readable name for the workspace
   * @param setAsDefault - Whether this should become the default workspace
   * @returns The newly created WorkspaceInfo
   */
  create(name: string, setAsDefault: boolean = false): WorkspaceInfo {
    const id = generateWorkspaceId();
    const wsPath = path.join(this.workspacesBasePath, id);

    // Create the workspace directory structure
    fs.mkdirSync(wsPath, { recursive: true });

    const workspace: WorkspaceInfo = {
      id,
      name,
      path: wsPath,
      createdAt: Date.now(),
      isDefault: setAsDefault,
    };

    // If this is set as default, clear the flag from other workspaces
    if (setAsDefault) {
      for (const ws of this.registry.workspaces) {
        ws.isDefault = false;
      }
    }

    this.registry.workspaces.push(workspace);
    this.saveRegistry();

    return workspace;
  }

  /**
   * Delete a workspace by ID.
   *
   * Cannot delete the active workspace or a workspace that doesn't exist.
   * Removes the workspace directory and all its contents from disk.
   *
   * @param workspaceId - The workspace ID to delete
   */
  delete(workspaceId: string): void {
    if (workspaceId === this.registry.activeWorkspaceId) {
      throw new Error('Cannot delete the active workspace. Switch to another workspace first.');
    }

    const index = this.registry.workspaces.findIndex((w) => w.id === workspaceId);
    if (index === -1) {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }

    const workspace = this.registry.workspaces[index];

    // Remove the workspace directory from disk
    try {
      fs.rmSync(workspace.path, { recursive: true, force: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workspace] Failed to delete workspace directory: ${msg}`);
      // Continue with registry removal even if directory deletion fails
    }

    this.registry.workspaces.splice(index, 1);
    this.saveRegistry();
  }

  /**
   * Rename a workspace.
   *
   * @param workspaceId - The workspace ID to rename
   * @param newName - The new name
   */
  rename(workspaceId: string, newName: string): void {
    const workspace = this.registry.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }
    workspace.name = newName;
    this.saveRegistry();
  }

  /**
   * Switch to a different workspace.
   *
   * This updates the active workspace ID in the registry.
   * The caller is responsible for tearing down current instances
   * and re-initializing with the new workspace's data path.
   *
   * @param workspaceId - The workspace to switch to
   * @returns The new active workspace info
   */
  switchWorkspace(workspaceId: string): WorkspaceInfo {
    const workspace = this.registry.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }

    this.registry.activeWorkspaceId = workspaceId;
    this.saveRegistry();

    return workspace;
  }

  /**
   * Set a workspace as the default (loaded on startup).
   * If the workspace is already the default, clears the default flag (toggle behavior).
   *
   * @param workspaceId - The workspace to set as default (or unset if already default)
   */
  setDefault(workspaceId: string): void {
    const workspace = this.registry.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }

    if (workspace.isDefault) {
      // Toggle off: clear default flag
      workspace.isDefault = false;
    } else {
      // Clear default flag from all workspaces, then set on target
      for (const ws of this.registry.workspaces) {
        ws.isDefault = false;
      }
      workspace.isDefault = true;
    }
    this.saveRegistry();
  }

  /**
   * Export a workspace as a JSON-serializable object.
   * Includes all data files in the workspace directory.
   *
   * @param workspaceId - The workspace to export
   * @returns An object containing the workspace info and file contents
   */
  exportWorkspace(workspaceId: string): {
    info: WorkspaceInfo;
    files: Record<string, string>;
  } {
    const workspace = this.registry.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }

    const files: Record<string, string> = {};

    // Read all data files from the workspace directory
    const filenames = [
      CONFIG_FILENAME,
      SESSIONS_DB_FILENAME,
      BLACKBOARD_DB_FILENAME,
    ];

    for (const filename of filenames) {
      const filePath = path.join(workspace.path, filename);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        files[filename] = buffer.toString('base64');
      }
    }

    return { info: { ...workspace }, files };
  }

  /**
   * Import a workspace from exported data.
   *
   * Creates a new workspace with the exported data.
   *
   * @param data - The exported workspace data
   * @param name - Optional name override (defaults to exported name + " (imported)")
   * @returns The newly created workspace
   */
  importWorkspace(
    data: { info: { name: string }; files: Record<string, string> },
    name?: string
  ): WorkspaceInfo {
    const workspaceName = name ?? `${data.info.name} (imported)`;
    const workspace = this.create(workspaceName);

    // Write all exported files to the new workspace directory
    for (const [filename, base64Content] of Object.entries(data.files)) {
      const filePath = path.join(workspace.path, filename);
      const buffer = Buffer.from(base64Content, 'base64');
      fs.writeFileSync(filePath, buffer);
    }

    return workspace;
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /**
   * Load the workspace registry from disk.
   * Creates a default registry if none exists.
   */
  private loadRegistry(): WorkspaceRegistry {
    try {
      if (fs.existsSync(this.registryPath)) {
        const raw = fs.readFileSync(this.registryPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<WorkspaceRegistry>;
        return {
          workspaces: parsed.workspaces ?? [],
          activeWorkspaceId: parsed.activeWorkspaceId ?? '',
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workspace] Failed to load registry: ${msg}`);
    }

    return {
      workspaces: [],
      activeWorkspaceId: '',
    };
  }

  /**
   * Save the workspace registry to disk.
   */
  private saveRegistry(): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
  }

  /**
   * Ensure a default workspace exists.
   * If no workspaces are registered, creates a "Default" workspace.
   */
  private ensureDefaultWorkspace(): void {
    if (this.registry.workspaces.length === 0) {
      // Create the default workspace
      const defaultWs = this.create('Default', true);
      this.registry.activeWorkspaceId = defaultWs.id;
      this.saveRegistry();
    }

    // Ensure activeWorkspaceId points to a valid workspace
    if (!this.registry.activeWorkspaceId ||
        !this.registry.workspaces.find((w) => w.id === this.registry.activeWorkspaceId)) {
      const defaultWs = this.registry.workspaces.find((w) => w.isDefault) ?? this.registry.workspaces[0];
      if (defaultWs) {
        this.registry.activeWorkspaceId = defaultWs.id;
        this.saveRegistry();
      }
    }
  }
}
