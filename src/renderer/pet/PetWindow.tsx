import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PetAnimator } from './PetAnimator';
import { ChatBubble } from './ChatBubble';
import {
  AgentState,
  ChatMessage,
  MessageRole,
  AgentToRendererMessage,
} from '../../shared/types';
import type { PetElectronAPI } from '../../shared/types';

/** Interface for active tool confirmation requests */
interface ConfirmationRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Interface for tool execution status display */
interface ToolStatus {
  toolName: string;
  status: 'running' | 'done' | 'error';
}

export const PetWindow: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Streaming state
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const streamingContentRef = useRef<Map<string, string>>(new Map());

  // Confirmation state
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);

  // Tool status display
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);

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
            setMessages((prev) => [...prev, msg.message]);
            if (msg.message.streaming) {
              setStreamingMessageId(msg.message.id);
              streamingContentRef.current.set(msg.message.id, msg.message.content);
            }
            break;

          case 'chat-message-update': {
            const { id, delta } = msg;
            streamingContentRef.current.set(
              id,
              (streamingContentRef.current.get(id) ?? '') + delta
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, content: streamingContentRef.current.get(id) ?? m.content }
                  : m
              )
            );
            break;
          }

          case 'chat-message-end': {
            setStreamingMessageId((prevId) => (prevId === msg.id ? null : prevId));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id ? { ...m, streaming: false } : m
              )
            );
            break;
          }

          case 'pong':
            break;

          case 'confirmation-request':
            setConfirmation({
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              args: msg.args,
            });
            break;

          case 'tool-execution':
            setToolStatus({
              toolName: msg.toolName,
              status: msg.status,
            });
            if (msg.status === 'done' || msg.status === 'error') {
              setTimeout(() => {
                setToolStatus((prev) =>
                  prev && prev.toolName === msg.toolName ? null : prev
                );
              }, 2000);
            }
            break;

          case 'error':
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: MessageRole.ASSISTANT,
                content: `[Error] ${msg.message}`,
                timestamp: Date.now(),
              },
            ]);
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

  const handleConfirmResponse = useCallback(
    (toolCallId: string, approved: boolean) => {
      setConfirmation(null);
      if (api?.sendToAgent) {
        api.sendToAgent({
          type: 'confirmation-response',
          toolCallId,
          approved,
        });
      }
    },
    [api]
  );

  // Handle pet click - open chat window
  const handlePetClick = useCallback(() => {
    if (!isDraggingRef.current) {
      api?.openChat?.();
    }
  }, [api]);

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

  // Get the latest assistant/tool message for the chat bubble
  const latestAgentMessage = [...messages]
    .reverse()
    .find((m) => m.role === MessageRole.ASSISTANT || m.role === MessageRole.TOOL);

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
      {/* Chat bubble — read-only, no drag/click */}
      <ChatBubble
        message={latestAgentMessage?.content ?? null}
        streamingMessageId={
          latestAgentMessage?.id === streamingMessageId ? streamingMessageId : null
        }
        confirmation={confirmation}
        toolStatus={toolStatus}
        onConfirmResponse={handleConfirmResponse}
      />

      {/* Pet area — drag + click to open chat */}
      <div
        ref={petAreaRef}
        onClick={handlePetClick}
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
