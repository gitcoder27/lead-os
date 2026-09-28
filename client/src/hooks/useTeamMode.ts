import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { DEFAULT_TEAM_MODE, type TeamMode, type TeamModeResponse, type TeamModeUpdateRequest } from '@/types';

/**
 * docs/56 P1-01: the workspace `team_mode`, delivered on the auth session
 * payload. `solo` (the default) means developers do not log in; participation
 * signals apply only when `teamMode === 'collab' && developer.participates`.
 */
export function useTeamMode(): TeamMode {
  return useAuth().features?.teamMode ?? DEFAULT_TEAM_MODE;
}

/** Manager-only: persists `team_mode`, then refreshes the session so every
 *  `useTeamMode()` consumer sees the new value. */
export function useSetTeamMode() {
  const queryClient = useQueryClient();
  const { refreshSession } = useAuth();

  return useMutation({
    mutationFn: (teamMode: TeamMode) =>
      api.put<TeamModeResponse>('/config/team-mode', { teamMode } satisfies TeamModeUpdateRequest),
    onSuccess: async () => {
      await refreshSession();
      void queryClient.invalidateQueries({ queryKey: ['team-tracker'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}
