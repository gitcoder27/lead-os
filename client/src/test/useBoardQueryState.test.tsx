import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBoardQueryState } from '@/hooks/useBoardQueryState';
import { teamBoardQueryFromParams, teamBoardQueryToSearch } from '@/lib/view-params';
import type { TeamTrackerSavedView } from '@/types';

vi.mock('@/hooks/useTeamTrackerViews', () => ({
  useTeamTrackerViews: () => ({ data: [], isLoading: false }),
  useCreateTeamTrackerView: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTeamTrackerView: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTeamTrackerView: () => ({ mutate: vi.fn() }),
}));

const savedView = (sortBy: 'attention' | 'name'): TeamTrackerSavedView => ({
  id: 12, name: 'Saved team', q: 'release', summaryFilter: 'blocked', sortBy,
  groupBy: 'status', createdAt: '2026-10-07T08:00:00Z', updatedAt: '2026-10-07T08:00:00Z',
});

describe('useBoardQueryState', () => {
  it('starts at Name and Clear view resets to Name with no saved view or filters', () => {
    const { result } = renderHook(() => useBoardQueryState(vi.fn()));
    expect(result.current.boardQuery).toEqual({ sortBy: 'name' });
    act(() => result.current.handleApplyView(savedView('attention')));
    act(() => result.current.handleClearView());
    expect(result.current.boardQuery).toEqual({ sortBy: 'name' });
    expect(result.current.activeViewId).toBeUndefined();
    expect(teamBoardQueryToSearch(result.current.boardQuery)).toBe('');
  });

  it('preserves explicit initial sort, filter, search and grouping', () => {
    const query = { sortBy: 'attention' as const, q: 'release', summaryFilter: 'blocked' as const, groupBy: 'status' as const };
    const { result } = renderHook(() => useBoardQueryState(vi.fn(), query));
    expect(result.current.boardQuery).toEqual(query);
  });

  it('keeps bare and saved-view URL omissions available for server defaults/inheritance', () => {
    const { result } = renderHook(() => useBoardQueryState(vi.fn(), { viewId: 12 }));
    expect(result.current.boardQuery).toEqual({ viewId: 12 });
    act(() => result.current.replaceQuery({}));
    expect(result.current.boardQuery).toEqual({});
    expect(teamBoardQueryToSearch(result.current.boardQuery)).toBe('');
  });

  it.each([
    ['attention', 'name'], ['name', 'attention'],
  ] as const)('retains a saved %s view overridden to %s through reload', (inherited, override) => {
    const view = savedView(inherited);
    const { result, unmount } = renderHook(() => useBoardQueryState(vi.fn()));
    act(() => result.current.handleApplyView(view));
    act(() => {
      result.current.handleSortChange(override);
      result.current.handleGroupChange('none');
      result.current.handleSummaryFilterChange('all');
    });
    const query = result.current.boardQuery;
    expect(query).toEqual({ viewId: 12, q: 'release', summaryFilter: 'all', sortBy: override, groupBy: 'none' });
    const parsed = teamBoardQueryFromParams(new URLSearchParams(teamBoardQueryToSearch(query)));
    unmount();
    const reloaded = renderHook(() => useBoardQueryState(vi.fn(), parsed));
    expect(reloaded.result.current.boardQuery).toEqual(query);
    expect(view).toEqual(savedView(inherited));
  });

  it('preserves other query fields when changing sort, and replaces them for history navigation', () => {
    const first = { viewId: 12, q: 'release', summaryFilter: 'blocked' as const, sortBy: 'name' as const, groupBy: 'status' as const };
    const { result } = renderHook(() => useBoardQueryState(vi.fn(), first));
    act(() => result.current.handleSortChange('attention'));
    const second = { ...first, sortBy: 'attention' as const };
    expect(result.current.boardQuery).toEqual(second);
    act(() => result.current.replaceQuery(first));
    expect(result.current.boardQuery).toEqual(first);
    act(() => result.current.replaceQuery(second));
    expect(result.current.boardQuery).toEqual(second);
  });

  it('still clears the unsaved All filter to the default', () => {
    const { result } = renderHook(() => useBoardQueryState(vi.fn(), { summaryFilter: 'blocked' }));
    act(() => result.current.handleSummaryFilterChange('all'));
    expect(result.current.boardQuery.summaryFilter).toBeUndefined();
  });
});
