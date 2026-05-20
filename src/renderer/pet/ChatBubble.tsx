import React from 'react';
import { AlertTriangle, Loader2, CheckCircle, AlertCircle, X, Check } from 'lucide-react';

interface ConfirmationRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ChatBubbleProps {
  message: string | null;
  streamingMessageId: string | null;
  confirmation: ConfirmationRequest | null;
  toolStatus: { toolName: string; status: string } | null;
  onConfirmResponse: (toolCallId: string, approved: boolean) => void;
}

/**
 * Mini chat bubble displayed above the Clawd pet.
 * Shows the latest agent message, tool status, and confirmation requests.
 * Input has moved to the ChatWindow — this bubble is read-only.
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  streamingMessageId,
  confirmation,
  toolStatus,
  onConfirmResponse,
}) => {
  const isVisible = message !== null || confirmation !== null;

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
        marginBottom: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: isVisible ? 1 : 0,
        transform: isVisible
          ? 'translateY(0) scale(1)'
          : 'translateY(var(--space-2)) scale(0.95)',
        transition: 'opacity var(--duration-slow) var(--ease-out), transform var(--duration-slow) var(--ease-out)',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {/* Main speech bubble — mini (one-line summary) */}
      {message && (
        <div
          style={{
            background: 'var(--glass-bg)',
            color: 'var(--text-primary)',
            border: `1px solid var(--glass-border)`,
            borderRadius: 'var(--radius-btn)',
            padding: 'var(--space-3) var(--space-4)',
            fontSize: 'var(--text-xs)',
            maxWidth: 280,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 'var(--leading-normal)',
            backdropFilter: `blur(var(--glass-blur))`,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
          title={message}
        >
          {message}
          {/* Streaming cursor indicator */}
          {streamingMessageId && (
            <span
              style={{
                display: 'inline-block',
                width: 2,
                height: 'var(--text-sm)',
                background: 'var(--success)',
                marginLeft: 'var(--space-1)',
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
            marginTop: 'var(--space-1)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            backdropFilter: `blur(var(--glass-blur))`,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {toolStatus.status === 'running' ? (
            <Loader2 size={12} strokeWidth={2} style={{ color: 'var(--warning)', animation: 'spin 1.2s linear infinite', flexShrink: 0 }} />
          ) : toolStatus.status === 'done' ? (
            <CheckCircle size={12} strokeWidth={2} style={{ color: 'var(--success)', flexShrink: 0 }} />
          ) : (
            <AlertCircle size={12} strokeWidth={2} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          )}
          {toolStatus.status === 'running'
            ? 'Running'
            : toolStatus.status === 'done'
              ? 'Done'
              : 'Error'}
          : {toolStatus.toolName}
        </div>
      )}

      {/* Confirmation request */}
      {confirmation && (
        <div
          style={{
            marginTop: 'var(--space-1)',
            background: 'var(--warning-bg)',
            border: `1px solid var(--warning)`,
            borderRadius: 'var(--radius-nav)',
            padding: 'var(--space-2) var(--space-3)',
            maxWidth: 300,
            backdropFilter: `blur(var(--glass-blur))`,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--warning)',
              marginBottom: 'var(--space-1)',
              fontWeight: 'var(--font-semibold)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <AlertTriangle size={12} strokeWidth={1.5} /> Confirm: {confirmation.toolName}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
            }}
          >
            {renderArgsPreview(confirmation.args)}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={() => onConfirmResponse(confirmation.toolCallId, false)}
              style={{
                background: 'var(--danger)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: '#fff',
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <X size={12} strokeWidth={2} style={{ color: '#fff' }} /> Deny
            </button>
            <button
              onClick={() => onConfirmResponse(confirmation.toolCallId, true)}
              style={{
                background: 'var(--success)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: '#fff',
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Check size={12} strokeWidth={2} style={{ color: '#fff' }} /> Allow
            </button>
          </div>
        </div>
      )}

      {/* Triangle pointer */}
      {isVisible && (
        <div
          style={{
            width: 'var(--space-3)',
            height: 'var(--space-3)',
            background: 'var(--glass-bg)',
            transform: 'rotate(45deg)',
            marginTop: -6, // specific layout offset, keep as-is
            borderRight: `1px solid var(--glass-border)`,
            borderBottom: `1px solid var(--glass-border)`,
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
