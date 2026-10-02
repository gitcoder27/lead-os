import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  IssueBulkItem,
  IssueBulkResponse,
  IssueStatusExpectation,
  IssueTransitionResponse,
  IssueTransitionsResponse,
} from '@/types';

export function useIssueTransitions(key: string, enabled: boolean) {
  const scope = useAuthScopeKey();
  return useQuery<IssueTransitionsResponse>({
    queryKey: ['issue-transitions', scope, key],
    queryFn: ({ signal }) => api.get(`/issues/${encodeURIComponent(key)}/transitions`, { signal }),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function useJiraExecution() {
  const client = useQueryClient();
  const refresh = () => {
    for (const key of [
      'issues',
      'issue',
      'issue-transitions',
      'overview',
      'workload',
      'today',
      'alerts',
      'weekly-review',
    ])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const transition = useMutation({
    mutationFn: ({
      key,
      transitionId,
      expectedStatus,
    }: {
      key: string;
      transitionId: string;
      expectedStatus: IssueStatusExpectation;
    }) =>
      api.post<IssueTransitionResponse>(`/issues/${encodeURIComponent(key)}/transition`, {
        transitionId,
        expectedStatus,
      }),
    onSettled: refresh,
  });
  const bulk = useMutation({
    mutationFn: (items: IssueBulkItem[]) => api.post<IssueBulkResponse>('/issues/bulk', { items }),
    onSettled: refresh,
  });
  const snooze = useMutation({
    mutationFn: ({ key, until }: { key: string; until: string }) =>
      api.post<{ success: true }>(`/issues/${encodeURIComponent(key)}/snooze`, { until }),
    onSettled: refresh,
  });
  return { transition, bulk, snooze, refresh };
}
