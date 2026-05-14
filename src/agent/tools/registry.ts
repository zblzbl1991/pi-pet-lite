/**
 * Tool registry for the Clawd agent.
 *
 * Centralizes all tool definitions and provides a single function
 * to get all registered tools. Add new tool modules here when
 * extending the agent's capabilities.
 */

import { buildFileSystemTools } from './file-system';
import { buildScriptExecTools } from './script-exec';
import { buildSchedulerTools } from './scheduler';

// Re-export the restore function so the runtime can call it on startup
export { restoreSchedules, setScheduleFireCallback } from './scheduler';
export type { ScheduleFireCallback } from './scheduler';

/**
 * Returns all registered agent tools as a flat array.
 *
 * To add a new tool:
 * 1. Create a new file in src/agent/tools/ with a build*Tools() function
 * 2. Import it above
 * 3. Add the builder call to the array below
 */
export function getAllTools(): import('@earendil-works/pi-agent-core').AgentTool[] {
  return [
    ...buildFileSystemTools(),
    ...buildScriptExecTools(),
    ...buildSchedulerTools(),
  ];
}
