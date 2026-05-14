import React, { useMemo } from 'react';
import { AgentState } from '../../shared/types';
import { AGENT_STATE_GIF_MAP } from '../../shared/constants';

interface PetAnimatorProps {
  state: AgentState;
  size?: number;
}

/**
 * Displays the Clawd pet GIF corresponding to the current agent state.
 * Falls back to idle if the state is not in the GIF map.
 */
export const PetAnimator: React.FC<PetAnimatorProps> = ({
  state,
  size = 128,
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

  return (
    <div
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <img
        src={gifUrl}
        alt={`Clawd ${state}`}
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
