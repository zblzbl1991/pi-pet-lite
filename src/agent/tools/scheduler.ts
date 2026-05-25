/**
 * Scheduled task tool for the Clawd agent.
 *
 * create_schedule: Create a cron-based scheduled task.
 * list_schedules: List all scheduled tasks.
 * delete_schedule: Delete a scheduled task.
 *
 * Uses node-cron for scheduling. Schedules are persisted to a JSON file
 * so they survive application restarts.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import * as cron from 'node-cron';
import { Type } from 'typebox';
import { SCHEDULES_FILENAME } from '../../shared/constants';

/**
 * Resolve the Electron userData path.
 * Works in both the main process (via app.getPath) and utility processes
 * (via CLAWD_USER_DATA env var set by main.ts).
 */
function getUserDataPath(): string {
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  const envPath = process.env.CLAWD_USER_DATA;
  if (envPath) {
    return envPath;
  }
  throw new Error('Cannot determine userData path: not in main process and CLAWD_USER_DATA env not set');
}

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

// ---------------------------------------------------------------------------
// Schedule types
// ---------------------------------------------------------------------------
export interface ScheduledTask {
  /** Unique name for the schedule */
  name: string;
  /** Cron expression (e.g., "0 9 * * 1" = every Monday at 9 AM) */
  cron: string;
  /** The prompt text to send to the agent when the cron fires */
  prompt: string;
  /** Whether the schedule is currently enabled */
  enabled: boolean;
  /** ISO timestamp when the schedule was created */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Schedule persistence
// ---------------------------------------------------------------------------
function getSchedulesPath(): string {
  return path.join(getUserDataPath(), SCHEDULES_FILENAME);
}

function readSchedules(): ScheduledTask[] {
  const filePath = getSchedulesPath();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ScheduledTask[];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to read schedules file "${filePath}": ${message}. Returning empty list.`);
    return [];
  }
}

function writeSchedules(schedules: ScheduledTask[]): void {
  const filePath = getSchedulesPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(schedules, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Cron task management
// ---------------------------------------------------------------------------

/** Active cron tasks keyed by schedule name */
const activeCrons = new Map<string, cron.ScheduledTask>();

/** Callback type for when a scheduled task fires */
export type ScheduleFireCallback = (prompt: string) => void;

/** Callback type for scheduled tasks using priority-aware delegation */
export type ScheduleFireWithPriorityCallback = (prompt: string) => void;

let scheduleFireCallback: ScheduleFireCallback | null = null;
let scheduleFireWithPriorityCallback: ScheduleFireWithPriorityCallback | null = null;

/**
 * Set the callback that fires when a scheduled task triggers.
 * Called by the runtime to inject the prompt into the agent loop.
 */
export function setScheduleFireCallback(cb: ScheduleFireCallback): void {
  scheduleFireCallback = cb;
}

/**
 * Set the priority-aware callback that fires when a scheduled task triggers.
 * Used by PetManager to enqueue with `scheduled` priority.
 * Takes precedence over the legacy callback if set.
 */
export function setScheduleFireWithPriorityCallback(cb: ScheduleFireWithPriorityCallback): void {
  scheduleFireWithPriorityCallback = cb;
}

/**
 * Start a cron task for a schedule entry.
 */
function startCron(schedule: ScheduledTask): void {
  // Stop existing cron if any
  stopCron(schedule.name);

  if (!schedule.enabled) {
    return;
  }

  // Validate cron expression
  if (!cron.validate(schedule.cron)) {
    console.error(`Invalid cron expression for "${schedule.name}": ${schedule.cron}`);
    return;
  }

  const task = cron.schedule(schedule.cron, () => {
    // Prefer priority-aware callback (routed through TaskScheduler)
    if (scheduleFireWithPriorityCallback) {
      scheduleFireWithPriorityCallback(schedule.prompt);
    } else if (scheduleFireCallback) {
      scheduleFireCallback(schedule.prompt);
    }
  });

  activeCrons.set(schedule.name, task);
}

/**
 * Stop a cron task by name.
 */
function stopCron(name: string): void {
  const existing = activeCrons.get(name);
  if (existing) {
    existing.stop();
    existing.destroy();
    activeCrons.delete(name);
  }
}

/**
 * Restore all persisted schedules on startup.
 * Call this once after the runtime is initialized.
 */
export function restoreSchedules(): void {
  const schedules = readSchedules();
  for (const schedule of schedules) {
    startCron(schedule);
  }
}

// ---------------------------------------------------------------------------
// Tool: create_schedule
// ---------------------------------------------------------------------------
export function buildCreateScheduleTool(): PiAgentTool {
  return {
    name: 'create_schedule',
    label: 'Create Schedule',
    description:
      'Create a scheduled task using a cron expression. When the schedule fires, the prompt text will be sent to the agent as if the user typed it. ' +
      'Cron format: "minute hour day-of-month month day-of-week" (e.g., "0 9 * * 1" = every Monday at 9:00 AM, "*/30 * * * *" = every 30 minutes).',
    parameters: Type.Object({
      name: Type.String({ description: 'Unique name for this schedule' }),
      cron: Type.String({ description: 'Cron expression (e.g., "0 9 * * 1" for every Monday at 9 AM)' }),
      prompt: Type.String({ description: 'The prompt text to send to the agent when the schedule fires' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { name, cron: cronExpr, prompt } = params as { name: string; cron: string; prompt: string };

      // Validate cron expression
      if (!cron.validate(cronExpr)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid cron expression: "${cronExpr}". Use standard 5-field cron format: "minute hour day-of-month month day-of-week".`,
            },
          ],
          details: { error: true, cron: cronExpr },
        };
      }

      const schedules = readSchedules();

      // Check for duplicate name
      if (schedules.some((s) => s.name === name)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `A schedule named "${name}" already exists. Use a different name or delete the existing one first.`,
            },
          ],
          details: { error: true, name },
        };
      }

      const newSchedule: ScheduledTask = {
        name,
        cron: cronExpr,
        prompt,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      schedules.push(newSchedule);
      writeSchedules(schedules);

      // Start the cron task
      startCron(newSchedule);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Created schedule "${name}" with cron "${cronExpr}". The following prompt will be sent automatically:\n\n"${prompt}"`,
          },
        ],
        details: { name, cron: cronExpr },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: list_schedules
// ---------------------------------------------------------------------------
export function buildListSchedulesTool(): PiAgentTool {
  return {
    name: 'list_schedules',
    label: 'List Schedules',
    description: 'List all scheduled tasks with their cron expressions and prompt text.',
    parameters: Type.Object({}),
    execute: async (
      _toolCallId: string,
      _params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const schedules = readSchedules();

      if (schedules.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No scheduled tasks found. Use create_schedule to add one.',
            },
          ],
          details: { count: 0 },
        };
      }

      const lines = schedules.map((s) => {
        const status = s.enabled ? 'enabled' : 'disabled';
        return `- "${s.name}" (${status}): cron "${s.cron}", created ${s.createdAt}\n  Prompt: "${s.prompt}"`;
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Scheduled tasks (${schedules.length}):\n\n${lines.join('\n\n')}`,
          },
        ],
        details: { count: schedules.length },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: delete_schedule
// ---------------------------------------------------------------------------
export function buildDeleteScheduleTool(): PiAgentTool {
  return {
    name: 'delete_schedule',
    label: 'Delete Schedule',
    description: 'Delete a scheduled task by name. The cron job will be stopped immediately.',
    parameters: Type.Object({
      name: Type.String({ description: 'Name of the schedule to delete' }),
    }),
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
      _onUpdate?: PiAgentToolUpdateCallback
    ): Promise<PiAgentToolResult> => {
      const { name } = params as { name: string };
      const schedules = readSchedules();
      const index = schedules.findIndex((s) => s.name === name);

      if (index === -1) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No schedule named "${name}" found.`,
            },
          ],
          details: { error: true, name },
        };
      }

      // Stop the cron task
      stopCron(name);

      // Remove from persisted list
      schedules.splice(index, 1);
      writeSchedules(schedules);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Deleted schedule "${name}".`,
          },
        ],
        details: { name },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
export function buildSchedulerTools(): PiAgentTool[] {
  return [buildCreateScheduleTool(), buildListSchedulesTool(), buildDeleteScheduleTool()];
}
