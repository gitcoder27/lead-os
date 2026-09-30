import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { BackupListResponse, BackupRunResponse } from '@/types';

/** docs/56 P6-01: snapshot list and schedule status (manager-only `/api/backups`). */
export function useBackups(enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<BackupListResponse>({
    queryKey: ['backups', authScopeKey],
    queryFn: () => api.get<BackupListResponse>('/backups'),
    enabled,
    staleTime: 15_000,
  });
}

export function useRunBackup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<BackupRunResponse>('/backups/run', { reason: 'manual' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });
}

/** A same-origin, cookie-authenticated GET, so a plain link downloads it. */
export function backupDownloadUrl(name: string): string {
  return `/api/backups/${encodeURIComponent(name)}/download`;
}
