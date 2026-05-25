import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PetAnimator } from './PetAnimator';
import {
  AgentState,
  AgentToRendererMessage,
} from '../../shared/types';
import type { PetElectronAPI, PetConfig } from '../../shared/types';

/** Pet name label shown below non-interactive pets */
const PetNameLabel: React.FC<{ name: string; color: string }> = ({ name, color }) => (
  <div
    style={{
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--font-semibold)',
      color: color,
      textAlign: 'center',
      marginTop: 'var(--space-1)',
      letterSpacing: 'var(--tracking-wide)',
      textTransform: 'uppercase',
      opacity: 0.8,
    }}
  >
    {name}
  </div>
);

/** Status badge for sub-pets */
const StatusBadge: React.FC<{ animation: string }> = ({ animation }) => {
  const colorMap: Record<string, string> = {
    idle: 'var(--role-custom)',
    thinking: 'var(--warning)',
    executing: 'var(--role-coder)',
    success: 'var(--success)',
    error: 'var(--danger)',
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 'var(--space-1)',
        right: 'var(--space-1)',
        width: 'var(--space-2)',
        height: 'var(--space-2)',
        borderRadius: '50%',
        background: colorMap[animation] ?? 'var(--role-custom)',
        boxShadow: `0 0 var(--space-1) ${colorMap[animation] ?? 'var(--role-custom)'}80`,
      }}
    />
  );
};

/** Tooltip for non-interactive pets */
const PetTooltip: React.FC<{ text: string; visible: boolean }> = ({ text, visible }) => (
  <div
    style={{
      position: 'absolute',
      top: -32,
      left: '50%',
      transform: `translateX(-50%) ${visible ? 'translateY(0)' : 'translateY(var(--space-1))'}`,
      background: 'var(--glass-bg)',
      color: 'var(--text-primary)',
      border: `1px solid var(--glass-border)`,
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-1) var(--space-3)',
      fontSize: 'var(--text-xs)',
      whiteSpace: 'nowrap',
      opacity: visible ? 1 : 0,
      transition: `opacity var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out)`,
      pointerEvents: 'none',
      zIndex: 100,
    }}
  >
    {text}
  </div>
);

export const PetWindow: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [petConfig, setPetConfig] = useState<PetConfig | null>(null);
  const [petAnimation, setPetAnimation] = useState<string>('idle');
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipText, setTooltipText] = useState('');

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const pointerDownRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // petContainerRef: full window, used for click-through hit-test only
  const petContainerRef = useRef<HTMLDivElement>(null);
  // petAreaRef: pet animation wrapper, receives pointer events + click
  const petAreaRef = useRef<HTMLDivElement>(null);

  const api = window.electronAPI as PetElectronAPI | undefined;

  // Read pet config on mount
  useEffect(() => {
    if (api?.getPetConfig) {
      const config = api.getPetConfig();
      setPetConfig(config);
    }
  }, [api]);

  // Listen for agent messages via IPC
  useEffect(() => {
    if (!api?.onAgentMessage) return;

    const unsubscribe = api.onAgentMessage(
      (msg: AgentToRendererMessage) => {
        switch (msg.type) {
          case 'state-change':
            setAgentState(msg.state);
            break;

          case 'chat-message':
          case 'chat-message-update':
          case 'chat-message-end':
          case 'pong':
          case 'confirmation-request':
          case 'tool-execution':
          case 'chat-thinking':
          case 'turn-indicator':
          case 'error':
          case 'pet-status':
          case 'pet-statuses':
          case 'plugin-list-response':
          case 'plugin-enable-response':
          case 'plugin-disable-response':
          case 'plugin-install-response':
          case 'plugin-uninstall-response':
          case 'session-branch-response':
          case 'session-checkpoint-response':
          case 'session-restore-checkpoint-response':
          case 'session-checkpoints-list':
          case 'session-delete-checkpoint-response':
          case 'session-export-response':
          case 'session-import-response':
          case 'session-branches-list':
          case 'session-tree':
          case 'workflow-list-response':
          case 'workflow-run-response':
          case 'workflow-pause-response':
          case 'workflow-resume-response':
          case 'workflow-cancel-response':
          case 'workflow-status-response':
          case 'workflow-history-response':
            // These are handled by the ChatWindow/Settings; pet only tracks state
            break;

          default: {
            const _exhaustive: never = msg;
            console.warn(
              'Unhandled agent message:',
              (_exhaustive as Record<string, unknown>).type
            );
            break;
          }
        }
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [api]);

  // Listen for pet status updates
  useEffect(() => {
    if (!api?.onPetStatusUpdate) return;

    const unsubscribe = api.onPetStatusUpdate((data) => {
      if (data.petId === (petConfig?.petId ?? 'chief')) {
        setPetAnimation(data.animation);
        // Map animation to agent state for the animator
        switch (data.animation) {
          case 'thinking':
            setAgentState(AgentState.THINKING);
            break;
          case 'executing':
            setAgentState(AgentState.EXECUTING);
            break;
          case 'success':
            setAgentState(AgentState.SUCCESS);
            break;
          case 'error':
            setAgentState(AgentState.FAILED);
            break;
          case 'idle':
          default:
            setAgentState(AgentState.IDLE);
            break;
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [api, petConfig?.petId]);

  // Send a ping to the agent on mount to verify connection
  useEffect(() => {
    if (api?.sendToAgent) {
      api.sendToAgent({ type: 'ping' });
    }
  }, [api]);

  const isInteractive = petConfig?.interactive !== false;

  // Handle pet click
  const handlePetClick = useCallback(() => {
    if (isDraggingRef.current) return;

    if (isInteractive) {
      // Chief: open quick input bubble
      api?.openQuickInput?.();
    } else {
      // Non-chief: toggle tooltip
      const statusText = petAnimation === 'idle'
        ? `${petConfig?.petName ?? 'Pet'} is idle`
        : petAnimation === 'executing'
          ? `${petConfig?.petName ?? 'Pet'} is working...`
          : petAnimation === 'thinking'
            ? `${petConfig?.petName ?? 'Pet'} is thinking...`
            : petAnimation === 'error'
              ? `${petConfig?.petName ?? 'Pet'} encountered an error`
              : `${petConfig?.petName ?? 'Pet'}: ${petAnimation}`;
      setTooltipText(statusText);
      setTooltipVisible(true);
      setTimeout(() => setTooltipVisible(false), 2000);
    }
  }, [api, isInteractive, petConfig?.petName, petAnimation]);

  // Handle right-click pet - open chat window (only for interactive pets)
  const handlePetContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isDraggingRef.current && isInteractive) {
        api?.openChat?.();
      }
    },
    [api, isInteractive]
  );

  // ---- Pointer-based drag — all pets are draggable ----

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const petEl = petAreaRef.current;
      if (!petEl) return;

      try {
        petEl.setPointerCapture(e.nativeEvent.pointerId);
      } catch {
        // setPointerCapture can fail in some Electron versions
      }

      isDraggingRef.current = false;
      pointerDownRef.current = true;
      setIsDragging(false);
      dragStartRef.current = { x: e.screenX, y: e.screenY };
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingRef.current) return;
      if (!pointerDownRef.current) return;

      const dx = e.screenX - dragStartRef.current.x;
      const dy = e.screenY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDraggingRef.current = true;
        setIsDragging(true);

        const offset = {
          x: e.screenX - window.screenX,
          y: e.screenY - window.screenY,
        };
        api?.petDragStart?.(offset, petConfig?.petId);
      }
    },
    [api, petConfig?.petId]
  );

  const handlePointerUp = useCallback(() => {
    if (isDraggingRef.current) {
      api?.petDragEnd?.(petConfig?.petId);
    }
    setTimeout(() => {
      isDraggingRef.current = false;
      pointerDownRef.current = false;
      setIsDragging(false);
    }, 0);
  }, [api, petConfig?.petId]);

  // Click-through toggle via hit testing on the full container.
  // Both interactive and non-interactive pets need this: interactive for drag,
  // non-interactive for tooltip clicks.
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!api?.setIgnoreMouseEvents) return;
      if (isDraggingRef.current) return;

      const petEl = petAreaRef.current;
      if (!petEl) return;

      const rect = petEl.getBoundingClientRect();
      const isOverPet =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      api.setIgnoreMouseEvents(!isOverPet, petConfig?.petId);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    return () => document.removeEventListener('mousemove', handleGlobalMouseMove);
  }, [api, petConfig?.petId]);

  return (
    <div
      ref={petContainerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingTop: 'var(--space-3)',
        position: 'relative',
      }}
    >
      {/* Pet area — drag + click (interactive) or click for tooltip (non-interactive) */}
      <div
        ref={petAreaRef}
        onClick={handlePetClick}
        onContextMenu={handlePetContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          cursor: isDragging ? 'grabbing' : 'pointer',
          position: 'relative',
        }}
      >
        {/* Status badge for non-chief pets */}
        {!isInteractive && <StatusBadge animation={petAnimation} />}

        <PetAnimator
          state={agentState}
          roleColor={petConfig?.roleColor}
          petName={petConfig?.petName}
        />

        {/* Name label for sub-pets */}
        {!isInteractive && petConfig && (
          <PetNameLabel name={petConfig.petName} color={petConfig.roleColor} />
        )}

        {/* Tooltip for non-interactive pets */}
        {!isInteractive && (
          <PetTooltip text={tooltipText} visible={tooltipVisible} />
        )}
      </div>
    </div>
  );
};
