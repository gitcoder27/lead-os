import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { registerSurfaceTaskIds, surfaceTaskToWorkItem } from '@/lib/surface-tasks';
import type {
  TeamTrackerBoardResponse,
  TeamTrackerBoardQuery,
  TrackerIssueAssignment,
  TrackerCarryForwardContextResponse,
  TrackerCarryForwardPreviewResponse,
  StandupFeedResponse,
} from '@/types';

interface TrackerIssueAssignmentsResponse {
  assignments?: TrackerIssueAssignment[];
}

function buildBoardUrl(date: string, query?: TeamTrackerBoardQuery): string {
  const params = new URLSearchParams({ date });
  if (query?.q) params.set('q', query.q);
  if (query?.summaryFilter && query.summaryFilter !== 'all') params.set('summaryFilter', query.summaryFilter);
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.groupBy && query.groupBy !== 'none') params.set('groupBy', query.groupBy);
  if (query?.viewId != null) params.set('viewId', String(query.viewId));
  return `/team-tracker?${params.toString()}`;
}

export function useTeamTracker(date: string, query?: TeamTrackerBoardQuery, enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<TeamTrackerBoardResponse>({
    queryKey: ['team-tracker', date, query ?? {}, authScopeKey],
    queryFn: () => api.get<TeamTrackerBoardResponse>(buildBoardUrl(date, query)),
    refetchInterval: enabled ? 30_000 : false,
    enabled,
    // Phase 2c: canonical transport carries `developers[].tasks`; rebuild the
    // item-shaped presentation arrays so board components stay agnostic.
    select: (data) => {
      if (data.taskModel !== 'canonical') return data;
      return {
        ...data,
        developers: data.developers.map((day) => {
          const items = (day.tasks ?? []).map((task) => surfaceTaskToWorkItem(task, day.developer.accountId));
          registerSurfaceTaskIds('tracker', items);
          return {
            ...day,
            currentItem: items.find((item) => item.state === 'in_progress'),
            plannedItems: items.filter((item) => item.state === 'planned'),
            completedItems: items.filter((item) => item.state === 'done'),
            droppedItems: items.filter((item) => item.state === 'dropped'),
          };
        }),
      };
    },
  });
}

/** Phase 3 (P3-D5/D6, §6.1): rolling-window standup feed for one developer. */
export function useStandupFeed(accountId: string | undefined, enabled = true) {
  const authScopeKey = useAuthScopeKey();
  return useQuery<StandupFeedResponse>({
    queryKey: ['team-tracker', 'standup-feed', accountId, authScopeKey],
    queryFn: () => api.get<StandupFeedResponse>(`/team-tracker/standup/feed?accountId=${encodeURIComponent(accountId!)}`),
    enabled: enabled && Boolean(accountId),
  });
}

export function useCarryForwardPreview(fromDate: string, toDate: string, enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<TrackerCarryForwardPreviewResponse>({
    queryKey: ['team-tracker', 'carry-forward-preview', fromDate, toDate, authScopeKey],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate, toDate });
      return api.get<TrackerCarryForwardPreviewResponse>(
        `/team-tracker/carry-forward-preview?${params.toString()}`
      );
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useCarryForwardContext(toDate: string, enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<TrackerCarryForwardContextResponse>({
    queryKey: ['team-tracker', 'carry-forward-context', toDate, authScopeKey],
    queryFn: () =>
      api.get<TrackerCarryForwardContextResponse>(
        `/team-tracker/carry-forward-context?toDate=${encodeURIComponent(toDate)}`
      ),
    enabled,
    staleTime: 30_000,
  });
}

export function useTrackerIssueAssignments(jiraKey?: string, date?: string) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<TrackerIssueAssignment[]>({
    queryKey: ['team-tracker', 'issue-assignment', date, jiraKey, authScopeKey],
    queryFn: async () => {
      const params = new URLSearchParams({ date: date! });
      const res = await api.get<TrackerIssueAssignmentsResponse>(
        `/team-tracker/issues/${encodeURIComponent(jiraKey!)}/assignment?${params.toString()}`
      );
      return res.assignments ?? [];
    },
    enabled: Boolean(jiraKey && date),
    staleTime: 0,
    refetchOnMount: true,
  });
}
