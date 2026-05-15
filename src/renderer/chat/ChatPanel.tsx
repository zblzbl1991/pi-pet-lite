import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChatMessage,
  MessageRole,
  AgentToRendererMessage,
} from '../../shared/types';
import type { ChatElectronAPI } from '../../shared/types';

interface ConfirmationRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolStatus {
  toolName: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export const ChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [toolStatuses, setToolStatuses] = useState<Map<string, ToolStatus>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = window.electronAPI as ChatElectronAPI;

  // Sync history on mount
  useEffect(() => {
    api.syncHistory().then((raw: ChatMessage[]) => {
      if (raw) setMessages(raw);
    });
  }, [api]);

  // Listen for agent messages
  useEffect(() => {
    const unsubscribe = api.onAgentMessage(
      (msg: AgentToRendererMessage) => {
        switch (msg.type) {
          case 'chat-message':
            setMessages((prev) => [...prev, msg.message]);
            if (msg.message.streaming) setStreamingId(msg.message.id);
            break;

          case 'chat-message-update':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id
                  ? { ...m, content: m.content + msg.delta }
                  : m
              )
            );
            break;

          case 'chat-message-end':
            setStreamingId((prev) => (prev === msg.id ? null : prev));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id ? { ...m, streaming: false } : m
              )
            );
            break;

          case 'confirmation-request':
            setConfirmation({
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              args: msg.args,
            });
            break;

          case 'tool-execution': {
            const key = msg.toolCallId;
            setToolStatuses((prev) => {
              const next = new Map(prev);
              next.set(key, {
                toolName: msg.toolName,
                status: msg.status,
                result: msg.result,
              });
              return next;
            });
            // Auto-clear completed tool status after 3s
            if (msg.status === 'done' || msg.status === 'error') {
              setTimeout(() => {
                setToolStatuses((prev) => {
                  const next = new Map(prev);
                  next.delete(key);
                  return next;
                });
              }, 3000);
            }
            break;
          }

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
        }
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [api]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatuses, confirmation]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    api.sendToAgent({ type: 'user-input', text });
    setInputText('');
    inputRef.current?.focus();
  }, [inputText, api]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleConfirm = useCallback(
    (toolCallId: string, approved: boolean) => {
      setConfirmation(null);
      api.sendToAgent({
        type: 'confirmation-response',
        toolCallId,
        approved,
      });
      inputRef.current?.focus();
    },
    [api]
  );

  // Active tool status entries for display
  const activeTools = Array.from(toolStatuses.entries());

  /** Render truncated tool args */
  const renderArgsPreview = (args: Record<string, unknown>): string => {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';
    return entries
      .slice(0, 3)
      .map(([key, val]) => {
        const s = typeof val === 'string' ? val : JSON.stringify(val);
        return `${key}: ${s.length > 40 ? s.slice(0, 40) + '...' : s}`;
      })
      .join(', ');
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={dotStyle} />
        <span style={{ fontWeight: 600, marginLeft: 8 }}>Clawd</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>
          Desktop AI Assistant
        </span>
      </div>

      {/* Messages */}
      <div style={messagesStyle}>
        {messages.length === 0 && (
          <div style={emptyStateStyle}>
            Click the pet to start chatting!
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={bubbleStyle(msg.role)}>
            {msg.role === MessageRole.TOOL && (
              <span style={toolLabelStyle}>
                {msg.isError ? '✗' : '⚡'} tool
              </span>
            )}
            <span>{msg.content}</span>
            {msg.id === streamingId && <span style={cursorStyle} />}
          </div>
        ))}

        {/* Active tool indicators */}
        {activeTools.map(([key, ts]) => (
          <div key={`tool-${key}`} style={toolStatusStyle}>
            <span
              style={{
                ...toolDotStyle,
                background:
                  ts.status === 'running'
                    ? '#f0ad4e'
                    : ts.status === 'done'
                      ? '#5cb85c'
                      : '#d9534f',
              }}
            />
            <span>
              {ts.status === 'running'
                ? 'Running'
                : ts.status === 'done'
                  ? 'Done'
                  : 'Error'}
              : {ts.toolName}
            </span>
          </div>
        ))}

        {/* Confirmation request */}
        {confirmation && (
          <div style={confirmCardStyle}>
            <div style={confirmTitleStyle}>
              Confirm: {confirmation.toolName}
            </div>
            <div style={confirmArgsStyle}>
              {renderArgsPreview(confirmation.args)}
            </div>
            <div style={confirmButtonsStyle}>
              <button
                onClick={() =>
                  handleConfirm(confirmation.toolCallId, false)
                }
                style={denyButtonStyle}
              >
                Deny
              </button>
              <button
                onClick={() =>
                  handleConfirm(confirmation.toolCallId, true)
                }
                style={allowButtonStyle}
              >
                Allow
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={inputContainerStyle}>
        <input
          ref={inputRef}
          style={inputStyle}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell Clawd what to do..."
        />
        <button
          style={sendButtonStyle}
          onClick={handleSend}
          disabled={!inputText.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
};

// --- Styles ---

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: '#1e1f22',
  color: '#e0e0e0',
  fontFamily: "'Segoe UI', -apple-system, sans-serif",
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: '#25262a',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  fontSize: 13,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#5cb85c',
  display: 'inline-block',
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#555',
  fontSize: 14,
};

const bubbleStyle = (role: string): React.CSSProperties => ({
  maxWidth: '85%',
  padding: '8px 12px',
  borderRadius: 12,
  fontSize: role === MessageRole.TOOL ? 11 : 13,
  lineHeight: 1.5,
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
  background:
    role === MessageRole.USER
      ? '#3a6b4f'
      : role === MessageRole.TOOL
        ? '#2a2820'
        : '#2a2c30',
  border: role === MessageRole.TOOL ? '1px solid #3a3a30' : 'none',
  color: '#e0e0e0',
  fontFamily: role === MessageRole.TOOL ? 'monospace' : 'inherit',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

const toolLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 9,
  color: '#888',
  marginBottom: 2,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const cursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: 14,
  background: '#5cb85c',
  marginLeft: 2,
  verticalAlign: 'text-bottom',
  animation: 'blink 0.8s ease-in-out infinite',
};

const toolStatusStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'rgba(40, 42, 48, 0.9)',
  color: 'rgba(200, 200, 210, 0.9)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 11,
  fontFamily: 'monospace',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const toolDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  display: 'inline-block',
};

const confirmCardStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'rgba(50, 40, 20, 0.95)',
  border: '1px solid rgba(240, 173, 78, 0.3)',
  borderRadius: 10,
  padding: '10px 14px',
  maxWidth: 320,
};

const confirmTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#f0ad4e',
  marginBottom: 4,
  fontWeight: 600,
};

const confirmArgsStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(200, 200, 210, 0.8)',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};

const confirmButtonsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 8,
  justifyContent: 'flex-end',
};

const denyButtonStyle: React.CSSProperties = {
  background: 'rgba(217, 83, 79, 0.8)',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  padding: '4px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const allowButtonStyle: React.CSSProperties = {
  background: 'rgba(80, 180, 120, 0.8)',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  padding: '4px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const inputContainerStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderTop: '1px solid #333',
  display: 'flex',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#2a2c30',
  border: '1px solid #444',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#e0e0e0',
  fontSize: 13,
  outline: 'none',
};

const sendButtonStyle: React.CSSProperties = {
  background: '#5cb85c',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 1,
};
