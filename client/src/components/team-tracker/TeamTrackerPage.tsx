import { lazy, Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, History, Keyboard, RefreshCw } from 'lucide-react';
import { useTeamTracker } from '@/hooks/useTeamTracker';
import { useTaskResolution } from '@/hooks/useTasks';
import { writeDevParam, writeTaskParam } from '@/lib/view-params';
import {
  useUpdateDay,
  useUpdateAvailability,
  useSetCurrentItem,
  useUpdateTrackerItem,
  useAddTrackerItem,
  useAddCheckIn,
  useStatusUpdate,
} from '@/hooks/useTeamTrackerMutations';
import { useBoardQueryState } from '@/hooks/useBoardQueryState';
import { useTeamMode } from '@/hooks/useTeamMode';
import { useToast } from '@/context/ToastContext';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import { TrackerSummaryStrip } from './TrackerSummaryStrip';
import { TrackerBoardToolbar } from './TrackerBoardToolbar';
import { InactiveDeveloperTray } from './InactiveDeveloperTray';
import { RosterSurface, TrackerRosterBoard, rosterGrid } from './TrackerRosterBoard';
import { FOCUS_RING, isEditable } from '@/components/ui/focus';
import { TeamTrackerViewSwitcher, type TeamTrackerLens } from './TeamTrackerViewSwitcher';
import { DeveloperTrackerDrawer } from './DeveloperTrackerDrawer';
import { AvailabilityDialog } from './AvailabilityDialog';
import { TrackerTaskDetailDrawer } from './TrackerTaskDetailDrawer';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { StandupMode } from './StandupMode';
import { OneOnOneSeriesPanel } from './OneOnOneSeriesPanel';
const OneOnOneWorkspace = lazy(() => import('./OneOnOneWorkspace').then((module) => ({ default: module.OneOnOneWorkspace })));
import { useOneOnOneEnabled } from '@/hooks/useOneOnOne';
import type { TeamPanel } from '@/lib/view-params';
import { StatusRationaleDialog } from './StatusRationaleDialog';
import { tasksFromItems } from '@/components/tasks/TaskPicker';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
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
  TeamMode,
  TeamTrackerBoardResponse,
  TrackerAttentionActionItem,
  TrackerDeveloperDay,
  TrackerAttentionReason,
  TrackerWorkItem,
} from '@/types';
import { UNDO_WINDOW_MS } from '@/lib/undo';
import { ShortcutSheet, type ShortcutGroup } from '@/components/ui/ShortcutSheet';

/** docs/56 P1-04: solo has no check-ins, so the drawer's `c` is a note. */
const teamBoardShortcuts = (teamMode: TeamMode): ShortcutGroup[] => [
  { group: 'Board', keys: [['j / k', 'Next / previous person'], ['Enter / o', 'Open their drawer'], ['/', 'Search']] },
  { group: 'Day', keys: [['[ / ]', 'Previous / next day'], ['t', 'Today'], ['?', 'This sheet']] },
  { group: 'In the drawer', keys: [['⇧ s', 'Status'], ['n', 'New task'], ['u', 'Update'], ['c', teamMode === 'solo' ? 'Note' : 'Check-in'], ['Esc', 'Close']] },
];

interface TeamTrackerPageProps {
  onViewChange?: (view: AppView) => void;
  initialDeveloperAccountId?: string;
  initialTrackerItemId?: number;
  initialManagerDeskItemId?: number;
  /** Deep-linked task key (`/team?task=T-5`) — resolved to developer + task drawers. */
  initialTaskKey?: string;
  initialDeveloperNonce?: number;
  onInitialDeveloperHandled?: () => void;
  initialBoardQuery?: TeamTrackerBoardQuery;
  urlBoardQuery?: TeamTrackerBoardQuery;
  urlBoardQueryNonce?: number;
  onBoardQueryChange?: (query: TeamTrackerBoardQuery) => void;
  /** Phase 3 (P3-D5): `/team?mode=standup` — the keyboard-driven standup overlay. */
  standupMode?: boolean;
  onStandupModeChange?: (open: boolean) => void;
  /** docs/48 (OO-D7): `/team?panel=` — the 1:1 overview/workspace panels. */
  oneOnOnePanel?: TeamPanel;
  oneOnOneDeveloperId?: string;
  onOneOnOnePanelChange?: (panel: TeamPanel | undefined, developerAccountId?: string) => void;
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
  const [selectedTask, setSelectedTask] = useState<{ trackerItemId: number | null; managerDeskItemId?: number; taskKey?: string } | null>(null);
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
              duration: UNDO_WINDOW_MS,
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
    setSelectedTask({ trackerItemId: itemId, managerDeskItemId, taskKey: findTrackerItem(itemId)?.taskKey ?? undefined });
  }, [findTrackerItem]);

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
  initialTrackerItemId,
  initialManagerDeskItemId,
  initialTaskKey,
  initialDeveloperNonce,
  onInitialDeveloperHandled,
  initialBoardQuery,
  urlBoardQuery,
  urlBoardQueryNonce,
  onBoardQueryChange,
  standupMode,
  onStandupModeChange,
  oneOnOnePanel,
  oneOnOneDeveloperId,
  onOneOnOnePanelChange,
}: TeamTrackerPageProps) {
  const { addToast } = useToast();
  const tasksPhase3 = useTasksPhase3();
  const oneOnOneEnabled = useOneOnOneEnabled();
  const teamMode = useTeamMode();
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

  const isToday = date === getLocalIsoDate();
  const nextDate = useMemo(() => shiftLocalIsoDate(date, 1), [date]);

  const addTrackerItem = useAddTrackerItem(date);
  const updateDay = useUpdateDay(date);
  const updateAvailability = useUpdateAvailability(date);
  const setCurrent = useSetCurrentItem(date);
  const updateItem = useUpdateTrackerItem(date);
  const addCheckIn = useAddCheckIn(date);
  const statusUpdate = useStatusUpdate(date);
  // P3-D11: roster badge accept → rationale dialog pre-picked to the
  // blocked task that raised the suggestion.
  const [suggestionTarget, setSuggestionTarget] = useState<TrackerDeveloperDay | null>(null);

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
    if (!initialDeveloperAccountId && !initialTrackerItemId) {
      return;
    }
    if (initialDeveloperAccountId) {
      workflow.setDrawerAccountId(initialDeveloperAccountId);
    }
    if (initialTrackerItemId) {
      workflow.setSelectedTask({
        trackerItemId: initialTrackerItemId,
        managerDeskItemId: initialManagerDeskItemId,
        taskKey: initialTaskKey,
      });
    }
    onInitialDeveloperHandled?.();
  }, [
    initialDeveloperAccountId,
    initialTrackerItemId,
    initialManagerDeskItemId,
    initialTaskKey,
    initialDeveloperNonce,
    onInitialDeveloperHandled,
    workflow.setDrawerAccountId,
    workflow.setSelectedTask,
  ]);

  const taskResolution = useTaskResolution(initialTaskKey);
  const handledTaskRef = useRef<string | undefined>();
  useEffect(() => {
    const resolution = taskResolution.data;
    if (!resolution || handledTaskRef.current === `${initialTaskKey}:${initialDeveloperNonce ?? 0}`) {
      return;
    }
    handledTaskRef.current = `${initialTaskKey}:${initialDeveloperNonce ?? 0}`;
    if (resolution.developer) {
      workflow.setDrawerAccountId(resolution.developer.accountId);
    }
    if (resolution.trackerItemId || resolution.managerDeskItemId) {
      workflow.setSelectedTask({
        trackerItemId: resolution.trackerItemId ?? null,
        managerDeskItemId: resolution.managerDeskItemId,
        taskKey: resolution.taskKey,
      });
    }
    onInitialDeveloperHandled?.();
  }, [taskResolution.data, initialTaskKey, initialDeveloperNonce, onInitialDeveloperHandled, workflow.setDrawerAccountId, workflow.setSelectedTask]);

  // A stale ?task= (unknown, deleted, or cross-workspace key) is dropped once
  // resolution settles so the board doesn't keep a dead deep link.
  useEffect(() => {
    if (!initialTaskKey || !taskResolution.isError) {
      return;
    }
    writeTaskParam(undefined);
    addToast(`Task ${initialTaskKey} is not available`, 'error');
    onInitialDeveloperHandled?.();
  }, [initialTaskKey, taskResolution.isError, addToast, onInitialDeveloperHandled]);

  // Mirror the open task drawer into ?task= so deep links stay shareable.
  useEffect(() => {
    writeTaskParam(workflow.selectedTask?.taskKey);
  }, [workflow.selectedTask]);

  // docs/53 F2: mirror the open developer drawer into ?dev= so Today deep
  // links (`/team?dev=<id>`) stay restorable on reload/back. The 1:1 panel
  // owns `dev` while it's open — the drawer mirror stays out of the way.
  useEffect(() => {
    if (!oneOnOnePanel) {
      writeDevParam(workflow.drawerAccountId);
    }
  }, [workflow.drawerAccountId, oneOnOnePanel]);

  // docs/54 K2: the board speaks the shared grammar — j/k move between
  // people, Enter opens, / searches, [ ] t step days, ? shows the sheet.
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLElement | null>(null);
  const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (oneOnOnePanel || standupMode) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (isEditable(target) || target.closest('[role="menu"], [role="dialog"], [data-popover-layer]'))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-roster-row]'));
      const index = rows.findIndex((row) => row === document.activeElement);
      switch (event.key) {
        case 'j':
        case 'k': {
          if (!rows.length) return;
          const next = index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'j' ? 1 : -1)));
          rows[next]?.focus();
          break;
        }
        case 'o':
          if (index < 0) return;
          rows[index]?.click();
          break;
        case '/':
          document.querySelector<HTMLInputElement>('input[aria-label="Search team"]')?.focus();
          break;
        case '[':
          setDate((current) => shiftLocalIsoDate(current, -1));
          break;
        case ']':
          setDate((current) => shiftLocalIsoDate(current, 1));
          break;
        case 't':
          setDate(getLocalIsoDate());
          break;
        case '?':
          setShortcutsAnchor(shortcutsButtonRef.current ?? document.body);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [oneOnOnePanel, standupMode]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="shrink-0 border-b px-4 pb-3 pt-3.5 md:px-6"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto max-w-[1600px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="ui-page-title">
              Team
            </h1>

            {board && (
              <TeamTrackerViewSwitcher
                activeLens={activeLens}
                onLensChange={setActiveLens}
                teamCount={board.visibleSummary.total}
                inactiveCount={board.inactiveDevelopers.length}
              />
            )}

            <TeamTrackerModeBanner date={date} viewMode={viewMode} />

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={workflow.handleRefresh}
                disabled={isRefreshing}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-default ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
                aria-label="Refresh team tracker"
                title={isRefreshing ? 'Refreshing…' : 'Refresh team tracker'}
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
              <BoardDateNav date={date} isToday={isToday} onChange={setDate} />
              <button
                ref={shortcutsButtonRef}
                type="button"
                onClick={(event) => setShortcutsAnchor(event.currentTarget)}
                className={`hidden h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] md:flex ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
                aria-label="Keyboard shortcuts"
                aria-expanded={shortcutsAnchor !== null}
                title="Keyboard shortcuts (?)"
              >
                <Keyboard size={14} />
              </button>
            </div>
            {shortcutsAnchor ? (
              <ShortcutSheet anchor={shortcutsAnchor} groups={teamBoardShortcuts(teamMode)} onClose={() => setShortcutsAnchor(null)} />
            ) : null}
          </div>

          {board && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
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
                  onStartStandup={
                    tasksPhase3 && isToday && !readOnly
                      ? () => onStandupModeChange?.(true)
                      : undefined
                  }
                  rosterEmpty={board.summary.total === 0 && board.inactiveDevelopers.length === 0}
                  onOpenOneOnOnes={
                    oneOnOneEnabled && !readOnly
                      ? () => onOneOnOnePanelChange?.('one-on-ones')
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
      </motion.header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 pt-4 md:px-6">
        {/* docs/48: 1:1 panels take over the board area while their URL
            params are set; the flag gate keeps flag-off URLs inert. */}
        {oneOnOneEnabled && oneOnOnePanel === 'one-on-ones' ? (
          <div className="mx-auto h-full max-w-[1600px]">
            <OneOnOneSeriesPanel
              developers={board?.developers.map((day) => day.developer) ?? []}
              onOpenDeveloper={(accountId) => onOneOnOnePanelChange?.('one-on-one', accountId)}
              onClose={() => onOneOnOnePanelChange?.(undefined)}
            />
          </div>
        ) : oneOnOneEnabled && oneOnOnePanel === 'one-on-one' && oneOnOneDeveloperId ? (
          <div className="mx-auto h-full max-w-[1600px]">
            <Suspense fallback={<div role="status">Loading 1:1 workspace…</div>}>
            <OneOnOneWorkspace
              developerAccountId={oneOnOneDeveloperId}
              onClose={() => onOneOnOnePanelChange?.(undefined)}
              onOpenTask={(taskKey) => workflow.setSelectedTask({ trackerItemId: null, taskKey })}
            />
            </Suspense>
          </div>
        ) : isLoading ? (
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
                className="ui-btn mt-4"
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
                onAcceptSuggestion={
                  tasksPhase3 && !readOnly
                    ? (day) => setSuggestionTarget(day)
                    : undefined
                }
                attentionItems={workflow.attentionItems}
                attentionSorted={resolvedSortBy === 'attention'}
                readOnly={readOnly}
                rosterEmpty={board.summary.total === 0 && board.inactiveDevelopers.length === 0}
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

      {/* Phase 3 (P3-D5/D6): keyboard-driven standup overlay. */}
      {standupMode && tasksPhase3 && board && !readOnly && (
        <StandupMode
          date={date}
          board={board}
          onClose={() => onStandupModeChange?.(false)}
          onOpenTask={(taskKey) => workflow.setSelectedTask({ trackerItemId: null, taskKey })}
          suspended={Boolean(workflow.selectedTask) || Boolean(workflow.drawerAccountId)}
        />
      )}
      {/* P3-D11: accepting a roster suggestion opens the shared rationale
          dialog with the blocked task pre-picked; the submit posts the
          person status + taskKey (server writes the blocker event). */}
      {suggestionTarget?.statusSuggestion && (
        <StatusRationaleDialog
          status={suggestionTarget.statusSuggestion.status}
          developerName={suggestionTarget.developer.displayName}
          developerParticipates={suggestionTarget.participates}
          tasks={
            suggestionTarget.tasks?.length
              ? suggestionTarget.tasks.map((task) => ({ taskKey: task.taskKey, title: task.title }))
              : tasksFromItems(
                  suggestionTarget.currentItem ? [suggestionTarget.currentItem] : [],
                  suggestionTarget.plannedItems,
                )
          }
          initialSelectedKeys={[suggestionTarget.statusSuggestion.reasonTaskKey]}
          isPending={statusUpdate.isPending}
          error={statusUpdate.error?.message}
          onClose={() => {
            if (!statusUpdate.isPending) {
              statusUpdate.reset();
              setSuggestionTarget(null);
            }
          }}
          onSubmit={({ rationale, taskKey, nextFollowUpAt, visibility }) =>
            statusUpdate.mutate(
              {
                accountId: suggestionTarget.developer.accountId,
                status: 'blocked',
                rationale,
                // A private update cannot be linked to a task (the blocker event would be shared).
                taskKey: visibility === 'private' ? undefined : taskKey ?? suggestionTarget.statusSuggestion!.reasonTaskKey,
                nextFollowUpAt,
                visibility,
              },
              { onSuccess: () => setSuggestionTarget(null) },
            )
          }
        />
      )}
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
        onUpdateItemTitle={(params) => updateItem.mutate(params)}
        onSetCurrent={workflow.handleSetCurrent}
        onMarkDone={workflow.handleMarkDone}
        onDropItem={workflow.handleDropItem}
        onAddCheckIn={(params) => addCheckIn.mutate(params)}
        onMarkInactive={workflow.handleMarkInactive}
        onOpenManagerDesk={onViewChange ? () => onViewChange('desk') : undefined}
        onOpenOneOnOne={oneOnOneEnabled ? (accountId) => onOneOnOnePanelChange?.('one-on-one', accountId) : undefined}
        isAddItemPending={addTrackerItem.isPending}
        readOnly={readOnly}
      />
      {/* Phase 3 (P3-D2): the shared TaskDrawer replaces the tracker detail drawer. */}
      {tasksPhase3 && workflow.selectedTask?.taskKey ? (
        <TaskDrawer
          taskKey={workflow.selectedTask.taskKey}
          stacked={Boolean(workflow.drawerAccountId) || Boolean(standupMode)}
          onClose={() => workflow.setSelectedTask(null)}
          onNavigateTask={(key) => workflow.setSelectedTask({ trackerItemId: null, taskKey: key })}
        />
      ) : (
        <TrackerTaskDetailDrawer
          trackerItemId={workflow.selectedTask?.trackerItemId ?? null}
          initialManagerDeskItemId={workflow.selectedTask?.managerDeskItemId ?? null}
          backTo={workflow.drawerDay?.developer.displayName}
          onClose={() => workflow.setSelectedTask(null)}
        />
      )}
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
    <span
      role="status"
      className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
      style={{
        color: 'var(--warning)',
        background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 24%, transparent)',
      }}
    >
      <History size={12} aria-hidden="true" />
      {date} is a read-only historical snapshot.
    </span>
  );
}

function formatBoardDate(date: string, today: string) {
  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime())) return date;
  const now = parseISO(today);
  const diff = differenceInCalendarDays(parsed, now);
  const sameYear = parsed.getFullYear() === now.getFullYear();
  if (diff === 0) return `Today · ${format(parsed, 'MMM d')}`;
  if (diff === -1) return `Yesterday · ${format(parsed, 'MMM d')}`;
  return format(parsed, sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
}

/**
 * ‹ Today · Sep 28 › — the label opens the native picker; the input stays in
 * the DOM as the source of truth for the value.
 */
function BoardDateNav({ date, isToday, onChange }: { date: string; isToday: boolean; onChange: (date: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = formatBoardDate(date, getLocalIsoDate());

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      // showPicker throws without a user gesture or in unsupported contexts.
    }
    input.focus();
  };

  const stepClass = `flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30 ${FOCUS_RING}`;

  return (
    <div className="flex items-center gap-1.5">
      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(getLocalIsoDate())}
          className={`h-8 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--accent)' }}
        >
          Today
        </button>
      )}
      <div
        className="flex h-8 items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)' }}
      >
        <button
          type="button"
          onClick={() => onChange(shiftLocalIsoDate(date, -1))}
          className={stepClass}
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Previous day"
          title="Previous day"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={openPicker}
            className={`flex h-7 min-w-[112px] items-center justify-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium tabular-nums transition-colors hover:bg-[var(--bg-elevated)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-primary)' }}
            aria-label={`Choose date, ${label}`}
            title="Choose date"
          >
            <Calendar size={12} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            {label}
          </button>
          <input
            ref={inputRef}
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
            tabIndex={-1}
            aria-label="Board date"
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(shiftLocalIsoDate(date, 1))}
          disabled={isToday}
          className={stepClass}
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Next day"
          title="Next day"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function Bone({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded ${className}`} style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)' }} />;
}

function TeamTrackerSkeleton() {
  const teamMode = useTeamMode();
  return (
    <div className="mx-auto max-w-[1600px]" aria-busy="true" aria-label="Loading team">
      <RosterSurface>
        <div className="hidden h-[34px] md:block" style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }} />
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className={`grid items-center gap-3 border-t px-4 py-2.5 md:min-h-[60px] ${rosterGrid(teamMode === 'solo')}`}
            style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}
          >
            <div className="flex items-center gap-3">
              <Bone className="h-[30px] w-[30px] shrink-0 !rounded-full" />
              <div className="space-y-1.5">
                <Bone className="h-3 w-28" />
                <Bone className="h-2.5 w-14" />
              </div>
            </div>
            <div className="space-y-1.5 max-md:col-span-2">
              <Bone className="h-3 w-3/4" />
              <Bone className="h-2.5 w-1/3" />
            </div>
            <Bone className="h-3 w-2/3 max-md:hidden" />
            <Bone className="h-3 w-10 max-md:hidden" />
            <Bone className="h-3 w-12 max-md:hidden" />
            <Bone className="h-3 w-20 max-md:hidden" />
            <span />
          </div>
        ))}
      </RosterSurface>
    </div>
  );
}

function EmptyLensState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-10 text-center" style={{ borderColor: 'var(--border)' }}>
      <div className="text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
        {message}
      </div>
    </div>
  );
}
