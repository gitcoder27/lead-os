import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  AppendDailyNotePayload,
  CreateDailyNoteFollowUpPayload,
  DailyNoteFollowUp,
  DailyNoteResponse,
  DailyNoteSource,
  DailyNoteSourcesResponse,
  DailyNotesResponse,
} from '@/types';

const LIST_PAGE_SIZE = 30;
const SOURCE_BATCH_SIZE = 100;

function useIsManager(): boolean {
  const { user } = useAuth();
  return user?.role === 'manager';
}

export function invalidateDailyNotesViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['daily-notes'] });
  qc.invalidateQueries({ queryKey: ['global-search'] });
}

export function useDailyNote(date: string) {
  const authScopeKey = useAuthScopeKey();
  const isManager = useIsManager();

  return useQuery<DailyNoteResponse>({
    queryKey: ['daily-notes', authScopeKey, 'day', date],
    queryFn: () => api.get<DailyNoteResponse>(`/notes/${encodeURIComponent(date)}`),
    enabled: isManager,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
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
      invalidateDailyNotesViews(qc);
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
