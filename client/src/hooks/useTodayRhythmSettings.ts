import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { TodayRhythmBoundaries, TodayRhythmSettings } from '@/types';

/** docs/56 P2-05: the workspace's Today stage times (`GET/PUT /api/today/settings`). */
export function useTodayRhythmSettings() {
  const authScopeKey = useAuthScopeKey();
  return useQuery<TodayRhythmSettings>({
    queryKey: ['today-rhythm-settings', authScopeKey],
    queryFn: () => api.get<TodayRhythmSettings>('/today/settings'),
  });
}

export function useUpdateTodayRhythmSettings() {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  return useMutation({
    mutationFn: (boundaries: TodayRhythmBoundaries) =>
      api.put<TodayRhythmSettings>('/today/settings', { boundaries }),
    onSuccess: (settings) => {
      queryClient.setQueryData(['today-rhythm-settings', authScopeKey], settings);
      // The stage on Today (and the getting-started tick) follows these times.
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}
