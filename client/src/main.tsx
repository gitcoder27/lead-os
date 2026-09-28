import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('LeadOS root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/* docs/54 M1: every Framer animation honours the OS reduced-motion setting. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>
);
