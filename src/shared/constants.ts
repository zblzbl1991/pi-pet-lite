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
  read_file: TrustLevel.AUTO,
  list_directory: TrustLevel.AUTO,
  write_file: TrustLevel.CONFIRM_ONCE,
  run_script: TrustLevel.CONFIRM_ONCE,
  browser_action: TrustLevel.CONFIRM_STEP,
};

/** Config file name */
export const CONFIG_FILENAME = 'clawd-config.json';
