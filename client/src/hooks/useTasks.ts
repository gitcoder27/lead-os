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

function invalidateTaskSurfaces(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['task-inbox'] });
  qc.invalidateQueries({ queryKey: ['task-inbox-event'] });
  qc.invalidateQueries({ queryKey: ['task-events'] });
  qc.invalidateQueries({ queryKey: ['team-tracker'] });
  qc.invalidateQueries({ queryKey: ['my-day'] });
  qc.invalidateQueries({ queryKey: ['manager-desk'] });
  qc.invalidateQueries({ queryKey: ['today'] });
}

export type AddTaskEventInput = Omit<AddTaskEventRequest, 'requestId'> & { requestId: string };

export function useAddTaskEvent(taskKey: string | undefined) {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  return useMutation({
    mutationFn: async (input: AddTaskEventInput) => {
      const startedAt = new Date().toISOString();
      const task = qc.getQueryData<TaskDetailResponse>(['task-detail', scope, 'manager', taskKey]);
      const event = await api.post<TaskEvent>(`/tasks/${encodeURIComponent(taskKey!)}/events`, input);
      if (input.via !== 'standup' && task && event) notifyTaskChange({
        id: `task-event:${event.id}`, scope, startedAt, task: taskChangeFacts(task),
        eventType: event.type, private: event.visibility === 'private',
      });
      return event;
    },
    onSuccess: () => invalidateTaskSurfaces(qc),
  });
}

export function useUpdateTaskEventVisibility(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { eventId: number; visibility: 'shared' | 'private' }) =>
      api.patch<TaskEvent>(`/tasks/${encodeURIComponent(taskKey!)}/events/${params.eventId}`, { visibility: params.visibility }),
    onSuccess: () => invalidateTaskSurfaces(qc),
  });
}

export function useRedactTaskEvent(taskKey: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => api.delete(`/tasks/${encodeURIComponent(taskKey!)}/events/${eventId}`),
    onSuccess: () => invalidateTaskSurfaces(qc),
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
  return useMutation({
    mutationFn: (input: AddMyDayTaskEventInput) =>
      api.post<TaskEvent>(`/my-day/tasks/${encodeURIComponent(taskKey!)}/events`, input),
    onSuccess: () => invalidateTaskSurfaces(qc),
  });
}
