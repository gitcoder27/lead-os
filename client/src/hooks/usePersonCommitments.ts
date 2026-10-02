import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { PersonCommitmentsResponse } from '@/types';

export function usePersonCommitments(accountId: string) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['tasks', scope, 'person', accountId],
    queryFn: () => api.get<PersonCommitmentsResponse>(`/tasks/person/${encodeURIComponent(accountId)}`),
    enabled: Boolean(accountId),
    retry: false,
    staleTime: 10_000,
  });
}
