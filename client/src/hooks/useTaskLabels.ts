import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { TaskLabel, TaskLabelColor, TaskLabelListResponse } from '@/types';
import { useTasksPhase3 } from './useTasksPhase3';

/** Phase 3 (P3-D13): the workspace label registry. */
export function useTaskLabels() {
  const scope = useAuthScopeKey();
  const phase3 = useTasksPhase3();
  return useQuery({
    queryKey: ['task-labels', scope],
    queryFn: () => api.get<TaskLabelListResponse>('/task-labels'),
    enabled: phase3,
    staleTime: 30_000,
  });
}

function useInvalidateLabels() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['task-labels'] });
    // Renames/deletes rewrite tasks.labels_json — refresh task surfaces too.
    for (const key of ['task-detail', 'tasks', 'manager-desk', 'team-tracker', 'my-day', 'today', 'task-events']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useCreateTaskLabel() {
  const invalidate = useInvalidateLabels();
  return useMutation({
    mutationFn: (input: { name: string; color?: TaskLabelColor }) => api.post<TaskLabel>('/task-labels', input),
    onSuccess: invalidate,
  });
}

export function useUpdateTaskLabel() {
  const invalidate = useInvalidateLabels();
  return useMutation({
    mutationFn: (params: { name: string; rename?: string; color?: TaskLabelColor }) =>
      api.patch<TaskLabel>(`/task-labels/${encodeURIComponent(params.name)}`, {
        ...(params.rename !== undefined ? { name: params.rename } : {}),
        ...(params.color !== undefined ? { color: params.color } : {}),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTaskLabel() {
  const invalidate = useInvalidateLabels();
  return useMutation({
    mutationFn: (name: string) => api.delete<{ deleted: boolean }>(`/task-labels/${encodeURIComponent(name)}`),
    onSuccess: invalidate,
  });
}
