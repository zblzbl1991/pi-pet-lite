import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT } from '../shared/constants';

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

/** Track the chat window to prevent duplicates */
let chatWindow: BrowserWindow | null = null;

/**
 * Create (or focus) the chat BrowserWindow.
 * Singleton pattern: if already exists, show and focus it.
 * The window is positioned near the pet window.
 */
export function createChatWindow(
  htmlPath: string,
  preloadPath: string,
  position?: { x: number; y: number }
): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }

  chatWindow = new BrowserWindow({
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_HEIGHT,
    minWidth: 320,
    minHeight: 400,
    resizable: true,
    title: 'Clawd Chat',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    show: false,
    ...(position ? { x: position.x, y: position.y } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  chatWindow.loadFile(htmlPath);

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  return chatWindow;
}

/**
 * Get the current chat window (may be null if closed).
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
