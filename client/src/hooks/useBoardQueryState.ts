import { useState, useCallback, useMemo, useRef } from 'react';
import {
  useTeamTrackerViews,
  useCreateTeamTrackerView,
  useUpdateTeamTrackerView,
  useDeleteTeamTrackerView,
} from '@/hooks/useTeamTrackerViews';
import type {
  TeamTrackerBoardQuery,
  TeamTrackerBoardResolvedQuery,
  TeamTrackerSavedView,
  TrackerBoardSummaryFilter,
  TeamTrackerBoardSort,
  TeamTrackerBoardGroupBy,
} from '@/types';

export interface BoardQueryState {
  boardQuery: TeamTrackerBoardQuery;
  activeViewId: number | undefined;
  isDirtyFrom: (resolvedQuery: TeamTrackerBoardResolvedQuery | undefined) => boolean;
  handleSearchChange: (q: string) => void;
  handleSummaryFilterChange: (filter: TrackerBoardSummaryFilter) => void;
  handleSortChange: (sortBy: TeamTrackerBoardSort) => void;
  handleGroupChange: (groupBy: TeamTrackerBoardGroupBy) => void;
  handleApplyView: (view: TeamTrackerSavedView) => void;
  handleClearView: () => void;
  handleSaveNewView: (name: string) => void;
  handleUpdateView: (viewId: number, name: string) => void;
  handleDeleteView: (viewId: number) => void;
  replaceQuery: (query: TeamTrackerBoardQuery) => void;
  savedViews: TeamTrackerSavedView[];
  isViewsLoading: boolean;
  isSaving: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AddToastFn = (...args: any[]) => void;

export function useBoardQueryState(
  addToast: AddToastFn,
  initialQuery?: TeamTrackerBoardQuery,
): BoardQueryState {
  const [boardQuery, setBoardQuery] = useState<TeamTrackerBoardQuery>(initialQuery ?? { sortBy: 'name' });
  const activeViewSnapshot = useRef<TeamTrackerSavedView | undefined>();

  const { data: savedViews, isLoading: isViewsLoading } = useTeamTrackerViews();
  const createView = useCreateTeamTrackerView();
  const updateView = useUpdateTeamTrackerView();
  const deleteView = useDeleteTeamTrackerView();

  const activeViewId = boardQuery.viewId;

  const isDirtyFrom = useCallback((resolvedQuery: TeamTrackerBoardResolvedQuery | undefined) => {
    const snap = activeViewSnapshot.current;
    if (!snap || !resolvedQuery) return false;
    return (
      resolvedQuery.q !== snap.q ||
      resolvedQuery.summaryFilter !== snap.summaryFilter ||
      resolvedQuery.sortBy !== snap.sortBy ||
      resolvedQuery.groupBy !== snap.groupBy
    );
  }, []);

  const patchQuery = useCallback((patch: Partial<TeamTrackerBoardQuery>) => {
    setBoardQuery((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSearchChange = useCallback((q: string) => {
    patchQuery({ q: q || undefined });
  }, [patchQuery]);

  const handleSummaryFilterChange = useCallback((filter: TrackerBoardSummaryFilter) => {
    setBoardQuery((prev) => ({
      ...prev,
      summaryFilter: filter === 'all' && prev.viewId === undefined ? undefined : filter,
    }));
  }, []);

  const handleSortChange = useCallback((sortBy: TeamTrackerBoardSort) => {
    patchQuery({ sortBy });
  }, [patchQuery]);

  const handleGroupChange = useCallback((groupBy: TeamTrackerBoardGroupBy) => {
    patchQuery({ groupBy });
  }, [patchQuery]);

  const handleApplyView = useCallback((view: TeamTrackerSavedView) => {
    activeViewSnapshot.current = view;
    setBoardQuery({
      viewId: view.id,
      q: view.q || undefined,
      summaryFilter: view.summaryFilter !== 'all' ? view.summaryFilter : undefined,
      sortBy: view.sortBy,
      groupBy: view.groupBy,
    });
  }, []);

  const handleClearView = useCallback(() => {
    activeViewSnapshot.current = undefined;
    setBoardQuery({ sortBy: 'name' });
  }, []);

  const handleSaveNewView = useCallback((name: string) => {
    createView.mutate(
      { name, ...boardQuery },
      {
        onSuccess: (newView) => {
          activeViewSnapshot.current = newView;
          setBoardQuery((prev) => ({ ...prev, viewId: newView.id }));
          addToast(`View "${name}" saved`, 'success');
        },
        onError: (err) => addToast(err.message, 'error'),
      }
    );
  }, [addToast, boardQuery, createView]);

  const handleUpdateView = useCallback((viewId: number, name: string) => {
    updateView.mutate(
      { viewId, name, ...boardQuery },
      {
        onSuccess: (updatedView) => {
          activeViewSnapshot.current = updatedView;
          addToast(`View "${name}" updated`, 'success');
        },
        onError: (err) => addToast(err.message, 'error'),
      }
    );
  }, [addToast, boardQuery, updateView]);

  const handleDeleteView = useCallback((viewId: number) => {
    deleteView.mutate(viewId, {
      onSuccess: () => {
        if (activeViewId === viewId) {
          activeViewSnapshot.current = undefined;
          setBoardQuery((prev) => {
            const { viewId: _, ...rest } = prev;
            return rest;
          });
        }
        addToast('View deleted', 'success');
      },
      onError: (err) => addToast(err.message, 'error'),
    });
  }, [activeViewId, addToast, deleteView]);

  const replaceQuery = useCallback((query: TeamTrackerBoardQuery) => {
    setBoardQuery(query);
  }, []);

  return {
    boardQuery,
    activeViewId,
    isDirtyFrom,
    handleSearchChange,
    handleSummaryFilterChange,
    handleSortChange,
    handleGroupChange,
    handleApplyView,
    handleClearView,
    handleSaveNewView,
    handleUpdateView,
    handleDeleteView,
    replaceQuery,
    savedViews: savedViews ?? [],
    isViewsLoading,
    isSaving: createView.isPending || updateView.isPending,
  };
}
