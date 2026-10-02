import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { invalidateTaskSurfaces } from '@/hooks/useTaskListMutations';
import type { TeamSelfLink } from '@/types';

/**
 * The manager's own roster record ("This is me"). One person, two ids: the login that owns private
 * tasks and the roster developer that owns board tasks. The link is read-side only, so changing it
 * re-reads every surface that decides who "me" is (Tasks, Today, the Team board).
 */
export function useSelfLink(enabled = true) {
  const authScopeKey = useAuthScopeKey();
  return useQuery<TeamSelfLink>({
    queryKey: ['team-self', authScopeKey],
    queryFn: () => api.get<TeamSelfLink>('/team/self'),
    enabled,
    staleTime: 60_000,
  });
}

export function useSetSelfLink() {
  const qc = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  return useMutation({
    mutationFn: (developerAccountId: string | null) => api.put<TeamSelfLink>('/team/self', { developerAccountId }),
    onSuccess: (link) => {
      qc.setQueryData(['team-self', authScopeKey], link);
      invalidateTaskSurfaces(qc, authScopeKey);
    },
  });
}
