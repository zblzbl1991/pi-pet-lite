import { AgentState, TrustLevel } from './types';

/** Application constants */

export const APP_NAME = 'Clawd';

/** Window dimensions for the pet overlay */
export const PET_SIZE = 128;

/** Default pet position (center of screen, offset upward) */
export const DEFAULT_PET_OFFSET_X = 0.5;
export const DEFAULT_PET_OFFSET_Y = 0.7;

/** Chat bubble max width in pixels */
export const CHAT_BUBBLE_MAX_WIDTH = 320;

/** Chat bubble display duration in ms for transient messages */
export const CHAT_BUBBLE_DURATION = 5000;

/** MessagePort channel name for renderer-agent communication */
export const AGENT_MESSAGE_PORT = 'agent-message-port';

/** Mapping from AgentState to GIF filename */
export const AGENT_STATE_GIF_MAP: Record<AgentState, string> = {
  [AgentState.IDLE]: 'clawd-idle.gif',
  [AgentState.GREETING]: 'clawd-waving.gif',
  [AgentState.THINKING]: 'clawd-review.gif',
  [AgentState.EXECUTING]: 'clawd-running.gif',
  [AgentState.WAITING]: 'clawd-waiting.gif',
  [AgentState.SUCCESS]: 'clawd-jumping.gif',
  [AgentState.FAILED]: 'clawd-failed.gif',
};

/** Trust policy for MVP - hardcoded security levels per tool */
export const TRUST_POLICY: Record<string, TrustLevel> = {
  // pi-coding-agent tools
  read: TrustLevel.AUTO,
  ls: TrustLevel.AUTO,
  find: TrustLevel.AUTO,
  grep: TrustLevel.AUTO,
  write: TrustLevel.CONFIRM_ONCE,
  edit: TrustLevel.CONFIRM_ONCE,
  bash: TrustLevel.CONFIRM_ONCE,
  // Our custom tools
  create_directory: TrustLevel.AUTO,
  delete_file: TrustLevel.CONFIRM_ONCE,
  create_schedule: TrustLevel.CONFIRM_ONCE,
  list_schedules: TrustLevel.AUTO,
  delete_schedule: TrustLevel.CONFIRM_ONCE,
  browser_action: TrustLevel.CONFIRM_STEP,
  // Delegation and blackboard tools (Chief-only)
  delegate_task: TrustLevel.AUTO,
  read_blackboard: TrustLevel.AUTO,
  write_blackboard: TrustLevel.AUTO,
};

/** Filename for persisting scheduled tasks */
export const SCHEDULES_FILENAME = 'clawd-schedules.json';

/** Config file name */
export const CONFIG_FILENAME = 'clawd-config.json';

/** IPC channels for main↔renderer communication */
export const IPC_AGENT_MESSAGE = 'agent-message';
export const IPC_RENDERER_TO_AGENT = 'renderer-to-agent';
export const IPC_CHAT_SYNC = 'chat:sync-history';
export const IPC_OPEN_CHAT = 'open-chat';

/** Chat sidebar width (height = screen work area) */
export const CHAT_WINDOW_WIDTH = 400;

/** Quick input bubble dimensions */
export const QUICK_INPUT_WIDTH = 320;
export const QUICK_INPUT_HEIGHT = 48;

/** IPC channels for quick input */
export const IPC_OPEN_QUICK_INPUT = 'open-quick-input';
export const IPC_QUICK_INPUT_SUBMIT = 'quick-input-submit';
export const IPC_QUICK_INPUT_CANCEL = 'quick-input-cancel';

/** IPC channels for chat sidebar slide animation */
export const IPC_CHAT_SLIDE_IN = 'chat:slide-in';
export const IPC_CHAT_SLIDE_OUT = 'chat:slide-out';
export const IPC_CHAT_SLIDE_OUT_COMPLETE = 'chat:slide-out-complete';

/** Maximum messages kept in main-process ring buffer */
export const MESSAGE_BUFFER_MAX = 200;

/** IPC channels for blackboard store operations */
export const IPC_BB_GET = 'blackboard:get';
export const IPC_BB_SET = 'blackboard:set';
export const IPC_BB_DELETE = 'blackboard:delete';
export const IPC_BB_LIST = 'blackboard:list';
export const IPC_BB_QUERY = 'blackboard:query';

/** Blackboard database filename */
export const BLACKBOARD_DB_FILENAME = 'clawd-blackboard.db';

/** Default capacity limits per namespace */
export const BLACKBOARD_DEFAULT_CAPACITY = {
  global: 200,
  pet: 50,
} as const;

/** PetManager configuration */
export const PET_MANAGER_MAX_CONCURRENT = 3;
export const PET_MANAGER_IDLE_TIMEOUT_MINUTES = 15;
export const PET_MANAGER_MAX_QUEUE_DEPTH = 5;

/** Delegation timeout in milliseconds (5 minutes) */
export const DELEGATION_TIMEOUT_MS = 5 * 60 * 1000;

/** IPC channels for pet management (main <-> renderer) */
export const IPC_PET_STATUS = 'pet:status';
export const IPC_PET_DELEGATE = 'pet:delegate';
export const IPC_PET_ABORT = 'pet:abort';
export const IPC_PET_STATUS_UPDATE = 'pet:status-update';
export const IPC_PET_CONFIG = 'pet:config';
export const IPC_PET_TOOLTIP = 'pet:tooltip';
