/**
 * CLI wrapper for agent-browser (vercel-labs).
 *
 * Spawns `agent-browser` CLI commands via child_process, parses JSON output,
 * and manages daemon lifecycle (auto-start on first use, graceful shutdown on
 * app exit).
 *
 * Architecture:
 *   agent-browser-client.ts (this file)
 *     -> spawn('agent-browser', [...args])
 *       -> Rust daemon -> CDP -> Chrome
 *
 * Uses `spawn` with explicit args (never `exec`) per project quality guidelines.
 */

import { spawn, ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed JSON response from agent-browser CLI */
interface AgentBrowserResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Result of a snapshot command */
export interface SnapshotResult {
  snapshot: string;
  refs: Record<string, ElementRef>;
}

/** Element reference from an accessibility tree snapshot */
export interface ElementRef {
  role: string;
  name: string;
  selector?: string;
}

/** Result of a screenshot command (base64 PNG) */
export interface ScreenshotResult {
  data: string; // base64-encoded PNG
  mimeType: 'image/png';
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

/** Whether the daemon has been started (connected to a CDP endpoint) */
let daemonConnected = false;
let connectedCdpPort: number | null = null;

/**
 * Ensure the agent-browser daemon is connected to the target CDP port.
 *
 * agent-browser auto-starts its daemon on first command, but we need to
 * tell it which CDP endpoint to use. The `connect` command establishes
 * the connection, and subsequent commands reuse it.
 */
export async function ensureDaemonConnected(cdpPort: number): Promise<void> {
  if (daemonConnected && connectedCdpPort === cdpPort) {
    return;
  }

  try {
    await runCommand(['connect', '--cdp', String(cdpPort)]);
    daemonConnected = true;
    connectedCdpPort = cdpPort;
  } catch (err: unknown) {
    daemonConnected = false;
    connectedCdpPort = null;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to connect agent-browser daemon to CDP port ${cdpPort}: ${message}`
    );
  }
}

/**
 * Gracefully shut down the agent-browser daemon.
 *
 * Should be called on app exit to clean up the Rust daemon process.
 */
export async function shutdownDaemon(): Promise<void> {
  if (!daemonConnected) {
    return;
  }

  try {
    await runCommand(['close'], { timeout: 5000 });
  } catch {
    // Best-effort shutdown; ignore errors during cleanup
  } finally {
    daemonConnected = false;
    connectedCdpPort = null;
  }
}

/**
 * Mark the daemon as disconnected (e.g., when the browser closes).
 * Does not attempt to send a close command.
 */
export function markDaemonDisconnected(): void {
  daemonConnected = false;
  connectedCdpPort = null;
}

// ---------------------------------------------------------------------------
// Core command execution
// ---------------------------------------------------------------------------

/**
 * Run an agent-browser CLI command and return parsed JSON output.
 *
 * Uses spawn (not exec) with explicit args per quality guidelines.
 * All commands use --json for structured output.
 *
 * @param args - Command arguments (e.g., ['snapshot', '--json'])
 * @param options - Optional timeout and abort signal
 * @returns Parsed JSON response from the CLI
 */
export async function runCommand(
  args: string[],
  options?: { timeout?: number; signal?: AbortSignal }
): Promise<AgentBrowserResponse> {
  const timeout = options?.timeout ?? 30000;

  return new Promise<AgentBrowserResponse>((resolve, reject) => {
    // Add --json to get structured output (unless already present or command is 'close')
    const cliArgs = args[0] === 'close' ? args : [...args, '--json'];

    const child: ChildProcess = spawn('agent-browser', cliArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Timeout handling
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(
        `agent-browser command timed out after ${timeout}ms: agent-browser ${args.join(' ')}`
      ));
    }, timeout);

    // Abort signal handling
    let onAbort: (() => void) | null = null;
    if (options?.signal) {
      onAbort = () => {
        child.kill();
        reject(new Error(
          `agent-browser command aborted: agent-browser ${args.join(' ')}`
        ));
      };
      if (options.signal.aborted) {
        clearTimeout(timer);
        child.kill();
        reject(new Error(
          `agent-browser command aborted before execution: agent-browser ${args.join(' ')}`
        ));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (onAbort && options?.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }

      // Try to parse JSON from stdout
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as AgentBrowserResponse;
          if (code !== 0 && code !== null && !parsed.success) {
            const errorMsg = parsed.error || stderr.trim() || `Exit code ${code}`;
            reject(new Error(`agent-browser error: ${errorMsg}`));
            return;
          }
          resolve(parsed);
          return;
        } catch {
          // JSON parse failed, fall through to error handling
        }
      }

      // Non-JSON output or empty stdout
      if (code === 0) {
        resolve({ success: true, data: trimmed || undefined });
        return;
      }

      const errorMsg = stderr.trim() || `Exit code ${code}`;
      reject(new Error(`agent-browser error: ${errorMsg}`));
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      if (onAbort && options?.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      reject(new Error(`Failed to spawn agent-browser: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// High-level action helpers
// ---------------------------------------------------------------------------

/**
 * Open a URL in the browser.
 */
export async function openUrl(url: string, options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['open', url], { signal: options?.signal });
}

/**
 * Take an accessibility tree snapshot with element refs.
 */
export async function snapshot(options?: { signal?: AbortSignal }): Promise<SnapshotResult> {
  const response = await runCommand(['snapshot', '-i'], { signal: options?.signal });
  if (!response.success || !response.data) {
    throw new Error(response.error || 'Snapshot failed');
  }
  return response.data as SnapshotResult;
}

/**
 * Click an element by its ref (e.g., "@e3").
 */
export async function clickElement(ref: string, options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['click', ref], { signal: options?.signal });
}

/**
 * Fill a text input by its ref.
 */
export async function fillElement(ref: string, text: string, options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['fill', ref, text], { signal: options?.signal });
}

/**
 * Take a screenshot and return base64 PNG.
 */
export async function screenshot(options?: { signal?: AbortSignal }): Promise<string> {
  const response = await runCommand(['screenshot'], { signal: options?.signal });
  if (!response.success) {
    throw new Error(response.error || 'Screenshot failed');
  }
  // agent-browser screenshot --json returns base64 data in response.data
  const data = response.data as { data?: string; base64?: string; path?: string } | string;
  if (typeof data === 'string') {
    return data;
  }
  return data?.data || data?.base64 || '';
}

/**
 * Get text content of the page.
 */
export async function getText(options?: { signal?: AbortSignal }): Promise<string> {
  const response = await runCommand(['get', 'text'], { signal: options?.signal });
  if (!response.success) {
    throw new Error(response.error || 'Get text failed');
  }
  const data = response.data;
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Scroll the page in a direction.
 */
export async function scroll(direction: 'up' | 'down', options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['scroll', direction], { signal: options?.signal });
}

/**
 * Hover over an element by its ref.
 */
export async function hoverElement(ref: string, options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['hover', ref], { signal: options?.signal });
}

/**
 * Navigate back in browser history.
 */
export async function goBack(options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['go', 'back'], { signal: options?.signal });
}

/**
 * Navigate forward in browser history.
 */
export async function goForward(options?: { signal?: AbortSignal }): Promise<AgentBrowserResponse> {
  return runCommand(['go', 'forward'], { signal: options?.signal });
}
