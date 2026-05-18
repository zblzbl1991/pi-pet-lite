/**
 * IPC handlers for Blackboard store operations.
 * Exposes CRUD operations to the renderer process via ipcMain.handle().
 *
 * Namespace isolation is enforced:
 * - The 'global' namespace can be written by anyone.
 * - Pet namespaces (anything other than 'global') can only be written
 *   by the matching pet. Any process can read any namespace.
 */

import { ipcMain } from 'electron';
import { getBlackboardStore } from '../storage/blackboard';
import type { BlackboardEntryItem } from '../shared/types';
import {
  IPC_BB_GET,
  IPC_BB_SET,
  IPC_BB_DELETE,
  IPC_BB_LIST,
  IPC_BB_QUERY,
} from '../shared/constants';

/**
 * Validate that a writer is allowed to write to the given namespace.
 * Convention: 'global' is writable by anyone. Other namespaces are
 * writable only if the caller provides a matching writerId.
 * For now (single-pet MVP), we allow all writes. Namespace enforcement
 * will be tightened when multi-pet support lands (M4).
 */
function canWrite(_writerId: string | undefined, _namespace: string): boolean {
  // MVP: all writes allowed. Multi-pet enforcement deferred to M4.
  return true;
}

/**
 * Register all Blackboard IPC handlers on ipcMain.
 * Should be called once during bootstrap.
 */
export function registerBlackboardIpcHandlers(): void {
  const store = getBlackboardStore();

  // ---- Get ----
  ipcMain.handle(
    IPC_BB_GET,
    (
      _event: Electron.IpcMainInvokeEvent,
      namespace: string,
      key: string
    ): { success: boolean; error?: string; data?: BlackboardEntryItem | null } => {
      try {
        const result = store.get(namespace, key);
        return { success: true, data: result };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Set ----
  ipcMain.handle(
    IPC_BB_SET,
    (
      _event: Electron.IpcMainInvokeEvent,
      namespace: string,
      key: string,
      value: string,
      ttlMs?: number,
      writerId?: string
    ): { success: boolean; error?: string } => {
      try {
        if (!canWrite(writerId, namespace)) {
          return { success: false, error: `Write access denied for namespace: ${namespace}` };
        }
        store.set(namespace, key, value, ttlMs ? { ttlMs } : undefined);
        return { success: true };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Delete ----
  ipcMain.handle(
    IPC_BB_DELETE,
    (
      _event: Electron.IpcMainInvokeEvent,
      namespace: string,
      key: string,
      writerId?: string
    ): { success: boolean; error?: string; data?: boolean } => {
      try {
        if (!canWrite(writerId, namespace)) {
          return { success: false, error: `Write access denied for namespace: ${namespace}` };
        }
        const deleted = store.delete(namespace, key);
        return { success: true, data: deleted };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- List ----
  ipcMain.handle(
    IPC_BB_LIST,
    (
      _event: Electron.IpcMainInvokeEvent,
      namespace: string,
      prefix?: string
    ): { success: boolean; error?: string; data?: BlackboardEntryItem[] } => {
      try {
        const entries = store.list(namespace, prefix);
        return { success: true, data: entries };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ---- Query ----
  ipcMain.handle(
    IPC_BB_QUERY,
    (
      _event: Electron.IpcMainInvokeEvent,
      namespace: string,
      filter: Record<string, unknown>
    ): { success: boolean; error?: string; data?: BlackboardEntryItem[] } => {
      try {
        const entries = store.query(namespace, filter);
        return { success: true, data: entries };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
  );
}
