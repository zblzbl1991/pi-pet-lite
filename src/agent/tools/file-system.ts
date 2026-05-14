/**
 * File system tools for the Clawd agent.
 *
 * read_file: reads a file from disk and returns its content.
 * Trust level: AUTO (safe, read-only).
 */

import { readFile } from 'fs/promises';

interface ReadFileParams {
  path: string;
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

/**
 * Read a file's contents from disk.
 *
 * This function implements the tool execute interface expected by pi-agent-core.
 * It reads the file at the given path and returns its text content.
 */
export async function executeReadFile(
  _toolCallId: string,
  params: ReadFileParams,
  _signal?: AbortSignal,
  _onUpdate?: (partialResult: ToolResult) => void
): Promise<ToolResult> {
  try {
    const content = await readFile(params.path, 'utf-8');
    return {
      content: [{ type: 'text' as const, text: content }],
      details: { path: params.path, size: content.length },
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error reading file: ${errorMessage}` }],
      details: { path: params.path, error: true },
    };
  }
}
