import { useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { authEpoch } from '@/lib/auth-epoch';
import { api } from '@/lib/api';
import type { TaskEvent, TaskInboxReadRequest, TaskInboxResponse } from '@/types';

export function useTaskInbox(unreadOnly = true) {
  const scope = useAuthScopeKey();
  const { user, features } = useAuth();
  const enabled = Boolean(
    user &&
    features?.tasksPhase3 &&
    features.teamMode === 'collab' &&
    (user.role === 'manager' || user.role === 'developer'),
  );
  const query = useInfiniteQuery({
    queryKey: ['task-inbox', scope, unreadOnly],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ unread: String(unreadOnly), limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<TaskInboxResponse>(`/task-inbox?${params}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    retry: false,
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  return { ...query, enabled: enabled && query.data?.pages[0]?.enabled !== false };
}

export function useMarkTaskInboxRead() {
  const scope = useAuthScopeKey();
  const qc = useQueryClient();
  const current = useRef(scope);
  current.current = scope;
  const { addToast } = useToast();
  type Lease = { scope: string; epoch: number };
  const mutation: UseMutationResult<{ success: true }, Error, TaskInboxReadRequest, Lease> = useMutation({
    mutationFn: (input: TaskInboxReadRequest) => api.post<{ success: true }>('/task-inbox/read', input),
    onMutate: () => ({ scope, epoch: authEpoch(qc) }),
    // Read state changes only after the server acknowledges the write.
    onSuccess: (_data, _input, lease) => qc.invalidateQueries({ queryKey: ['task-inbox', lease?.scope] }),
    // Hook-level callbacks survive closing the popover and opening a task.
    onError: (error, input, lease) => {
      const valid = () => lease?.scope === current.current && lease.epoch === authEpoch(qc);
      if (!valid()) return;
      addToast({
        type: 'error',
        title: 'Could not update read state',
        message: error.message,
        action: {
          label: 'Retry',
          onClick: () => {
            if (valid()) mutation.mutate(input);
          },
        },
      });
    },
  });
  return mutation;
}

export function useInboxTargetEvent(taskKey: string, eventId: number | undefined) {
  const scope = useAuthScopeKey();
  const { user, features } = useAuth();
  const enabled = Boolean(
    user &&
    features?.tasksPhase3 &&
    features.teamMode === 'collab' &&
    eventId &&
    (user.role === 'manager' || user.role === 'developer'),
  );
  const query = useQuery({
    queryKey: ['task-inbox-event', scope, taskKey, eventId],
    queryFn: ({ signal }) =>
      api.get<{ event: TaskEvent }>(`/task-inbox/events/${eventId}?taskKey=${encodeURIComponent(taskKey)}`, { signal }),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  return { ...query, enabled };
}
