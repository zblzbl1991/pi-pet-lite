import { BrowserWindow, screen } from 'electron';
import path from 'path';

/**
 * Create the pet overlay BrowserWindow.
 * Uses full-screen transparent overlay approach:
 * - Covers the entire work area
 * - Transparent background
 * - Click-through by default (setIgnoreMouseEvents)
 * - Pet rendered at a specific (x,y) within the canvas
 */
export function createPetWindow(
  rendererPath: string,
  preloadPath: string
): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  const win = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: workArea.x,
    y: workArea.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    thickFrame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: false,
      plugins: false,
      images: true,
    },
  });

  // Start fully click-through; renderer toggles based on pixel alpha
  win.setIgnoreMouseEvents(true, { forward: true });

  // Use 'floating' level so pet stays above normal windows but below taskbar
  win.setAlwaysOnTop(true, 'floating');

  return win;
}

/** Track the settings window to prevent duplicates */
let settingsWindow: BrowserWindow | null = null;

/**
 * Create (or focus) the settings BrowserWindow.
 * This is a normal window -- not transparent, not always-on-top.
 * Dark theme matching the pet's chat bubble style.
 */
export function createSettingsWindow(
  settingsHtmlPath: string,
  preloadPath: string
): BrowserWindow {
  // If settings window already exists, focus and return it
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 480,
    minWidth: 400,
    minHeight: 360,
    resizable: true,
    title: 'Clawd Settings',
    backgroundColor: '#1a1c1f',
    autoHideMenuBar: true,
    center: true,
    alwaysOnTop: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.loadFile(settingsHtmlPath);

  // Show window once content is ready to avoid flash
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });

  // Clean up reference when the window is closed
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

/**
 * Resolve the path to the settings renderer HTML.
 * Looks for the Vite-bundled output in dist/renderer/settings/index.html.
 */
export function getSettingsHtmlPath(): string {
  return path.join(__dirname, '..', 'renderer', 'settings', 'index.html');
}
