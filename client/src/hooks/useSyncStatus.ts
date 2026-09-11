import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { SyncStatus } from '@/types';

interface UseSyncStatusOptions {
  enabled?: boolean;
}

export function useSyncStatus(options?: UseSyncStatusOptions) {
  const enabled = options?.enabled ?? true;
  const authScopeKey = useAuthScopeKey();

  return useQuery<SyncStatus>({
    queryKey: ['syncStatus', authScopeKey],
    queryFn: () => api.get('/sync/status'),
    refetchInterval: enabled ? 10_000 : false,
    refetchIntervalInBackground: true,
    enabled,
  });
}
