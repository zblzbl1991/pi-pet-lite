import { BrowserWindow, screen } from 'electron';
import path from 'path';
import {
  CHAT_WINDOW_WIDTH,
  QUICK_INPUT_WIDTH,
  QUICK_INPUT_HEIGHT,
} from '../shared/constants';

/**
 * Create the pet BrowserWindow as a small, transparent, always-on-top window.
 * Uses frame:false + transparent:true for a clean frameless appearance.
 */
export function createPetWindow(
  rendererPath: string,
  preloadPath: string
): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workArea;

  const petSize = 128;
  const petLocalX = (160 - petSize) / 2;
  const petLocalY = 160 - petSize;

  const win = new BrowserWindow({
    width: 160,
    height: 160,
    x: Math.round(width * 0.45 - petLocalX),
    y: Math.round(height * 0.65 - petLocalY),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    thickFrame: false,
    title: '',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Start fully click-through; renderer toggles based on pixel alpha
  win.setIgnoreMouseEvents(true, { forward: true });

  // Use 'floating' level so pet stays above normal windows but below taskbar
  win.setAlwaysOnTop(true, 'floating');

  // Explicitly set empty title and hide from taskbar
  win.setTitle('');
  win.setSkipTaskbar(true);
  // win.setFocusable(false);
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
    width: 680,
    height: 520,
    minWidth: 560,
    minHeight: 420,
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

/** Track the chat sidebar window (singleton, hidden not destroyed) */
let chatWindow: BrowserWindow | null = null;

/**
 * Create the chat sidebar BrowserWindow.
 * Frameless, full-height, positioned at the right edge of the display nearest to the pet.
 * Starts hidden; use showChatWindow() to trigger slide-in.
 */
export function createChatWindow(
  htmlPath: string,
  preloadPath: string,
  petPoint?: { x: number; y: number }
): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) {
    return chatWindow;
  }

  const display = petPoint
    ? screen.getDisplayNearestPoint(petPoint)
    : screen.getPrimaryDisplay();
  const wa = display.workArea;

  chatWindow = new BrowserWindow({
    width: CHAT_WINDOW_WIDTH,
    height: wa.height,
    x: wa.x + wa.width - CHAT_WINDOW_WIDTH,
    y: wa.y,
    minWidth: 320,
    minHeight: 400,
    resizable: true,
    frame: false,
    skipTaskbar: true,
    title: '',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  chatWindow.loadFile(htmlPath);

  // Prevent actual close — hide instead (window persists in memory)
  chatWindow.on('close', (e) => {
    e.preventDefault();
    hideChatWindow();
  });

  return chatWindow;
}

/**
 * Show the chat sidebar and trigger slide-in animation via IPC.
 * Repositions to the display nearest to the pet point.
 */
export function showChatWindow(petPoint?: { x: number; y: number }): void {
  if (!chatWindow || chatWindow.isDestroyed()) return;

  // Reposition to the display where the pet is
  const display = petPoint
    ? screen.getDisplayNearestPoint(petPoint)
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const targetX = wa.x + wa.width - CHAT_WINDOW_WIDTH;
  const targetY = wa.y;

  // Use setSize + setPosition separately for reliable cross-monitor resize
  chatWindow.setSize(CHAT_WINDOW_WIDTH, wa.height);
  chatWindow.setPosition(targetX, targetY);

  chatWindow.show();
  chatWindow.webContents.send('chat:slide-in');
}

/**
 * Trigger slide-out animation. Window is hidden after animation completes
 * (renderer sends 'chat:slide-out-complete').
 */
export function hideChatWindow(): void {
  if (!chatWindow || chatWindow.isDestroyed() || !chatWindow.isVisible()) return;
  chatWindow.webContents.send('chat:slide-out');
}

/**
 * Actually hide the window (called after slide-out animation completes).
 */
export function forceHideChatWindow(): void {
  if (!chatWindow || chatWindow.isDestroyed()) return;
  chatWindow.hide();
}

/**
 * Get the current chat window (may be null if not yet created).
 */
export function getChatWindow(): BrowserWindow | null {
  return chatWindow && !chatWindow.isDestroyed() ? chatWindow : null;
}

/**
 * Resolve the path to the chat renderer HTML.
 */
export function getChatHtmlPath(): string {
  return path.join(__dirname, '..', 'renderer', 'chat', 'index.html');
}

/** Track the quick input window */
let quickInputWindow: BrowserWindow | null = null;

/**
 * Create the quick input BrowserWindow as a small transparent bubble.
 * Positioned above the pet. Auto-closes on blur after 200ms delay.
 */
export function createQuickInputWindow(
  htmlPath: string,
  preloadPath: string,
  position: { x: number; y: number }
): BrowserWindow {
  // If already open, destroy and recreate (fresh state each time)
  if (quickInputWindow && !quickInputWindow.isDestroyed()) {
    quickInputWindow.destroy();
    quickInputWindow = null;
  }

  quickInputWindow = new BrowserWindow({
    width: QUICK_INPUT_WIDTH,
    height: QUICK_INPUT_HEIGHT,
    x: position.x,
    y: position.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    thickFrame: false,
    title: '',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  quickInputWindow.setAlwaysOnTop(true, 'floating');

  quickInputWindow.loadFile(htmlPath);

  quickInputWindow.once('ready-to-show', () => {
    quickInputWindow?.show();
    quickInputWindow?.focus();
  });

  // Close on blur after 200ms delay (unless submit already happened)
  quickInputWindow.on('blur', () => {
    setTimeout(() => {
      if (quickInputWindow && !quickInputWindow.isDestroyed()) {
        quickInputWindow.close();
      }
    }, 200);
  });

  quickInputWindow.on('closed', () => {
    quickInputWindow = null;
  });

  return quickInputWindow;
}

/**
 * Get the current quick input window (may be null if closed).
 */
export function getQuickInputWindow(): BrowserWindow | null {
  return quickInputWindow && !quickInputWindow.isDestroyed()
    ? quickInputWindow
    : null;
}

/**
 * Close the quick input window if it exists.
 */
export function closeQuickInputWindow(): void {
  if (quickInputWindow && !quickInputWindow.isDestroyed()) {
    quickInputWindow.close();
  }
}

/**
 * Resolve the path to the quick input renderer HTML.
 */
export function getQuickInputHtmlPath(): string {
  return path.join(__dirname, '..', 'renderer', 'quick-input', 'index.html');
}
