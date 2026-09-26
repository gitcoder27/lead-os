import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  OneOnOneAgendaAttachRequest,
  OneOnOneAgendaItem,
  OneOnOneAgendaReorderRequest,
  OneOnOneSeriesCreateRequest,
  OneOnOneSeriesDetail,
  OneOnOneSeriesListResponse,
  OneOnOneSeriesUpdateRequest,
  OneOnOneSessionActionRequest,
  OneOnOneSessionCreateRequest,
  OneOnOneSessionUpdateRequest,
} from '@/types';

/** docs/48: the `one_on_one_enabled` flag, delivered on the manager session. */
export function useOneOnOneEnabled(): boolean {
  return useAuth().features?.oneOnOne ?? false;
}

function useInvalidateOneOnOnes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['one-on-ones'] });
    void queryClient.invalidateQueries({ queryKey: ['team-tracker'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
}

export function useOneOnOneSeriesList(enabled = true) {
  const authScopeKey = useAuthScopeKey();
  const flagOn = useOneOnOneEnabled();
  return useQuery<OneOnOneSeriesListResponse>({
    queryKey: ['one-on-ones', 'list', authScopeKey],
    queryFn: () => api.get<OneOnOneSeriesListResponse>('/one-on-ones'),
    enabled: enabled && flagOn,
  });
}

/** Series detail (upcoming session + agenda + history) — lazily schedules. */
export function useOneOnOneSeries(seriesId: number | undefined) {
  const authScopeKey = useAuthScopeKey();
  const flagOn = useOneOnOneEnabled();
  return useQuery<OneOnOneSeriesDetail>({
    queryKey: ['one-on-ones', 'detail', seriesId, authScopeKey],
    queryFn: () => api.get<OneOnOneSeriesDetail>(`/one-on-ones/${seriesId}`),
    enabled: flagOn && seriesId !== undefined,
  });
}

/** Resolve a developer's series from the list (returns null when none exists). */
export function useOneOnOneSeriesForDeveloper(developerAccountId: string | undefined) {
  const list = useOneOnOneSeriesList(Boolean(developerAccountId));
  const series = developerAccountId
    ? list.data?.series.find((entry) => entry.developerAccountId === developerAccountId) ?? null
    : null;
  return { ...list, series };
}

export function useCreateOneOnOneSeries() {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (body: OneOnOneSeriesCreateRequest) =>
      api.post<OneOnOneSeriesDetail>('/one-on-ones', body),
    onSuccess: invalidate,
  });
}

export function useUpdateOneOnOneSeries(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (body: OneOnOneSeriesUpdateRequest) =>
      api.patch<OneOnOneSeriesDetail>(`/one-on-ones/${seriesId}`, body),
    onSuccess: invalidate,
  });
}

export function useCreateOneOnOneSession(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (body: OneOnOneSessionCreateRequest) =>
      api.post<OneOnOneSeriesDetail>(`/one-on-ones/${seriesId}/sessions`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateOneOnOneSession(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: ({ sessionId, ...body }: OneOnOneSessionUpdateRequest & { sessionId: number }) =>
      api.patch<OneOnOneSeriesDetail>(`/one-on-ones/${seriesId}/sessions/${sessionId}`, body),
    onSuccess: invalidate,
  });
}

export function useAttachOneOnOneAgendaItem(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (body: OneOnOneAgendaAttachRequest) =>
      api.post<{ item: OneOnOneAgendaItem }>(`/one-on-ones/${seriesId}/agenda`, body),
    onSuccess: invalidate,
  });
}

/** Same attach, but the series is chosen per call (TaskDrawer series picker). */
export function useAttachOneOnOneAgendaItemToSeries() {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: ({ seriesId, ...body }: OneOnOneAgendaAttachRequest & { seriesId: number }) =>
      api.post<{ item: OneOnOneAgendaItem }>(`/one-on-ones/${seriesId}/agenda`, body),
    onSuccess: invalidate,
  });
}

export function useReorderOneOnOneAgenda(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (body: OneOnOneAgendaReorderRequest) =>
      api.patch<{ items: OneOnOneAgendaItem[] }>(`/one-on-ones/${seriesId}/agenda`, body),
    onSuccess: invalidate,
  });
}

export function useDetachOneOnOneAgendaItem(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: (itemId: number) =>
      api.delete<{ deleted: boolean }>(`/one-on-ones/${seriesId}/agenda/${itemId}`),
    onSuccess: invalidate,
  });
}

/** Session action item — canonical task + agenda attach in one transaction. */
export function useCreateOneOnOneSessionAction(seriesId: number | undefined) {
  const invalidate = useInvalidateOneOnOnes();
  return useMutation({
    mutationFn: ({ sessionId, ...body }: OneOnOneSessionActionRequest & { sessionId: number }) =>
      api.post<{ item: OneOnOneAgendaItem }>(`/one-on-ones/${seriesId}/sessions/${sessionId}/actions`, body),
    onSuccess: invalidate,
  });
}
