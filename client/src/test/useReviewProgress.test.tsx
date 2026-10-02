import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewProgress, REVIEW_SAVE_DELAY_MS } from '@/hooks/useWeeklyReview';
import { blankSavedState } from '@/lib/weekly-review';
const put = vi.fn(),
  toast = vi.fn();
vi.mock('@/lib/api', () => ({ api: { put: (...args: unknown[]) => put(...args) } }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast }) }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope' }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());
describe('acknowledged review progress', () => {
  it('serializes edits made while a save is in flight, preserving the newest report', async () => {
    let resolve!: (value: unknown) => void;
    put
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ saved: { ...blankSavedState('2026-09-28'), reportMarkdown: 'Newer' } });
    const { result } = renderHook(() => useReviewProgress('2026-09-28', null));
    act(() => result.current.patch({ reportMarkdown: 'First' }));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_SAVE_DELAY_MS));
    act(() => result.current.patch({ reportMarkdown: 'Newer' }));
    let completion!: Promise<unknown>;
    act(() => {
      completion = result.current.flush();
    });
    await act(async () => {
      resolve({ saved: { ...blankSavedState('2026-09-28'), reportMarkdown: 'First' } });
      await completion;
    });
    expect(put.mock.calls.map((call) => call[1])).toEqual([{ reportMarkdown: 'First' }, { reportMarkdown: 'Newer' }]);
    expect(result.current.saved.reportMarkdown).toBe('Newer');
  });
  it('keeps failures without a retry loop and never completes later through an ordinary edit', async () => {
    put.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ saved: blankSavedState('2026-09-28') });
    const { result } = renderHook(() => useReviewProgress('2026-09-28', null));
    await act(async () => {
      await expect(result.current.saveNow({ reportMarkdown: 'Kept', completed: true })).rejects.toThrow(
        "Couldn't save",
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.saved.completedAt).toBeNull();
    act(() => result.current.patch({ reportMarkdown: 'Edited after failure' }));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_SAVE_DELAY_MS));
    expect(put).toHaveBeenLastCalledWith('/review/week/2026-09-28', { reportMarkdown: 'Edited after failure' });
    expect(result.current.saved.completedAt).toBeNull();
  });
  it('sets completion only after the server acknowledges it', async () => {
    let resolve!: (value: unknown) => void;
    put.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useReviewProgress('2026-09-28', null));
    let completion!: Promise<unknown>;
    act(() => {
      completion = result.current.saveNow({ reportMarkdown: 'Finished', completed: true });
    });
    expect(result.current.saved.completedAt).toBeNull();
    await act(async () => {
      resolve({ saved: { ...blankSavedState('2026-09-28'), completedAt: '2026-10-02T12:00:00Z' } });
      await completion;
    });
    expect(result.current.saved.completedAt).toBe('2026-10-02T12:00:00Z');
  });
});
