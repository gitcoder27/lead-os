import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { blankSavedState } from '@/lib/weekly-review';
import { getLocalTimeZone } from '@/lib/utils';
import type { SaveWeeklyReviewRequest, SaveWeeklyReviewResponse, WeeklyReviewResponse, WeeklyReviewSavedState } from '@/types';

/** How long a burst of ticks waits before it is written (docs/59 §5.3: saved, debounced). */
export const REVIEW_SAVE_DELAY_MS = 400;

/**
 * docs/59 §9: the week's read model. It is a snapshot: the review must not reshuffle under the
 * manager's hands, so there is no polling and no refocus refetch; opening the review (or Retry)
 * fetches a fresh one.
 */
export function useWeeklyReview(week?: string) {
  const scope = useAuthScopeKey();
  const tz = getLocalTimeZone();
  return useQuery<WeeklyReviewResponse>({
    queryKey: ['weekly-review', scope, week ?? 'auto', tz ?? null],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (week) params.set('week', week);
      if (tz) params.set('tz', tz);
      const query = params.toString();
      return api.get<WeeklyReviewResponse>(`/review/week${query ? `?${query}` : ''}`, { signal });
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    // One quiet retry; a second failure is the error state with a manual Retry.
    retry: 1,
    retryDelay: 400,
  });
}

function merge(pending: SaveWeeklyReviewRequest, next: SaveWeeklyReviewRequest): SaveWeeklyReviewRequest {
  return { ...pending, ...next, ...(pending.decisions || next.decisions ? { decisions: { ...pending.decisions, ...next.decisions } } : {}) };
}

/**
 * The manager's progress in one week's review. The saved record is kept locally so ticks and step
 * changes show at once; writes are debounced into one `PUT`, flushed when the review closes, and a
 * failed write raises a persistent error toast and is sent again with the next change.
 */
export function useReviewProgress(weekStart: string, initial: WeeklyReviewSavedState | null) {
  const { addToast } = useToast();
  const [saved, setSaved] = useState<WeeklyReviewSavedState>(() => initial ?? blankSavedState(weekStart));
  const pending = useRef<SaveWeeklyReviewRequest>({});
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const body = pending.current;
    if (Object.keys(body).length === 0 || inFlight.current) return;
    pending.current = {};
    inFlight.current = true;
    api.put<SaveWeeklyReviewResponse>(`/review/week/${weekStart}`, body)
      .catch((error: Error) => {
        pending.current = merge(body, pending.current);
        addToast({ type: 'error', title: "Couldn't save your review progress", message: error.message });
      })
      .finally(() => {
        inFlight.current = false;
        if (Object.keys(pending.current).length > 0 && timer.current === null) {
          timer.current = window.setTimeout(flush, REVIEW_SAVE_DELAY_MS);
        }
      });
  }, [addToast, weekStart]);

  const patch = useCallback((change: SaveWeeklyReviewRequest) => {
    setSaved((current) => ({
      ...current,
      ...(change.step !== undefined && { step: change.step }),
      ...(change.excluded !== undefined && { excluded: change.excluded }),
      ...(change.reportMarkdown !== undefined && { reportMarkdown: change.reportMarkdown }),
      ...(change.decisions && {
        decisions: Object.fromEntries(
          Object.entries({ ...current.decisions, ...change.decisions }).filter((entry): entry is [string, string] => entry[1] !== null),
        ),
      }),
    }));
    pending.current = merge(pending.current, change);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, REVIEW_SAVE_DELAY_MS);
  }, [flush]);

  // Leaving the review (Esc, back, a route change) writes what is waiting.
  useEffect(() => () => flush(), [flush]);

  return { saved, patch, flush };
}
