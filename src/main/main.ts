import {
  app,
  BrowserWindow,
  MessageChannelMain,
  utilityProcess,
  ipcMain,
} from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { createPetWindow } from './windows';
import { createTray } from './tray';
import { AGENT_MESSAGE_PORT } from '../shared/constants';

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
        // Open settings - placeholder for PR5
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
      // TODO: PR5 - Open settings window
    });

    // Keep app alive when window is closed (lives in tray)
    app.on('window-all-closed', () => {
      // Do nothing - app continues running in system tray
    });
  });
}

bootstrap();
