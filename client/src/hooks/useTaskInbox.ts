import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { authEpoch } from '@/lib/auth-epoch';
import { api } from '@/lib/api';
import type { TaskEvent, TaskInboxReadRequest, TaskInboxResponse } from '@/types';

/** Badge and latest page share one bounded request, regardless of history depth. */
export function useTaskInboxLatest(unreadOnly = true) {
  const scope = useAuthScopeKey();
  const { user, features } = useAuth();
  const enabled = Boolean(user && features?.tasksPhase3 && features.teamMode === 'collab' && (user.role === 'manager' || user.role === 'developer'));
  const query = useQuery({
    queryKey: ['task-inbox', scope, 'latest', unreadOnly],
    queryFn: ({ signal }) => api.get<TaskInboxResponse>(`/task-inbox?unread=${unreadOnly}&limit=20`, { signal }),
    enabled, retry: false, staleTime: 10_000, refetchInterval: 30_000,
  });
  return { ...query, enabled: enabled && query.data?.enabled !== false };
}

/** History starts only on Load older, is never polled, and lives only while open. */
export function useTaskInbox(unreadOnly = true) {
  const scope = useAuthScopeKey();
  const latest = useTaskInboxLatest(unreadOnly);
  const [anchor, setAnchor] = useState<{ scope: string; unreadOnly: boolean; cursor: string } | null>(null);
  const cursor = anchor?.scope === scope && anchor.unreadOnly === unreadOnly ? anchor.cursor : null;
  const history = useInfiniteQuery({
    queryKey: ['task-inbox', scope, 'history', unreadOnly, cursor],
    queryFn: ({ pageParam, signal }) => api.get<TaskInboxResponse>(`/task-inbox?${new URLSearchParams({ unread: String(unreadOnly), limit: '20', cursor: pageParam ?? '' })}`, { signal }),
    initialPageParam: cursor,
    getNextPageParam: (last) => last.nextCursor,
    enabled: latest.enabled && Boolean(cursor),
    maxPages: 5,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const older = cursor ? history.data?.pages ?? [] : [];
  return {
    enabled: latest.enabled,
    data: latest.data ? { pages: [latest.data, ...older] } : undefined,
    isLoading: latest.isLoading,
    isError: latest.isError || (Boolean(cursor) && history.isError),
    isFetchingNextPage: Boolean(cursor) && history.isFetching,
    hasNextPage: cursor ? history.hasNextPage : Boolean(latest.data?.nextCursor),
    fetchNextPage: () => {
      if (cursor) return history.fetchNextPage();
      if (latest.data?.nextCursor) setAnchor({ scope, unreadOnly, cursor: latest.data.nextCursor });
      return Promise.resolve();
    },
    refetch: () => { setAnchor(null); return latest.refetch(); },
  };
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
