import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleCheck, ListTodo, LogOut, Radio, ScrollText, Target, CircleX } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { useMyDay } from '@/hooks/useMyDay';
import { useTaskResolution } from '@/hooks/useTasks';
import { usePrefetchTaskDetail } from '@/hooks/useTaskDetail';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import { taskKeyFromParams, writeTaskParam } from '@/lib/view-params';
import { TaskDrawer, navigateToTaskPage } from '@/components/tasks/TaskDrawer';
import { tasksFromItems } from '@/components/tasks/TaskPicker';
import { formatCompactRelative } from '@/components/team-tracker/trackerItemFormat';
import type { MyDayReadOnlyReason, MyDayResponse } from '@/types';
import { useMyDayHandlers } from './useMyDayHandlers';
import { useMyDayShortcuts } from './useMyDayShortcuts';
import { MyDayHeader } from './MyDayHeader';
import { TaskInboxPopover } from '@/components/actions/TaskInboxPopover';
import { MyDayInactiveBanner, MyDayReadOnlyBanner } from './MyDayInactiveBanner';
import { StatusSelector } from './StatusSelector';
import { QuickUpdates } from './QuickUpdates';
import { CurrentTask } from './CurrentTask';
import { PlannedQueue } from './PlannedQueue';
import { AddTaskForm } from './AddTaskForm';
import { FinishedWork } from './FinishedWork';
import { RecentActivity } from './RecentActivity';
import { HAIRLINE, Kbd, MyDaySection, pageVariants, sectionVariants, surfaceStyle } from './MyDayUI';
import { FOCUS_RING } from '@/components/ui/focus';
import { MyDayTaskDetailContext, type MyDayTaskDetailActions } from './MyDayTaskDetailContext';
import { ShortcutSheet, type ShortcutGroup } from '@/components/ui/ShortcutSheet';

// docs/54 K2: My Day's full map, in the shared sheet format.
const MY_DAY_SHORTCUTS: ShortcutGroup[] = [
  { group: 'Work', keys: [['n', 'New task'], ['c / u', 'Check in']] },
  { group: 'Day', keys: [['[ / ]', 'Previous / next day'], ['t', 'Today'], ['?', 'This sheet']] },
];

function readOnlyReasonFor(day: MyDayResponse | undefined): MyDayReadOnlyReason | undefined {
  if (!day) return undefined;
  if (day.readOnlyReason) return day.readOnlyReason;
  if (day.viewMode === 'history') return 'history';
  if (day.viewMode === 'planning') return 'future';
  return undefined;
}

/**
 * The developer's side of the dev ↔ lead link. Reads top to bottom as the
 * day itself: how it's going, what you're on, what's next, what's done —
 * with the running log beside it. Everything here lands on the lead's board.
 */
export function MyDayPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const [date, setDate] = useState(() => getLocalIsoDate());
  const [deepLinkTaskKey] = useState(() => taskKeyFromParams(new URLSearchParams(window.location.search)));
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  // The shared task drawer (developer mode): title, status, details, links and
  // the full timeline. Mirrored to `?task=` so a refresh reopens it.
  const [openTaskKey, setOpenTaskKey] = useState<string | null>(null);
  const prefetchTaskDetail = usePrefetchTaskDetail();
  const openTask = useCallback((taskKey: string) => {
    setOpenTaskKey(taskKey);
    writeTaskParam(taskKey);
  }, []);
  const closeTask = useCallback(() => {
    setOpenTaskKey(null);
    writeTaskParam(undefined);
  }, []);
  const taskDetailActions = useMemo<MyDayTaskDetailActions>(
    () => ({ openTask, prefetchTask: prefetchTaskDetail }),
    [openTask, prefetchTaskDetail],
  );
  // Background polling refetches every 30s; only a manual refresh spins the icon.
  const [refreshing, setRefreshing] = useState(false);
  const quickUpdateRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: day, isLoading, error, refetch } = useMyDay(date);
  const isReadOnly = Boolean(
    day && (day.viewMode !== 'live' || day.readOnlyReason || day.isReadOnly)
  );

  const {
    handleStatusUpdate,
    handleMarkDone,
    handleDrop,
    handleReopen,
    handleSetCurrent,
    handleReorder,
    handleUpdateItemTitle,
    handleAddItem,
    handleAddCheckIn,
    updateStatusPending,
    addItemPending,
    addCheckInPending,
  } = useMyDayHandlers(date, isReadOnly, day);

  const goToday = () => setDate(getLocalIsoDate());
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLElement | null>(null);

  useMyDayShortcuts({
    onFocusUpdate: isReadOnly ? undefined : () => quickUpdateRef.current?.focus(),
    onAddTask: isReadOnly ? undefined : () => setAddTaskOpen(true),
    onPrevDay: () => setDate((d) => shiftLocalIsoDate(d, -1)),
    onNextDay: () => setDate((d) => shiftLocalIsoDate(d, 1)),
    onToday: goToday,
    onShowShortcuts: () => setShortcutsAnchor(document.querySelector<HTMLElement>('[data-my-day-shortcuts]') ?? document.body),
  });

  useEffect(() => setAddTaskOpen(false), [date]);

  // /my-day?task=T-n deep link: resolve ownership, move to the task's date,
  // then scroll to and highlight its row. Unknown/non-owned keys 404.
  const taskResolution = useTaskResolution(deepLinkTaskKey, { role: 'developer' });
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) {
      return;
    }
    if (taskResolution.isError) {
      deepLinkHandledRef.current = true;
      writeTaskParam(undefined);
      addToast('That task is not available here', 'error');
      return;
    }
    const resolution = taskResolution.data;
    if (!resolution) {
      return;
    }
    // Phase 3 (P3-D15): a former owner resolving a deep link gets the
    // restricted read-only task page instead of a My Day row.
    if ('access' in resolution && resolution.access === 'former-owner') {
      deepLinkHandledRef.current = true;
      writeTaskParam(undefined);
      navigateToTaskPage(resolution.taskKey);
      return;
    }
    if (resolution.date && resolution.date !== date) {
      setDate(resolution.date);
      return;
    }
    if (!day) {
      return;
    }
    const row = document.querySelector(`[data-task-key="${resolution.taskKey}"]`);
    if (!row) {
      return;
    }
    deepLinkHandledRef.current = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('task-row-deep-link');
    window.setTimeout(() => row.classList.remove('task-row-deep-link'), 2400);
    openTask(resolution.taskKey);
  }, [taskResolution.data, taskResolution.isError, day, date, addToast, openTask]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading) {
    return <MyDaySkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4" style={{ background: 'var(--bg-canvas)' }}>
        <div className="w-full max-w-sm rounded-2xl p-7 text-center" style={{ ...surfaceStyle, boxShadow: 'var(--panel-shadow)' }}>
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>
            <CircleX size={22} />
          </div>
          <h2 className="mb-1.5 text-[16px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>Couldn’t load your day</h2>
          <p className="mb-6 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => refetch()}
              className="rounded-xl px-4 py-2.5 text-[13px] font-semibold"
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
            >
              Try again
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => { window.history.pushState(null, '', '/'); window.location.reload(); }}
                className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-medium"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Today
              </button>
              <button
                onClick={async () => { await logout(); window.location.reload(); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium"
                style={{ color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 24%, transparent)' }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isToday = date === getLocalIsoDate();
  const plannedItems = day?.plannedItems ?? [];
  const completedItems = day?.completedItems ?? [];
  const droppedItems = day?.droppedItems ?? [];
  const checkIns = day?.checkIns ?? [];
  const readOnlyReason = readOnlyReasonFor(day);
  const isInactive = day?.availability.state === 'inactive';
  const nudge = Boolean(day?.isStale) && !isReadOnly;
  // J/K in the drawer steps through the page in reading order.
  const orderedTaskKeys = [day?.currentItem, ...plannedItems, ...completedItems, ...droppedItems]
    .map((item) => item?.taskKey)
    .filter((key): key is string => Boolean(key));

  return (
    <>
      <MyDayTaskDetailContext.Provider value={taskDetailActions}>
      <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-canvas)' }}>
        <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 sm:px-6 md:pt-10 lg:px-10">
          <MyDayHeader
            inbox={<TaskInboxPopover />}
            date={date}
            setDate={setDate}
            user={user}
            day={day}
            isFetching={refreshing}
            theme={theme}
            onRefresh={handleRefresh}
            onToggleTheme={toggleTheme}
            onLogout={logout}
            onJumpToCheckIn={() => {
              document.getElementById('my-day-check-in')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              if (!isReadOnly) window.setTimeout(() => quickUpdateRef.current?.focus({ preventScroll: true }), 350);
            }}
          />

          <motion.div
            key={date}
            variants={pageVariants}
            initial="hidden"
            animate="visible"
            className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_344px]"
          >
            {/* Main column: the developer's to-do list for the day. */}
            <div className="flex min-w-0 flex-col gap-8">
              {(isInactive || readOnlyReason === 'history' || readOnlyReason === 'future') && (
                <motion.div variants={sectionVariants} className="flex flex-col gap-2">
                  {day && <MyDayInactiveBanner availability={day.availability} />}
                  {!isInactive && <MyDayReadOnlyBanner reason={readOnlyReason} onToday={goToday} />}
                </motion.div>
              )}

              <MyDaySection id="now" icon={<Target size={14} />} title="Now" readOnly={isReadOnly}>
                <CurrentTask
                  viewDate={date}
                  item={day?.currentItem}
                  nextItem={plannedItems[0]}
                  onMarkDone={handleMarkDone}
                  onDrop={handleDrop}
                  onUpdateTitle={handleUpdateItemTitle}
                  onSetCurrent={handleSetCurrent}
                  onAddTask={() => setAddTaskOpen(true)}
                  readOnly={isReadOnly}
                />
              </MyDaySection>

              <MyDaySection
                id="up-next"
                icon={<ListTodo size={14} />}
                title="Up next"
                count={plannedItems.length}
                hint={!isReadOnly && plannedItems.length > 1 ? 'Drag to reorder' : undefined}
                readOnly={isReadOnly}
              >
                <div className="overflow-hidden rounded-2xl" style={surfaceStyle}>
                  <PlannedQueue
                    viewDate={date}
                    items={plannedItems}
                    onSetCurrent={handleSetCurrent}
                    onMarkDone={handleMarkDone}
                    onDrop={handleDrop}
                    onReorder={handleReorder}
                    onUpdateTitle={handleUpdateItemTitle}
                    readOnly={isReadOnly}
                    footer={
                      isReadOnly ? undefined : (
                        <AddTaskForm
                          onAdd={handleAddItem}
                          isPending={addItemPending}
                          open={addTaskOpen}
                          onOpenChange={setAddTaskOpen}
                        />
                      )
                    }
                  />
                </div>
              </MyDaySection>

              {completedItems.length + droppedItems.length > 0 && (
                <MyDaySection
                  id="done"
                  icon={<CircleCheck size={14} />}
                  title={isToday ? 'Done today' : 'Done'}
                  count={completedItems.length}
                  hint={droppedItems.length > 0 ? `· ${droppedItems.length} dropped` : undefined}
                >
                  <div className="overflow-hidden rounded-2xl" style={surfaceStyle}>
                    <FinishedWork
                      viewDate={date}
                      completedItems={completedItems}
                      droppedItems={droppedItems}
                      onReopen={handleReopen}
                      readOnly={isReadOnly}
                    />
                  </div>
                </MyDaySection>
              )}
            </div>

            {/* Side column: an optional line to the lead, and the day's log. */}
            <aside className="flex min-w-0 flex-col gap-7 lg:sticky lg:top-6 lg:-mx-1 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:px-1 lg:pb-4">
              <MyDaySection
                id="check-in"
                icon={<Radio size={14} />}
                title="Check in"
                hint={
                  nudge ? (
                    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--warning)' }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warning)' }} aria-hidden="true" />
                      Due for an update
                    </span>
                  ) : (
                    'Optional'
                  )
                }
                action={
                  day?.lastCheckInAt ? (
                    <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }} title="Last check-in">
                      {formatCompactRelative(day.lastCheckInAt)}
                    </span>
                  ) : undefined
                }
                readOnly={isReadOnly}
              >
                <div
                  className="overflow-hidden rounded-2xl ring-0 ring-[var(--border-active)] transition-shadow focus-within:ring-1"
                  style={surfaceStyle}
                >
                  <div className="p-1.5">
                    <StatusSelector
                      current={day?.status ?? 'on_track'}
                      onUpdate={handleStatusUpdate}
                      isPending={updateStatusPending}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div style={{ borderTop: `1px solid ${HAIRLINE}` }}>
                    <QuickUpdates
                      onAddCheckIn={handleAddCheckIn}
                      tasks={tasksFromItems(day?.currentItem ? [day.currentItem] : undefined, plannedItems)}
                      status={day?.status}
                      isPending={addCheckInPending}
                      disabled={isReadOnly}
                      inputRef={quickUpdateRef}
                    />
                  </div>
                </div>
              </MyDaySection>

              <MyDaySection
                id="log"
                icon={<ScrollText size={14} />}
                title={isToday ? 'Today’s log' : 'Log'}
                count={checkIns.length > 0 ? checkIns.length : undefined}
              >
                <div className="overflow-hidden rounded-2xl" style={surfaceStyle}>
                  <RecentActivity checkIns={checkIns} isToday={isToday} />
                </div>
              </MyDaySection>

              <motion.div variants={sectionVariants} className="hidden flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[12px] md:flex" style={{ color: 'var(--text-muted)' }}>
                {!isReadOnly && (
                  <>
                    <span className="inline-flex items-center gap-1.5"><Kbd>n</Kbd> new task</span>
                    <span className="inline-flex items-center gap-1.5"><Kbd>c</Kbd> check in</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1.5"><Kbd>[</Kbd><Kbd>]</Kbd> change day</span>
                <span className="inline-flex items-center gap-1.5"><Kbd>t</Kbd> today</span>
                <button
                  type="button"
                  data-my-day-shortcuts=""
                  onClick={(event) => setShortcutsAnchor(event.currentTarget)}
                  className={`inline-flex items-center gap-1.5 rounded-md underline-offset-2 hover:underline ${FOCUS_RING}`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Kbd>?</Kbd> all shortcuts
                </button>
              </motion.div>
              {shortcutsAnchor ? (
                <ShortcutSheet
                  anchor={shortcutsAnchor}
                  groups={MY_DAY_SHORTCUTS.filter((group) => !isReadOnly || group.group !== 'Work')}
                  onClose={() => setShortcutsAnchor(null)}
                />
              ) : null}
            </aside>
          </motion.div>
        </div>
      </div>
      <TaskDrawer
        taskKey={openTaskKey}
        onClose={closeTask}
        onNavigateTask={openTask}
        orderedKeys={orderedTaskKeys}
        onStepTask={openTask}
      />
      </MyDayTaskDetailContext.Provider>
    </>
  );
}

/** Mirrors the real layout so the page doesn't jump when data lands. */
function MyDaySkeleton() {
  const block = 'animate-pulse rounded-2xl';
  const fill = { background: 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' };
  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-canvas)' }} aria-busy="true">
      <span className="sr-only" role="status">Loading your day…</span>
      <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 sm:px-6 md:pt-10 lg:px-10" aria-hidden="true">
        <div className="space-y-2.5">
          <div className="h-3 w-40 animate-pulse rounded-full" style={fill} />
          <div className="h-7 w-72 max-w-full animate-pulse rounded-lg" style={fill} />
          <div className="h-2 w-44 animate-pulse rounded-full" style={fill} />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_344px]">
          <div className="flex flex-col gap-8">
            <div className={`${block} h-[168px]`} style={fill} />
            <div className={`${block} h-[180px]`} style={fill} />
          </div>
          <div className="flex flex-col gap-7">
            <div className={`${block} h-[150px]`} style={fill} />
            <div className={`${block} h-[120px]`} style={fill} />
          </div>
        </div>
      </div>
    </div>
  );
}
