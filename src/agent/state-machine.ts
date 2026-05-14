import { AgentState } from '../shared/types';
import { AGENT_STATE_GIF_MAP } from '../shared/constants';

/**
 * Agent state machine and GIF mapping.
 *
 * Provides the state transition logic and GIF filename lookup
 * for the Clawd desktop pet animations.
 */

/** Valid state transitions from each state */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]: [AgentState.GREETING, AgentState.THINKING],
  [AgentState.GREETING]: [AgentState.THINKING, AgentState.IDLE],
  [AgentState.THINKING]: [AgentState.EXECUTING, AgentState.WAITING, AgentState.FAILED],
  [AgentState.EXECUTING]: [AgentState.THINKING, AgentState.SUCCESS, AgentState.FAILED, AgentState.WAITING],
  [AgentState.WAITING]: [AgentState.THINKING, AgentState.IDLE],
  [AgentState.SUCCESS]: [AgentState.IDLE],
  [AgentState.FAILED]: [AgentState.IDLE],
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(
  from: AgentState,
  to: AgentState
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the GIF filename for an agent state.
 */
export function getGifForState(state: AgentState): string {
  return AGENT_STATE_GIF_MAP[state] ?? AGENT_STATE_GIF_MAP[AgentState.IDLE];
}

/**
 * Get all valid next states from the current state.
 */
export function getNextStates(current: AgentState): AgentState[] {
  return VALID_TRANSITIONS[current] ?? [];
}
