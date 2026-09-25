import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getLocalIsoDate } from '@/lib/utils';
import type { CreateTaskRequest, FormerOwnerTaskDetail, ManagerTask, TaskDetailResponse, TaskLink, UpdateTaskRequest } from '@/types';

/**
 * Phase 3 (P3-D2): shared task detail. Managers hit `/api/tasks/:key/detail`;
 * developer principals use the `/api/my-day` equivalent, which returns the
 * developer DTO with children scoped to tasks they own. A developer who
 * previously authored events on a task they no longer own gets the restricted
 * `FormerOwnerTaskDetail` projection (P3-D15).
 */
export function useTaskDetail(taskKey: string | undefined) {
  const { user } = useAuth();
  const scope = useAuthScopeKey();
  const role = user?.role === 'developer' ? 'developer' : 'manager';
  return useQuery({
    queryKey: ['task-detail', scope, role, taskKey],
    queryFn: () =>
      api.get<TaskDetailResponse | FormerOwnerTaskDetail>(
        role === 'developer'
          ? `/my-day/tasks/${encodeURIComponent(taskKey!)}/detail`
          : `/tasks/${encodeURIComponent(taskKey!)}/detail`,
      ),
    enabled: Boolean(taskKey) && Boolean(user),
    retry: false,
    staleTime: 5_000,
  });
}

function invalidateTaskDetailSurfaces(qc: ReturnType<typeof useQueryClient>, taskKey?: string) {
  for (const key of ['task-detail', 'tasks', 'task-events', 'task-resolution', 'manager-desk', 'team-tracker', 'my-day', 'today', 'workload']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  if (taskKey) qc.invalidateQueries({ queryKey: ['task-detail'], exact: false });
}

/** Update a task. Developer principals are limited to title/status server-side. */
export function useUpdateTaskDetail(taskKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isDeveloper = user?.role === 'developer';
  return useMutation({
    mutationFn: (updates: UpdateTaskRequest) =>
      isDeveloper
        ? api.patch<TaskDetailResponse>(`/my-day/tasks/${encodeURIComponent(taskKey!)}`, { date: getLocalIsoDate(), ...updates })
        : api.patch<TaskDetailResponse>(`/tasks/${encodeURIComponent(taskKey!)}`, updates),
    onSuccess: () => invalidateTaskDetailSurfaces(qc, taskKey),
  });
}

export function useDeleteTaskDetail(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(`/tasks/${encodeURIComponent(taskKey!)}`),
    onSuccess: () => invalidateTaskDetailSurfaces(qc, taskKey),
  });
}

export function useAddTaskDetailLink(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: TaskLink['kind']; ref: string; role?: TaskLink['role'] }) =>
      api.post<TaskLink>(`/tasks/${encodeURIComponent(taskKey!)}/links`, input),
    onSuccess: () => invalidateTaskDetailSurfaces(qc, taskKey),
  });
}

export function useRemoveTaskDetailLink(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) => api.delete<{ deleted: boolean }>(`/tasks/${encodeURIComponent(taskKey!)}/links/${linkId}`),
    onSuccess: () => invalidateTaskDetailSurfaces(qc, taskKey),
  });
}

/** Create a task (optionally a child action item via `parentId`). */
export function useCreateChildTask(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskRequest) => api.post<ManagerTask>('/tasks', input),
    onSuccess: () => invalidateTaskDetailSurfaces(qc, taskKey),
  });
}
