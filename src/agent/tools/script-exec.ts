/**
 * Script execution tool for the Clawd agent.
 *
 * run_script: Execute a shell command with timeout support.
 * Trust level: CONFIRM_ONCE (destructive, can run arbitrary code).
 */

import { exec } from 'child_process';
import { Type } from 'typebox';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

/** Default timeout for command execution in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum output length to prevent overwhelming the context */
const MAX_OUTPUT_LENGTH = 50_000;

/** Safely get an error message from an unknown thrown value */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Truncate output if it exceeds the maximum length.
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
  return (
    output.substring(0, half) +
    '\n\n... [truncated] ...\n\n' +
    output.substring(output.length - half)
  );
}

// ---------------------------------------------------------------------------
// Tool: run_script
// ---------------------------------------------------------------------------
export function buildRunScriptTool(): PiAgentTool {
  return {
    name: 'run_script',
    label: 'Run Script',
    description:
      'Execute a shell command via the system shell (cmd.exe on Windows) and return stdout and stderr. ' +
      'Use with caution as this can run arbitrary code. ' +
      'Supports a configurable timeout (default 30 seconds). The working directory can be specified.',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell command to execute' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory for the command (default: current directory)' })),
      timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds (default: 30000)' })),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { command, cwd, timeout } = params as { command: string; cwd?: string; timeout?: number };
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      return new Promise<PiAgentToolResult>((resolve) => {
        if (signal?.aborted) {
          resolve({
            content: [{ type: 'text' as const, text: 'Script execution was aborted before it started.' }],
            details: { aborted: true },
          });
          return;
        }

        const child = exec(
          command,
          {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024, // 10 MB
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            const truncatedStdout = truncateOutput(stdout ?? '');
            const truncatedStderr = truncateOutput(stderr ?? '');

            let output = '';
            if (truncatedStdout) {
              output += truncatedStdout;
            }
            if (truncatedStderr) {
              if (output) output += '\n';
              output += `[stderr]\n${truncatedStderr}`;
            }

            if (error) {
              if (error.killed) {
                // Process was killed (timeout or abort)
                resolve({
                  content: [
                    {
                      type: 'text' as const,
                      text: `Command timed out or was killed after ${timeoutMs}ms.\n${output}`,
                    },
                  ],
                  details: {
                    timedOut: true,
                    exitCode: null,
                    command,
                  },
                });
              } else {
                resolve({
                  content: [
                    {
                      type: 'text' as const,
                      text: `Command failed with exit code ${error.code ?? 'unknown'}:\n${output}\nError: ${error.message}`,
                    },
                  ],
                  details: {
                    error: true,
                    exitCode: error.code,
                    command,
                  },
                });
              }
            } else {
              resolve({
                content: [
                  {
                    type: 'text' as const,
                    text: output || 'Command completed with no output.',
                  },
                ],
                details: {
                  exitCode: 0,
                  command,
                  stdoutLength: (stdout ?? '').length,
                  stderrLength: (stderr ?? '').length,
                },
              });
            }
          }
        );

        // Listen for abort signal to kill the child process
        if (signal) {
          const onAbort = () => {
            // On Windows, child.kill('SIGTERM') only kills cmd.exe, not the
            // subprocess tree. Use taskkill with /T (tree) and /F (force) to
            // ensure the entire process tree is terminated.
            if (process.platform === 'win32' && child.pid != null) {
              const { execSync } = require('child_process') as typeof import('child_process');
              try {
                execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
              } catch {
                // taskkill may throw if the process already exited; fall back
                try { child.kill('SIGTERM'); } catch { /* already dead */ }
              }
            } else {
              child.kill('SIGTERM');
            }
          };
          signal.addEventListener('abort', onAbort, { once: true });
          // Clean up listener when the process exits
          child.on('exit', () => {
            signal.removeEventListener('abort', onAbort);
          });
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
export function buildScriptExecTools(): PiAgentTool[] {
  return [buildRunScriptTool()];
}
