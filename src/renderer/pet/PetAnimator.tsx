import React, { useMemo } from 'react';
import { AgentState } from '../../shared/types';
import { buildGifMap, DEFAULT_GIF_PREFIX } from '../../shared/constants';

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
 * Supports per-profile gifPrefix for different animation sets (e.g. "ikun").
 */
export const PetAnimator: React.FC<PetAnimatorProps> = ({
  state,
  size = 128,
  roleColor,
  petName = 'Clawd',
}) => {
  const gifFilename = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const prefix = params.get('gifPrefix') ?? DEFAULT_GIF_PREFIX;
    const gifMap = buildGifMap(prefix);
    return gifMap[state] ?? gifMap[AgentState.IDLE];
  }, [state]);

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

  // No decorative border — pet GIF should appear clean without circle frame

  return (
    <div
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        pointerEvents: 'auto',
        position: 'relative',
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
