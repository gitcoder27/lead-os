import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { addDays, format, isToday, parseISO, subDays } from 'date-fns';
import { Briefcase, CalendarClock, History } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  useCancelDelegatedManagerDeskTask,
  useCarryForwardManagerDesk,
  useCreateManagerDeskItem,
  useDeleteManagerDeskItem,
  useManagerDesk,
  useUpdateManagerDeskItem,
} from '@/hooks/useManagerDesk';
import { useTaskResolution } from '@/hooks/useTasks';
import { writeTaskParam } from '@/lib/view-params';
import type { ManagerDeskItem, ManagerDeskViewMode } from '@/types/manager-desk';
import { EmptyDay } from './EmptyDay';
import { ItemDetailDrawer } from './ItemDetailDrawer';
import { RescheduleItemDialog } from './RescheduleItemDialog';
import { ManagerDeskCommandBar } from './ManagerDeskCommandBar';
import { ManagerDeskHeader } from './ManagerDeskHeader';
import { ManagerDeskWorkspace } from './ManagerDeskWorkspace';
import { UnifiedDeskList } from './UnifiedDeskList';
import { MANAGER_DESK_CARD_LAYOUT_TRANSITION } from './motion';
import {
  filterItems,
  getContinuedOpenItems,
  sortForWorkbench,
  type ManagerDeskFilterState,
  type ManagerDeskQuickFilter,
} from './workbench-utils';

const defaultFilters: ManagerDeskFilterState = { kind: null, category: null, status: null };

type HistorySubview = 'snapshot' | 'created';
const getDefaultQuickFilter = (): ManagerDeskQuickFilter => 'all';

interface ManagerDeskPageProps {
  initialItemId?: number;
  initialDate?: string;
  /** Deep-linked task key (`/desk?task=T-5`) — resolved to the desk item. */
  initialTaskKey?: string;
  initialItemNonce?: number;
  onInitialItemHandled?: () => void;
  onDateChange?: (date: string) => void;
}

export function ManagerDeskPage({
  initialItemId,
  initialDate,
  initialTaskKey,
  initialItemNonce,
  onInitialItemHandled,
  onDateChange,
}: ManagerDeskPageProps = {}) {
  const { addToast } = useToast();
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [filters, setFilters] = useState<ManagerDeskFilterState>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<ManagerDeskQuickFilter>('all');
  const [historySubview, setHistorySubview] = useState<HistorySubview>('snapshot');

  const { data: day, isLoading, isFetching, error, refetch } = useManagerDesk(date);
  const createItem = useCreateManagerDeskItem(date);
  const updateItem = useUpdateManagerDeskItem(date);
  const deleteItem = useDeleteManagerDeskItem(date);
  const cancelDelegated = useCancelDelegatedManagerDeskTask(date);
  const carryForward = useCarryForwardManagerDesk(date);
  const [rescheduleItem, setRescheduleItem] = useState<ManagerDeskItem | null>(null);

  const viewMode = day?.viewMode ?? 'live';
  const readOnly = viewMode === 'history';

  useEffect(() => {
    setHistorySubview('snapshot');
    setSearchQuery('');
    setFilters(defaultFilters);
    setQuickFilter(getDefaultQuickFilter());
  }, [date, viewMode]);

  const sourceItems = useMemo(() => {
    if (viewMode === 'history' && historySubview === 'created') {
      return day?.createdThatDayItems ?? [];
    }
    return day?.items ?? [];
  }, [day?.createdThatDayItems, day?.items, historySubview, viewMode]);

  const filteredItems = useMemo(
    () => filterItems(sourceItems, searchQuery, quickFilter, filters, date),
    [sourceItems, searchQuery, quickFilter, filters, date],
  );
  const listItems = useMemo(() => sortForWorkbench(filteredItems), [filteredItems]);
  const pulseItems = useMemo(
    () => sortForWorkbench(filterItems(sourceItems, searchQuery, getDefaultQuickFilter(), filters, date)),
    [filters, searchQuery, sourceItems, date],
  );
  const continuedOpenItems = useMemo(() => getContinuedOpenItems(sourceItems, date), [date, sourceItems]);
  const selectedItem = useMemo(
    () => sourceItems.find((item) => item.id === selectedItemId) ?? null,
    [sourceItems, selectedItemId],
  );

  useEffect(() => {
    if (selectedItemId !== null && !sourceItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [sourceItems, selectedItemId]);

  useEffect(() => {
    if (initialDate) {
      setDate(initialDate);
    }
  }, [initialDate, initialItemNonce]);

  useEffect(() => {
    if (initialItemId && sourceItems.some((item) => item.id === initialItemId)) {
      setSelectedItemId(initialItemId);
      onInitialItemHandled?.();
    }
  }, [initialItemId, initialItemNonce, onInitialItemHandled, sourceItems]);

  const taskResolution = useTaskResolution(initialTaskKey);
  const handledTaskRef = useRef<string | undefined>();
  useEffect(() => {
    const resolution = taskResolution.data;
    const handleKey = `${initialTaskKey}:${initialItemNonce ?? 0}`;
    if (!resolution || handledTaskRef.current === handleKey) {
      return;
    }
    handledTaskRef.current = handleKey;
    if (resolution.managerDeskItemId) {
      if (resolution.date) {
        setDate(resolution.date);
      }
      setSelectedItemId(resolution.managerDeskItemId);
    }
    onInitialItemHandled?.();
  }, [taskResolution.data, initialTaskKey, initialItemNonce, onInitialItemHandled]);

  // A stale ?task= (unknown, deleted, or cross-workspace key) is dropped once
  // resolution settles so the desk doesn't keep a dead deep link.
  useEffect(() => {
    if (!initialTaskKey || !taskResolution.isError) {
      return;
    }
    writeTaskParam(undefined);
    addToast(`Task ${initialTaskKey} is not available`, 'error');
    onInitialItemHandled?.();
  }, [initialTaskKey, taskResolution.isError, addToast, onInitialItemHandled]);

  // Mirror the open drawer into ?task= so task deep links stay shareable.
  useEffect(() => {
    writeTaskParam(selectedItem?.taskKey ?? undefined);
  }, [selectedItem]);

  useEffect(() => {
    onDateChange?.(date);
  }, [date, onDateChange]);

  const goToday = useCallback(() => setDate(format(new Date(), 'yyyy-MM-dd')), []);
  const goPrev = useCallback(() => setDate((value) => format(subDays(parseISO(value), 1), 'yyyy-MM-dd')), []);
  const goNext = useCallback(() => setDate((value) => format(addDays(parseISO(value), 1), 'yyyy-MM-dd')), []);

  const resetDeskView = useCallback(() => {
    setSearchQuery('');
    setFilters(defaultFilters);
    setQuickFilter(getDefaultQuickFilter());
  }, []);

  const handleShowCarried = useCallback(() => {
    setQuickFilter('carried');
  }, []);

  const handleSelectItem = useCallback((item: ManagerDeskItem) => {
    setSelectedItemId(item.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItemId(null);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const handleQuickCapture = useCallback(
    (title: string, kind?: ManagerDeskItem['kind'], category?: ManagerDeskItem['category']) => {
      if (readOnly) {
        addToast('Historical views are read-only. Switch to today or a future date to add work.', 'info');
        return;
      }

      createItem.mutate(
        { date, title, kind, category },
        {
          onSuccess: () => {
            addToast(viewMode === 'planning' ? 'Planned item added' : 'Captured to triage', 'success');
          },
          onError: (err) => addToast(err.message, 'error'),
        },
      );
    },
    [addToast, createItem, date, readOnly, viewMode],
  );

  const handleUpdateItem = useCallback(
    (itemId: number, updates: Record<string, unknown>) => {
      if (readOnly) {
        addToast('Historical snapshots are read-only.', 'info');
        return;
      }

      updateItem.mutate(
        { itemId, ...updates } as Parameters<typeof updateItem.mutate>[0],
        { onError: (err) => addToast(err.message, 'error') },
      );
    },
    [addToast, readOnly, updateItem],
  );

  const handleDeleteItem = useCallback(
    (itemId: number) => {
      if (readOnly) {
        addToast('Historical snapshots are read-only.', 'info');
        return;
      }

      deleteItem.mutate(itemId, {
        onSuccess: () => {
          addToast('Item removed from desk', 'success');
          setSelectedItemId((current) => (current === itemId ? null : current));
        },
        onError: (err) => addToast(err.message, 'error'),
      });
    },
    [addToast, deleteItem, readOnly],
  );

  const handleCancelDelegatedTask = useCallback(
    (itemId: number) => {
      if (readOnly) {
        addToast('Historical snapshots are read-only.', 'info');
        return;
      }

      cancelDelegated.mutate(itemId, {
        onSuccess: () => {
          addToast('Delegated task cancelled', 'success');
        },
        onError: (err) => addToast(err.message, 'error'),
      });
    },
    [addToast, cancelDelegated, readOnly],
  );

  const handleOpenReschedule = useCallback(() => {
    if (selectedItem) {
      setRescheduleItem(selectedItem);
    }
  }, [selectedItem]);

  const handleConfirmReschedule = useCallback(
    (toDate: string) => {
      if (!rescheduleItem) return;
      carryForward.mutate(
        { fromDate: rescheduleItem.originDate, toDate, itemIds: [rescheduleItem.id] },
        {
          onSuccess: (result) => {
            setRescheduleItem(null);
            if (result.created > 0) {
              addToast(`Moved to ${format(parseISO(toDate), 'EEE, MMM d')}`, 'success');
            } else {
              addToast('Item could not be moved to that date', 'info');
            }
          },
          onError: (err) => addToast(err.message, 'error'),
        },
      );
    },
    [addToast, carryForward, rescheduleItem],
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="md-glass-panel w-full max-w-md rounded-xl p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(239,68,68,0.12)' }}>
            <Briefcase size={18} style={{ color: 'var(--danger)' }} />
          </div>
          <h2 className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Failed to load Manager Desk
          </h2>
          <p className="mt-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            {(error as Error).message}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-lg px-4 py-1.5 text-[13px] font-semibold"
            style={{ background: 'var(--md-accent)', color: '#000' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const dateObj = parseISO(date);
  const displayDate = format(dateObj, 'EEEE, MMMM d, yyyy');
  const hasStructuredFilters = filters.kind !== null || filters.category !== null || filters.status !== null;
  const hasAnyNarrowing = searchQuery.trim().length > 0 || quickFilter !== getDefaultQuickFilter() || hasStructuredFilters;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ManagerDeskHeader
        displayDate={displayDate}
        isTodayDate={isToday(dateObj)}
        isFetching={isFetching}
        viewMode={viewMode}
        commandBar={
          <ManagerDeskCommandBar
            items={sourceItems}
            viewDate={date}
            searchQuery={searchQuery}
            quickFilter={quickFilter}
            defaultQuickFilter={getDefaultQuickFilter()}
            filters={filters}
            showFilters={showFilters}
            isCreatePending={createItem.isPending}
            variant="inline"
            captureDisabled={readOnly}
            captureDisabledLabel="Historical views are review-only. Open today or a future date to add work."
            onSearchChange={setSearchQuery}
            onQuickFilterChange={setQuickFilter}
            onToggleFilters={() => setShowFilters((current) => !current)}
            onClearSearch={() => setSearchQuery('')}
            onClearFilters={() => setFilters(defaultFilters)}
            onResetView={resetDeskView}
            onChangeFilters={setFilters}
            onCapture={handleQuickCapture}
          />
        }
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onRefresh={() => void refetch()}
      />

      {viewMode !== 'live' && (
        <ManagerDeskWorkspace className="pt-2">
          <ViewModeBanner
            date={date}
            viewMode={viewMode}
            historySubview={historySubview}
            createdThatDayCount={day?.createdThatDayItems?.length ?? 0}
            onChangeHistorySubview={setHistorySubview}
          />
        </ManagerDeskWorkspace>
      )}

      <ManagerDeskWorkspace className="min-h-0 flex-1 overflow-hidden py-1.5">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div
              className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: 'var(--md-accent)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            <MotionConfig reducedMotion="user">
              {(sourceItems.length ?? 0) === 0 && !hasAnyNarrowing ? (
                <EmptyDay date={displayDate} viewMode={viewMode} />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={MANAGER_DESK_CARD_LAYOUT_TRANSITION}
                  className="h-full"
                >
                  <UnifiedDeskList
                    items={listItems}
                    pulseItems={pulseItems}
                    continuedOpenCount={continuedOpenItems.length}
                    quickFilter={quickFilter}
                    selectedItemId={selectedItemId}
                    readOnly={readOnly}
                    viewMode={viewMode}
                    viewDate={date}
                    onSelect={handleSelectItem}
                    onStatusChange={readOnly ? undefined : (itemId, status) => handleUpdateItem(itemId, { status })}
                    onShowCarried={handleShowCarried}
                  />
                </motion.div>
              )}
            </MotionConfig>
          </div>
        )}
      </ManagerDeskWorkspace>

      <ItemDetailDrawer
        item={selectedItem}
        open={selectedItem !== null}
        date={date}
        readOnly={readOnly}
        onClose={handleCloseDetail}
        onUpdate={handleUpdateItem}
        onDelete={handleDeleteItem}
        onCancelDelegatedTask={handleCancelDelegatedTask}
        isCancelDelegatedPending={cancelDelegated.isPending}
        onCarryForward={readOnly ? undefined : handleOpenReschedule}
        isCarryForwardPending={carryForward.isPending}
        topSlot={<DrawerModeNote viewMode={viewMode} date={date} />}
      />

      {rescheduleItem && (
        <RescheduleItemDialog
          item={rescheduleItem}
          isPending={carryForward.isPending}
          onConfirm={handleConfirmReschedule}
          onClose={() => setRescheduleItem(null)}
        />
      )}
    </div>
  );
}

function ViewModeBanner({
  date,
  viewMode,
  historySubview,
  createdThatDayCount,
  onChangeHistorySubview,
}: {
  date: string;
  viewMode: ManagerDeskViewMode;
  historySubview: HistorySubview;
  createdThatDayCount: number;
  onChangeHistorySubview: (value: HistorySubview) => void;
}) {
  if (viewMode === 'live') {
    return (
      <div className="md-glass-panel rounded-xl px-3 py-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        Open manager work stays on this desk until you complete it or drop it. A new day changes the lens, not the task’s existence.
      </div>
    );
  }

  if (viewMode === 'planning') {
    return (
      <div className="md-glass-panel rounded-xl px-3 py-2">
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          <CalendarClock size={13} style={{ color: 'var(--accent)' }} />
          Future dates use a lighter scheduling view. Only work explicitly relevant to {date} is shown here.
        </div>
      </div>
    );
  }

  return (
    <div className="md-glass-panel rounded-xl px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          <History size={13} style={{ color: 'var(--info)' }} />
          Past dates show a review-focused snapshot. This view is read-only.
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          <HistoryToggleButton
            active={historySubview === 'snapshot'}
            label="End of Day"
            onClick={() => onChangeHistorySubview('snapshot')}
          />
          <HistoryToggleButton
            active={historySubview === 'created'}
            label={`Captured (${createdThatDayCount})`}
            onClick={() => onChangeHistorySubview('created')}
          />
        </div>
      </div>
    </div>
  );
}

function HistoryToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={{
        background: active ? 'var(--md-accent-glow)' : 'transparent',
        color: active ? 'var(--md-accent)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}

function DrawerModeNote({ viewMode, date }: { viewMode: ManagerDeskViewMode; date: string }) {
  if (viewMode === 'live') {
    return null;
  }

  return (
    <div
      className="mx-5 mt-4 rounded-xl border px-3 py-2 text-[12px]"
      style={{
        borderColor: viewMode === 'history' ? 'rgba(59,130,246,0.18)' : 'rgba(6,182,212,0.18)',
        background: viewMode === 'history' ? 'rgba(59,130,246,0.06)' : 'rgba(6,182,212,0.06)',
        color: 'var(--text-secondary)',
      }}
    >
      {viewMode === 'history'
        ? `Reviewing the ${date} snapshot. Changes are disabled here so the historical record stays easy to inspect.`
        : `Planning view for ${date}. Edit details here to schedule work without cluttering the future with the full live desk.`}
    </div>
  );
}
