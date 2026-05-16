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
        padding: 4,
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
          padding: '0 14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          background: 'rgba(26, 28, 31, 0.92)',
          backdropFilter: 'blur(8px)',
          color: '#e0e0e0',
          fontSize: 14,
          fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
          outline: 'none',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />
    </div>
  );
};
