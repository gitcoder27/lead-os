import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStandupRound } from '@/hooks/useStandupRound';

/**
 * A faithful-enough Web Locks fake: a lock is *granted* the moment it is free, but its callback runs a task
 * later, and an abort after the grant changes nothing — the real browser behaviour that leaked the standup lock.
 */
function installFakeLocks() {
  const held = new Set<string>();
  const queue: Array<{ name: string; grant: () => void; signal?: AbortSignal; reject: (e: unknown) => void; done: boolean }> = [];
  const pump = () => {
    for (const entry of [...queue]) {
      if (entry.done || held.has(entry.name)) continue;
      entry.done = true;
      queue.splice(queue.indexOf(entry), 1);
      held.add(entry.name);
      entry.grant();
    }
  };
  const locks = {
    request(name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const entry = {
          name, signal: options.signal, reject, done: false,
          grant: () => {
            // Granted now; the callback runs on a later task.
            setTimeout(() => {
              void Promise.resolve(callback()).then(resolve, reject).finally(() => { held.delete(name); pump(); });
            }, 0);
          },
        };
        options.signal?.addEventListener('abort', () => {
          if (entry.done) return;            // already granted: abort is ignored
          entry.done = true;
          queue.splice(queue.indexOf(entry), 1);
          reject(new DOMException('aborted', 'AbortError'));
        });
        queue.push(entry);
        pump();
      });
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return { held };
}

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe('standup round lock (re-opening standup)', () => {
  let fake: ReturnType<typeof installFakeLocks>;
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    fake = installFakeLocks();
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('owns the round while open and lets go on close, so it can be opened again (also under StrictMode)', async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const view = renderHook(() => useStandupRound('standup-key', ['a', 'b']), { wrapper: strict });
      await waitFor(() => expect(view.result.current.ownsRound).toBe(true), { timeout: 1000 });
      expect(fake.held.size).toBe(1);
      view.unmount();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(fake.held.size, `lock released after close #${attempt}`).toBe(0);
    }
  });

  it('releases a lock that is granted only after the screen was already closed', async () => {
    const view = renderHook(() => useStandupRound('standup-key', ['a']));
    view.unmount();                                   // closed before the browser ran the callback
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(fake.held.size).toBe(0);
    const again = renderHook(() => useStandupRound('standup-key', ['a']));
    await waitFor(() => expect(again.result.current.ownsRound).toBe(true), { timeout: 1000 });
    again.unmount();
  });

  it('still reports a second open tab while the first holds the round', async () => {
    const first = renderHook(() => useStandupRound('standup-key', ['a']));
    await waitFor(() => expect(first.result.current.ownsRound).toBe(true), { timeout: 1000 });
    const second = renderHook(() => useStandupRound('standup-key', ['a']));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(second.result.current.ownsRound).toBe(false);
    first.unmount();
    await waitFor(() => expect(second.result.current.ownsRound).toBe(true), { timeout: 1000 });
    second.unmount();
  });
});
