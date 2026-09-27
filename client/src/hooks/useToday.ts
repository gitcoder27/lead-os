import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getTodayFreshness } from '@/lib/today-freshness';
import { readTodaySnapshot, writeTodaySnapshot } from '@/lib/today-snapshot-cache';
import { getLocalIsoDate, getLocalTimeZone } from '@/lib/utils';
import type { TodayResponse } from '@/types';

export function todayUrl(date: string, timeZone = getLocalTimeZone()): string {
  const params = new URLSearchParams({ date });
  // docs/53 F5: stage and day boundaries compute in the manager's zone.
  if (timeZone) params.set('tz', timeZone);
  return `/today?${params.toString()}`;
}

export function useToday(date = getLocalIsoDate()) {
  const authScopeKey = useAuthScopeKey();
  const storedSnapshot = useMemo(() => readTodaySnapshot(authScopeKey, date), [authScopeKey, date]);

  const query = useQuery<TodayResponse>({
    queryKey: ['today', date, authScopeKey],
    queryFn: ({ signal }) => api.get<TodayResponse>(todayUrl(date), { signal }),
    initialData: storedSnapshot?.data,
    initialDataUpdatedAt: storedSnapshot?.savedAt,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (query.data && query.dataUpdatedAt > 0) {
      writeTodaySnapshot(authScopeKey, date, query.data, query.dataUpdatedAt);
    }
  }, [authScopeKey, date, query.data, query.dataUpdatedAt]);

  // docs/53 U8: count failed polls since the last success (errorUpdateCount
  // is cumulative, so remember where it stood when data last landed).
  const errorCountAtSuccess = useRef(query.errorUpdateCount);
  const lastDataUpdatedAt = useRef(query.dataUpdatedAt);
  if (query.dataUpdatedAt !== lastDataUpdatedAt.current) {
    lastDataUpdatedAt.current = query.dataUpdatedAt;
    errorCountAtSuccess.current = query.errorUpdateCount;
  }
  const freshness = getTodayFreshness({
    dataUpdatedAt: query.dataUpdatedAt,
    errorUpdatedAt: query.errorUpdatedAt,
    failedPolls: query.errorUpdateCount - errorCountAtSuccess.current,
    error: query.error,
  });

  return Object.assign(query, { freshness });
}
