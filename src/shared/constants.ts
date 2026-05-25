import { AgentState, TrustLevel, RiskLevel } from './types';

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

/** Default GIF prefix for clawd-style pets */
export const DEFAULT_GIF_PREFIX = 'clawd';

/** Mapping from AgentState to GIF filename suffix (without prefix) */
const AGENT_STATE_GIF_SUFFIX: Record<AgentState, string> = {
  [AgentState.IDLE]: '-idle.gif',
  [AgentState.GREETING]: '-waving.gif',
  [AgentState.THINKING]: '-review.gif',
  [AgentState.EXECUTING]: '-running.gif',
  [AgentState.WAITING]: '-waiting.gif',
  [AgentState.SUCCESS]: '-jumping.gif',
  [AgentState.FAILED]: '-failed.gif',
};

/** Build GIF map for a given prefix (e.g. "clawd" → "clawd-idle.gif") */
export function buildGifMap(prefix: string = DEFAULT_GIF_PREFIX): Record<AgentState, string> {
  const map: Record<string, string> = {};
  for (const [state, suffix] of Object.entries(AGENT_STATE_GIF_SUFFIX)) {
    map[state] = `${prefix}${suffix}`;
  }
  return map as Record<AgentState, string>;
}

/** Default mapping from AgentState to GIF filename (clawd prefix) */
export const AGENT_STATE_GIF_MAP: Record<AgentState, string> = buildGifMap();

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
  // Agent-to-agent direct messaging
  send_message: TrustLevel.AUTO,
  check_inbox: TrustLevel.AUTO,
};

/**
 * Risk-level-based trust policy overrides.
 * Each risk level maps to a complete trust policy that replaces TRUST_POLICY.
 *
 * LOW:    All tools require confirmation (safest)
 * MEDIUM: Only destructive/critical tools require confirmation (balanced)
 * HIGH:   All tools auto-execute without confirmation (most autonomous)
 */
export const RISK_TRUST_POLICIES: Record<RiskLevel, Record<string, TrustLevel>> = {
  [RiskLevel.LOW]: {
    read: TrustLevel.CONFIRM_ONCE,
    ls: TrustLevel.CONFIRM_ONCE,
    find: TrustLevel.CONFIRM_ONCE,
    grep: TrustLevel.CONFIRM_ONCE,
    write: TrustLevel.CONFIRM_ONCE,
    edit: TrustLevel.CONFIRM_ONCE,
    bash: TrustLevel.CONFIRM_STEP,
    create_directory: TrustLevel.CONFIRM_ONCE,
    delete_file: TrustLevel.CONFIRM_STEP,
    create_schedule: TrustLevel.CONFIRM_ONCE,
    list_schedules: TrustLevel.CONFIRM_ONCE,
    delete_schedule: TrustLevel.CONFIRM_STEP,
    browser_action: TrustLevel.CONFIRM_STEP,
    delegate_task: TrustLevel.CONFIRM_ONCE,
    read_blackboard: TrustLevel.CONFIRM_ONCE,
    write_blackboard: TrustLevel.CONFIRM_ONCE,
    send_message: TrustLevel.CONFIRM_ONCE,
    check_inbox: TrustLevel.CONFIRM_ONCE,
  },
  [RiskLevel.MEDIUM]: {
    read: TrustLevel.AUTO,
    ls: TrustLevel.AUTO,
    find: TrustLevel.AUTO,
    grep: TrustLevel.AUTO,
    write: TrustLevel.CONFIRM_ONCE,
    edit: TrustLevel.CONFIRM_ONCE,
    bash: TrustLevel.CONFIRM_ONCE,
    create_directory: TrustLevel.AUTO,
    delete_file: TrustLevel.CONFIRM_ONCE,
    create_schedule: TrustLevel.CONFIRM_ONCE,
    list_schedules: TrustLevel.AUTO,
    delete_schedule: TrustLevel.CONFIRM_ONCE,
    browser_action: TrustLevel.CONFIRM_STEP,
    delegate_task: TrustLevel.AUTO,
    read_blackboard: TrustLevel.AUTO,
    write_blackboard: TrustLevel.AUTO,
    send_message: TrustLevel.AUTO,
    check_inbox: TrustLevel.AUTO,
  },
  [RiskLevel.HIGH]: {
    read: TrustLevel.AUTO,
    ls: TrustLevel.AUTO,
    find: TrustLevel.AUTO,
    grep: TrustLevel.AUTO,
    write: TrustLevel.AUTO,
    edit: TrustLevel.AUTO,
    bash: TrustLevel.AUTO,
    create_directory: TrustLevel.AUTO,
    delete_file: TrustLevel.AUTO,
    create_schedule: TrustLevel.AUTO,
    list_schedules: TrustLevel.AUTO,
    delete_schedule: TrustLevel.AUTO,
    browser_action: TrustLevel.AUTO,
    delegate_task: TrustLevel.AUTO,
    read_blackboard: TrustLevel.AUTO,
    write_blackboard: TrustLevel.AUTO,
    send_message: TrustLevel.AUTO,
    check_inbox: TrustLevel.AUTO,
  },
};

/** Filename for persisting scheduled tasks */
export const SCHEDULES_FILENAME = 'clawd-schedules.json';

/** Config file name */
export const CONFIG_FILENAME = 'clawd-config.json';

/** Tool groups with friendly names for Settings UI */
export const TOOL_GROUPS: Record<string, { label: string; tools: string[] }> = {
  'File Operations': {
    label: '文件操作',
    tools: ['read', 'write', 'edit', 'create_directory', 'delete_file'],
  },
  'Search': {
    label: '搜索',
    tools: ['grep', 'find', 'ls'],
  },
  'Shell': {
    label: 'Shell 命令',
    tools: ['bash'],
  },
  'Browser Automation': {
    label: '浏览器自动化',
    tools: ['browser_action'],
  },
  'Scheduling': {
    label: '定时任务',
    tools: ['create_schedule', 'list_schedules', 'delete_schedule'],
  },
  'Delegation': {
    label: '委派与黑板',
    tools: ['delegate_task', 'read_blackboard', 'write_blackboard'],
  },
  'Messaging': {
    label: 'Agent 直连通信',
    tools: ['send_message', 'check_inbox'],
  },
  'Plugins': {
    label: '插件工具',
    tools: [], // Populated at runtime from loaded plugins
  },
};

/** Default system prompt for newly created custom profiles */
export const CUSTOM_PROFILE_DEFAULT_PROMPT = `你是 {name}，一只以猫咪形象出现的自定义桌面 AI 助手。
你的能力由可用工具定义。
请仔细遵循用户指令并清晰地汇报结果。`;

/** Default tool set for newly created custom profiles */
export const CUSTOM_PROFILE_DEFAULT_TOOLS = ['read', 'grep', 'find', 'ls'];

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
export const SESSIONS_DB_FILENAME = 'clawd-sessions.db';

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

/** Default timeout for remote agent calls (3 minutes) */
export const REMOTE_DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

/** IPC channels for pet management (main <-> renderer) */
export const IPC_PET_STATUS = 'pet:status';
export const IPC_PET_DELEGATE = 'pet:delegate';
export const IPC_PET_ABORT = 'pet:abort';
export const IPC_PET_STATUS_UPDATE = 'pet:status-update';
export const IPC_PET_CONFIG = 'pet:config';
export const IPC_PET_TOOLTIP = 'pet:tooltip';

/** IPC channels for plugin management (main <-> renderer <-> agent) */
export const IPC_PLUGIN_LIST = 'plugin:list';
export const IPC_PLUGIN_ENABLE = 'plugin:enable';
export const IPC_PLUGIN_DISABLE = 'plugin:disable';
export const IPC_PLUGIN_INSTALL = 'plugin:install';
export const IPC_PLUGIN_UNINSTALL = 'plugin:uninstall';

/** IPC channels for session branching/checkpoint/export operations */
export const IPC_SESSION_BRANCH = 'session:branch';
export const IPC_SESSION_CHECKPOINT = 'session:checkpoint';
export const IPC_SESSION_RESTORE_CHECKPOINT = 'session:restore-checkpoint';
export const IPC_SESSION_LIST_CHECKPOINTS = 'session:list-checkpoints';
export const IPC_SESSION_DELETE_CHECKPOINT = 'session:delete-checkpoint';
export const IPC_SESSION_EXPORT = 'session:export';
export const IPC_SESSION_EXPORT_RANGE = 'session:export-range';
export const IPC_SESSION_IMPORT = 'session:import';
export const IPC_SESSION_LIST_BRANCHES = 'session:list-branches';
export const IPC_SESSION_GET_TREE = 'session:get-tree';
