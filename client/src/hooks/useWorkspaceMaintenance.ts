import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  WorkspaceMaintenancePreviewResponse,
  WorkspaceMaintenanceResetResponse,
  WorkspaceMaintenanceResetTarget,
} from '@/types';

export function useWorkspaceMaintenancePreview(enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<WorkspaceMaintenancePreviewResponse>({
    queryKey: ['config', 'maintenance-reset-preview', authScopeKey],
    queryFn: () =>
      api.get<WorkspaceMaintenancePreviewResponse>('/config/maintenance/reset-preview'),
    enabled,
    staleTime: 15_000,
  });
}

export function useWorkspaceMaintenanceReset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      target: WorkspaceMaintenanceResetTarget;
      confirmationText: string;
    }) =>
      api.post<WorkspaceMaintenanceResetResponse>(
        '/config/maintenance/reset',
        params,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['config', 'maintenance-reset-preview'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['today'] }),
        queryClient.invalidateQueries({ queryKey: ['manager-desk'] }),
        queryClient.invalidateQueries({ queryKey: ['team-tracker'] }),
        queryClient.invalidateQueries({ queryKey: ['my-day'] }),
        queryClient.invalidateQueries({ queryKey: ['workload'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
        queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      ]);
    },
  });
}
