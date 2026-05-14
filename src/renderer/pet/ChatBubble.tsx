import React, { useEffect, useRef } from 'react';

interface ConfirmationRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ChatBubbleProps {
  message: string | null;
  streamingMessageId: string | null;
  inputVisible: boolean;
  inputValue: string;
  confirmation: ConfirmationRequest | null;
  toolStatus: { toolName: string; status: string } | null;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  onConfirmResponse: (toolCallId: string, approved: boolean) => void;
}

/**
 * Chat bubble component displayed above the Clawd pet.
 * Shows agent messages, streaming text, tool execution status,
 * confirmation requests with approve/reject buttons,
 * and a text input for user commands.
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  streamingMessageId,
  inputVisible,
  inputValue,
  confirmation,
  toolStatus,
  onInputChange,
  onKeyDown,
  onSubmit,
  onConfirmResponse,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const isVisible = message !== null || inputVisible || confirmation !== null;

  // Auto-focus input when it becomes visible
  useEffect(() => {
    if (inputVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [inputVisible]);

  /** Render a truncated preview of tool arguments */
  const renderArgsPreview = (args: Record<string, unknown>): string => {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';
    const preview = entries
      .slice(0, 3)
      .map(([key, val]) => {
        const valStr = typeof val === 'string' ? val : JSON.stringify(val);
        const truncated = valStr.length > 40 ? valStr.slice(0, 40) + '...' : valStr;
        return `${key}: ${truncated}`;
      })
      .join(', ');
    return entries.length > 3 ? `${preview} ...` : preview;
  };

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
      {/* Main speech bubble */}
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
          {/* Streaming cursor indicator */}
          {streamingMessageId && (
            <span
              style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                background: 'rgba(80, 180, 120, 0.9)',
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                animation: 'blink 0.8s ease-in-out infinite',
              }}
            />
          )}
        </div>
      )}

      {/* Tool execution status */}
      {toolStatus && !confirmation && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(40, 42, 48, 0.9)',
            color: 'rgba(200, 200, 210, 0.9)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontFamily: 'monospace',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: toolStatus.status === 'running' ? '#f0ad4e' : toolStatus.status === 'done' ? '#5cb85c' : '#d9534f',
            }}
          />
          {toolStatus.status === 'running' ? 'Running' : toolStatus.status === 'done' ? 'Done' : 'Error'}: {toolStatus.toolName}
        </div>
      )}

      {/* Confirmation request */}
      {confirmation && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(50, 40, 20, 0.95)',
            border: '1px solid rgba(240, 173, 78, 0.3)',
            borderRadius: 10,
            padding: '8px 12px',
            maxWidth: 300,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ fontSize: 12, color: '#f0ad4e', marginBottom: 4, fontWeight: 600 }}>
            Confirm: {confirmation.toolName}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(200, 200, 210, 0.8)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {renderArgsPreview(confirmation.args)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onConfirmResponse(confirmation.toolCallId, false)}
              style={{
                background: 'rgba(217, 83, 79, 0.8)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                padding: '4px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Deny
            </button>
            <button
              onClick={() => onConfirmResponse(confirmation.toolCallId, true)}
              style={{
                background: 'rgba(80, 180, 120, 0.8)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                padding: '4px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Allow
            </button>
          </div>
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

      {/* CSS animation for streaming cursor */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};
