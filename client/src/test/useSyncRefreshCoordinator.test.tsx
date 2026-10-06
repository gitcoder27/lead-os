import { act, renderHook, screen, waitFor, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIssueDetail } from '@/hooks/useIssueDetail';
import { useIssues } from '@/hooks/useIssues';
import { useSyncRefreshCoordinator } from '@/hooks/useSyncRefreshCoordinator';
import {
  SYNC_DEPENDENT_QUERY_KEYS,
  SYNC_STATUS_QUERY_KEY,
} from '@/lib/sync-refresh';
import { getLocalIsoDate } from '@/lib/utils';
import type { Issue, SyncStatus } from '@/types';

const mockGet = vi.fn();
const SYNC_STATUS_SCOPED_QUERY_KEY = [...SYNC_STATUS_QUERY_KEY, 'anonymous'] as const;

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function buildIssue(assigneeName: string): Issue {
  return {
    jiraKey: 'PROJ-101',
    summary: 'Login flow breaks on submit',
    aspenSeverity: 'High',
    priorityName: 'Highest',
    priorityId: '1',
    statusName: 'In Progress',
    statusCategory: 'indeterminate',
    assigneeId: assigneeName.toLowerCase(),
    assigneeName,
    reporterName: 'Lead',
    component: 'Auth',
    labels: ['auth'],
    flagged: false,
    createdAt: '2026-03-14T09:00:00.000Z',
    updatedAt: '2026-03-14T09:30:00.000Z',
    localTags: [],
  };
}

function seedSyncDependentQueries(queryClient: QueryClient) {
  for (const queryKey of SYNC_DEPENDENT_QUERY_KEYS) {
    queryClient.setQueryData(queryKey as readonly unknown[], { seeded: true });
  }
}

function expectSyncDependentQueriesInvalidated(queryClient: QueryClient) {
  for (const queryKey of SYNC_DEPENDENT_QUERY_KEYS) {
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  }
}

async function waitForInitialSyncStatus(queryClient: QueryClient, lastSyncedAt: string) {
  await waitFor(() => {
    expect(
      queryClient.getQueryData<SyncStatus>(SYNC_STATUS_SCOPED_QUERY_KEY)?.lastSyncedAt
    ).toBe(lastSyncedAt);
  });

  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSyncRefreshCoordinator', () => {
  let syncStatus: SyncStatus;

  beforeEach(() => {
    mockGet.mockReset();
    syncStatus = {
      status: 'idle',
      lastSyncedAt: '2026-03-14T10:00:00.000Z',
      issuesSynced: 12,
    };
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/sync/status') {
        return syncStatus;
      }

      throw new Error(`Unhandled GET ${url}`);
    });
  });

  it('does not invalidate sync-dependent queries on the initial sync-status load', async () => {
    const queryClient = createQueryClient();
    seedSyncDependentQueries(queryClient);

    renderHook(() => useSyncRefreshCoordinator(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/sync/status');
    });

    await waitForInitialSyncStatus(queryClient, syncStatus.lastSyncedAt ?? '');

    for (const queryKey of SYNC_DEPENDENT_QUERY_KEYS) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it('invalidates the full sync-dependent query set when a newer sync completes', async () => {
    const queryClient = createQueryClient();
    seedSyncDependentQueries(queryClient);

    renderHook(() => useSyncRefreshCoordinator(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/sync/status');
    });

    await waitForInitialSyncStatus(queryClient, syncStatus.lastSyncedAt ?? '');

    syncStatus = {
      ...syncStatus,
      lastSyncedAt: '2026-03-14T10:05:00.000Z',
      issuesSynced: 13,
    };

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: SYNC_STATUS_QUERY_KEY });
    });

    await waitFor(() => {
      expectSyncDependentQueriesInvalidated(queryClient);
    });
  });

  it('refetches sync status on tab return and invalidates when a newer sync completed while hidden', async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);
    const originalVisibilityState = document.visibilityState;
    seedSyncDependentQueries(queryClient);

    renderHook(() => useSyncRefreshCoordinator(), { wrapper });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    await waitForInitialSyncStatus(queryClient, syncStatus.lastSyncedAt ?? '');

    syncStatus = {
      ...syncStatus,
      lastSyncedAt: '2026-03-14T10:10:00.000Z',
      issuesSynced: 14,
    };

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expectSyncDependentQueriesInvalidated(queryClient);
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState,
    });
  });

  it('refetches sync status on focus without invalidating when the sync timestamp is unchanged', async () => {
    const queryClient = createQueryClient();
    seedSyncDependentQueries(queryClient);

    renderHook(() => useSyncRefreshCoordinator(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    await waitForInitialSyncStatus(queryClient, syncStatus.lastSyncedAt ?? '');

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    for (const queryKey of SYNC_DEPENDENT_QUERY_KEYS) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });
});

function SyncAwareIssueHarness() {
  useSyncRefreshCoordinator();
  const { data: issues } = useIssues('all');
  const { data: issue } = useIssueDetail('PROJ-101');

  return (
    <div>
      <div data-testid="list-assignee">{issues?.[0]?.assigneeName ?? 'missing'}</div>
      <div data-testid="detail-assignee">{issue?.assigneeName ?? 'missing'}</div>
    </div>
  );
}

describe('sync refresh regression', () => {
  let syncStatus: SyncStatus;
  let currentIssue: Issue;
  let trackerDate: string;

  beforeEach(() => {
    mockGet.mockReset();
    syncStatus = {
      status: 'idle',
      lastSyncedAt: '2026-03-14T10:00:00.000Z',
      issuesSynced: 12,
    };
    currentIssue = buildIssue('Alice');
    trackerDate = getLocalIsoDate();

    mockGet.mockImplementation(async (url: string) => {
      if (url === '/sync/status') {
        return syncStatus;
      }
      if (url === `/issues?trackerDate=${trackerDate}&limit=200&offset=0`) {
        return { issues: [currentIssue] };
      }
      if (url === `/issues/PROJ-101?trackerDate=${trackerDate}`) {
        return currentIssue;
      }

      throw new Error(`Unhandled GET ${url}`);
    });
  });

  it('refreshes both issue list data and open issue detail data after a newer sync timestamp arrives', async () => {
    const queryClient = createQueryClient();

    render(<SyncAwareIssueHarness />, {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(screen.getByTestId('list-assignee')).toHaveTextContent('Alice');
      expect(screen.getByTestId('detail-assignee')).toHaveTextContent('Alice');
    });

    currentIssue = buildIssue('Bob');
    syncStatus = {
      ...syncStatus,
      lastSyncedAt: '2026-03-14T10:05:00.000Z',
      issuesSynced: 13,
    };

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: SYNC_STATUS_QUERY_KEY });
    });

    await waitFor(() => {
      expect(screen.getByTestId('list-assignee')).toHaveTextContent('Bob');
      expect(screen.getByTestId('detail-assignee')).toHaveTextContent('Bob');
    });
  });
});
