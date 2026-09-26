import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { Developer } from '@/types';

interface DevelopersResponse {
  developers: Developer[];
}

interface UseDevelopersOptions {
  includeUnavailable?: boolean;
  /** Set false to skip the request (e.g. developer principals hit a 403). */
  enabled?: boolean;
}

function isLegacyPlaceholder(dev: Developer): boolean {
  const accountId = dev.accountId.trim().toLowerCase();
  const name = dev.displayName.trim().toLowerCase();
  return accountId === 'dev-1' || accountId === 'lead-1' || name === 'dev' || name === 'lead';
}

export function useDevelopers(date?: string, options: UseDevelopersOptions = {}) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<Developer[]>({
    queryKey: ['developers', date, authScopeKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (date) {
        params.set('date', date);
      }
      const res = await api.get<DevelopersResponse>(`/team/developers${params.toString() ? `?${params.toString()}` : ''}`);
      return res.developers;
    },
    select: (developers) => developers
      .filter((dev) => !isLegacyPlaceholder(dev))
      .filter((dev) => options.includeUnavailable || dev.availability?.state !== 'inactive'),
    enabled: options.enabled !== false,
    staleTime: 0,
    refetchOnMount: true,
  });
}
