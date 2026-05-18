/**
 * Browser launcher helper for the Clawd browser automation tool.
 *
 * Finds and launches the user's existing Chrome or Edge browser
 * with CDP (Chrome DevTools Protocol) enabled on a specified port.
 *
 * Windows-specific: searches standard installation paths for
 * Chrome and Edge. Prefers Edge (guaranteed on Windows 11).
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

/** Default CDP remote debugging port */
export const DEFAULT_CDP_PORT = 9222;

/** Timeout for waiting for CDP port to become available (ms) */
const CDP_WAIT_TIMEOUT = 15000;

/** Interval for polling CDP port availability (ms) */
const CDP_POLL_INTERVAL = 500;

/**
 * Standard browser installation paths on Windows.
 * Listed in preference order: Edge first (guaranteed on Win11), then Chrome.
 */
const BROWSER_PATHS = [
  // Edge (64-bit)
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Chrome (both architectures)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * Find the first available browser (Edge or Chrome) on the system.
 * If a configured path is provided and it exists, use that instead.
 *
 * @returns Absolute path to the browser executable, or null if none found.
 */
export function findBrowserPath(configuredPath?: string): string | null {
  if (configuredPath) {
    try {
      if (fs.existsSync(configuredPath)) {
        return configuredPath;
      }
    } catch {
      // Configured path doesn't exist, fall through to auto-detect
    }
  }
  for (const browserPath of BROWSER_PATHS) {
    try {
      if (fs.existsSync(browserPath)) {
        return browserPath;
      }
    } catch {
      // Ignore permission errors, try next path
    }
  }
  return null;
}

/**
 * Check if a port is currently open and accepting connections.
 */
function isPortOpen(port: number, host: string = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(1000);
    socket.on('error', onError);
    socket.on('timeout', onError);
    socket.connect(port, host, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

/**
 * Wait for a port to become available (listening and accepting connections).
 *
 * @param port - Port number to wait for
 * @param timeout - Maximum wait time in ms
 * @returns Promise that resolves to true if port became available, false on timeout
 */
export function waitForPort(port: number, timeout: number = CDP_WAIT_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = async () => {
      const open = await isPortOpen(port);
      if (open) {
        resolve(true);
        return;
      }
      if (Date.now() - startTime >= timeout) {
        resolve(false);
        return;
      }
      setTimeout(check, CDP_POLL_INTERVAL);
    };

    check();
  });
}

/**
 * Launch a browser with CDP remote debugging enabled.
 *
 * Spawns the browser process with --remote-debugging-port and
 * waits for the port to become available before returning.
 *
 * @param browserPath - Absolute path to the browser executable
 * @param port - CDP port to use (default: 9222)
 * @returns Object with the child process and a boolean indicating
 *          whether the CDP port became available
 */
export async function launchBrowserWithCDP(
  browserPath: string,
  port: number = DEFAULT_CDP_PORT
): Promise<{ process: ChildProcess; cdpReady: boolean }> {
  const childProc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    }
  );

  // Unref so the browser process does not prevent the agent from exiting
  childProc.unref();

  // Handle unexpected early exit
  childProc.on('error', (err: Error) => {
    console.error(`Browser process error: ${err.message}`);
  });

  // Wait for CDP port to become available
  const cdpReady = await waitForPort(port);

  return { process: childProc, cdpReady };
}
