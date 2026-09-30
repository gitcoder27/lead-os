import { useCallback, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { useSkipOneOnOneSession } from '@/hooks/useOneOnOne';
import type { WeeklyReviewOneOnOneRow } from '@/types';

/**
 * Step 4: skipping a scheduled 1:1 session. It is a real write that cannot be undone (a skipped
 * session does not go back to scheduled), so it is only offered from the row's menu; the row shows
 * "Skipped" for the rest of the review, and a failure puts it back with a persistent error.
 */
export function useReviewSessions(announce: (message: string) => void) {
  const { addToast } = useToast();
  const skip = useSkipOneOnOneSession();
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());

  const skipSession = useCallback((session: WeeklyReviewOneOnOneRow) => {
    setSkipped((current) => new Set(current).add(session.sessionId));
    announce(`Skipped the 1:1 with ${session.developerName}.`);
    skip.mutate({ seriesId: session.seriesId, sessionId: session.sessionId }, {
      onError: (error: Error) => {
        setSkipped((current) => {
          const next = new Set(current);
          next.delete(session.sessionId);
          return next;
        });
        addToast({ type: 'error', title: "Couldn't skip that 1:1", message: error.message });
      },
    });
  }, [addToast, announce, skip]);

  return { skippedSessions: skipped, skipSession };
}
