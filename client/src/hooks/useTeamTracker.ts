import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { registerSurfaceTaskIds, surfaceTaskToWorkItem } from '@/lib/surface-tasks';
import type {
  TeamTrackerBoardResponse,
  TeamTrackerBoardQuery,
  TrackerIssueAssignment,
  StandupFeedResponse,
  LatestStandupSessionResponse,
} from '@/types';

interface TrackerIssueAssignmentsResponse {
  assignments?: TrackerIssueAssignment[];
}

function buildBoardUrl(date: string, query?: TeamTrackerBoardQuery): string {
  const params = new URLSearchParams({ date, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
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

/** A feed younger than this is served from cache without a request (switching back and forth is free). */
const STANDUP_FEED_STALE_MS = 30_000;

function standupFeedOptions(accountId: string, authScopeKey: string) {
  return {
    queryKey: ['team-tracker', 'standup-feed', accountId, authScopeKey],
    queryFn: () => api.get<StandupFeedResponse>(`/team-tracker/standup/feed?${new URLSearchParams({ accountId, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`),
    staleTime: STANDUP_FEED_STALE_MS,
  };
}

/** Phase 3 (P3-D5/D6, §6.1): rolling-window standup feed for one developer. */
export function useStandupFeed(accountId: string | undefined, enabled = true) {
  const authScopeKey = useAuthScopeKey();
  return useQuery<StandupFeedResponse>({
    ...standupFeedOptions(accountId ?? '', authScopeKey),
    refetchInterval: enabled ? 30_000 : false,
    enabled: enabled && Boolean(accountId),
  });
}

/** A preloaded feed is not fetched again for this long, however often the cursor moves. */
const STANDUP_FEED_PRELOAD_MS = 5 * 60_000;

/**
 * Loads the feeds of the people a standup will visit, in the order given (nearest first), so ←/→ lands
 * on data that is already there: no wait, and no panel opening and closing. A person already loaded
 * recently is skipped, so moving the cursor does not re-request the whole roster; nothing here polls.
 * What is shown from cache is still refreshed in the background once it is older than 30s.
 */
export function usePrefetchStandupFeeds(accountIds: readonly string[], enabled = true) {
  const queryClient = useQueryClient();
  const authScopeKey = useAuthScopeKey();
  const ids = accountIds.join('|');
  useEffect(() => {
    if (!enabled) return;
    for (const accountId of ids.split('|').filter(Boolean)) void queryClient.prefetchQuery({ ...standupFeedOptions(accountId, authScopeKey), staleTime: STANDUP_FEED_PRELOAD_MS });
  }, [enabled, ids, authScopeKey, queryClient]);
}

/** docs/50 v2: the manager's most recent sealed standup — "previous round" recall. */
export function useLatestStandupSession(enabled = true) {
  const authScopeKey = useAuthScopeKey();
  return useQuery<LatestStandupSessionResponse>({
    queryKey: ['team-tracker', 'standup-session', 'latest', authScopeKey],
    queryFn: () => api.get<LatestStandupSessionResponse>('/team-tracker/standup/session/latest'),
    enabled,
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
