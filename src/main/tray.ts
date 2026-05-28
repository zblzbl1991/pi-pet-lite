import { Tray, Menu, app, nativeImage } from 'electron';
import { THEME_TRAY_ICON } from '../shared/theme-constants';
import type { WorkspaceInfo } from '../shared/types';

let tray: Tray | null = null;

// Callbacks stored for rebuilding the menu
let onOpenSettings: () => void = () => {};
let onToggleVisibility: () => void = () => {};
let onOpenDevTools: () => void = () => {};
let onSwitchWorkspace: ((workspaceId: string) => void) | null = null;

/**
 * Create the system tray icon with context menu.
 */
export function createTray(
  openSettings: () => void,
  toggleVisibility: () => void,
  openDevTools: () => void,
  switchWorkspace?: (workspaceId: string) => void
): Tray {
  onOpenSettings = openSettings;
  onToggleVisibility = toggleVisibility;
  onOpenDevTools = openDevTools;
  onSwitchWorkspace = switchWorkspace ?? null;

  // Create a simple programmatic tray icon (16x16 green circle)
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist < size / 2 - 1) {
        // Green circle
        buffer[offset] = THEME_TRAY_ICON.r; // R
        buffer[offset + 1] = THEME_TRAY_ICON.g; // G
        buffer[offset + 2] = THEME_TRAY_ICON.b; // B
        buffer[offset + 3] = 255; // A
      } else {
        buffer[offset + 3] = 0; // Transparent
      }
    }
  }
  const trayIcon = nativeImage.createFromBuffer(buffer, {
    width: size,
    height: size,
  });

  tray = new Tray(trayIcon);
  tray.setToolTip('Clawd Desktop Pet');

  buildMenu([], null);

  // Double-click toggles visibility
  tray.on('double-click', () => {
    onToggleVisibility();
  });

  return tray;
}

/**
 * Build the tray context menu, optionally including workspace switching submenu.
 */
function buildMenu(workspaces: WorkspaceInfo[], activeWorkspace: WorkspaceInfo | null): void {
  if (!tray) return;

  const workspaceItems: Electron.MenuItemConstructorOptions[] = workspaces.map((ws) => ({
    label: ws.name + (ws.id === activeWorkspace?.id ? ' (active)' : '') + (ws.isDefault ? ' *' : ''),
    type: 'checkbox' as const,
    checked: ws.id === activeWorkspace?.id,
    enabled: ws.id !== activeWorkspace?.id,
    click: () => {
      if (onSwitchWorkspace) {
        onSwitchWorkspace(ws.id);
      }
    },
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Clawd v0.1.0', enabled: false },
    { type: 'separator' },
    {
      label: 'Show / Hide',
      click: () => {
        onToggleVisibility();
      },
    },
    {
      label: 'Settings',
      click: () => {
        onOpenSettings();
      },
    },
    {
      label: 'DevTools',
      click: () => {
        onOpenDevTools();
      },
    },
    ...(workspaceItems.length > 1 ? [
      { type: 'separator' as const },
      { label: 'Workspaces', submenu: Menu.buildFromTemplate(workspaceItems) },
    ] : []),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Rebuild the tray menu with workspace information.
 */
export function rebuildTrayMenu(active: WorkspaceInfo, workspaces: WorkspaceInfo[]): void {
  buildMenu(workspaces, active);
}
