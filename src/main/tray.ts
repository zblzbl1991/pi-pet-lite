import { Tray, Menu, app, nativeImage } from 'electron';
import { THEME_TRAY_ICON } from '../shared/theme-constants';

let tray: Tray | null = null;

/**
 * Create the system tray icon with context menu.
 */
export function createTray(
  onOpenSettings: () => void,
  onToggleVisibility: () => void,
  onOpenDevTools: () => void
): Tray {
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
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click toggles visibility
  tray.on('double-click', () => {
    onToggleVisibility();
  });

  return tray;
}
