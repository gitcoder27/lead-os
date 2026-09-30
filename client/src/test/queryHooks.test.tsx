import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAlerts, useDismissAlerts } from '@/hooks/useAlerts';
import { useBootstrapState } from '@/hooks/useBootstrapState';
import { useConfig } from '@/hooks/useConfig';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useManagerActions } from '@/hooks/useManagerActions';
import { useOverview } from '@/hooks/useOverview';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useTagCounts } from '@/hooks/useTagCounts';
import { useWorkload } from '@/hooks/useWorkload';
import type { Alert, Developer } from '@/types';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
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

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const alertFixture = (id: string): Alert => ({
  id,
  type: 'overdue',
  severity: 'high',
  issueKey: `PROJ-${id}`,
  message: `Alert ${id}`,
  detectedAt: '2026-03-20T00:00:00.000Z',
});

describe('query hook wrappers', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('loads alerts from the API and unwraps the response list', async () => {
    const alerts = [alertFixture('101')];
    mockGet.mockResolvedValue({ alerts });

    const { result } = renderHook(() => useAlerts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/alerts');
    expect(result.current.data).toEqual(alerts);
  });

  it('optimistically removes dismissed alerts and restores them if dismissal fails', async () => {
    const queryClient = createQueryClient();
    const alerts = [alertFixture('101'), alertFixture('102')];
    queryClient.setQueryData<Alert[]>(['alerts', 'anonymous'], alerts);
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    let rejectPost: ((error: Error) => void) | undefined;
    mockPost.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        })
    );

    const { result } = renderHook(() => useDismissAlerts(), {
      wrapper: createWrapper(queryClient),
    });

    let mutation: Promise<unknown>;
    act(() => {
      mutation = result.current.mutateAsync({ alertIds: ['101'] }).catch(() => undefined);
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<Alert[]>(['alerts', 'anonymous'])).toEqual([alerts[1]]);
    });

    act(() => {
      rejectPost?.(new Error('Dismiss failed'));
    });
    await mutation!;

    expect(queryClient.getQueryData<Alert[]>(['alerts', 'anonymous'])).toEqual(alerts);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['alerts'] });
  });

  it('respects disabled config and overview queries', async () => {
    const { result: configResult } = renderHook(() => useConfig({ enabled: false }), {
      wrapper: createWrapper(),
    });
    const { result: overviewResult } = renderHook(() => useOverview({ enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(configResult.current.fetchStatus).toBe('idle');
    expect(overviewResult.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('loads bootstrap, overview, manager actions, tag counts, and workload through their API endpoints', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/auth/bootstrap') return Promise.resolve({ needsSetup: false });
      if (url === '/overview') return Promise.resolve({ total: 3 });
      if (url.startsWith('/manager-actions?')) return Promise.resolve({ actions: [] });
      if (url.startsWith('/tags/counts?')) return Promise.resolve({ counts: [] });
      if (url.startsWith('/team/workload?')) return Promise.resolve({ developers: [{ accountId: 'dev-1' }] });
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const wrapper = createWrapper();
    const bootstrap = renderHook(() => useBootstrapState(), { wrapper });
    const overview = renderHook(() => useOverview(), { wrapper });
    const managerActions = renderHook(
      () => useManagerActions({ date: '2026-03-09', surface: 'today', limit: 4 }),
      { wrapper }
    );
    const tagCounts = renderHook(() => useTagCounts('overdue', 'dev-1'), { wrapper });
    const workload = renderHook(() => useWorkload('2026-03-09'), { wrapper });

    await waitFor(() => {
      expect(bootstrap.result.current.isSuccess).toBe(true);
      expect(overview.result.current.isSuccess).toBe(true);
      expect(managerActions.result.current.isSuccess).toBe(true);
      expect(tagCounts.result.current.isSuccess).toBe(true);
      expect(workload.result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/auth/bootstrap');
    expect(mockGet).toHaveBeenCalledWith('/overview');
    expect(mockGet).toHaveBeenCalledWith(
      '/manager-actions?date=2026-03-09&surface=today&limit=4',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockGet).toHaveBeenCalledWith('/tags/counts?filter=overdue&assignee=dev-1');
    expect(mockGet).toHaveBeenCalledWith('/team/workload?date=2026-03-09');
    expect(workload.result.current.data).toEqual([{ accountId: 'dev-1' }]);
  });

  it('filters legacy and inactive developers unless unavailable developers are requested', async () => {
    const developers: Developer[] = [
      { accountId: 'dev-1', displayName: 'Dev', isActive: true },
      { accountId: 'lead-1', displayName: 'Lead', isActive: true },
      { accountId: 'alice-1', displayName: 'Alice', isActive: true },
      {
        accountId: 'bob-2',
        displayName: 'Bob',
        isActive: true,
        availability: { state: 'inactive', note: 'PTO' },
      },
    ];
    mockGet.mockResolvedValue({ developers });

    const activeOnly = renderHook(() => useDevelopers('2026-03-09'), {
      wrapper: createWrapper(),
    });
    const includeUnavailable = renderHook(
      () => useDevelopers('2026-03-09', { includeUnavailable: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(activeOnly.result.current.isSuccess).toBe(true);
      expect(includeUnavailable.result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/team/developers?date=2026-03-09');
    expect(activeOnly.result.current.data?.map((developer) => developer.accountId)).toEqual(['alice-1']);
    expect(includeUnavailable.result.current.data?.map((developer) => developer.accountId)).toEqual([
      'alice-1',
      'bob-2',
    ]);
  });

  it('keeps suggestions disabled without an issue and unwraps all suggestion responses when enabled', async () => {
    const disabled = renderHook(() => useSuggestions(), { wrapper: createWrapper() });
    expect(disabled.result.current.prioritySuggestion.fetchStatus).toBe('idle');
    expect(disabled.result.current.dueDateSuggestion.fetchStatus).toBe('idle');
    expect(disabled.result.current.assigneeSuggestion.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();

    mockGet.mockImplementation((url: string) => {
      if (url === '/suggestions/priority/PROJ-101') return Promise.resolve({ priority: 'High' });
      if (url === '/suggestions/duedate/Highest?issue=PROJ-101') return Promise.resolve({ dueDate: '2026-03-14' });
      if (url === '/suggestions/assignee/PROJ-101') {
        return Promise.resolve({ issueKey: 'PROJ-101', suggestions: [{ accountId: 'alice-1', score: 0.91 }] });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const enabled = renderHook(() => useSuggestions('PROJ-101', 'Highest'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(enabled.result.current.prioritySuggestion.isSuccess).toBe(true);
      expect(enabled.result.current.dueDateSuggestion.isSuccess).toBe(true);
      expect(enabled.result.current.assigneeSuggestion.isSuccess).toBe(true);
    });

    expect(enabled.result.current.prioritySuggestion.data).toEqual({ priority: 'High' });
    expect(enabled.result.current.dueDateSuggestion.data).toEqual({ dueDate: '2026-03-14' });
    expect(enabled.result.current.assigneeSuggestion.data).toEqual([{ accountId: 'alice-1', score: 0.91 }]);
  });

  it('asks for the due-date target of the suggested priority, counted from the issue (docs/56 P5-02)', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/suggestions/priority/PROJ-101') return Promise.resolve({ suggested: 'Highest', reason: 'r' });
      if (url === '/suggestions/duedate/Highest?issue=PROJ-101') return Promise.resolve({ suggested: '2026-03-02', reason: 'r' });
      if (url === '/suggestions/assignee/PROJ-101') return Promise.resolve({ issueKey: 'PROJ-101', suggestions: [] });
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const hook = renderHook(() => useSuggestions('PROJ-101', 'Medium'), { wrapper: createWrapper() });
    await waitFor(() => expect(hook.result.current.dueDateSuggestion.isSuccess).toBe(true));
    expect(hook.result.current.dueDateSuggestion.data).toEqual({ suggested: '2026-03-02', reason: 'r' });
  });

  it('keeps the current priority for the due-date target when the priority suggestion is only the default', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/suggestions/priority/PROJ-101') return Promise.resolve({ suggested: 'Medium', reason: 'r', isDefault: true });
      if (url === '/suggestions/duedate/High?issue=PROJ-101') return Promise.resolve({ suggested: '2026-03-04', reason: 'r' });
      if (url === '/suggestions/assignee/PROJ-101') return Promise.resolve({ issueKey: 'PROJ-101', suggestions: [] });
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const hook = renderHook(() => useSuggestions('PROJ-101', 'High'), { wrapper: createWrapper() });
    await waitFor(() => expect(hook.result.current.dueDateSuggestion.isSuccess).toBe(true));
    expect(hook.result.current.dueDateSuggestion.data).toEqual({ suggested: '2026-03-04', reason: 'r' });
  });
});
