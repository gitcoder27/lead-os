import { useTaskCountInvalidation } from '@/lib/task-count-invalidation';
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { patchCachedTasks, taskWrites, type CacheShape, type CachedTaskRow } from '@/lib/task-writes';
import { getLocalIsoDate } from '@/lib/utils';
import { notifyTaskChange, taskChangeFacts } from '@/lib/task-change-notifications';
import { prefetchMyDayTaskEvents } from './useTasks';
import type { FormerOwnerTaskDetail, ManagerTask, TaskDetailResponse, TaskLink, UpdateTaskRequest } from '@/types';

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
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get<TaskDetailResponse | FormerOwnerTaskDetail>(
        role === 'developer'
          ? `/my-day/tasks/${encodeURIComponent(taskKey!)}/detail`
          : `/tasks/${encodeURIComponent(taskKey!)}/detail`,
        { signal },
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

function invalidateTaskDetailSurfaces(qc: ReturnType<typeof useQueryClient>, scope: string | undefined, taskKey?: string) {
  if (!scope) return;
  for (const key of ['task-detail', 'task-events', 'task-resolution', 'task-inbox-event']) {
    void qc.invalidateQueries({ queryKey: [key, scope], predicate: (query) => {
      if (key === 'task-inbox-event') return query.queryKey[2] === taskKey;
      if (query.queryKey[3] === taskKey) return true;
      if (key !== 'task-detail') return false;
      const detail = query.state.data as TaskDetailResponse | undefined;
      return detail?.parent?.taskKey === taskKey || Boolean(detail?.children?.some((child) => child.taskKey === taskKey));
    } });
  }
  for (const key of ['tasks', 'task-inbox', 'manager-desk', 'team-tracker', 'my-day', 'today', 'workload']) {
    void qc.invalidateQueries({ queryKey: [key], predicate: (query) => query.queryKey.includes(scope) });
  }
}

/** Plain text fields with no server-side side effects — safe to show before the PATCH lands. */
const OPTIMISTIC_FIELDS = ['title', 'details', 'outcome', 'participants'] as const;

/** A cached detail is the task itself; the former-owner projection has no fields to patch. */
const detailShape: CacheShape<TaskDetailResponse | FormerOwnerTaskDetail> = {
  rows: (data) => ('access' in data ? [] : [data as unknown as CachedTaskRow]),
  map: (data, update) => ('access' in data ? data : (update(data as unknown as CachedTaskRow) as unknown as TaskDetailResponse)),
};

/**
 * Update a task. Developer principals are limited to title/details/status server-side.
 *
 * docs/61 TS-01 (D1): the write shares its lifecycle with list writes on the same task
 * (one at a time, in order), and a failure gives back only the text fields it patched,
 * only where they still read as it wrote them.
 */
export function useUpdateTaskDetail(taskKey: string | undefined, source: 'detail' | 'standup' = 'detail') {
  const { user } = useAuth();
  const scope = useAuthScopeKey();
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  const isDeveloper = user?.role === 'developer';
  return useMutation({
    onMutate: counts.submittedScope,
    mutationFn: (updates: UpdateTaskRequest) => {
      const startedAt = new Date().toISOString();
      const coordinator = taskWrites(qc, scope);
      const submitted = coordinator.mark();
      return coordinator.run(taskKey ? [taskKey] : [], async () => {
        const before = (taskKey && coordinator.latest(taskKey, submitted)) || qc.getQueryData<TaskDetailResponse>(['task-detail', scope, isDeveloper ? 'developer' : 'manager', taskKey]);
        const text = Object.fromEntries(OPTIMISTIC_FIELDS.filter((field) => field in updates).map((field) => [field, updates[field]]));
        let rollback = () => {};
        if (taskKey && Object.keys(text).length) {
          const filter = { queryKey: ['task-detail'], predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] === scope && query.queryKey[3] === taskKey };
          await qc.cancelQueries(filter);
          rollback = patchCachedTasks(qc, filter, detailShape, new Map([[taskKey, (row) => ({ ...row, ...text })]]));
        }
        try {
          const saved = isDeveloper
            ? await api.patch<TaskDetailResponse>(`/my-day/tasks/${encodeURIComponent(taskKey!)}`, { date: getLocalIsoDate(), ...updates })
            : await api.patch<TaskDetailResponse>(`/tasks/${encodeURIComponent(taskKey!)}`, updates);
          // Writes queued behind this one act on what the server now holds.
          if (!isDeveloper && saved && 'taskKey' in saved) taskWrites(qc, scope).acknowledge([saved as unknown as ManagerTask]);
          if (!isDeveloper && source !== 'standup' && saved?.taskKey) notifyTaskChange({
            scope, startedAt, task: taskChangeFacts(saved), ...(before && { before: taskChangeFacts(before) }),
            fields: Object.keys(updates).filter((field) => field !== 'expected') as Array<keyof UpdateTaskRequest>,
          });
          return saved;
        } catch (error) {
          rollback();
          throw error;
        }
      });
    },
    onSuccess: (_data, _variables, scope) => counts.recount(scope),
    onSettled: (_data, _error, _variables, submittedScope) => invalidateTaskDetailSurfaces(qc, submittedScope, taskKey),
  });
}

export function useDeleteTaskDetail(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: counts.submittedScope,
    mutationFn: () => api.delete<{ deleted: boolean }>(`/tasks/${encodeURIComponent(taskKey!)}`),
    onSuccess: (_data, _variables, scope) => { counts.recount(scope); invalidateTaskDetailSurfaces(qc, scope, taskKey); },
  });
}

export function useAddTaskDetailLink(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: counts.submittedScope,
    mutationFn: (input: { kind: TaskLink['kind']; ref: string; role?: TaskLink['role'] }) =>
      api.post<TaskLink>(`/tasks/${encodeURIComponent(taskKey!)}/links`, input),
    onSuccess: (_data, _variables, scope) => { counts.recount(scope); invalidateTaskDetailSurfaces(qc, scope, taskKey); },
  });
}

export function useRemoveTaskDetailLink(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: counts.submittedScope,
    mutationFn: (linkId: number) => api.delete<{ deleted: boolean }>(`/tasks/${encodeURIComponent(taskKey!)}/links/${linkId}`),
    onSuccess: (_data, _variables, scope) => { counts.recount(scope); invalidateTaskDetailSurfaces(qc, scope, taskKey); },
  });
}
