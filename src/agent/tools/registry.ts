/**
 * Tool registry for the Clawd agent.
 *
 * Centralizes all tool definitions and provides a single function
 * to get all registered tools. Combines tools from pi-coding-agent
 * (read, write, bash, edit, ls, find, grep) with our custom tools
 * (create_directory, delete_file, scheduler, browser_action).
 *
 * NOTE: createCodingTools() already provides `read`, so we avoid using
 * createReadOnlyTools() (which also includes `read`) to prevent duplicate
 * tool registration. Instead, we add grep/find/ls individually.
 *
 * Uses dynamic import() to load ESM-only pi-coding-agent from CommonJS context.
 */

// Re-export the restore function so the runtime can call it on startup
export { restoreSchedules, setScheduleFireCallback } from './scheduler';
export type { ScheduleFireCallback } from './scheduler';

/** Cached pi-coding-agent tools module */
let piToolsModule: typeof import('@earendil-works/pi-coding-agent') | null = null;

/** True dynamic import bypassing TypeScript CJS transpilation */
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as <T>(
  modulePath: string
) => Promise<T>;

async function loadPiCodingTools() {
  if (!piToolsModule) {
    piToolsModule = await dynamicImport<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');
  }
  return piToolsModule;
}

/**
 * Returns all registered agent tools as a flat array.
 *
 * Combines pi-coding-agent's built-in tools (read, write, bash, edit, ls, find, grep)
 * with our custom tools (create_directory, delete_file, scheduler tools).
 *
 * Uses createCodingTools() for read/bash/edit/write, then adds grep/find/ls
 * individually (not via createReadOnlyTools) to avoid duplicating the `read` tool.
 *
 * Uses dynamic import because pi-coding-agent is ESM-only.
 */
export async function getAllTools(): Promise<import('@earendil-works/pi-agent-core').AgentTool[]> {
  const piTools = await loadPiCodingTools();

  // Use process.cwd() as the working directory for pi's tools.
  // pi's tools resolve relative paths against this cwd.
  const cwd = process.cwd();

  return [
    // pi-coding-agent tools: read, bash, edit, write
    ...piTools.createCodingTools(cwd),
    // pi-coding-agent read-only tools: grep, find, ls
    // NOTE: We do NOT use createReadOnlyTools() because it also includes `read`,
    // which createCodingTools() already provides. Duplicating `read` would send
    // two tool definitions with the same name to the LLM.
    piTools.createGrepTool(cwd),
    piTools.createFindTool(cwd),
    piTools.createLsTool(cwd),
    // Our custom tools
    ...buildCreateDirectoryTool(),
    ...buildDeleteFileTool(),
    // Scheduler tools (from scheduler.ts)
    ...(await import('./scheduler')).buildSchedulerTools(),
    // Browser automation tool (agent-browser CLI)
    ...(await import('./browser')).buildBrowserTool(),
    // Delegation and blackboard tools (Chief coordinator)
    ...(await import('./delegate')).buildDelegateTools(),
  ];
}

/**
 * Synchronous helper that returns the pi-coding-agent tool names
 * for trust policy mapping. These names are stable and known at compile time.
 */
export const PI_TOOL_NAMES = [
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
] as const;

/**
 * Returns only the tools that match the profile's toolNames allowlist.
 *
 * Filters the full tool set from getAllTools() against the profile's
 * declared toolNames array. If no profile is provided, returns all tools
 * (backward compatible behavior).
 *
 * @param profile - The PetProfile whose toolNames determine which tools are included.
 *                  If undefined, all tools are returned.
 */
export async function getToolsForProfile(
  profile?: PetProfile
): Promise<import('@earendil-works/pi-agent-core').AgentTool[]> {
  const allTools = await getAllTools();

  if (!profile) {
    return allTools;
  }

  const allowedNames = new Set(profile.toolNames);
  return allTools.filter((tool) => allowedNames.has(tool.name));
}

// ---------------------------------------------------------------------------
// Custom tools that pi-coding-agent does not provide
// ---------------------------------------------------------------------------

import { mkdir, rm, stat } from 'fs/promises';
import * as path from 'path';
import { Type } from 'typebox';
import type { PetProfile } from '../../shared/types';

type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    details: { error: true, ...details },
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Tool: create_directory
// ---------------------------------------------------------------------------
function buildCreateDirectoryTool(): PiAgentTool[] {
  return [
    {
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
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool: delete_file
// ---------------------------------------------------------------------------
function buildDeleteFileTool(): PiAgentTool[] {
  return [
    {
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
            return errorResult(
              `Path is a directory, not a file: ${targetPath}. This tool only deletes files, not directories.`,
              { path: targetPath }
            );
          }
          await rm(targetPath);
          return textResult(`Successfully deleted file: ${targetPath}`, { path: targetPath });
        } catch (err: unknown) {
          return errorResult(`Error deleting file: ${getErrorMessage(err)}`, { path: filePath });
        }
      },
    },
  ];
}
