/**
 * File system tools for the Clawd agent.
 *
 * Provides read_file, write_file, list_directory, create_directory,
 * delete_file, and search_files tools.
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'fs/promises';
import * as path from 'path';
import * as glob from 'glob';
import { Type } from 'typebox';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types (resolved at runtime via dynamic import)
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

/** Helper to create a successful text result */
function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

/** Helper to create an error text result */
function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    details: { error: true, ...details },
  };
}

/** Safely get an error message from an unknown thrown value */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Tool: read_file
// ---------------------------------------------------------------------------
export function buildReadFileTool(): PiAgentTool {
  return {
    name: 'read_file',
    label: 'Read File',
    description:
      'Read the contents of a file from disk. Provide the full file path. Returns the file content as text.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative path to the file to read' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { path: filePath } = params as { path: string };
      try {
        const content = await readFile(filePath, 'utf-8');
        return textResult(content, { path: filePath, size: content.length });
      } catch (err: unknown) {
        return errorResult(`Error reading file: ${getErrorMessage(err)}`, { path: filePath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: write_file
// ---------------------------------------------------------------------------
export function buildWriteFileTool(): PiAgentTool {
  return {
    name: 'write_file',
    label: 'Write File',
    description:
      'Write content to a file. Creates parent directories if they do not exist. Overwrites existing files.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative path to the file to write' }),
      content: Type.String({ description: 'Content to write to the file' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { path: filePath, content } = params as { path: string; content: string };
      try {
        const dir = path.dirname(filePath);
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, content, 'utf-8');
        return textResult(`Successfully wrote ${content.length} bytes to ${filePath}`, {
          path: filePath,
          size: content.length,
        });
      } catch (err: unknown) {
        return errorResult(`Error writing file: ${getErrorMessage(err)}`, { path: filePath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: list_directory
// ---------------------------------------------------------------------------
export function buildListDirectoryTool(): PiAgentTool {
  return {
    name: 'list_directory',
    label: 'List Directory',
    description:
      'List files and directories in a given path. Optionally list recursively. Returns a formatted text listing.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative path to the directory to list' }),
      recursive: Type.Optional(Type.Boolean({ description: 'Whether to list recursively (default: false)' })),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { path: dirPath, recursive = false } = params as { path: string; recursive?: boolean };
      try {
        const targetPath = path.resolve(dirPath);

        interface FileEntry {
          relativePath: string;
          isDirectory: boolean;
          size: number;
        }

        const entries: FileEntry[] = [];

        async function walk(dir: string, baseDir: string): Promise<void> {
          const items = await readdir(dir, { withFileTypes: true });
          for (const item of items) {
            const fullPath = path.join(dir, item.name);
            const relativePath = path.relative(baseDir, fullPath);
            if (item.isDirectory()) {
              entries.push({ relativePath, isDirectory: true, size: 0 });
              if (recursive) {
                await walk(fullPath, baseDir);
              }
            } else if (item.isFile()) {
              const fileStat = await stat(fullPath);
              entries.push({ relativePath, isDirectory: false, size: fileStat.size });
            }
          }
        }

        await walk(targetPath, targetPath);

        const lines = entries.map((entry) => {
          const prefix = entry.isDirectory ? '[DIR]  ' : '       ';
          const sizeInfo = entry.isDirectory ? '' : ` (${entry.size} bytes)`;
          return `${prefix}${entry.relativePath}${sizeInfo}`;
        });

        const resultText =
          lines.length > 0
            ? `Contents of ${targetPath}:\n${lines.join('\n')}`
            : `Directory ${targetPath} is empty.`;

        return textResult(resultText, { path: targetPath, count: entries.length });
      } catch (err: unknown) {
        return errorResult(`Error listing directory: ${getErrorMessage(err)}`, { path: dirPath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: create_directory
// ---------------------------------------------------------------------------
export function buildCreateDirectoryTool(): PiAgentTool {
  return {
    name: 'create_directory',
    label: 'Create Directory',
    description: 'Create a directory and all necessary parent directories recursively.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative path of the directory to create' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { path: dirPath } = params as { path: string };
      try {
        const targetPath = path.resolve(dirPath);
        await mkdir(targetPath, { recursive: true });
        return textResult(`Successfully created directory: ${targetPath}`, { path: targetPath });
      } catch (err: unknown) {
        return errorResult(`Error creating directory: ${getErrorMessage(err)}`, { path: dirPath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: delete_file
// ---------------------------------------------------------------------------
export function buildDeleteFileTool(): PiAgentTool {
  return {
    name: 'delete_file',
    label: 'Delete File',
    description:
      'Delete a file from disk. This is destructive and cannot be undone. Use with caution.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative path to the file to delete' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { path: filePath } = params as { path: string };
      try {
        const targetPath = path.resolve(filePath);
        const fileStat = await stat(targetPath);
        if (fileStat.isDirectory()) {
          return errorResult(`Path is a directory, not a file: ${targetPath}. This tool only deletes files, not directories.`, {
            path: targetPath,
          });
        }
        await rm(targetPath);
        return textResult(`Successfully deleted file: ${targetPath}`, { path: targetPath });
      } catch (err: unknown) {
        return errorResult(`Error deleting file: ${getErrorMessage(err)}`, { path: filePath });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: search_files
// ---------------------------------------------------------------------------
export function buildSearchFilesTool(): PiAgentTool {
  return {
    name: 'search_files',
    label: 'Search Files',
    description:
      'Search for files by glob pattern in a directory. Returns matching file paths.',
    parameters: Type.Object({
      directory: Type.String({ description: 'Directory to search in' }),
      pattern: Type.String({ description: 'Glob pattern to match (e.g. "**/*.ts", "*.json")' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { directory, pattern } = params as { directory: string; pattern: string };
      try {
        const targetDir = path.resolve(directory);
        // Use forward slashes so glob patterns like "**/*.ts" are not mangled
        // by path.join on Windows (which converts them to backslashes).
        const fullPattern = `${targetDir.replace(/\\/g, '/')}/${pattern}`;
        const matches = await glob.glob(fullPattern, {
          nodir: true,
          absolute: true,
          signal: signal ?? undefined,
        });

        const resultText =
          matches.length > 0
            ? `Found ${matches.length} file(s):\n${matches.join('\n')}`
            : `No files matching "${pattern}" found in ${targetDir}.`;

        return textResult(resultText, { directory: targetDir, pattern, count: matches.length });
      } catch (err: unknown) {
        return errorResult(`Error searching files: ${getErrorMessage(err)}`, {
          directory,
          pattern,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate: all file system tools
// ---------------------------------------------------------------------------
export function buildFileSystemTools(): PiAgentTool[] {
  return [
    buildReadFileTool(),
    buildWriteFileTool(),
    buildListDirectoryTool(),
    buildCreateDirectoryTool(),
    buildDeleteFileTool(),
    buildSearchFilesTool(),
  ];
}
