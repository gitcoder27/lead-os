import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getLocalIsoDate } from '@/lib/utils';
import { prefetchMyDayTaskEvents } from './useTasks';
import type { CreateTaskRequest, FormerOwnerTaskDetail, ManagerTask, TaskDetailResponse, TaskLink, UpdateTaskRequest } from '@/types';

/**
 * Phase 3 (P3-D2): shared task detail. Managers hit `/api/tasks/:key/detail`;
 * developer principals use the `/api/my-day` equivalent, which returns the
 * developer DTO with children scoped to tasks they own. A developer who
 * previously authored events on a task they no longer own gets the restricted
 * `FormerOwnerTaskDetail` projection (P3-D15).
 */
type DetailRole = 'manager' | 'developer';

function taskDetailQuery(scope: string, role: DetailRole, taskKey: string | undefined) {
  return {
    queryKey: ['task-detail', scope, role, taskKey],
    queryFn: () =>
      api.get<TaskDetailResponse | FormerOwnerTaskDetail>(
        role === 'developer'
          ? `/my-day/tasks/${encodeURIComponent(taskKey!)}/detail`
          : `/tasks/${encodeURIComponent(taskKey!)}/detail`,
      ),
    retry: false,
    staleTime: 5_000,
  };
}

export function useTaskDetail(taskKey: string | undefined) {
  const { user } = useAuth();
  const scope = useAuthScopeKey();
  const role: DetailRole = user?.role === 'developer' ? 'developer' : 'manager';
  return useQuery({
    ...taskDetailQuery(scope, role, taskKey),
    enabled: Boolean(taskKey) && Boolean(user),
  });
}

/**
 * Warm a task's detail (and, for developers, its first timeline page) before
 * the drawer opens — wired to row hover/focus so opening feels instant.
 */
export function usePrefetchTaskDetail() {
  const { user } = useAuth();
  const scope = useAuthScopeKey();
  const qc = useQueryClient();
  const role: DetailRole = user?.role === 'developer' ? 'developer' : 'manager';
  return useCallback(
    (taskKey: string | null | undefined) => {
      if (!taskKey || !user) return;
      void qc.prefetchQuery(taskDetailQuery(scope, role, taskKey));
      if (role === 'developer') void prefetchMyDayTaskEvents(qc, scope, taskKey);
    },
    [qc, scope, role, user],
  );
}

function invalidateTaskDetailSurfaces(qc: ReturnType<typeof useQueryClient>, taskKey?: string) {
  for (const key of ['task-detail', 'tasks', 'task-events', 'task-resolution', 'manager-desk', 'team-tracker', 'my-day', 'today', 'workload']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  if (taskKey) qc.invalidateQueries({ queryKey: ['task-detail'], exact: false });
}

/** Plain text fields with no server-side side effects — safe to show before the PATCH lands. */
const OPTIMISTIC_FIELDS = ['title', 'details', 'outcome', 'participants'] as const;

/** Update a task. Developer principals are limited to title/details/status server-side. */
export function useUpdateTaskDetail(taskKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isDeveloper = user?.role === 'developer';
  const matchesTask = { queryKey: ['task-detail'], predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[3] === taskKey };
  return useMutation({
    mutationFn: (updates: UpdateTaskRequest) =>
      isDeveloper
        ? api.patch<TaskDetailResponse>(`/my-day/tasks/${encodeURIComponent(taskKey!)}`, { date: getLocalIsoDate(), ...updates })
        : api.patch<TaskDetailResponse>(`/tasks/${encodeURIComponent(taskKey!)}`, updates),
    onMutate: async (updates) => {
      const text = Object.fromEntries(OPTIMISTIC_FIELDS.filter((field) => field in updates).map((field) => [field, updates[field]]));
      if (!Object.keys(text).length) return undefined;
      await qc.cancelQueries(matchesTask);
      const previous = qc.getQueriesData<TaskDetailResponse | FormerOwnerTaskDetail>(matchesTask);
      qc.setQueriesData<TaskDetailResponse | FormerOwnerTaskDetail>(matchesTask, (task) =>
        task && !('access' in task) ? { ...task, ...text } : task,
      );
      return { previous };
    },
    onError: (_error, _updates, context) => {
      for (const [queryKey, task] of context?.previous ?? []) qc.setQueryData(queryKey, task);
    },
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
