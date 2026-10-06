import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { IssueSuggestionsResponse } from '@/types';

export function useIssueSuggestions(search: string, enabled: boolean) {
  const scope = useAuthScopeKey();
  const [term, setTerm] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  return useQuery({
    queryKey: ['issue-suggestions', scope, term],
    queryFn: ({ signal }) => api.get<IssueSuggestionsResponse>(`/issues/suggestions?q=${encodeURIComponent(term)}`, { signal }),
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
