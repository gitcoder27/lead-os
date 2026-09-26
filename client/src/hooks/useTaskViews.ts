import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { encodeTaskViewDefinition } from '@/lib/task-views';
import type {
  SaveTaskViewRequest,
  TaskSavedView,
  TaskViewCountsResponse,
  TaskViewDefinition,
  TaskViewsResponse,
  TaskViewTasksResponse,
  UpdateTaskViewRequest,
} from '@/types';

/**
 * Phase 3 (P3-D9/D10): task view hooks. `useTaskViews` lists built-ins plus
 * the manager's private saved views; `useTaskViewTasks` runs a definition
 * through `GET /api/tasks?viewDef=`; the mutations manage saved views.
 * docs/49 D3: `today` (client-local) resolves relative horizons server-side
 * and re-keys every query when the date rolls over.
 */
export function useTaskViews(enabled: boolean, today?: string) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['task-views', scope, today ?? null],
    queryFn: () => api.get<TaskViewsResponse>(`/task-views${today ? `?today=${today}` : ''}`),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTaskViewTasks(definition: TaskViewDefinition | undefined, enabled: boolean, today?: string) {
  const scope = useAuthScopeKey();
  const encoded = definition ? encodeTaskViewDefinition(definition) : '';
  return useQuery({
    queryKey: ['tasks', scope, 'view', encoded, today ?? null],
    queryFn: () =>
      api.get<TaskViewTasksResponse>(`/tasks?viewDef=${encodeURIComponent(encoded)}${today ? `&today=${today}` : ''}`),
    enabled: enabled && Boolean(definition),
    staleTime: 10_000,
    // docs/49 R5: keep the previous list on screen while a new view loads.
    placeholderData: keepPreviousData,
  });
}

/** docs/49 §10: rail counts for every built-in and saved view in one call. */
export function useTaskViewCounts(enabled: boolean, today: string) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['task-view-counts', scope, today],
    queryFn: () => api.get<TaskViewCountsResponse>(`/tasks/view-counts?today=${today}`),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

function invalidateViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['task-views'] });
  qc.invalidateQueries({ queryKey: ['task-view-counts'] });
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
