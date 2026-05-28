/**
 * IPC handlers for workspace management operations.
 * Exposes workspace CRUD, switching, export/import to the renderer process
 * via ipcMain.handle().
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { WorkspaceManager } from '../storage/workspace-manager';
import { setConfigBasePath } from '../config/config-store';
import type { WorkspaceInfo } from '../shared/types';
import {
  IPC_WORKSPACE_LIST,
  IPC_WORKSPACE_CREATE,
  IPC_WORKSPACE_DELETE,
  IPC_WORKSPACE_RENAME,
  IPC_WORKSPACE_SWITCH,
  IPC_WORKSPACE_EXPORT,
  IPC_WORKSPACE_IMPORT,
  IPC_WORKSPACE_SET_DEFAULT,
  IPC_WORKSPACE_GET_ACTIVE,
} from '../shared/constants';

/** Singleton workspace manager instance */
let manager: WorkspaceManager | null = null;

/**
 * Callback type for when a workspace switch is requested.
 * The main process needs to tear down the current agent process
 * and re-initialize with the new workspace data path.
 */
export type WorkspaceSwitchCallback = (
  newWorkspace: WorkspaceInfo
) => Promise<void>;

let switchCallback: WorkspaceSwitchCallback | null = null;

/**
 * Register all workspace IPC handlers on ipcMain.
 * Should be called once during bootstrap.
 */
export function registerWorkspaceIpcHandlers(
  onSwitch?: WorkspaceSwitchCallback
): WorkspaceManager {
  manager = new WorkspaceManager();
  switchCallback = onSwitch ?? null;

  // Set the config base path to the active workspace
  const active = manager.getActive();
  setConfigBasePath(active.path);

  // ---- List ----
  ipcMain.handle(IPC_WORKSPACE_LIST, () => {
    try {
      return { success: true, data: manager!.list() };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  });

  // ---- Create ----
  ipcMain.handle(
    IPC_WORKSPACE_CREATE,
    (
      _event: Electron.IpcMainInvokeEvent,
      name: string,
      setAsDefault?: boolean
    ) => {
      try {
        if (!name || !name.trim()) {
          return { success: false, error: 'Workspace name cannot be empty' };
        }
        const workspace = manager!.create(name.trim(), setAsDefault ?? false);
        return { success: true, data: workspace };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Delete ----
  ipcMain.handle(
    IPC_WORKSPACE_DELETE,
    (_event: Electron.IpcMainInvokeEvent, workspaceId: string) => {
      try {
        manager!.delete(workspaceId);
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Rename ----
  ipcMain.handle(
    IPC_WORKSPACE_RENAME,
    (
      _event: Electron.IpcMainInvokeEvent,
      workspaceId: string,
      newName: string
    ) => {
      try {
        if (!newName || !newName.trim()) {
          return { success: false, error: 'Workspace name cannot be empty' };
        }
        manager!.rename(workspaceId, newName.trim());
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Switch ----
  ipcMain.handle(
    IPC_WORKSPACE_SWITCH,
    async (
      _event: Electron.IpcMainInvokeEvent,
      workspaceId: string
    ) => {
      try {
        const newWorkspace = manager!.switchWorkspace(workspaceId);

        // Update config base path
        setConfigBasePath(newWorkspace.path);

        // Notify callback to tear down and reinitialize
        if (switchCallback) {
          await switchCallback(newWorkspace);
        }

        return { success: true, data: newWorkspace };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Export ----
  ipcMain.handle(
    IPC_WORKSPACE_EXPORT,
    (_event: Electron.IpcMainInvokeEvent, workspaceId: string) => {
      try {
        const data = manager!.exportWorkspace(workspaceId);

        // Show save dialog
        const result = dialog.showSaveDialogSync(
          BrowserWindow.getFocusedWindow() ?? undefined,
          {
            title: 'Export Workspace',
            defaultPath: `${data.info.name}.clawd-workspace.json`,
            filters: [
              { name: 'Clawd Workspace', extensions: ['clawd-workspace.json'] },
              { name: 'JSON', extensions: ['json'] },
            ],
          }
        );

        if (!result) {
          return { success: false, error: 'Export cancelled' };
        }

        // Write the exported data to the chosen file
        const fs = require('fs') as typeof import('fs');
        fs.writeFileSync(result, JSON.stringify(data, null, 2), 'utf-8');

        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Import ----
  ipcMain.handle(IPC_WORKSPACE_IMPORT, async () => {
    try {
      const result = await dialog.showOpenDialog(
        BrowserWindow.getFocusedWindow() ?? undefined,
        {
          title: 'Import Workspace',
          filters: [
            { name: 'Clawd Workspace', extensions: ['clawd-workspace.json'] },
            { name: 'JSON', extensions: ['json'] },
          ],
          properties: ['openFile'],
        }
      );

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Import cancelled' };
      }

      const fs = require('fs') as typeof import('fs');
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw) as {
        info: { name: string };
        files: Record<string, string>;
      };

      const workspace = manager!.importWorkspace(data);
      return { success: true, data: workspace };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  });

  // ---- Set Default ----
  ipcMain.handle(
    IPC_WORKSPACE_SET_DEFAULT,
    (_event: Electron.IpcMainInvokeEvent, workspaceId: string) => {
      try {
        manager!.setDefault(workspaceId);
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Get Active ----
  ipcMain.handle(IPC_WORKSPACE_GET_ACTIVE, () => {
    try {
      return { success: true, data: manager!.getActive() };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  });

  return manager;
}

/**
 * Get the workspace manager instance.
 */
export function getWorkspaceManager(): WorkspaceManager | null {
  return manager;
}
