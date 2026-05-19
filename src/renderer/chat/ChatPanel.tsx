import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChatMessage,
  ChatEntry,
  ToolCardEntry,
  TurnIndicatorEntry,
  isToolCardEntry,
  isTurnIndicatorEntry,
  MessageRole,
  AgentToRendererMessage,
} from '../../shared/types';
import type { ChatElectronAPI } from '../../shared/types';

interface ConfirmationRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Per-card collapse state */
interface CardCollapseState {
  collapsed: boolean;
  manualOverride: boolean;
}

/** Generate a summary string for a tool card based on tool name and result */
function getToolSummary(toolName: string, _args: Record<string, unknown>, result: string): string {
  const name = toolName.toLowerCase();
  if (name === 'glob' || name === 'find') {
    if (!result) return 'Searching...';
    const lines = result.trim().split('\n').filter((l) => l.trim());
    return lines.length === 0 ? 'No files found' : `${lines.length} file${lines.length !== 1 ? 's' : ''} found`;
  }
  if (name === 'grep') {
    if (!result) return 'Searching...';
    const lines = result.trim().split('\n').filter((l) => l.trim());
    return `${lines.length} match${lines.length !== 1 ? 'es' : ''}`;
  }
  if (name === 'read') {
    const filePath = _args?.file_path || _args?.path || '';
    if (typeof filePath === 'string' && filePath) {
      const filename = filePath.split('/').pop() || filePath;
      return `Read ${filename}`;
    }
    return 'Read file';
  }
  if (name === 'edit') {
    const filePath = _args?.file_path || _args?.path || '';
    if (typeof filePath === 'string' && filePath) {
      const filename = filePath.split('/').pop() || filePath;
      return `Edited ${filename}`;
    }
    return 'Edited file';
  }
  if (name === 'write') {
    const filePath = _args?.file_path || _args?.path || '';
    if (typeof filePath === 'string' && filePath) {
      const filename = filePath.split('/').pop() || filePath;
      return `Wrote ${filename}`;
    }
    return 'Wrote file';
  }
  if (name === 'bash') {
    if (!result) return 'Running command...';
    return 'Command executed';
  }
  // Generic fallback: first line truncated
  if (!result) return `${toolName} running...`;
  const firstLine = result.split('\n')[0];
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
}

export const ChatPanel: React.FC = () => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [inputText, setInputText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [slidIn, setSlidIn] = useState(false);
  const [cardStates, setCardStates] = useState<Map<string, CardCollapseState>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const collapseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const api = window.electronAPI as ChatElectronAPI;

  // Sync history on mount
  useEffect(() => {
    api.syncHistory().then((raw: ChatEntry[]) => {
      if (raw) {
        setEntries(raw);
        // Initialize card states from history
        const states = new Map<string, CardCollapseState>();
        for (const entry of raw) {
          if (isToolCardEntry(entry)) {
            states.set(entry.toolCallId, {
              collapsed: entry.toolStatus === 'done',
              manualOverride: false,
            });
          }
        }
        setCardStates(states);
      }
    });
  }, [api]);

  // Listen for slide-in / slide-out from main process
  useEffect(() => {
    const unsubSlideIn = api.onSlideIn(() => setSlidIn(true));
    const unsubSlideOut = api.onSlideOut(() => {
      setSlidIn(false);
      setTimeout(() => api.slideOutComplete(), 260);
    });
    return () => {
      unsubSlideIn();
      unsubSlideOut();
    };
  }, [api]);

  // Cleanup collapse timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of collapseTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Schedule auto-collapse for a tool card
  const scheduleAutoCollapse = useCallback((toolCallId: string) => {
    // Clear any existing timer
    const existing = collapseTimers.current.get(toolCallId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      setCardStates((prev) => {
        const state = prev.get(toolCallId);
        if (state && !state.manualOverride) {
          const next = new Map(prev);
          next.set(toolCallId, { ...state, collapsed: true });
          return next;
        }
        return prev;
      });
    }, 4000);
    collapseTimers.current.set(toolCallId, timer);
  }, []);

  // Listen for agent messages
  useEffect(() => {
    const unsubscribe = api.onAgentMessage(
      (msg: AgentToRendererMessage) => {
        switch (msg.type) {
          case 'chat-message':
            setEntries((prev) => [...prev, msg.message]);
            if (msg.message.streaming) setStreamingId(msg.message.id);
            break;

          case 'chat-message-update':
            setEntries((prev) =>
              prev.map((e) =>
                'role' in e && e.id === msg.id
                  ? { ...e, content: e.content + msg.delta }
                  : e
              )
            );
            break;

          case 'chat-message-end':
            setStreamingId((prev) => (prev === msg.id ? null : prev));
            setEntries((prev) =>
              prev.map((e) =>
                'role' in e && e.id === msg.id ? { ...e, streaming: false } : e
              )
            );
            break;

          case 'chat-thinking':
            setEntries((prev) =>
              prev.map((e) => {
                if (!('role' in e)) return e;
                if (e.id === msg.id) {
                  return { ...e, thinking: (e.thinking || '') + msg.delta };
                }
                return e;
              })
            );
            break;

          case 'turn-indicator':
            // We render turn indicators inline by storing them in entries
            if (msg.event === 'start') {
              const ti: TurnIndicatorEntry = {
                type: 'turn-indicator',
                id: `turn-${msg.turn}`,
                turn: msg.turn,
              };
              setEntries((prev) => [...prev, ti]);
            }
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
            if (msg.status === 'running' && msg.args) {
              // New tool card
              const toolCard: ToolCardEntry = {
                type: 'tool-card',
                id: `tc-${key}`,
                toolCallId: key,
                toolName: msg.toolName,
                toolArgs: msg.args,
                toolStatus: 'running',
                timestamp: Date.now(),
              };
              setEntries((prev) => [...prev, toolCard]);
              setCardStates((prev) => {
                const next = new Map(prev);
                next.set(key, { collapsed: false, manualOverride: false });
                return next;
              });
            } else {
              // Update existing tool card
              setEntries((prev) =>
                prev.map((e) => {
                  if (isToolCardEntry(e) && e.toolCallId === key) {
                    const updated: ToolCardEntry = {
                      ...e,
                      toolStatus: msg.status as 'running' | 'done' | 'error',
                    };
                    if (msg.result !== undefined) {
                      updated.toolResult = msg.result;
                    } else if (msg.partialResult !== undefined) {
                      updated.toolResult = (e.toolResult || '') + msg.partialResult;
                    }
                    if (msg.duration !== undefined) {
                      updated.duration = msg.duration;
                    }
                    return updated;
                  }
                  return e;
                })
              );
              // Schedule auto-collapse for done, not for error
              if (msg.status === 'done') {
                scheduleAutoCollapse(key);
              }
            }
            break;
          }

          case 'error':
            setEntries((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: MessageRole.ASSISTANT,
                content: `[Error] ${msg.message}`,
                timestamp: Date.now(),
              } as ChatMessage,
            ]);
            break;
        }
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [api, scheduleAutoCollapse]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, confirmation]);

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

  const handleAbort = useCallback(() => {
    api.sendToAgent({ type: 'abort' });
  }, [api]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (streamingId) {
          handleAbort();
        } else {
          handleSend();
        }
      }
    },
    [handleSend, handleAbort, streamingId]
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

  const handleClose = useCallback(() => {
    api.closeChat();
  }, [api]);

  const toggleCardCollapse = useCallback((toolCallId: string) => {
    setCardStates((prev) => {
      const next = new Map(prev);
      const current = next.get(toolCallId);
      if (current) {
        next.set(toolCallId, {
          collapsed: !current.collapsed,
          manualOverride: true,
        });
      }
      return next;
    });
  }, []);

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
    <div style={{
      ...containerStyle,
      transform: slidIn ? 'translateX(0)' : 'translateX(100%)',
    }}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={dotStyle} />
        <span style={{ fontWeight: 600, marginLeft: 8 }}>Clawd</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>
          Desktop AI Assistant
        </span>
        <button
          onClick={handleClose}
          style={closeButtonStyle}
          title="Close sidebar"
        >
          x
        </button>
      </div>

      {/* Messages */}
      <div style={messagesStyle}>
        {entries.length === 0 && (
          <div style={emptyStateStyle}>
            Click the pet to start chatting!
          </div>
        )}

        {entries.map((entry) => {
          // Turn indicator
          if (isTurnIndicatorEntry(entry)) {
            return (
              <div key={entry.id} style={turnSeparatorStyle}>
                <div style={turnLineStyle} />
                <span style={turnLabelStyle}>Turn {entry.turn}</span>
                <div style={turnLineStyle} />
              </div>
            );
          }

          // Tool card entry
          if (isToolCardEntry(entry)) {
            const cardState = cardStates.get(entry.toolCallId) || { collapsed: false, manualOverride: false };
            const summary = getToolSummary(entry.toolName, entry.toolArgs, entry.toolResult || '');
            const statusColor =
              entry.toolStatus === 'running'
                ? '#f0ad4e'
                : entry.toolStatus === 'done'
                  ? '#5cb85c'
                  : '#d9534f';
            const statusLabel =
              entry.toolStatus === 'running'
                ? 'Running'
                : entry.toolStatus === 'done'
                  ? 'Done'
                  : 'Error';

            return (
              <div key={entry.id} style={toolCardStyle}>
                {/* Card header */}
                <div
                  style={toolCardHeaderStyle}
                  onClick={() => toggleCardCollapse(entry.toolCallId)}
                >
                  <span style={{ ...toolCardDotStyle, background: statusColor }} />
                  <span style={toolCardNameStyle}>{entry.toolName}</span>
                  <span style={toolCardStatusLabel}>{statusLabel}</span>
                  {entry.duration != null && (
                    <span style={toolCardDurationStyle}>{(entry.duration / 1000).toFixed(1)}s</span>
                  )}
                  {cardState.collapsed && (
                    <span style={toolCardSummaryStyle}>{summary}</span>
                  )}
                  <span style={toolCardChevronStyle}>{cardState.collapsed ? '+' : '-'}</span>
                </div>

                {/* Expandable content */}
                {!cardState.collapsed && (
                  <div style={toolCardContentStyle}>
                    {/* Args section */}
                    <div style={toolCardSectionStyle}>
                      <div style={toolCardSectionLabelStyle}>Arguments</div>
                      <pre style={toolCardPreStyle}>
                        {JSON.stringify(entry.toolArgs, null, 2)}
                      </pre>
                    </div>

                    {/* Result section */}
                    {(entry.toolResult || entry.toolStatus === 'running') && (
                      <div style={toolCardSectionStyle}>
                        <div style={toolCardSectionLabelStyle}>Result</div>
                        <div style={toolCardResultStyle}>
                          {entry.toolResult || 'Waiting...'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }

          // Chat message
          const msg = entry as ChatMessage;
          return (
            <div key={msg.id} style={bubbleStyle(msg.role)}>
              {/* Thinking block */}
              {msg.thinking && (
                <div style={thinkingBlockStyle}>{msg.thinking}</div>
              )}
              <span>{msg.content}</span>
              {msg.id === streamingId && <span style={cursorStyle} />}
            </div>
          );
        })}

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
        {streamingId ? (
          <button
            style={stopButtonStyle}
            onClick={handleAbort}
            title="Stop generating"
          >
            Stop
          </button>
        ) : (
          <button
            style={sendButtonStyle}
            onClick={handleSend}
            disabled={!inputText.trim()}
          >
            Send
          </button>
        )}
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
  borderLeft: '1px solid #444',
  transform: 'translateX(100%)',
  transition: 'transform 250ms ease-out',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: '#25262a',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  fontSize: 13,
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

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
  fontSize: 13,
  lineHeight: 1.5,
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
  background:
    role === MessageRole.USER
      ? '#3a6b4f'
      : '#2a2c30',
  border: 'none',
  color: '#e0e0e0',
  fontFamily: 'inherit',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

const thinkingBlockStyle: React.CSSProperties = {
  fontStyle: 'italic',
  color: 'rgba(180, 180, 200, 0.5)',
  fontSize: 12,
  lineHeight: 1.4,
  marginBottom: 6,
  paddingBottom: 6,
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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

// Turn indicator styles
const turnSeparatorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  alignSelf: 'center',
  width: '80%',
};

const turnLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: 'rgba(255, 255, 255, 0.1)',
};

const turnLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
};

// Tool card styles
const toolCardStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'rgba(40, 42, 48, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 10,
  maxWidth: '95%',
  minWidth: 200,
};

const toolCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

const toolCardDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  display: 'inline-block',
  flexShrink: 0,
};

const toolCardNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#e0e0e0',
};

const toolCardStatusLabel: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(200, 200, 210, 0.5)',
};

const toolCardDurationStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(200, 200, 210, 0.4)',
};

const toolCardSummaryStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(200, 200, 210, 0.6)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginLeft: 4,
};

const toolCardChevronStyle: React.CSSProperties = {
  fontSize: 14,
  color: 'rgba(200, 200, 210, 0.4)',
  marginLeft: 'auto',
  flexShrink: 0,
};

const toolCardContentStyle: React.CSSProperties = {
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  padding: '6px 12px 10px',
};

const toolCardSectionStyle: React.CSSProperties = {
  marginBottom: 6,
};

const toolCardSectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(200, 200, 210, 0.4)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 3,
};

const toolCardPreStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'rgba(200, 200, 210, 0.7)',
  background: 'rgba(0, 0, 0, 0.2)',
  borderRadius: 6,
  padding: '6px 8px',
  margin: 0,
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const toolCardResultStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'rgba(200, 200, 210, 0.7)',
  background: 'rgba(0, 0, 0, 0.2)',
  borderRadius: 6,
  padding: '6px 8px',
  maxHeight: 300,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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

const stopButtonStyle: React.CSSProperties = {
  background: '#d9534f',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  minWidth: 52,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 16,
  cursor: 'pointer',
  marginLeft: 8,
  padding: '0 4px',
  lineHeight: 1,
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;
