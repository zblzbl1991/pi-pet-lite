import React, { useEffect, useRef } from 'react';

interface ChatBubbleProps {
  message: string | null;
  inputVisible: boolean;
  inputValue: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}

/**
 * Chat bubble component displayed above the Clawd pet.
 * Shows agent messages and optionally a text input for user commands.
 * Uses CSS transitions for animated show/hide.
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  inputVisible,
  inputValue,
  onInputChange,
  onKeyDown,
  onSubmit,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const isVisible = message !== null || inputVisible;

  // Auto-focus input when it becomes visible
  useEffect(() => {
    if (inputVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [inputVisible]);

  return (
    <div
      style={{
        position: 'relative',
        marginBottom: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: isVisible ? 1 : 0,
        transform: isVisible
          ? 'translateY(0) scale(1)'
          : 'translateY(8px) scale(0.95)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {/* Speech bubble */}
      {message && (
        <div
          style={{
            background: 'rgba(26, 28, 31, 0.92)',
            color: '#F0F1F2',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: '10px 16px',
            fontSize: 13,
            maxWidth: 320,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          {message}
        </div>
      )}

      {/* Input field */}
      {inputVisible && (
        <div
          style={{
            marginTop: 6,
            width: 280,
            background: 'rgba(26, 28, 31, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 10,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Tell Clawd what to do..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#F0F1F2',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={onSubmit}
            style={{
              background: 'rgba(80, 180, 120, 0.8)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              marginLeft: 8,
            }}
          >
            Send
          </button>
        </div>
      )}

      {/* Triangle pointer */}
      {isVisible && (
        <div
          style={{
            width: 12,
            height: 12,
            background: 'rgba(26, 28, 31, 0.92)',
            transform: 'rotate(45deg)',
            marginTop: -6,
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        />
      )}
    </div>
  );
};
