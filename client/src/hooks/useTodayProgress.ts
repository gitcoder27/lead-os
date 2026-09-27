import { useEffect, useMemo, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { nextTodayProgress, readTodayProgress, writeTodayProgress } from '@/lib/today-progress';
import type { TodayActionItem } from '@/types';

/** docs/53 U2: how many queue rows were cleared this session, for the given day. */
export function useTodayProgress(date: string, items: TodayActionItem[] | undefined): number {
  const scope = useAuthScopeKey();
  const [state, setState] = useState(() => readTodayProgress(scope, date));
  const ids = useMemo(
    () => (items ? items.filter((item) => item.type !== 'calm').map((item) => item.id) : undefined),
    [items],
  );
  const idsKey = ids?.join('|');

  useEffect(() => {
    setState(readTodayProgress(scope, date));
  }, [scope, date]);

  useEffect(() => {
    if (!ids) return;
    setState((current) => {
      const next = nextTodayProgress(current, ids);
      writeTodayProgress(scope, date, next);
      return next;
    });
    // idsKey captures the id list's identity.
  }, [idsKey, scope, date]);

  return state.cleared.length;
}
