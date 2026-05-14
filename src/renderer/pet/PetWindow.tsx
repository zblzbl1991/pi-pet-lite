import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PetAnimator } from './PetAnimator';
import { ChatBubble } from './ChatBubble';
import {
  AgentState,
  ChatMessage,
  MessageRole,
  AgentToRendererMessage,
} from '../../shared/types';

/** Default pet position as fractions of screen dimensions */
const DEFAULT_POSITION = { xFraction: 0.45, yFraction: 0.65 };

export const PetWindow: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isInputVisible, setIsInputVisible] = useState(false);
  const [petPosition, setPetPosition] = useState(DEFAULT_POSITION);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const petStartRef = useRef({ x: 0, y: 0 });

  // Set up MessagePort listener for agent messages
  useEffect(() => {
    if (!window.electronAPI?.onAgentMessage) return;

    const unsubscribe = window.electronAPI.onAgentMessage(
      (msg: AgentToRendererMessage) => {
        switch (msg.type) {
          case 'state-change':
            setAgentState(msg.state);
            break;
          case 'chat-message':
            setMessages((prev) => [...prev, msg.message]);
            break;
          case 'pong':
            // Ping response
            break;
          case 'tool-confirmation-request':
            // TODO: PR2 - Handle tool confirmation requests
            break;
        }
      }
    );

    return unsubscribe;
  }, []);

  // Send a ping to the agent on mount to verify connection
  useEffect(() => {
    if (window.electronAPI?.sendToAgent) {
      window.electronAPI.sendToAgent({ type: 'ping' });
    }
  }, []);

  const handleSendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    // Add user message to local state
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: MessageRole.USER,
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Send to agent
    if (window.electronAPI?.sendToAgent) {
      window.electronAPI.sendToAgent({ type: 'user-input', text });
    }

    setInputText('');
    setIsInputVisible(false);
  }, [inputText]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendMessage();
      } else if (e.key === 'Escape') {
        setIsInputVisible(false);
        setInputText('');
      }
      e.stopPropagation();
    },
    [handleSendMessage]
  );

  // Handle pet click - toggle input visibility
  const handlePetClick = useCallback(() => {
    if (!isDraggingRef.current) {
      setIsInputVisible((prev) => !prev);
    }
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag if clicking on the pet area (not chat bubble)
      isDraggingRef.current = false;
      setIsDragging(false);
      dragStartRef.current = { x: e.screenX, y: e.screenY };
      petStartRef.current = {
        x: petPosition.xFraction * window.innerWidth,
        y: petPosition.yFraction * window.innerHeight,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.screenX - dragStartRef.current.x;
        const deltaY = moveEvent.screenY - dragStartRef.current.y;
        if (!isDraggingRef.current && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
          isDraggingRef.current = true;
          setIsDragging(true);
        }
        if (isDraggingRef.current) {
          const newX = petStartRef.current.x + deltaX;
          const newY = petStartRef.current.y + deltaY;
          setPetPosition({
            xFraction: Math.max(0, Math.min(1, newX / window.innerWidth)),
            yFraction: Math.max(0, Math.min(1, newY / window.innerHeight)),
          });
        }
      };

      const handleMouseUp = () => {
        // Use a short delay so isDragging is still true when click fires
        setTimeout(() => {
          isDraggingRef.current = false;
          setIsDragging(false);
        }, 0);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [petPosition]
  );

  // Hit testing for click-through toggle
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!window.electronAPI?.setIgnoreMouseEvents) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      // Bounding-box hit test: cursor is within the pet container
      const isOverPet =
        localX >= 0 &&
        localX <= rect.width &&
        localY >= 0 &&
        localY <= rect.height;

      window.electronAPI.setIgnoreMouseEvents(!isOverPet);
    },
    []
  );

  // Compute pixel position from fractions
  const petX = petPosition.xFraction * window.innerWidth;
  const petY = petPosition.yFraction * window.innerHeight;

  // Get the latest agent message for the chat bubble
  const latestAgentMessage = [...messages]
    .reverse()
    .find((m) => m.role === MessageRole.AGENT);

  return (
    <div
      style={{
        position: 'absolute',
        left: petX,
        top: petY,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      {/* Chat bubble above the pet */}
      <ChatBubble
        message={latestAgentMessage?.content ?? null}
        inputVisible={isInputVisible}
        inputValue={inputText}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSubmit={handleSendMessage}
      />

      {/* Pet animation */}
      <div onClick={handlePetClick} style={{ cursor: 'pointer' }}>
        <PetAnimator state={agentState} />
      </div>
    </div>
  );
};
