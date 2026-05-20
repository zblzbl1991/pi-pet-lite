import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/reset.css';
import { QuickInput } from './QuickInput';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <QuickInput />
  </React.StrictMode>
);
