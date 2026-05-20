import React, { useRef, useEffect, useState } from 'react';
import type { QuickInputElectronAPI } from '../../shared/types';

export const QuickInput: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const [text, setText] = useState('');

  const api = window.electronAPI as QuickInputElectronAPI | undefined;

  useEffect(() => {
    // Auto-focus the input on mount
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && text.trim()) {
      submittedRef.current = true;
      api?.submit(text.trim());
    } else if (e.key === 'Escape') {
      api?.cancel();
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-1)',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Clawd..."
        style={{
          width: '100%',
          height: 40,
          padding: '0 var(--space-4)',
          border: `1px solid var(--glass-border)`,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--glass-bg)',
          backdropFilter: `blur(var(--glass-blur))`,
          color: 'var(--text-primary)',
          fontSize: 'var(--text-base)',
          fontFamily: 'var(--font-body)',
          outline: 'none',
          WebkitBackdropFilter: `blur(var(--glass-blur))`,
        }}
      />
    </div>
  );
};
