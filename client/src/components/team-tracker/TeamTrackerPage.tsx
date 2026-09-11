import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight, History, RefreshCw } from 'lucide-react';
import { useTeamTracker } from '@/hooks/useTeamTracker';
import {
  useUpdateDay,
  useUpdateAvailability,
  useSetCurrentItem,
  useUpdateTrackerItem,
  useAddTrackerItem,
  useAddCheckIn,
} from '@/hooks/useTeamTrackerMutations';
import { useBoardQueryState } from '@/hooks/useBoardQueryState';
import { useIssues } from '@/hooks/useIssues';
import { useToast } from '@/context/ToastContext';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import { TrackerSummaryStrip } from './TrackerSummaryStrip';
import { TrackerBoardToolbar } from './TrackerBoardToolbar';
import { InactiveDeveloperTray } from './InactiveDeveloperTray';
import { ROSTER_GRID, TrackerRosterBoard } from './TrackerRosterBoard';
import { TeamTrackerViewSwitcher, type TeamTrackerLens } from './TeamTrackerViewSwitcher';
import { DeveloperTrackerDrawer } from './DeveloperTrackerDrawer';
import { AvailabilityDialog } from './AvailabilityDialog';
import { TrackerTaskDetailDrawer } from './TrackerTaskDetailDrawer';
import { describeTeamTrackerView } from './SavedViewItem';
import { ManagerDeskCaptureDialog } from '@/components/manager-desk/ManagerDeskCaptureDialog';
import {
  formatTrackerIssueContextNote,
  getTrackerIssueContextChips,
  getTrackerIssueLinks,
} from './trackerIssueContext';
import type { AppView } from '@/App';
import type {
  TeamTrackerBoardQuery,
  TeamTrackerBoardResponse,
  TrackerAttentionActionItem,
  TrackerDeveloperDay,
  TrackerAttentionReason,
  TrackerWorkItem,
} from '@/types';

interface TeamTrackerPageProps {
  onViewChange?: (view: AppView) => void;
  initialDeveloperAccountId?: string;
  initialDeveloperNonce?: number;
  onInitialDeveloperHandled?: () => void;
  initialBoardQuery?: TeamTrackerBoardQuery;
  urlBoardQuery?: TeamTrackerBoardQuery;
  urlBoardQueryNonce?: number;
  onBoardQueryChange?: (query: TeamTrackerBoardQuery) => void;
}

function useTeamTrackerWorkflow({
  date,
  board,
  readOnly,
  addToast,
  addTrackerItem,
  updateAvailability,
  setCurrent,
  updateItem,
  refetchBoard,
}: {
  date: string;
  board?: TeamTrackerBoardResponse;
  readOnly: boolean;
  addToast: ReturnType<typeof useToast>['addToast'];
  addTrackerItem: ReturnType<typeof useAddTrackerItem>;
  updateAvailability: ReturnType<typeof useUpdateAvailability>;
  setCurrent: ReturnType<typeof useSetCurrentItem>;
  updateItem: ReturnType<typeof useUpdateTrackerItem>;
  refetchBoard: () => unknown;
}) {
  const [drawerAccountId, setDrawerAccountId] = useState<string | undefined>();
  const [selectedTask, setSelectedTask] = useState<{ trackerItemId: number; managerDeskItemId?: number } | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<TrackerDeveloperDay | undefined>();
  const [followUpTarget, setFollowUpTarget] = useState<{ day: TrackerDeveloperDay; reasons: TrackerAttentionReason[] } | null>(null);

  const drawerDay = useMemo(
    () => board?.developers.find((day) => day.developer.accountId === drawerAccountId),
    [board, drawerAccountId]
  );

  const attentionItems = useMemo(() => {
    if (!board) {
      return [];
    }

    const currentItemsByDeveloper = new Map(
      board.developers
        .filter((day) => Boolean(day.currentItem))
        .map((day) => [day.developer.accountId, mapAttentionCurrentItem(day.currentItem!)]),
    );

    return board.attentionQueue.map((item) => {
      const currentItem = item.currentItem ?? currentItemsByDeveloper.get(item.developer.accountId);
      if (!currentItem) {
        return item;
      }

      return {
        ...item,
        hasCurrentItem: true,
        currentItem,
      };
    });
  }, [board]);

  const findTrackerItem = useCallback(
    (itemId: number): TrackerWorkItem | undefined => {
      for (const day of board?.developers ?? []) {
        if (day.currentItem?.id === itemId) {
          return day.currentItem;
        }

        const plannedItem = day.plannedItems.find((item) => item.id === itemId);
        if (plannedItem) {
          return plannedItem;
        }

        const completedItem = day.completedItems.find((item) => item.id === itemId);
        if (completedItem) {
          return completedItem;
        }

        const droppedItem = day.droppedItems.find((item) => item.id === itemId);
        if (droppedItem) {
          return droppedItem;
        }
      }

      return undefined;
    },
    [board?.developers]
  );

  const handleSetCurrent = useCallback(
    (itemId: number) => {
      setCurrent.mutate(itemId, {
        onError: (err) => addToast(err.message, 'error'),
      });
    },
    [addToast, setCurrent]
  );

  const handleMarkDone = useCallback(
    (itemId: number) => {
      const previousItem = findTrackerItem(itemId);
      const previousState = previousItem?.state ?? 'in_progress';
      const itemLabel = previousItem?.title ?? 'Task';

      updateItem.mutate(
        { itemId, state: 'done' },
        {
          onSuccess: () => {
            addToast({
              type: 'success',
              title: `${itemLabel} marked done`,
              message: 'Current work was moved out of the active slot.',
              action: {
                label: 'Undo',
                onClick: () => {
                  updateItem.mutate(
                    { itemId, state: previousState },
                    {
                      onSuccess: () => addToast('Task restored', 'success'),
                      onError: (err) => addToast(err.message, 'error'),
                    }
                  );
                },
              },
              duration: 8000,
            });
          },
          onError: (err) => addToast(err.message, 'error'),
        }
      );
    },
    [addToast, findTrackerItem, updateItem]
  );

  const handleDropItem = useCallback(
    (itemId: number) => {
      updateItem.mutate({ itemId, state: 'dropped' });
    },
    [updateItem]
  );

  const handleOpenTaskDetail = useCallback((itemId: number, managerDeskItemId?: number) => {
    setSelectedTask({ trackerItemId: itemId, managerDeskItemId });
  }, []);

  const handleCreateTask = useCallback(
    (params: { accountId: string; title: string; jiraKey?: string; relatedIssueKeys?: string[]; note?: string }) => {
      if (readOnly) {
        return;
      }
      addTrackerItem.mutate(params);
    },
    [addTrackerItem, readOnly]
  );

  const handleRefresh = useCallback(() => {
    void refetchBoard();
  }, [refetchBoard]);

  useEffect(() => {
    setSelectedTask(null);
  }, [date]);

  const handleMarkInactive = useCallback((day: TrackerDeveloperDay) => {
    setAvailabilityTarget(day);
  }, []);

  const handleConfirmInactive = useCallback((note?: string) => {
    if (!availabilityTarget) {
      return;
    }

    updateAvailability.mutate(
      {
        accountId: availabilityTarget.developer.accountId,
        state: 'inactive',
        note,
      },
      {
        onSuccess: () => {
          setAvailabilityTarget(undefined);
          if (drawerAccountId === availabilityTarget.developer.accountId) {
            setDrawerAccountId(undefined);
          }
        },
      }
    );
  }, [availabilityTarget, drawerAccountId, updateAvailability]);

  const handleReactivate = useCallback((accountId: string) => {
    updateAvailability.mutate({ accountId, state: 'active' });
  }, [updateAvailability]);

  const handleCaptureFollowUp = useCallback((day: TrackerDeveloperDay) => {
    const attentionItem = attentionItems.find((item) => item.developer.accountId === day.developer.accountId);
    setFollowUpTarget({ day, reasons: attentionItem?.reasons ?? [] });
  }, [attentionItems]);

  return {
    drawerAccountId,
    setDrawerAccountId,
    drawerDay,
    selectedTask,
    setSelectedTask,
    availabilityTarget,
    setAvailabilityTarget,
    followUpTarget,
    setFollowUpTarget,
    attentionItems,
    handleSetCurrent,
    handleMarkDone,
    handleDropItem,
    handleOpenTaskDetail,
    handleCreateTask,
    handleRefresh,
    handleMarkInactive,
    handleConfirmInactive,
    handleReactivate,
    handleCaptureFollowUp,
  };
}

export function TeamTrackerPage({
  onViewChange,
  initialDeveloperAccountId,
  initialDeveloperNonce,
  onInitialDeveloperHandled,
  initialBoardQuery,
  urlBoardQuery,
  urlBoardQueryNonce,
  onBoardQueryChange,
}: TeamTrackerPageProps) {
  const { addToast } = useToast();
  const [date, setDate] = useState(getLocalIsoDate);
  const [activeLens, setActiveLens] = useState<TeamTrackerLens>('team');

  // Board query + saved views (extracted hook)
  const qs = useBoardQueryState(addToast, initialBoardQuery);

  useEffect(() => {
    onBoardQueryChange?.(qs.boardQuery);
  }, [onBoardQueryChange, qs.boardQuery]);

  useEffect(() => {
    if (urlBoardQueryNonce !== undefined && urlBoardQueryNonce > 0) {
      qs.replaceQuery(urlBoardQuery ?? {});
    }
  }, [qs.replaceQuery, urlBoardQuery, urlBoardQueryNonce]);

  const {
    data: board,
    isLoading,
    isError,
    error,
    isFetching: isBoardFetching,
    refetch: refetchBoard,
  } = useTeamTracker(date, qs.boardQuery);

  // Feed resolved query back to qs for derived values
  const resolvedQuery = board?.query;

  const { data: issues } = useIssues('all');
  const isToday = date === getLocalIsoDate();
  const nextDate = useMemo(() => shiftLocalIsoDate(date, 1), [date]);

  const addTrackerItem = useAddTrackerItem(date);
  const updateDay = useUpdateDay(date);
  const updateAvailability = useUpdateAvailability(date);
  const setCurrent = useSetCurrentItem(date);
  const updateItem = useUpdateTrackerItem(date);
  const addCheckIn = useAddCheckIn(date);

  const groups = board?.groups ?? [];
  const viewMode = board?.viewMode ?? (isToday ? 'live' : 'history');
  const readOnly = viewMode === 'history';
  const resolvedSummaryFilter = resolvedQuery?.summaryFilter ?? 'all';
  const resolvedSortBy = resolvedQuery?.sortBy ?? 'name';
  const resolvedGroupBy = resolvedQuery?.groupBy ?? 'none';
  const resolvedSearch = resolvedQuery?.q ?? '';
  const isGrouped = resolvedGroupBy !== 'none';

  const isRefreshing = isBoardFetching;
  const workflow = useTeamTrackerWorkflow({
    date,
    board,
    readOnly,
    addToast,
    addTrackerItem,
    updateAvailability,
    setCurrent,
    updateItem,
    refetchBoard,
  });

  useEffect(() => {
    if (initialDeveloperAccountId) {
      workflow.setDrawerAccountId(initialDeveloperAccountId);
      onInitialDeveloperHandled?.();
    }
  }, [initialDeveloperAccountId, initialDeveloperNonce, onInitialDeveloperHandled, workflow.setDrawerAccountId]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="shrink-0 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
            >
              <Calendar size={14} />
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="shrink-0 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Team
              </h1>
              <div className="hidden truncate text-[12px] md:block" style={{ color: 'var(--text-muted)' }}>
                Full roster, current work, and blockers.
              </div>
            </div>
          </div>

          {board && (
            <TeamTrackerViewSwitcher
              activeLens={activeLens}
              onLensChange={setActiveLens}
              teamCount={board.visibleSummary.total}
              inactiveCount={board.inactiveDevelopers.length}
            />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={workflow.handleRefresh}
              disabled={isRefreshing}
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              aria-label="Refresh team tracker"
              title="Refresh team tracker"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <div
              className="flex h-8 items-center gap-0.5 rounded-lg px-1"
              style={{ background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)', border: '1px solid var(--border)' }}
            >
              <button
                onClick={() => setDate(shiftLocalIsoDate(date, -1))}
                className="h-6 w-6 rounded-md flex items-center justify-center transition-colors hover:brightness-125"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Previous day"
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex items-center gap-1.5 px-1.5">
                <Calendar size={12} style={{ color: 'var(--text-muted)' }} />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-[116px] bg-transparent text-[12px] font-mono outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
              </div>
              <button
                onClick={() => setDate(shiftLocalIsoDate(date, 1))}
                disabled={isToday}
                className="h-6 w-6 rounded-md flex items-center justify-center transition-colors hover:brightness-125 disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Next day"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            {!isToday && (
              <button
                onClick={() => setDate(getLocalIsoDate())}
                className="h-8 rounded-lg px-2.5 text-[12px] font-medium"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--accent)',
                  border: '1px solid var(--border)',
                }}
              >
                Today
              </button>
            )}
          </div>
        </div>

        {board && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TrackerSummaryStrip
              summary={board.summary}
              activeFilter={resolvedSummaryFilter}
              onFilterChange={qs.handleSummaryFilterChange}
            />

            <div className="min-w-[280px] flex-1">
              <TrackerBoardToolbar
                searchQuery={resolvedSearch}
                onSearchChange={qs.handleSearchChange}
                sortBy={resolvedSortBy}
                onSortChange={qs.handleSortChange}
                groupBy={resolvedGroupBy}
                onGroupChange={qs.handleGroupChange}
                visibleCount={board.visibleSummary.total}
                totalCount={board.summary.total}
                views={qs.savedViews}
                describe={describeTeamTrackerView}
                activeViewId={qs.activeViewId}
                isDirty={qs.isDirtyFrom(resolvedQuery)}
                isViewsLoading={qs.isViewsLoading}
                onApplyView={qs.handleApplyView}
                onClearView={qs.handleClearView}
                onSaveNew={qs.handleSaveNewView}
                onUpdateView={qs.handleUpdateView}
                onDeleteView={qs.handleDeleteView}
                isSaving={qs.isSaving}
              />
            </div>

            <TeamTrackerModeBanner date={date} viewMode={viewMode} />
          </div>
        )}
      </motion.div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-4">
        {isLoading ? (
          <TeamTrackerSkeleton />
        ) : isError ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--danger)' }}>
                Could not load team tracker
              </div>
              <p className="mt-2 max-w-md text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                {error instanceof Error ? error.message : 'The team tracker query failed.'}
              </p>
              <button
                type="button"
                onClick={() => void refetchBoard()}
                disabled={isBoardFetching}
                className="mt-4 rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {isBoardFetching ? 'Retrying' : 'Retry'}
              </button>
            </div>
          </div>
        ) : board ? (
          <div className="mx-auto max-w-[1600px]">
            {activeLens === 'team' && (
              <TrackerRosterBoard
                date={date}
                developers={board.developers}
                groups={groups}
                isGrouped={isGrouped}
                searchActive={!!resolvedSearch}
                onOpenDrawer={workflow.setDrawerAccountId}
                onOpenTaskDetail={readOnly ? undefined : workflow.handleOpenTaskDetail}
                onCaptureFollowUp={workflow.handleCaptureFollowUp}
                issues={issues}
                attentionItems={workflow.attentionItems}
                attentionSorted={resolvedSortBy === 'attention'}
                readOnly={readOnly}
              />
            )}
            {activeLens === 'inactive' && (
              board.inactiveDevelopers.length > 0 ? (
                <InactiveDeveloperTray
                  items={board.inactiveDevelopers}
                  onReactivate={workflow.handleReactivate}
                  pendingAccountId={updateAvailability.isPending ? updateAvailability.variables?.accountId : undefined}
                  readOnly={readOnly}
                  defaultExpanded
                />
              ) : (
                <EmptyLensState title="No inactive developers." message="Everyone is available in the selected team view." />
              )
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-20">
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No tracker data. Add developers from the settings page first.
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <DeveloperTrackerDrawer
        date={date}
        day={workflow.drawerDay}
        open={!!workflow.drawerAccountId}
        onClose={() => workflow.setDrawerAccountId(undefined)}
        onUpdateDay={(params) => updateDay.mutate(params)}
        onAddItem={workflow.handleCreateTask}
        onOpenTaskDetail={workflow.handleOpenTaskDetail}
        onReorderPlannedItem={(params) => updateItem.mutate(params)}
        onUpdateItemNote={(params) => updateItem.mutate(params)}
        onUpdateItemTitle={(params) => updateItem.mutate(params)}
        onSetCurrent={workflow.handleSetCurrent}
        onMarkDone={workflow.handleMarkDone}
        onDropItem={workflow.handleDropItem}
        onAddCheckIn={(params) => addCheckIn.mutate(params)}
        onMarkInactive={workflow.handleMarkInactive}
        onOpenManagerDesk={onViewChange ? () => onViewChange('desk') : undefined}
        issues={issues}
        isAddItemPending={addTrackerItem.isPending}
        readOnly={readOnly}
      />
      <TrackerTaskDetailDrawer
        trackerItemId={workflow.selectedTask?.trackerItemId ?? null}
        initialManagerDeskItemId={workflow.selectedTask?.managerDeskItemId ?? null}
        backTo={workflow.drawerDay?.developer.displayName}
        onClose={() => workflow.setSelectedTask(null)}
      />
      <AvailabilityDialog
        open={!!workflow.availabilityTarget}
        developerName={workflow.availabilityTarget?.developer.displayName}
        date={date}
        isPending={updateAvailability.isPending && updateAvailability.variables?.state === 'inactive'}
        onClose={() => workflow.setAvailabilityTarget(undefined)}
        onConfirm={workflow.handleConfirmInactive}
      />
      {workflow.followUpTarget && (
        <ManagerDeskCaptureDialog
          onClose={() => workflow.setFollowUpTarget(null)}
          onOpenManagerDesk={onViewChange ? () => onViewChange('desk') : undefined}
          heading={`Follow up with ${workflow.followUpTarget.day.developer.displayName}`}
          description="Capture a manager follow-up linked to this developer."
          initialTitle={`Follow up with ${workflow.followUpTarget.day.developer.displayName}`}
          initialKind="action"
          initialCategory="follow_up"
          initialContextNote={formatTrackerIssueContextNote(workflow.followUpTarget.day.currentItem)}
          initialLinks={[
            { linkType: 'developer', developerAccountId: workflow.followUpTarget.day.developer.accountId },
            ...getTrackerIssueLinks(workflow.followUpTarget.day.currentItem),
          ]}
          contextChips={[
            { label: 'Developer', value: workflow.followUpTarget.day.developer.displayName, tone: 'developer' },
            ...getTrackerIssueContextChips(workflow.followUpTarget.day.currentItem),
            ...workflow.followUpTarget.reasons.map((reason) => ({ label: 'Reason', value: reason.label, tone: 'generic' as const })),
          ]}
          date={date}
        />
      )}
    </div>
  );
}

function mapAttentionCurrentItem(item: TrackerWorkItem): TrackerAttentionActionItem {
  return {
    id: item.id,
    title: item.title,
    jiraKey: item.jiraKey,
    relatedIssueKeys: item.relatedIssueKeys,
    lifecycle: item.lifecycle ?? (item.managerDeskItemId ? 'manager_desk_linked' : 'tracker_only'),
  };
}

function TeamTrackerModeBanner({
  date,
  viewMode,
}: {
  date: string;
  viewMode: 'live' | 'history';
}) {
  if (viewMode === 'live') {
    return null;
  }

  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', background: 'transparent' }}>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <History size={13} style={{ color: 'var(--accent)' }} />
        {date} is a read-only historical snapshot.
      </div>
    </div>
  );
}

function TeamTrackerSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className={`grid gap-3 border-b px-3 py-3 ${ROSTER_GRID}`} style={{ borderColor: 'var(--border)' }}>
          {Array.from({ length: 7 }).map((__, cellIndex) => (
            <div
              key={cellIndex}
              className="h-8 animate-pulse rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 74%, transparent)' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyLensState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-xl border px-4 py-10 text-center" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}>
      <div>
        <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {message}
        </div>
      </div>
    </div>
  );
}
