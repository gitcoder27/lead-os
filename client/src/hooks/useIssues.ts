import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { DeveloperIssue, Issue, FilterType } from '@/types';
import { getLocalIsoDate } from '@/lib/utils';

interface IssuesResponse {
  issues: Issue[];
}

interface DeveloperIssuesResponse {
  issues: DeveloperIssue[];
}

export function useIssues(filter?: FilterType, assignee?: string, tagId?: number, noTags?: boolean) {
  return useIssuesWithOptions(filter, assignee, tagId, noTags, true);
}

export function useIssuesWithOptions(
  filter?: FilterType,
  assignee?: string,
  tagId?: number,
  noTags?: boolean,
  enabled = true,
  trackerDate = getLocalIsoDate()
) {
  const authScopeKey = useAuthScopeKey();
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('filter', filter);
  if (assignee) params.set('assignee', assignee);
  if (trackerDate) params.set('trackerDate', trackerDate);
  if (noTags) {
    params.set('noTags', 'true');
  } else if (tagId !== undefined) {
    params.set('tags', String(tagId));
  }
  const qs = params.toString();

  return useQuery<Issue[]>({
    queryKey: ['issues', filter, assignee, tagId, noTags, trackerDate, authScopeKey],
    queryFn: async () => {
      const res = await api.get<IssuesResponse>(`/issues${qs ? `?${qs}` : ''}`);
      return res.issues;
    },
    refetchInterval: enabled ? 30_000 : false,
    enabled,
  });
}

export function useMyDayIssues(enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<DeveloperIssue[]>({
    queryKey: ['my-day-issues', authScopeKey],
    queryFn: async () => {
      const res = await api.get<DeveloperIssuesResponse>('/my-day/issues');
      return res.issues;
    },
    refetchInterval: enabled ? 30_000 : false,
    enabled,
  });
}
