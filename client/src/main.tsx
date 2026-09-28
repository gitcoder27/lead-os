import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { RootErrorBoundary } from '@/components/layout/RootErrorBoundary';
import { installPreloadErrorReload } from '@/lib/chunk-reload';
import './index.css';

// A stale tab after a deploy 404s on old chunk hashes; reload once to pick up the new build.
installPreloadErrorReload();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('LeadOS root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      {/* docs/54 M1: every Framer animation honours the OS reduced-motion setting. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </RootErrorBoundary>
  </React.StrictMode>
);
