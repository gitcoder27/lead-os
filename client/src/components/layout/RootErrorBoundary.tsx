import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-reload';

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

const ACTION_CLASS =
  'rounded-lg px-4 py-2 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

/**
 * Last-resort recovery screen. It is deliberately static: no router, providers,
 * queries or lazy chunks, so it still renders when any of those is what failed.
 * Navigation is a full page load for the same reason.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LeadOS render error', error, info.componentStack);
    // A lazy() import that 404s after a deploy: fetch the new build once.
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-full w-full items-center justify-center overflow-auto p-6"
        style={{ background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
      >
        <div
          className="w-full max-w-md rounded-xl border p-6"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            LeadOS hit an unexpected error. Your data is safe. Reloading usually fixes it.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={ACTION_CLASS}
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className={`${ACTION_CLASS} border`}
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              onClick={() => window.location.assign('/')}
            >
              Go to Today
            </button>
          </div>
          {error.message ? (
            <details className="mt-4 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}
