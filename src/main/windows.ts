import { BrowserWindow, screen } from 'electron';

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
