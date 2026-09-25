import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { readNavPreferencesCache, writeNavPreferencesCache } from '@/lib/nav-preferences-cache';
import { DEFAULT_NAV_PREFERENCES, sanitizeNavPreferences, type NavPreferences, type NavPreferencesResponse } from '@/types';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';

export function useNavPreferences(): { preferences: NavPreferences } {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const authScopeKey = useAuthScopeKey();
  const tasksPhase3 = useTasksPhase3();

  const query = useQuery<NavPreferences>({
    queryKey: ['nav-preferences', authScopeKey],
    queryFn: async () => (await api.get<NavPreferencesResponse>('/preferences/navigation')).preferences,
    enabled: isManager,
    staleTime: 60_000,
  });

  const cached = useMemo(() => (isManager ? readNavPreferencesCache(authScopeKey, { tasksNav: tasksPhase3 }) : null), [authScopeKey, isManager, tasksPhase3]);

  useEffect(() => {
    if (query.data && isManager) {
      writeNavPreferencesCache(authScopeKey, query.data);
    }
  }, [authScopeKey, isManager, query.data]);

  const preferences =
    (isManager ? query.data ?? cached : null) ??
    sanitizeNavPreferences(DEFAULT_NAV_PREFERENCES.topNav, DEFAULT_NAV_PREFERENCES.moreNav, { tasksNav: tasksPhase3 });
  return { preferences };
}

export function useSaveNavPreferences() {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const queryKey = ['nav-preferences', authScopeKey];

  return useMutation({
    mutationFn: async (preferences: NavPreferences) =>
      (await api.put<NavPreferencesResponse>('/preferences/navigation', preferences)).preferences,
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NavPreferences>(queryKey);
      queryClient.setQueryData(queryKey, preferences);
      writeNavPreferencesCache(authScopeKey, preferences);
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      if (context?.previous) {
        writeNavPreferencesCache(authScopeKey, context.previous);
      }
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(queryKey, preferences);
      writeNavPreferencesCache(authScopeKey, preferences);
    },
  });
}
