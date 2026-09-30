import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider, useToast } from '@/context/ToastContext';

vi.mock('framer-motion', async () => {
  // Exit animations would keep a dismissed toast in the DOM; these tests are about timing and roles.
  const React = await import('react');
  // One stable component per tag: a new component type on every access would remount the toast on each render.
  const cache = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      if (!cache.has(tag)) {
        cache.set(tag, React.forwardRef<HTMLElement, Record<string, unknown>>(function MotionStub(props, ref) {
          const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
          return React.createElement(tag, { ...rest, ref });
        }));
      }
      return cache.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) };
});

type Api = ReturnType<typeof useToast>;
let api: Api;

function Harness() {
  api = useToast();
  return null;
}

function renderProvider() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
}

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider (docs/56 P7-01)', () => {
  it('dismisses a success toast after 5 seconds, announced politely', () => {
    renderProvider();
    act(() => api.addToast({ type: 'success', title: 'Saved' }));

    const status = screen.getByRole('status');
    expect(within(status).getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    advance(4900);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('keeps an error until it is dismissed, and announces it as an alert', () => {
    renderProvider();
    act(() => api.addToast({ type: 'error', title: 'Could not save', message: 'Jira said no' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not save');
    expect(alert).toHaveTextContent('Jira said no');
    // Not inside the polite region: one announcement, and it is assertive.
    expect(within(screen.getByRole('status')).queryByText('Could not save')).not.toBeInTheDocument();

    advance(10 * 60_000);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the string form addToast(title, "error") persists too', () => {
    renderProvider();
    act(() => api.addToast('Sync failed', 'error', 'Timeout'));

    advance(60_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Sync failed');
  });

  it('honours an explicit duration, even on an error', () => {
    renderProvider();
    act(() => api.addToast({ type: 'error', title: 'Brief', duration: 2000 }));

    advance(1900);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    advance(200);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a toast with duration 0 for good', () => {
    renderProvider();
    act(() => api.addToast({ type: 'info', title: 'Sticky', duration: 0 }));

    advance(60_000);
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('pauses while hovered and resumes with the time that was left', () => {
    renderProvider();
    act(() => api.addToast({ type: 'info', title: 'Reading me' }));
    const toast = screen.getByText('Reading me').closest('div[class*="rounded-xl"]') as HTMLElement;

    advance(3000);
    fireEvent.mouseEnter(toast);
    advance(30_000);
    expect(screen.getByText('Reading me')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    advance(1900);
    expect(screen.getByText('Reading me')).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText('Reading me')).not.toBeInTheDocument();
  });

  it('pauses while focus is inside the toast and resumes when it leaves', () => {
    renderProvider();
    act(() => api.addToast({ type: 'info', title: 'Undo available', duration: 6000, action: { label: 'Undo', onClick: vi.fn() } }));
    const undo = screen.getByRole('button', { name: 'Undo' });

    advance(4000);
    act(() => undo.focus());
    advance(60_000);
    expect(screen.getByText('Undo available')).toBeInTheDocument();

    // Moving focus between controls inside the same toast does not resume it.
    act(() => screen.getByRole('button', { name: 'Dismiss notification' }).focus());
    advance(60_000);
    expect(screen.getByText('Undo available')).toBeInTheDocument();

    act(() => (document.activeElement as HTMLElement).blur());
    advance(1900);
    expect(screen.getByText('Undo available')).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText('Undo available')).not.toBeInTheDocument();
  });

  it('a persistent error stays put while hovered or focused, and is still there afterwards', () => {
    renderProvider();
    act(() => api.addToast({ type: 'error', title: 'Broken' }));
    const alert = screen.getByRole('alert');

    fireEvent.mouseEnter(alert);
    advance(60_000);
    fireEvent.mouseLeave(alert);
    advance(60_000);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('raising the same failure again keeps one alert instead of stacking copies', () => {
    renderProvider();
    act(() => {
      api.addToast({ type: 'error', title: 'Could not save', message: 'Jira said no' });
      api.addToast({ type: 'error', title: 'Could not save', message: 'Jira said no' });
      api.addToast({ type: 'error', title: 'Could not save', message: 'Something else' });
    });

    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('raising an identical timed toast again restarts its timer', () => {
    renderProvider();
    act(() => api.addToast({ type: 'success', title: 'Saved' }));
    advance(4000);
    act(() => api.addToast({ type: 'success', title: 'Saved' }));

    advance(4000);
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    advance(1100);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('Escape dismisses the toast that has focus, and only that one', () => {
    renderProvider();
    act(() => {
      api.addToast({ type: 'error', title: 'First' });
      api.addToast({ type: 'error', title: 'Second' });
    });
    const first = screen.getByText('First').closest('[role="alert"]') as HTMLElement;

    fireEvent.keyDown(first, { key: 'Escape' });

    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('clearToasts removes everything, including persistent errors', () => {
    renderProvider();
    act(() => {
      api.addToast({ type: 'error', title: 'Broken' });
      api.addToast({ type: 'info', title: 'FYI' });
    });

    act(() => api.clearToasts());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('FYI')).not.toBeInTheDocument();
  });
});
