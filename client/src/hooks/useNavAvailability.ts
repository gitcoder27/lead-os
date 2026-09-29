import { useQuery } from '@tanstack/react-query';
import { useAuth, useAuthScopeKey } from '@/context/AuthContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { api } from '@/lib/api';
import type { NavAvailability } from '@/lib/nav-pages';
import type { Developer } from '@/types';

/**
 * docs/56 P2-04: whether Team and Work have anything to show. Unknown reads as
 * available, so a page never flickers away while the answer is loading or when
 * a request fails; only a loaded, empty roster or a Jira connection known to be
 * missing holds a page back.
 */
export function useNavAvailability(): NavAvailability {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const scope = useAuthScopeKey();
  // Its own key under ['developers'], so a roster edit (which invalidates that prefix) refreshes the nav,
  // but a page change does not refetch the roster the way `useDevelopers` does.
  const roster = useQuery<number>({
    queryKey: ['developers', 'nav-availability', scope],
    queryFn: async () => (await api.get<{ developers: Developer[] }>('/team/developers')).developers.length,
    enabled: isManager,
    staleTime: 60_000,
  });
  const sync = useSyncStatus({ enabled: isManager });
  return {
    team: !(roster.isSuccess && roster.data === 0),
    work: sync.data?.jiraConfigured !== false,
  };
}
