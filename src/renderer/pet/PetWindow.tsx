import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PetAnimator } from './PetAnimator';
import {
  AgentState,
  AgentToRendererMessage,
} from '../../shared/types';
import type { PetElectronAPI } from '../../shared/types';

export const PetWindow: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);

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
          case 'error':
            // These are handled by the ChatWindow; pet only tracks state
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

  // Send a ping to the agent on mount to verify connection
  useEffect(() => {
    if (api?.sendToAgent) {
      api.sendToAgent({ type: 'ping' });
    }
  }, [api]);

  // Handle pet click - open quick input bubble
  const handlePetClick = useCallback(() => {
    if (!isDraggingRef.current) {
      api?.openQuickInput?.();
    }
  }, [api]);

  // Handle right-click pet - open chat window
  const handlePetContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isDraggingRef.current) {
        api?.openChat?.();
      }
    },
    [api]
  );

  // ---- Pointer-based drag — ONLY on pet area ----

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
        api?.petDragStart?.(offset);
      }
    },
    [api]
  );

  const handlePointerUp = useCallback(() => {
    if (isDraggingRef.current) {
      api?.petDragEnd?.();
    }
    setTimeout(() => {
      isDraggingRef.current = false;
      pointerDownRef.current = false;
      setIsDragging(false);
    }, 0);
  }, [api]);

  // Click-through toggle via hit testing on the full container.
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

      api.setIgnoreMouseEvents(!isOverPet);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    return () => document.removeEventListener('mousemove', handleGlobalMouseMove);
  }, [api]);

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
        paddingTop: 10,
      }}
    >
      {/* Pet area — drag + click to open chat */}
      <div
        ref={petAreaRef}
        onClick={handlePetClick}
        onContextMenu={handlePetContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
      >
        <PetAnimator state={agentState} />
      </div>
    </div>
  );
};
