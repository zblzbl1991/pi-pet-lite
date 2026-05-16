import {
  app,
  BrowserWindow,
  MessageChannelMain,
  utilityProcess,
  ipcMain,
  screen,
} from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  createPetWindow,
  createSettingsWindow,
  createChatWindow,
  getSettingsHtmlPath,
  getChatHtmlPath,
  getChatWindow,
  createQuickInputWindow,
  closeQuickInputWindow,
  getQuickInputHtmlPath,
} from './windows';
import { createTray } from './tray';
import {
  IPC_AGENT_MESSAGE,
  IPC_RENDERER_TO_AGENT,
  IPC_CHAT_SYNC,
  IPC_OPEN_CHAT,
  IPC_OPEN_QUICK_INPUT,
  IPC_QUICK_INPUT_SUBMIT,
  IPC_QUICK_INPUT_CANCEL,
  MESSAGE_BUFFER_MAX,
} from '../shared/constants';
import { readConfig, updateLLMConfig, updateNotificationConfig } from '../config/config-store';
import { MessageRole } from '../shared/types';
import type {
  LLMConfig,
  ChatMessage,
  NotificationConfig,
  AgentToRendererMessage,
  RendererToAgentMessage,
} from '../shared/types';

let petWindow: BrowserWindow | null = null;

// Message buffer for ChatWindow history sync
const messageBuffer: ChatMessage[] = [];

function addToBuffer(msg: ChatMessage): void {
  messageBuffer.push(msg);
  while (messageBuffer.length > MESSAGE_BUFFER_MAX) {
    messageBuffer.shift();
  }
}

function updateBufferStream(id: string, delta: string): void {
  const idx = messageBuffer.findIndex((m) => m.id === id);
  if (idx >= 0) {
    messageBuffer[idx] = {
      ...messageBuffer[idx],
      content: messageBuffer[idx].content + delta,
    };
  }
}

function markBufferStreamEnd(id: string): void {
  const idx = messageBuffer.findIndex((m) => m.id === id);
  if (idx >= 0) {
    messageBuffer[idx] = { ...messageBuffer[idx], streaming: false };
  }
}

function broadcastToWindows(msg: AgentToRendererMessage): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send(IPC_AGENT_MESSAGE, msg);
  }
  const chatWin = getChatWindow();
  if (chatWin) {
    chatWin.webContents.send(IPC_AGENT_MESSAGE, msg);
  }
}

/** Send system toast notification if enabled in config */
function sendSystemNotification(state: string): void {
  try {
    const config = readConfig();
    if (!config.notifications?.systemToast) return;

    const { Notification } = require('electron') as typeof import('electron');
    if (!Notification.isSupported()) return;

    const lastAssistantMsg = [...messageBuffer]
      .reverse()
      .find((m) => m.role === 'assistant');

    const body =
      state === 'success'
        ? lastAssistantMsg
          ? truncateText(lastAssistantMsg.content, 100)
          : 'Task completed successfully'
        : 'An error occurred while executing the task';

    new Notification({
      title: state === 'success' ? 'Clawd - Task Complete' : 'Clawd - Task Failed',
      body,
    }).show();
  } catch {
    // Notification not available or config read failed
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Resolve the path to GIF assets.
 * In development, use the project root clawd-gifs/ directory.
 * In production (packaged), use extraResources.
 */
function getGifsBasePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'clawd-gifs');
  }
  return path.join(app.getAppPath(), 'clawd-gifs');
}

function getRendererPath(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

function getSettingsPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'settings-preload.js');
}

function getChatPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'chat-preload.js');
}

function getQuickInputPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'quick-input-preload.js');
}

function getAgentEntryPath(): string {
  return path.join(__dirname, '..', 'agent', 'agent-process.js');
}

/**
 * Compute chat window position near the pet.
 * Places chat to the right of the pet, vertically centered.
 * Falls back to left side if not enough space.
 */
function computeChatPosition(
  petX: number,
  petY: number,
  petWidth: number,
  petHeight: number
): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({
    x: petX + petWidth / 2,
    y: petY + petHeight / 2,
  });
  const wa = display.workArea;

  let cx = petX + petWidth / 2 + 30;
  let cy = petY + petHeight / 2 - 300;

  // If chat overflows right edge, place on left
  if (cx + 400 > wa.x + wa.width) {
    cx = petX + petWidth / 2 - 430;
  }

  // Clamp vertically
  cy = Math.max(wa.y, Math.min(cy, wa.y + wa.height - 600));

  return { x: Math.round(cx), y: Math.round(cy) };
}

/**
 * Compute quick input window position above the pet.
 * Centers the 320px-wide bubble horizontally above the pet.
 * Clamps to screen edges.
 */
function computeQuickInputPosition(
  petX: number,
  petY: number,
  petWidth: number,
  petHeight: number
): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({
    x: petX + petWidth / 2,
    y: petY + petHeight / 2,
  });
  const wa = display.workArea;

  const qiw = 320;
  const qih = 48;
  const gap = 8;

  // Center horizontally above pet
  let qx = petX + petWidth / 2 - qiw / 2;
  let qy = petY - qih - gap;

  // Clamp horizontally to work area
  qx = Math.max(wa.x, Math.min(qx, wa.x + wa.width - qiw));

  // If goes above screen top, place below pet instead
  if (qy < wa.y) {
    qy = petY + petHeight + gap;
  }

  return { x: Math.round(qx), y: Math.round(qy) };
}

function bootstrap(): void {
  // Drag state: main-process polling via screen.getCursorScreenPoint()
  let dragOffset: { x: number; y: number } | null = null;
  let dragInterval: ReturnType<typeof setInterval> | null = null;

  app.whenReady().then(() => {
    const gifsPath = getGifsBasePath();

    // Create the pet overlay window
    petWindow = createPetWindow(getRendererPath(), getPreloadPath());

    const rendererUrl = pathToFileURL(getRendererPath());
    rendererUrl.searchParams.set('gifsPath', gifsPath);
    petWindow.loadURL(rendererUrl.toString());

    // Create system tray
    createTray(
      () => {
        const settingsHtmlPath = getSettingsHtmlPath();
        const settingsPreloadPath = getSettingsPreloadPath();
        createSettingsWindow(settingsHtmlPath, settingsPreloadPath);
      },
      () => {
        if (petWindow) {
          if (petWindow.isVisible()) {
            petWindow.hide();
          } else {
            petWindow.show();
          }
        }
      },
      () => {
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.openDevTools({ mode: 'detach' });
        }
      }
    );

    // ---- Message routing: Agent ←MessagePort→ Main →IPC→ Windows ----
    const { port1: mainPort, port2: agentPort } = new MessageChannelMain();

    // Launch agent utility process
    const agentProc = utilityProcess.fork(getAgentEntryPath(), [], {
      env: { ...process.env, CLAWD_USER_DATA: app.getPath('userData') },
    });
    agentProc.postMessage({ type: 'init' }, [agentPort]);

    // Main process keeps port1: listen for agent messages
    mainPort.on('message', (event: unknown) => {
      const msg = (event as { data: AgentToRendererMessage }).data;

      // Update message buffer
      switch (msg.type) {
        case 'chat-message':
          addToBuffer(msg.message);
          break;
        case 'chat-message-update':
          updateBufferStream(msg.id, msg.delta);
          break;
        case 'chat-message-end':
          markBufferStreamEnd(msg.id);
          break;
      }

      // Broadcast to all windows via IPC
      broadcastToWindows(msg);

      // Auto-show ChatWindow for confirmation requests
      if (msg.type === 'confirmation-request') {
        const chatWin = getChatWindow();
        if (!chatWin) {
          const chatHtmlPath = getChatHtmlPath();
          const chatPreloadPath = getChatPreloadPath();
          let position: { x: number; y: number } | undefined;
          if (petWindow && !petWindow.isDestroyed()) {
            const [px, py] = petWindow.getPosition();
            position = computeChatPosition(px, py, 160, 160);
          }
          createChatWindow(chatHtmlPath, chatPreloadPath, position);
        } else {
          chatWin.show();
          chatWin.focus();
        }
      }

      // System toast notification on task completion
      if (msg.type === 'state-change') {
        if (msg.state === 'success' || msg.state === 'failed') {
          sendSystemNotification(msg.state);
        }
      }
    });
    mainPort.start();

    // Handle messages from renderers → forward to agent
    ipcMain.on(
      IPC_RENDERER_TO_AGENT,
      (_event: Electron.IpcMainEvent, msg: RendererToAgentMessage) => {
        // For user-input: create user message, buffer, broadcast
        if (msg.type === 'user-input') {
          const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: MessageRole.USER,
            content: msg.text,
            timestamp: Date.now(),
          };
          addToBuffer(userMsg);
          broadcastToWindows({
            type: 'chat-message',
            message: userMsg,
          });
        }

        // Forward to agent via MessagePort
        mainPort.postMessage(msg);
      }
    );

    // Chat history sync handler
    ipcMain.handle(IPC_CHAT_SYNC, () => {
      return [...messageBuffer];
    });

    // ---- Open chat window ----
    ipcMain.on(IPC_OPEN_CHAT, () => {
      const chatHtmlPath = getChatHtmlPath();
      const chatPreloadPath = getChatPreloadPath();

      let position: { x: number; y: number } | undefined;
      if (petWindow && !petWindow.isDestroyed()) {
        const [px, py] = petWindow.getPosition();
        position = computeChatPosition(px, py, 160, 160);
      }

      createChatWindow(chatHtmlPath, chatPreloadPath, position);
    });

    // ---- Open quick input bubble ----
    ipcMain.on(IPC_OPEN_QUICK_INPUT, () => {
      if (!petWindow || petWindow.isDestroyed()) return;

      const [px, py] = petWindow.getPosition();
      const position = computeQuickInputPosition(px, py, 160, 160);
      const qiHtmlPath = getQuickInputHtmlPath();
      const qiPreloadPath = getQuickInputPreloadPath();

      createQuickInputWindow(qiHtmlPath, qiPreloadPath, position);
    });

    // ---- Quick input submit ----
    ipcMain.on(
      IPC_QUICK_INPUT_SUBMIT,
      (_event: Electron.IpcMainEvent, text: string) => {
        if (!text.trim()) return;

        // Create user message, add to buffer, broadcast
        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: MessageRole.USER,
          content: text,
          timestamp: Date.now(),
        };
        addToBuffer(userMsg);
        broadcastToWindows({
          type: 'chat-message',
          message: userMsg,
        });

        // Forward to agent via MessagePort
        mainPort.postMessage({ type: 'user-input', text });

        // Close the quick input window
        closeQuickInputWindow();
      }
    );

    // ---- Quick input cancel ----
    ipcMain.on(IPC_QUICK_INPUT_CANCEL, () => {
      closeQuickInputWindow();
    });

    // Handle IPC from renderer for window control
    ipcMain.on(
      'set-ignore-mouse-events',
      (_event: Electron.IpcMainEvent, ignore: boolean) => {
        if (petWindow) {
          petWindow.setIgnoreMouseEvents(ignore, { forward: true });
        }
      }
    );

    // ---- Pet drag via main-process cursor polling ----
    ipcMain.on(
      'pet-drag-start',
      (_event: Electron.IpcMainEvent, offset: { x: number; y: number }) => {
        if (!petWindow || dragInterval) return;
        dragOffset = offset;
        dragInterval = setInterval(() => {
          try {
            if (!petWindow || petWindow.isDestroyed() || !dragOffset) return;
            const cursor = screen.getCursorScreenPoint();
            petWindow.setPosition(
              Math.round(cursor.x - dragOffset.x),
              Math.round(cursor.y - dragOffset.y)
            );
          } catch {
            if (dragInterval) {
              clearInterval(dragInterval);
              dragInterval = null;
            }
            dragOffset = null;
          }
        }, 16);
      }
    );

    ipcMain.on('pet-drag-end', () => {
      if (dragInterval) {
        clearInterval(dragInterval);
        dragInterval = null;
      }
      dragOffset = null;
    });

    ipcMain.on(
      'move-window',
      (_event: Electron.IpcMainEvent, deltaX: number, deltaY: number) => {
        if (petWindow) {
          const [currentX, currentY] = petWindow.getPosition();
          petWindow.setPosition(currentX + deltaX, currentY + deltaY);
        }
      }
    );

    ipcMain.handle('get-window-position', (): { x: number; y: number } => {
      if (petWindow) {
        const [x, y] = petWindow.getPosition();
        return { x, y };
      }
      return { x: 0, y: 0 };
    });

    ipcMain.on('open-settings', () => {
      const settingsHtmlPath = getSettingsHtmlPath();
      const settingsPreloadPath = getSettingsPreloadPath();
      createSettingsWindow(settingsHtmlPath, settingsPreloadPath);
    });

    // ---- Settings window IPC handlers ----

    ipcMain.handle('settings:load-config', () => {
      const config = readConfig();
      return config.llm;
    });

    ipcMain.handle(
      'settings:save-config',
      (_event: Electron.IpcMainInvokeEvent, llm: LLMConfig) => {
        try {
          updateLLMConfig(llm);
          return { success: true };
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return { success: false, error: errorMessage };
        }
      }
    );

    ipcMain.handle(
      'settings:test-connection',
      async (
        _event: Electron.IpcMainInvokeEvent,
        config: LLMConfig
      ): Promise<{ success: boolean; error?: string }> => {
        if (!config.apiKey || config.apiKey.trim().length === 0) {
          return { success: false, error: 'API key is empty' };
        }
        if (!config.provider) {
          return { success: false, error: 'No provider selected' };
        }
        if (!config.model) {
          return { success: false, error: 'No model selected' };
        }

        const dynamicImport = new Function(
          'modulePath',
          'return import(modulePath)'
        ) as <T>(m: string) => Promise<T>;
        try {
          const piAi = await dynamicImport<
            typeof import('@earendil-works/pi-ai')
          >('@earendil-works/pi-ai');
          const model = piAi.getModel(
            config.provider as import('@earendil-works/pi-ai').KnownProvider,
            config.model as Parameters<typeof piAi.getModel>[1]
          );

          const stream = piAi.streamSimple(
            model,
            {
              messages: [
                { role: 'user' as const, content: 'Say "ok"', timestamp: Date.now() },
              ],
            },
            { apiKey: config.apiKey, maxTokens: 5 }
          );

          for await (const _chunk of stream) {
            return { success: true };
          }

          return { success: true };
        } catch (apiErr: unknown) {
          const apiMessage =
            apiErr instanceof Error ? apiErr.message : String(apiErr);
          return { success: false, error: apiMessage };
        }
      }
    );

    // Notification config handlers
    ipcMain.handle('settings:load-notifications', () => {
      const config = readConfig();
      return config.notifications;
    });

    ipcMain.handle(
      'settings:save-notifications',
      (_event: Electron.IpcMainInvokeEvent, notifications: NotificationConfig) => {
        try {
          updateNotificationConfig(notifications);
          return { success: true };
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return { success: false, error: errorMessage };
        }
      }
    );

    ipcMain.on('settings:close', () => {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win.getTitle() === 'Clawd Settings') {
          win.close();
          break;
        }
      }
    });

    app.on('window-all-closed', () => {
      // App continues running in system tray
    });
  });
}

bootstrap();
