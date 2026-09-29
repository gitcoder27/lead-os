import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { AttentionRulesResponse, AttentionRulesUpdateRequest } from '@/types';

/** Every view whose signals the Attention rules drive. */
const AFFECTED_QUERY_KEYS = ['today', 'team-tracker', 'issues', 'issue', 'overview', 'alerts', 'workload', 'manager-actions', 'my-day'];

/** docs/56 P1-05: the workspace Attention rules (`GET/PUT /api/config/attention-rules`), manager-only. */
export function useAttentionRules() {
  const authScopeKey = useAuthScopeKey();
  return useQuery<AttentionRulesResponse>({
    queryKey: ['attention-rules', authScopeKey],
    queryFn: () => api.get<AttentionRulesResponse>('/config/attention-rules'),
  });
}

export function useUpdateAttentionRules() {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  return useMutation({
    mutationFn: (update: AttentionRulesUpdateRequest) =>
      api.put<AttentionRulesResponse>('/config/attention-rules', update),
    onSuccess: (response) => {
      queryClient.setQueryData(['attention-rules', authScopeKey], response);
      // Stale, no-current and follow-up signals are computed server-side from these rules.
      for (const key of AFFECTED_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
