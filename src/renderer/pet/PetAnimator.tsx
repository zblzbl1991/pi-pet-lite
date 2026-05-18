import React, { useMemo } from 'react';
import { AgentState } from '../../shared/types';
import { AGENT_STATE_GIF_MAP } from '../../shared/constants';

interface PetAnimatorProps {
  state: AgentState;
  size?: number;
  /** Role color for the pet's border/visual accent */
  roleColor?: string;
  /** Pet name for alt text */
  petName?: string;
}

/**
 * Displays the Clawd pet GIF corresponding to the current agent state.
 * Falls back to idle if the state is not in the GIF map.
 *
 * In multi-pet mode, each pet has a colored border based on its role.
 */
export const PetAnimator: React.FC<PetAnimatorProps> = ({
  state,
  size = 128,
  roleColor,
  petName = 'Clawd',
}) => {
  const gifFilename = AGENT_STATE_GIF_MAP[state] ?? AGENT_STATE_GIF_MAP[AgentState.IDLE];

  // Build the GIF URL from the gifsPath query parameter
  const gifUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const gifsPath = params.get('gifsPath') ?? '../clawd-gifs';
    // Use file:// protocol path or relative path
    if (gifsPath.startsWith('/') || gifsPath.match(/^[A-Z]:\\/i)) {
      return `file:///${gifsPath.replace(/\\/g, '/')}/${gifFilename}`;
    }
    return `${gifsPath}/${gifFilename}`;
  }, [gifFilename]);

  // Border style for role color (subtle glow)
  const borderStyle: React.CSSProperties = roleColor
    ? {
        boxShadow: `0 0 8px 2px ${roleColor}40, 0 0 2px 1px ${roleColor}60`,
        borderRadius: '50%',
      }
    : {};

  return (
    <div
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        pointerEvents: 'auto',
        position: 'relative',
        ...borderStyle,
      }}
    >
      <img
        src={gifUrl}
        alt={`${petName} ${state}`}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          imageRendering: 'auto',
          display: 'block',
        }}
        draggable={false}
      />
    </div>
  );
};
