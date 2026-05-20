import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Square,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
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
        <span style={{ fontWeight: 'var(--font-semibold)', marginLeft: 'var(--space-2)' }}>Clawd</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Desktop AI Assistant
        </span>
        <button
          onClick={handleClose}
          style={closeButtonStyle}
          title="Close sidebar"
        >
          <X size={16} strokeWidth={1.5} />
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
                ? 'var(--warning)'
                : entry.toolStatus === 'done'
                  ? 'var(--success)'
                  : 'var(--danger)';
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
                  {entry.toolStatus === 'running' ? (
                    <Loader2 size={14} strokeWidth={2} style={{ color: statusColor, animation: 'spin 1.2s linear infinite', flexShrink: 0 }} />
                  ) : entry.toolStatus === 'done' ? (
                    <CheckCircle size={14} strokeWidth={2} style={{ color: statusColor, flexShrink: 0 }} />
                  ) : (
                    <AlertCircle size={14} strokeWidth={2} style={{ color: statusColor, flexShrink: 0 }} />
                  )}
                  <span style={toolCardNameStyle}>{entry.toolName}</span>
                  <span style={toolCardStatusLabel}>{statusLabel}</span>
                  {entry.duration != null && (
                    <span style={toolCardDurationStyle}>{(entry.duration / 1000).toFixed(1)}s</span>
                  )}
                  {cardState.collapsed && (
                    <span style={toolCardSummaryStyle}>{summary}</span>
                  )}
                  {cardState.collapsed
                    ? <ChevronRight size={14} strokeWidth={1.5} style={toolCardChevronStyle} />
                    : <ChevronDown size={14} strokeWidth={1.5} style={toolCardChevronStyle} />
                  }
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
              <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--warning)', verticalAlign: 'middle', marginRight: 'var(--space-1)' }} />
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
            <Square size={14} strokeWidth={2} style={{ color: '#fff' }} />
            <span style={{ marginLeft: 'var(--space-1)' }}>Stop</span>
          </button>
        ) : (
          <button
            style={sendButtonStyle}
            onClick={handleSend}
            disabled={!inputText.trim()}
          >
            <Send size={14} strokeWidth={2} style={{ color: '#fff' }} />
            <span style={{ marginLeft: 'var(--space-1)' }}>Send</span>
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
  background: 'var(--glass-bg)',
  backdropFilter: `blur(var(--glass-blur))`,
  WebkitBackdropFilter: `blur(var(--glass-blur))`,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
  borderLeft: `1px solid var(--glass-border)`,
  transform: 'translateX(100%)',
  transition: 'transform var(--duration-slow) var(--ease-out)',
};

const headerStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg-header)',
  borderBottom: `1px solid var(--border)`,
  display: 'flex',
  alignItems: 'center',
  fontSize: 'var(--text-xs)',
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

const dotStyle: React.CSSProperties = {
  width: 'var(--space-2)',
  height: 'var(--space-2)',
  borderRadius: '50%',
  background: 'var(--success)',
  display: 'inline-block',
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-base)',
};

const bubbleStyle = (role: string): React.CSSProperties => ({
  maxWidth: '85%',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-lg)',
  fontSize: 'var(--text-xs)',
  lineHeight: 'var(--leading-relaxed)',
  alignSelf: role === MessageRole.USER ? 'flex-end' : 'flex-start',
  background:
    role === MessageRole.USER
      ? 'var(--role-scout)'
      : 'var(--bg-input)',
  border: 'none',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

const thinkingBlockStyle: React.CSSProperties = {
  fontStyle: 'italic',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
  lineHeight: 'var(--leading-normal)',
  marginBottom: 'var(--space-2)',
  paddingBottom: 'var(--space-2)',
  borderBottom: `1px solid var(--border-subtle)`,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const cursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: 'var(--text-sm)',
  background: 'var(--success)',
  marginLeft: 'var(--space-1)',
  verticalAlign: 'text-bottom',
  animation: 'blink 0.8s ease-in-out infinite',
};

// Turn indicator styles
const turnSeparatorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-1) 0',
  alignSelf: 'center',
  width: '80%',
};

const turnLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: 'var(--border)',
};

const turnLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  whiteSpace: 'nowrap',
};

// Tool card styles
const toolCardStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--bg-elevated)',
  border: `1px solid var(--border-subtle)`,
  borderRadius: 'var(--radius-nav)',
  maxWidth: '95%',
  minWidth: 200,
};

const toolCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
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
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--font-semibold)',
  color: 'var(--text-primary)',
};

const toolCardStatusLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
};

const toolCardDurationStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
};

const toolCardSummaryStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginLeft: 'var(--space-1)',
};

const toolCardChevronStyle: React.CSSProperties = {
  fontSize: 'var(--text-base)',
  color: 'var(--text-tertiary)',
  marginLeft: 'auto',
  flexShrink: 0,
};

const toolCardContentStyle: React.CSSProperties = {
  borderTop: `1px solid var(--border-subtle)`,
  padding: 'var(--space-2) var(--space-3) var(--space-3)',
};

const toolCardSectionStyle: React.CSSProperties = {
  marginBottom: 'var(--space-2)',
};

const toolCardSectionLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  marginBottom: 'var(--space-1)',
};

const toolCardPreStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-page)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-2)',
  margin: 0,
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const toolCardResultStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-page)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-2)',
  maxHeight: 300,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const confirmCardStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--warning-bg)',
  border: `1px solid var(--warning)`,
  borderRadius: 'var(--radius-nav)',
  padding: 'var(--space-3) var(--space-4)',
  maxWidth: 320,
};

const confirmTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--warning)',
  marginBottom: 'var(--space-1)',
  fontWeight: 'var(--font-semibold)',
};

const confirmArgsStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  wordBreak: 'break-all',
};

const confirmButtonsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--space-2)',
  marginTop: 'var(--space-2)',
  justifyContent: 'flex-end',
};

const denyButtonStyle: React.CSSProperties = {
  background: 'var(--danger)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: 'var(--space-1) var(--space-3)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};

const allowButtonStyle: React.CSSProperties = {
  background: 'var(--success)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: 'var(--space-1) var(--space-3)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};

const inputContainerStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-3)',
  borderTop: `1px solid var(--border)`,
  display: 'flex',
  gap: 'var(--space-2)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg-input)',
  border: `1px solid var(--border)`,
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs)',
  outline: 'none',
};

const sendButtonStyle: React.CSSProperties = {
  background: 'var(--success)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-4)',
  color: '#fff',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  opacity: 1,
  display: 'flex',
  alignItems: 'center',
};

const stopButtonStyle: React.CSSProperties = {
  background: 'var(--danger)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-4)',
  color: '#fff',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  minWidth: 52,
  display: 'flex',
  alignItems: 'center',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-lg)',
  cursor: 'pointer',
  marginLeft: 'var(--space-2)',
  padding: '0 var(--space-1)',
  lineHeight: 1,
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;
