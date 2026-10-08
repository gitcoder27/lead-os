import { useTaskCountInvalidation } from '@/lib/task-count-invalidation';
import { invalidateTaskSurfaces } from '@/lib/task-query-invalidation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { notifyTaskChange, taskChangeFacts } from '@/lib/task-change-notifications';
import type { AddTaskEventRequest, TaskDetailResponse, TaskEvent, TaskResolution } from '@/types';

interface TaskEventsPage {
  events: TaskEvent[];
  nextCursor: string | null;
}

const EVENTS_PAGE_SIZE = 50;

export function useTaskResolution(key: string | undefined, options?: { role?: 'manager' | 'developer' }) {
  const authScopeKey = useAuthScopeKey();
  const role = options?.role ?? 'manager';

  return useQuery({
    queryKey: ['task-resolution', authScopeKey, role, key],
    queryFn: () =>
      // Developer requests can also return the restricted former-owner
      // projection (P3-D15): { taskKey, title, status, access: 'former-owner' }.
      api.get<TaskResolution>(role === 'developer' ? `/my-day/tasks/${encodeURIComponent(key!)}` : `/tasks/${encodeURIComponent(key!)}`),
    enabled: Boolean(key),
    retry: false,
    staleTime: 30_000,
  });
}

export function useTaskEvents(key: string | undefined, options?: { enabled?: boolean }) {
  const authScopeKey = useAuthScopeKey();

  return useInfiniteQuery<TaskEventsPage>({
    queryKey: ['task-events', authScopeKey, 'manager', key],
    queryFn: ({ pageParam }) =>
      api.get<TaskEventsPage>(
        `/tasks/${encodeURIComponent(key!)}/events?limit=${EVENTS_PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(key) && (options?.enabled ?? true),
  });
}

function myDayTaskEventsQuery(authScopeKey: string, key: string | undefined) {
  return {
    queryKey: ['task-events', authScopeKey, 'my-day', key],
    queryFn: ({ pageParam }: { pageParam: unknown }) =>
      api.get<TaskEventsPage>(
        `/my-day/tasks/${encodeURIComponent(key!)}/events?limit=${EVENTS_PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TaskEventsPage) => last.nextCursor,
  };
}

export function useMyDayTaskEvents(key: string | undefined, options?: { enabled?: boolean }) {
  const authScopeKey = useAuthScopeKey();

  return useInfiniteQuery<TaskEventsPage>({
    ...myDayTaskEventsQuery(authScopeKey, key),
    enabled: Boolean(key) && (options?.enabled ?? true),
  });
}

/** Warm the developer timeline's first page (row hover/focus on My Day). */
export function prefetchMyDayTaskEvents(qc: ReturnType<typeof useQueryClient>, authScopeKey: string, key: string) {
  return qc.prefetchInfiniteQuery({ ...myDayTaskEventsQuery(authScopeKey, key), staleTime: 10_000 });
}

export type AddTaskEventInput = Omit<AddTaskEventRequest, 'requestId'> & { requestId: string };

export function useAddTaskEvent(taskKey: string | undefined) {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: () => ({ scope: counts.submittedScope(), taskKey }),
    mutationFn: async (input: AddTaskEventInput) => {
      const startedAt = new Date().toISOString();
      const task = qc.getQueryData<TaskDetailResponse>(['task-detail', scope, 'manager', taskKey]);
      const event = await api.post<TaskEvent>(`/tasks/${encodeURIComponent(taskKey!)}/events`, input);
      if (counts.isCurrent(scope) && input.via !== 'standup' && task && event) notifyTaskChange({
        id: `task-event:${event.id}`, scope, startedAt, task: taskChangeFacts(task),
        eventType: event.type, private: event.visibility === 'private',
      });
      return event;
    },
    onSuccess: (_data, _variables, context) => { if (counts.isCurrent(context?.scope)) invalidateTaskSurfaces(qc, context.scope, context.taskKey ? [context.taskKey] : []); },
  });
}

export function useUpdateTaskEventVisibility(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: () => ({ scope: counts.submittedScope(), taskKey }),
    mutationFn: (params: { eventId: number; visibility: 'shared' | 'private' }) =>
      api.patch<TaskEvent>(`/tasks/${encodeURIComponent(taskKey!)}/events/${params.eventId}`, { visibility: params.visibility }),
    onSuccess: (_data, _variables, context) => { if (counts.isCurrent(context?.scope)) invalidateTaskSurfaces(qc, context.scope, context.taskKey ? [context.taskKey] : []); },
  });
}

export function useRedactTaskEvent(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: () => ({ scope: counts.submittedScope(), taskKey }),
    mutationFn: (eventId: number) => api.delete(`/tasks/${encodeURIComponent(taskKey!)}/events/${eventId}`),
    onSuccess: (_data, _variables, context) => { if (counts.isCurrent(context?.scope)) invalidateTaskSurfaces(qc, context.scope, context.taskKey ? [context.taskKey] : []); },
  });
}

export type AddMyDayTaskEventInput = {
  date: string;
  type: 'update' | 'blocker';
  body: string;
  blockerAction?: 'raised' | 'cleared';
  requestId: string;
};

export function useAddMyDayTaskEvent(taskKey: string | undefined) {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    onMutate: () => ({ scope: counts.submittedScope(), taskKey }),
    mutationFn: (input: AddMyDayTaskEventInput) =>
      api.post<TaskEvent>(`/my-day/tasks/${encodeURIComponent(taskKey!)}/events`, input),
    onSuccess: (_data, _variables, context) => { if (counts.isCurrent(context?.scope)) invalidateTaskSurfaces(qc, context.scope, context.taskKey ? [context.taskKey] : []); },
  });
}
