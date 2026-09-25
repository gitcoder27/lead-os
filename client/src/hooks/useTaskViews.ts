import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { encodeTaskViewDefinition } from '@/lib/task-views';
import type { ManagerTask, SaveTaskViewRequest, TaskSavedView, TaskViewDefinition, TaskViewsResponse, UpdateTaskViewRequest } from '@/types';

/**
 * Phase 3 (P3-D9/D10): task view hooks. `useTaskViews` lists built-ins plus
 * the manager's private saved views; `useTaskViewTasks` runs a definition
 * through `GET /api/tasks?viewDef=`; the mutations manage saved views.
 */
export function useTaskViews(enabled: boolean) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['task-views', scope],
    queryFn: () => api.get<TaskViewsResponse>('/task-views'),
    enabled,
    staleTime: 30_000,
  });
}

export function useTaskViewTasks(definition: TaskViewDefinition | undefined, enabled: boolean) {
  const scope = useAuthScopeKey();
  const encoded = definition ? encodeTaskViewDefinition(definition) : '';
  return useQuery({
    queryKey: ['tasks', scope, 'view', encoded],
    queryFn: () => api.get<{ tasks: ManagerTask[] }>(`/tasks?viewDef=${encodeURIComponent(encoded)}`),
    enabled: enabled && Boolean(definition),
    staleTime: 10_000,
  });
}

function invalidateViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['task-views'] });
}

export function useSaveTaskView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveTaskViewRequest) =>
      (await api.post<{ view: TaskSavedView }>('/task-views', input)).view,
    onSuccess: () => invalidateViews(qc),
  });
}

export function useUpdateTaskView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; updates: UpdateTaskViewRequest }) =>
      (await api.patch<{ view: TaskSavedView }>(`/task-views/${input.id}`, input.updates)).view,
    onSuccess: () => invalidateViews(qc),
  });
}

export function useDeleteTaskView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/task-views/${id}`),
    onSuccess: () => invalidateViews(qc),
  });
}
