import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAddMyDayCheckIn,
  useAddMyDayItem,
  useMyDay,
  useSetMyDayCurrent,
  useUpdateMyDayItem,
  useUpdateMyDayStatus,
} from '@/hooks/useMyDay';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
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

describe('useMyDay hooks', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPost.mockReset();
  });

  it('loads the developer day for the selected date and can be disabled', async () => {
    mockGet.mockResolvedValue({ date: '2026-03-09', items: [] });

    const enabled = renderHook(() => useMyDay('2026-03-09'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));

    const disabled = renderHook(() => useMyDay('2026-03-10', false), {
      wrapper: createWrapper(),
    });

    expect(mockGet).toHaveBeenCalledWith('/my-day?date=2026-03-09');
    expect(enabled.result.current.data).toEqual({ date: '2026-03-09', items: [] });
    expect(disabled.result.current.fetchStatus).toBe('idle');
  });

  it('updates status and invalidates the developer day and team tracker caches', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPatch.mockResolvedValue({ status: 'blocked' });

    const { result } = renderHook(() => useUpdateMyDayStatus('2026-03-09'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('blocked');
    });

    expect(mockPatch).toHaveBeenCalledWith('/my-day', {
      date: '2026-03-09',
      status: 'blocked',
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day', '2026-03-09'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker', '2026-03-09'] });
  });

  it('shows a status change immediately and rolls it back if the server refuses', async () => {
    const queryClient = createQueryClient();
    const key = ['my-day', '2026-03-09', 'dev-1'];
    queryClient.setQueryData(key, { date: '2026-03-09', status: 'on_track' });
    let rejectPatch: (error: Error) => void = () => undefined;
    mockPatch.mockReturnValue(new Promise((_resolve, reject) => { rejectPatch = reject; }));

    const { result } = renderHook(() => useUpdateMyDayStatus('2026-03-09'), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate('blocked');
    });
    await waitFor(() => expect(queryClient.getQueryData<{ status: string }>(key)?.status).toBe('blocked'));

    await act(async () => {
      rejectPatch(new Error('nope'));
    });
    await waitFor(() => expect(queryClient.getQueryData<{ status: string }>(key)?.status).toBe('on_track'));
  });

  it('adds developer work items with Jira and related issue context', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPost.mockResolvedValue({ id: 12, title: 'Fix export flow' });

    const { result } = renderHook(() => useAddMyDayItem('2026-03-09'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        jiraKey: 'AM-12',
        relatedIssueKeys: ['AM-13'],
        title: 'Fix export flow',
        note: 'Pair with QA',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/my-day/items', {
      date: '2026-03-09',
      jiraKey: 'AM-12',
      relatedIssueKeys: ['AM-13'],
      title: 'Fix export flow',
      note: 'Pair with QA',
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day', '2026-03-09'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker', '2026-03-09'] });
  });

  it('updates items, sets current work, and refreshes manager desk views', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPatch.mockResolvedValue({ id: 12, title: 'Updated task' });
    mockPost.mockResolvedValue({ id: 12, state: 'current' });
    const wrapper = createWrapper(queryClient);
    const updateItem = renderHook(() => useUpdateMyDayItem('2026-03-09'), { wrapper });
    const setCurrent = renderHook(() => useSetMyDayCurrent('2026-03-09'), { wrapper });

    await act(async () => {
      await updateItem.result.current.mutateAsync({
        itemId: 12,
        title: 'Updated task',
        note: null,
        state: 'planned',
        position: 2,
      });
      await setCurrent.result.current.mutateAsync(12);
    });

    expect(mockPatch).toHaveBeenCalledWith('/my-day/items/12', {
      date: '2026-03-09',
      title: 'Updated task',
      note: null,
      state: 'planned',
      position: 2,
    });
    expect(mockPost).toHaveBeenCalledWith('/my-day/items/12/set-current', {
      date: '2026-03-09',
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day', '2026-03-09'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker', '2026-03-09'] });
  });

  it('adds check-ins with optional status and refreshes day-level caches', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPost.mockResolvedValue({ id: 5, summary: 'Still blocked' });

    const { result } = renderHook(() => useAddMyDayCheckIn('2026-03-09'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        summary: 'Still blocked',
        status: 'blocked',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/my-day/checkins', {
      date: '2026-03-09',
      summary: 'Still blocked',
      status: 'blocked',
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day', '2026-03-09'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker', '2026-03-09'] });
  });
});
