import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { TaskResolution } from '@/types';

export function useTaskResolution(key: string | undefined, options?: { role?: 'manager' | 'developer' }) {
  const authScopeKey = useAuthScopeKey();
  const role = options?.role ?? 'manager';

  return useQuery({
    queryKey: ['task-resolution', authScopeKey, role, key],
    queryFn: () =>
      api.get<TaskResolution>(role === 'developer' ? `/my-day/tasks/${encodeURIComponent(key!)}` : `/tasks/${encodeURIComponent(key!)}`),
    enabled: Boolean(key),
    retry: false,
    staleTime: 30_000,
  });
}
