import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { GlobalSearchResponse } from '@/types';

export const GLOBAL_SEARCH_MIN_LENGTH = 2;

export function useGlobalSearch(query: string, options?: { enabled?: boolean }) {
  const authScopeKey = useAuthScopeKey();
  const trimmed = (options?.enabled ?? true) ? query.trim() : '';
  const valid = trimmed.length >= GLOBAL_SEARCH_MIN_LENGTH;

  const [debounce, setDebounce] = useState({ query: trimmed, settled: false });
  // Returning to an earlier query still starts a fresh typing delay.
  if (debounce.query !== trimmed) setDebounce({ query: trimmed, settled: false });
  const enabled = valid && debounce.query === trimmed && debounce.settled;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounce({ query: trimmed, settled: true }), 150);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  const search = useQuery({
    // Move the observer immediately so TanStack aborts the superseded request,
    // while enabled still waits for typing to settle before fetching this key.
    queryKey: ['global-search', authScopeKey, trimmed],
    queryFn: ({ signal }) =>
      api.get<GlobalSearchResponse>(`/search?q=${encodeURIComponent(trimmed)}`, { signal }),
    enabled,
    staleTime: 30_000,
  });

  return {
    ...search,
    data: enabled ? search.data : undefined,
    isError: enabled && search.isError,
    isSearching: valid && (!enabled || search.isPending || search.isFetching),
  };
}
