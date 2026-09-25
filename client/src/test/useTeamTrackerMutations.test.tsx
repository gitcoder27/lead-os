import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAddCheckIn,
  useAddTrackerItem,
  useCarryForward,
  useDeleteTrackerItem,
  useReassignTrackerItem,
  useSetCurrentItem,
  useStatusUpdate,
  useUpdateAvailability,
  useUpdateDay,
  useUpdateTrackerItem,
} from '@/hooks/useTeamTrackerMutations';

const mockPatch = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    patch: (...args: unknown[]) => mockPatch(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

describe('useTeamTrackerMutations', () => {
  beforeEach(() => {
    mockPatch.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('updates day status/capacity and developer availability with the selected date', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPatch.mockResolvedValue({});
    const wrapper = createWrapper(queryClient);
    const updateDay = renderHook(() => useUpdateDay('2026-03-09'), { wrapper });
    const updateAvailability = renderHook(() => useUpdateAvailability('2026-03-09'), { wrapper });

    await act(async () => {
      await updateDay.result.current.mutateAsync({
        accountId: 'alice-1',
        status: 'blocked',
        capacityUnits: 2,
        managerNotes: 'Pair on deploy',
      });
      await updateAvailability.result.current.mutateAsync({
        accountId: 'bob-2',
        state: 'inactive',
        note: 'PTO',
      });
    });

    expect(mockPatch).toHaveBeenCalledWith('/team-tracker/alice-1/day', {
      date: '2026-03-09',
      status: 'blocked',
      capacityUnits: 2,
      managerNotes: 'Pair on deploy',
    });
    expect(mockPatch).toHaveBeenCalledWith('/team-tracker/bob-2/availability', {
      effectiveDate: '2026-03-09',
      state: 'inactive',
      note: 'PTO',
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['workload'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['developers'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk', 'lookup-developers'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day', '2026-03-09'] });
  });

  it('handles tracker item lifecycle mutations and refreshes issue assignment views', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPost.mockResolvedValue({ id: 12, title: 'Linked Jira task' });
    mockPatch.mockResolvedValue({ id: 12, title: 'Updated Jira task' });
    mockDelete.mockResolvedValue({ deleted: true });
    const wrapper = createWrapper(queryClient);
    const addItem = renderHook(() => useAddTrackerItem('2026-03-09'), { wrapper });
    const updateItem = renderHook(() => useUpdateTrackerItem('2026-03-09'), { wrapper });
    const setCurrent = renderHook(() => useSetCurrentItem('2026-03-09'), { wrapper });
    const deleteItem = renderHook(() => useDeleteTrackerItem('2026-03-09'), { wrapper });

    await act(async () => {
      await addItem.result.current.mutateAsync({
        accountId: 'alice-1',
        jiraKey: 'AM-12',
        relatedIssueKeys: ['AM-13'],
        title: 'Linked Jira task',
        note: 'Needs QA',
      });
      await updateItem.result.current.mutateAsync({
        itemId: 12,
        title: 'Updated Jira task',
        state: 'planned',
        note: null,
        position: 1,
      });
      await setCurrent.result.current.mutateAsync(12);
      await deleteItem.result.current.mutateAsync(12);
    });

    expect(mockPost).toHaveBeenCalledWith('/team-tracker/alice-1/items', {
      date: '2026-03-09',
      jiraKey: 'AM-12',
      relatedIssueKeys: ['AM-13'],
      title: 'Linked Jira task',
      note: 'Needs QA',
    });
    expect(mockPatch).toHaveBeenCalledWith('/team-tracker/items/12', {
      title: 'Updated Jira task',
      state: 'planned',
      note: null,
      position: 1,
    });
    expect(mockPost).toHaveBeenCalledWith('/team-tracker/items/12/set-current');
    expect(mockDelete).toHaveBeenCalledWith('/team-tracker/items/12');
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ['team-tracker', 'issue-assignment', '2026-03-09'],
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ['team-tracker', 'issue-assignment', '2026-03-09', 'AM-12'],
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['issues'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['issue'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk', 'task-detail'] });
  });

  it('records check-ins, manager status updates, and carry-forward requests', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPost.mockResolvedValue({});
    const wrapper = createWrapper(queryClient);
    const addCheckIn = renderHook(() => useAddCheckIn('2026-03-09'), { wrapper });
    const statusUpdate = renderHook(() => useStatusUpdate('2026-03-09'), { wrapper });
    const carryForward = renderHook(() => useCarryForward(), { wrapper });

    await act(async () => {
      await addCheckIn.result.current.mutateAsync({
        accountId: 'alice-1',
        summary: 'Unblocked after QA review',
        status: 'on_track',
      });
      await statusUpdate.result.current.mutateAsync({
        accountId: 'alice-1',
        status: 'needs_attention',
        rationale: 'Waiting on architecture review',
        summary: 'Needs follow-up',
        nextFollowUpAt: '2026-03-10T10:00:00.000Z',
      });
      await carryForward.result.current.mutateAsync({
        fromDate: '2026-03-08',
        toDate: '2026-03-09',
        itemIds: [12],
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/team-tracker/alice-1/checkins', {
      date: '2026-03-09',
      summary: 'Unblocked after QA review',
      status: 'on_track',
    });
    expect(mockPost).toHaveBeenCalledWith('/team-tracker/alice-1/status-update', {
      date: '2026-03-09',
      status: 'needs_attention',
      rationale: 'Waiting on architecture review',
      summary: 'Needs follow-up',
      nextFollowUpAt: '2026-03-10T10:00:00.000Z',
    });
    expect(mockPost).toHaveBeenCalledWith('/team-tracker/carry-forward', {
      fromDate: '2026-03-08',
      toDate: '2026-03-09',
      itemIds: [12],
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker', 'carry-forward-context'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['workload'] });
  });

  it('reassigns tracker items with a uuid request id and refreshes task views', async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockPost.mockResolvedValue({ id: 12, taskKey: 'T-4' });
    const wrapper = createWrapper(queryClient);
    const reassign = renderHook(() => useReassignTrackerItem('2026-03-09'), { wrapper });

    await act(async () => {
      await reassign.result.current.mutateAsync({ itemId: 12, toAccountId: 'bob-2' });
    });

    expect(mockPost).toHaveBeenCalledWith('/team-tracker/items/12/reassign', {
      toAccountId: 'bob-2',
      date: '2026-03-09',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['team-tracker'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['task-events'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-day'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['today'] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk'] });
  });
});
