import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  AppendDailyNotePayload,
  CreateDailyNoteFollowUpPayload,
  DailyNote,
  DailyNoteDayContext,
  DailyNoteFollowUp,
  DailyNoteResponse,
  DailyNoteSource,
  DailyNoteSourcesResponse,
  DailyNotesResponse,
  TaskEvent,
  TaskResolution,
} from '@/types';

const LIST_PAGE_SIZE = 30;
const SOURCE_BATCH_SIZE = 100;
const DAY_REFETCH_INTERVAL_MS = 60_000;
const CONTEXT_STALE_TIME_MS = 30_000;

function useIsManager(): boolean {
  const { user } = useAuth();
  return user?.role === 'manager';
}

/** Full invalidation — for explicit user writes that came from outside the editor. */
export function invalidateDailyNotesViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['daily-notes'] });
  qc.invalidateQueries({ queryKey: ['global-search'] });
}

/**
 * Sidebar list, search, day-context, and source rows — everything under
 * ['daily-notes'] except open day documents. Used on auto-save commit
 * boundaries (blur / date switch) so a routine PUT doesn't refetch the day
 * document the editor is currently editing (docs/52 P1).
 */
export function invalidateDailyNoteListViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'daily-notes' && query.queryKey[2] !== 'day',
  });
  qc.invalidateQueries({ queryKey: ['global-search'] });
}

/** Patch (or remove, when `note` is null) a saved note inside every cached list page. */
export function patchDailyNoteInLists(
  qc: ReturnType<typeof useQueryClient>,
  scope: string,
  date: string,
  note: DailyNote | null,
) {
  const matches = qc.getQueriesData<InfiniteData<DailyNotesResponse>>({
    queryKey: ['daily-notes', scope, 'list'],
  });
  for (const [queryKey, data] of matches) {
    if (!data) {
      continue;
    }
    qc.setQueryData<InfiniteData<DailyNotesResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        notes: page.notes.flatMap((row) =>
          row.date === date
            ? note
              ? [{ ...row, title: note.title, excerpt: note.excerpt, updatedAt: note.updatedAt }]
              : []
            : [row],
        ),
      })),
    });
  }
}

export function useDailyNote(date: string, options?: { pollPaused?: boolean }) {
  const authScopeKey = useAuthScopeKey();
  const isManager = useIsManager();

  return useQuery<DailyNoteResponse>({
    queryKey: ['daily-notes', authScopeKey, 'day', date],
    queryFn: () => api.get<DailyNoteResponse>(`/notes/${encodeURIComponent(date)}`),
    enabled: isManager,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: options?.pollPaused ? false : DAY_REFETCH_INTERVAL_MS,
  });
}

/** Day-context strip for the notes header (docs/52 §5); cheap + cache-friendly. */
export function useDailyNoteContext(date: string) {
  const authScopeKey = useAuthScopeKey();
  const isManager = useIsManager();

  return useQuery<DailyNoteDayContext>({
    queryKey: ['daily-notes', authScopeKey, 'context', date],
    queryFn: () => api.get<DailyNoteDayContext>(`/notes/${encodeURIComponent(date)}/context`),
    enabled: isManager,
    staleTime: CONTEXT_STALE_TIME_MS,
  });
}

export function useDailyNotes(query: string) {
  const authScopeKey = useAuthScopeKey();
  const isManager = useIsManager();
  const trimmed = query.trim();

  const [debouncedQuery, setDebouncedQuery] = useState(trimmed);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), 200);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  return useInfiniteQuery<DailyNotesResponse>({
    queryKey: ['daily-notes', authScopeKey, 'list', debouncedQuery],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
      if (debouncedQuery) {
        params.set('q', debouncedQuery);
      }
      if (typeof pageParam === 'string' && pageParam) {
        params.set('before', pageParam);
      }
      return api.get<DailyNotesResponse>(`/notes?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isManager,
  });
}

function useMutationScopeGuard(): (scopeAtSend: string) => boolean {
  const authScopeKey = useAuthScopeKey();
  const activeRef = useRef(true);
  const scopeRef = useRef(authScopeKey);
  scopeRef.current = authScopeKey;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  return (scopeAtSend: string) => activeRef.current && scopeRef.current === scopeAtSend;
}

export function useAppendDailyNote() {
  const qc = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const scopeAtSendRef = useRef(authScopeKey);
  const stillCurrent = useMutationScopeGuard();

  return useMutation({
    mutationFn: (variables: AppendDailyNotePayload & { date: string }) => {
      scopeAtSendRef.current = authScopeKey;
      return api.post<DailyNoteResponse>(`/notes/${encodeURIComponent(variables.date)}/append`, {
        text: variables.text,
        requestId: variables.requestId,
      });
    },
    onSuccess: (data, variables) => {
      if (!stillCurrent(scopeAtSendRef.current)) {
        return;
      }
      qc.setQueryData(['daily-notes', authScopeKey, 'day', variables.date], data);
      invalidateDailyNoteListViews(qc);
    },
  });
}

export function useCreateDailyNoteFollowUp(noteDate: string) {
  const qc = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const scopeAtSendRef = useRef(authScopeKey);
  const stillCurrent = useMutationScopeGuard();

  return useMutation({
    mutationFn: (payload: CreateDailyNoteFollowUpPayload) => {
      scopeAtSendRef.current = authScopeKey;
      return api.post<DailyNoteFollowUp>(`/notes/${encodeURIComponent(noteDate)}/follow-ups`, payload);
    },
    onSuccess: () => {
      if (!stillCurrent(scopeAtSendRef.current)) {
        return;
      }
      invalidateDailyNotesViews(qc);
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export function useAddDailyNoteTaskUpdate(noteDate: string) {
  const qc = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const scopeAtSendRef = useRef(authScopeKey);
  const stillCurrent = useMutationScopeGuard();

  return useMutation({
    mutationFn: (payload: {
      taskKey: string;
      text: string;
      type?: 'update' | 'instruction' | 'decision';
      visibility?: 'shared' | 'private';
      requestId: string;
    }) => {
      scopeAtSendRef.current = authScopeKey;
      return api.post<TaskEvent>(`/notes/${encodeURIComponent(noteDate)}/task-updates`, payload);
    },
    onSuccess: () => {
      if (!stillCurrent(scopeAtSendRef.current)) {
        return;
      }
      invalidateDailyNotesViews(qc);
      qc.invalidateQueries({ queryKey: ['task-events'] });
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export function useCreateDailyNoteTask(noteDate: string) {
  const qc = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const scopeAtSendRef = useRef(authScopeKey);
  const stillCurrent = useMutationScopeGuard();

  return useMutation({
    mutationFn: (payload: {
      title: string;
      developerAccountId?: string;
      jiraKey?: string;
      context?: string;
      requestId: string;
    }) => {
      scopeAtSendRef.current = authScopeKey;
      return api.post<TaskResolution>(`/notes/${encodeURIComponent(noteDate)}/tasks`, payload);
    },
    onSuccess: () => {
      if (!stillCurrent(scopeAtSendRef.current)) {
        return;
      }
      invalidateDailyNotesViews(qc);
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['my-day'] });
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['task-events'] });
    },
  });
}

export function useDailyNoteSources(itemIds: number[]) {
  const authScopeKey = useAuthScopeKey();
  const isManager = useIsManager();
  const ids = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);

  return useQuery<DailyNoteSource[]>({
    queryKey: ['daily-notes', authScopeKey, 'sources', ids],
    queryFn: async () => {
      const batches: number[][] = [];
      for (let index = 0; index < ids.length; index += SOURCE_BATCH_SIZE) {
        batches.push(ids.slice(index, index + SOURCE_BATCH_SIZE));
      }
      const responses = await Promise.all(
        batches.map((batch) =>
          api.get<DailyNoteSourcesResponse>(`/notes/sources?itemIds=${batch.join(',')}`),
        ),
      );
      return responses.flatMap((response) => response.sources);
    },
    enabled: isManager && ids.length > 0,
    staleTime: 30_000,
  });
}
