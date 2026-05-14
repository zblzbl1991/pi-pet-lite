import {
  app,
  BrowserWindow,
  MessageChannelMain,
  utilityProcess,
  ipcMain,
} from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { createPetWindow, createSettingsWindow, getSettingsHtmlPath } from './windows';
import { createTray } from './tray';
import { AGENT_MESSAGE_PORT } from '../shared/constants';
import { readConfig, updateLLMConfig } from '../config/config-store';
import type { LLMConfig } from '../shared/types';

let petWindow: BrowserWindow | null = null;

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

/**
 * Resolve the path to renderer HTML.
 */
function getRendererPath(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

/**
 * Resolve the path to the preload script (compiled output).
 */
function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

/**
 * Resolve the path to the settings preload script (compiled output).
 */
function getSettingsPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'settings-preload.js');
}

/**
 * Resolve the path to the agent utility process entry.
 */
function getAgentEntryPath(): string {
  return path.join(__dirname, '..', 'agent', 'agent-process.js');
}

function bootstrap(): void {
  // Required for transparent windows on Windows with some GPU drivers
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('force-device-scale-factor', '1');

  app.whenReady().then(() => {
    const gifsPath = getGifsBasePath();

    // Create the pet overlay window
    petWindow = createPetWindow(getRendererPath(), getPreloadPath());

    // Pass GIF base path to the renderer via query param.
    // Use pathToFileURL for correct Windows path handling.
    const rendererUrl = pathToFileURL(getRendererPath());
    rendererUrl.searchParams.set('gifsPath', gifsPath);
    petWindow.loadURL(rendererUrl.toString());

    // Create system tray
    createTray(
      () => {
        // Open settings window
        const settingsHtmlPath = getSettingsHtmlPath();
        const settingsPreloadPath = getSettingsPreloadPath();
        createSettingsWindow(settingsHtmlPath, settingsPreloadPath);
      },
      () => {
        // Show/hide pet
        if (petWindow) {
          if (petWindow.isVisible()) {
            petWindow.hide();
          } else {
            petWindow.show();
          }
        }
      }
    );

    // Set up Utility Process with MessagePort to Renderer
    const { port1: rendererPort, port2: agentPort } = new MessageChannelMain();

    // Launch agent utility process
    const agentProc = utilityProcess.fork(getAgentEntryPath());
    agentProc.postMessage({ type: 'init' }, [agentPort]);

    // Connect the renderer's MessagePort after the page finishes loading
    if (petWindow.webContents.isLoading()) {
      petWindow.webContents.on('did-finish-load', () => {
        petWindow?.webContents.postMessage(
          AGENT_MESSAGE_PORT,
          null,
          [rendererPort]
        );
      });
    } else {
      petWindow.webContents.postMessage(AGENT_MESSAGE_PORT, null, [
        rendererPort,
      ]);
    }

    // Handle IPC from renderer for window control
    ipcMain.on(
      'set-ignore-mouse-events',
      (_event: Electron.IpcMainEvent, ignore: boolean) => {
        if (petWindow) {
          petWindow.setIgnoreMouseEvents(ignore, { forward: true });
        }
      }
    );

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
      // Open settings window from renderer request
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
        // Validate config fields before attempting a connection test
        if (!config.apiKey || config.apiKey.trim().length === 0) {
          return { success: false, error: 'API key is empty' };
        }
        if (!config.provider) {
          return { success: false, error: 'No provider selected' };
        }
        if (!config.model) {
          return { success: false, error: 'No model selected' };
        }

        // Attempt a real API call via pi-ai to verify the key works.
        // pi-ai is ESM-only so we use dynamic import from this CJS context.
        try {
          const piAi = await import('@earendil-works/pi-ai');
          const model = piAi.getModel(
            config.provider as import('@earendil-works/pi-ai').KnownProvider,
            config.model as Parameters<typeof piAi.getModel>[1]
          );

          // Use pi-ai's streamSimple to send a minimal request.
          // The API key is passed via the options object.
          const stream = piAi.streamSimple(
            model,
            { messages: [{ role: 'user' as const, content: 'Say "ok"', timestamp: Date.now() }] },
            { apiKey: config.apiKey, maxTokens: 5 }
          );

          for await (const _chunk of stream) {
            // Got at least one chunk -- connection is valid
            return { success: true };
          }

          // Stream completed without chunks (unlikely but handle gracefully)
          return { success: true };
        } catch (apiErr: unknown) {
          const apiMessage =
            apiErr instanceof Error ? apiErr.message : String(apiErr);
          return { success: false, error: apiMessage };
        }
      }
    );

    ipcMain.on('settings:close', () => {
      // Find the settings window and close it
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win.getTitle() === 'Clawd Settings') {
          win.close();
          break;
        }
      }
    });

    // Keep app alive when window is closed (lives in tray)
    app.on('window-all-closed', () => {
      // Do nothing - app continues running in system tray
    });
  });
}

bootstrap();
