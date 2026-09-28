import { useState, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Bell, CalendarClock, CornerDownLeft, Crosshair, ListTodo, MessagesSquare, NotebookPen, UserMinus, Users } from 'lucide-react';
import type { Issue, TrackerDeveloperDay, TrackerDeveloperStatus, TrackerWorkItem } from '@/types';
import { TrackerItemRow } from './TrackerItemRow';
import { AddTrackerItemForm } from './AddTrackerItemForm';
import { ManagerDeskCaptureDialog } from '@/components/manager-desk/ManagerDeskCaptureDialog';
import { useManagerDesk, useUpdateManagerDeskItem } from '@/hooks/useManagerDesk';
import { TaskPicker, taskKeysForSubmit, tasksFromItems, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { InlineTextField, useTaskShortcuts } from '@/components/tasks/TaskDetailPrimitives';
import { ShortcutLegend } from '@/components/ui/ShortcutSheet';
import { FOCUS_RING, isEditable } from '@/components/ui/focus';
import { describePlanDate } from '@/components/tasks/task-detail-format';
import { getLocalIsoDate } from '@/lib/utils';
import {
  CheckInTimeline,
  DeveloperHero,
  Divider,
  DrawerSection,
  DrawerToolbar,
  EmptyLine,
  HistorySection,
  type DrawerMenuAction,
} from './DeveloperDrawerSections';
import { ManagerFollowUpRow } from './ManagerFollowUpsSection';
import { OneOnOneAgendaButton } from './OneOnOneAgendaButton';
import { useCreateOneOnOneSeries, useOneOnOneEnabled, useOneOnOneSeriesForDeveloper } from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import type { ManagerDeskItem } from '@/types/manager-desk';
import {
  formatTrackerIssueContextNote,
  getTrackerIssueContextChips,
  getTrackerIssueLinks,
} from './trackerIssueContext';
import { isCoveredByLaterLayer, useModalFocus } from '@/hooks/useModalFocus';

interface DeveloperTrackerDrawerProps {
  date: string;
  day: TrackerDeveloperDay | undefined;
  open: boolean;
  onClose: () => void;
  onUpdateDay: (params: { accountId: string; status?: TrackerDeveloperStatus; managerNotes?: string }) => void;
  onAddItem: (params: { accountId: string; jiraKey?: string; relatedIssueKeys?: string[]; title: string; note?: string }) => void;
  onOpenTaskDetail: (itemId: number, managerDeskItemId?: number) => void;
  onReorderPlannedItem: (params: { itemId: number; position: number }) => void;
  onUpdateItemTitle: (params: { itemId: number; title: string }) => void;
  onSetCurrent: (itemId: number) => void;
  onMarkDone: (itemId: number) => void;
  onDropItem: (itemId: number) => void;
  onAddCheckIn: (params: { accountId: string; summary: string; status?: TrackerDeveloperStatus; taskKeys?: string[] }) => void;
  onMarkInactive?: (day: TrackerDeveloperDay) => void;
  onOpenManagerDesk?: () => void;
  /** docs/48 §4.3: opens the 1:1 workspace panel for this developer. */
  onOpenOneOnOne?: (accountId: string) => void;
  issues?: Issue[];
  isAddItemPending?: boolean;
  readOnly?: boolean;
}

export function DeveloperTrackerDrawer({
  date,
  day,
  open,
  onClose,
  onUpdateDay,
  onAddItem,
  onOpenTaskDetail,
  onReorderPlannedItem,
  onUpdateItemTitle,
  onSetCurrent,
  onMarkDone,
  onDropItem,
  onAddCheckIn,
  onMarkInactive,
  onOpenManagerDesk,
  onOpenOneOnOne,
  issues,
  isAddItemPending,
  readOnly = false,
}: DeveloperTrackerDrawerProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const visible = open && Boolean(day);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const checkInInputRef = useRef<HTMLInputElement>(null);
  const [condensed, setCondensed] = useState(false);
  const [localPlannedItems, setLocalPlannedItems] = useState<TrackerWorkItem[]>([]);
  const [deskCaptureOpen, setDeskCaptureOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [droppedOpen, setDroppedOpen] = useState(false);
  const localPlannedItemsRef = useRef<TrackerWorkItem[]>([]);
  const isDraggingRef = useRef(false);
  const draggedItemIdRef = useRef<number | null>(null);
  const refocusItemIdRef = useRef<number | null>(null);
  const composerApisRef = useRef(new Map<number, { expand: () => void; focus: () => void }>());
  const assignedTodayCount = (day?.currentItem ? 1 : 0) + (day?.plannedItems.length ?? 0);
  const managerDesk = useManagerDesk(date, open && Boolean(day) && !readOnly);
  const updateManagerDeskItem = useUpdateManagerDeskItem(date);
  const managerFollowUps = day
    ? getDeveloperManagerFollowUps(managerDesk.data?.items ?? [], day.developer.accountId)
    : [];

  useDrawerLayer(panelRef, visible, onClose);

  // Sync local planned items from server data when not actively dragging
  useEffect(() => {
    if (day && !isDraggingRef.current) {
      setLocalPlannedItems(day.plannedItems);
      localPlannedItemsRef.current = day.plannedItems;
    }
  }, [day?.plannedItems]);

  useEffect(() => {
    if (day) {
      setCompletedOpen(false);
      setDroppedOpen(false);
    }
  }, [day?.id]);

  // A different developer starts at the top of the panel.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setCondensed(false);
  }, [day?.developer.accountId]);

  // Keyboard reordering moves DOM nodes; keep focus on the row that moved.
  useLayoutEffect(() => {
    const itemId = refocusItemIdRef.current;
    if (itemId === null) return;
    refocusItemIdRef.current = null;
    panelRef.current?.querySelector<HTMLElement>(`[data-planned-item="${itemId}"] [tabindex="0"]`)?.focus();
  }, [localPlannedItems]);

  const handleDragReorder = useCallback(
    (newOrder: TrackerWorkItem[]) => {
      localPlannedItemsRef.current = newOrder;
      setLocalPlannedItems(newOrder);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    const movedItemId = draggedItemIdRef.current;
    draggedItemIdRef.current = null;
    if (!day) return;

    if (movedItemId === null) {
      return;
    }

    const targetIndex = localPlannedItemsRef.current.findIndex((item) => item.id === movedItemId);
    if (targetIndex === -1) {
      return;
    }

    const originalIndex = day.plannedItems.findIndex((item) => item.id === movedItemId);
    if (originalIndex === targetIndex) {
      return;
    }

    const targetPosition = day.plannedItems[targetIndex]?.position ?? targetIndex;
    onReorderPlannedItem({ itemId: movedItemId, position: targetPosition });
  }, [day, onReorderPlannedItem]);

  /** Alt+↑/↓ on a focused planned row — the keyboard path for drag reordering. */
  const movePlannedItem = useCallback(
    (itemId: number, direction: 'up' | 'down') => {
      if (!day) return;
      const current = localPlannedItemsRef.current;
      const index = current.findIndex((item) => item.id === itemId);
      const targetIndex = index + (direction === 'up' ? -1 : 1);
      if (index === -1 || targetIndex < 0 || targetIndex >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved!);
      localPlannedItemsRef.current = next;
      refocusItemIdRef.current = itemId;
      setLocalPlannedItems(next);
      onReorderPlannedItem({ itemId, position: day.plannedItems[targetIndex]?.position ?? targetIndex });
    },
    [day, onReorderPlannedItem],
  );

  // Canonical transport carries `day.tasks`; the legacy item arrays are the
  // pre-canonical fallback (and stay populated under Phase 2 transport).
  const checkInTasks = useMemo(
    () =>
      day?.tasks?.length
        ? day.tasks.map((task) => ({ taskKey: task.taskKey, title: task.title }))
        : tasksFromItems(day?.currentItem ? [day.currentItem] : undefined, localPlannedItems),
    [day?.tasks, day?.currentItem, localPlannedItems],
  );

  const composerOrder = useMemo(
    () =>
      [day?.currentItem?.id, ...localPlannedItems.map((item) => item.id)].filter(
        (id): id is number => id !== undefined,
      ),
    [day?.currentItem?.id, localPlannedItems],
  );

  const focusAdjacentComposer = useCallback(
    (itemId: number, direction: 'up' | 'down') => {
      const index = composerOrder.indexOf(itemId);
      const nextId = composerOrder[index + (direction === 'down' ? 1 : -1)];
      if (nextId === undefined) return;
      composerApisRef.current.get(nextId)?.expand();
    },
    [composerOrder],
  );

  const registerComposer = useCallback(
    (itemId: number) => (api: { expand: () => void; focus: () => void; togglePrivate: () => void } | null) => {
      if (api) {
        composerApisRef.current.set(itemId, api);
      } else {
        composerApisRef.current.delete(itemId);
      }
    },
    [],
  );

  const composerFor = (item: TrackerWorkItem) =>
    !readOnly && item.taskKey ? (
      <TaskUpdateComposer
        taskKey={item.taskKey}
        mode="manager"
        via="standup"
        collapsed
        quiet
        registerComposer={registerComposer(item.id)}
        onArrowNav={(direction) => focusAdjacentComposer(item.id, direction)}
      />
    ) : undefined;

  // docs/48 §4.3: "Add to 1:1 agenda" rides the row hover toolbar — manager
  // board only (never the historical read-only snapshot), flag-gated.
  const oneOnOneEnabled = useOneOnOneEnabled();
  const agendaActionFor = (item: TrackerWorkItem) =>
    oneOnOneEnabled && !readOnly && day && item.taskKey ? (
      <OneOnOneAgendaButton
        developerAccountId={day.developer.accountId}
        taskKey={item.taskKey}
        title={item.title}
        onOpenOneOnOne={onOpenOneOnOne}
      />
    ) : undefined;

  const currentComposerId = day?.currentItem?.taskKey ? day.currentItem.id : undefined;
  useTaskShortcuts(panelRef, visible && !readOnly, {
    u: () => {
      if (currentComposerId !== undefined) composerApisRef.current.get(currentComposerId)?.expand();
    },
  });

  const shortcutHints: [string, string][] = readOnly
    ? [['Esc', 'Close']]
    : [
        // docs/54 K1: n new task, ⇧s developer status (s stays "schedule").
        ['⇧ s', 'Status'],
        ['n', 'New task'],
        ...(currentComposerId !== undefined ? [['u', 'Update'] as [string, string]] : []),
        ['c', 'Check-in'],
        ...(localPlannedItems.length > 1 ? [['⌥ ↑ / ⌥ ↓', 'Reorder'] as [string, string]] : []),
        ['Esc', 'Close'],
      ];

  const issueList = issues?.map((i) => ({
    jiraKey: i.jiraKey,
    summary: i.summary,
    priorityName: i.priorityName,
    dueDate: i.dueDate,
    developmentDueDate: i.developmentDueDate,
  })) ?? [];

  const menuActions: DrawerMenuAction[] = [];
  if (day && !readOnly) {
    menuActions.push({ key: 'capture', label: 'Capture follow-up', icon: <Bell size={13} />, onSelect: () => setDeskCaptureOpen(true) });
  }
  if (day && onOpenOneOnOne) {
    menuActions.push({ key: 'one-on-one', label: 'Open 1:1 workspace', icon: <Users size={13} />, onSelect: () => onOpenOneOnOne(day.developer.accountId) });
  }
  if (day && !readOnly && onMarkInactive) {
    menuActions.push({
      key: 'inactive',
      label: `Mark ${day.developer.displayName.split(' ')[0]} inactive…`,
      icon: <UserMinus size={13} />,
      onSelect: () => onMarkInactive(day),
      separated: true,
    });
  }

  return (
    <AnimatePresence>
      {open && day && (
        <>
          <motion.div
            key="developer-drawer-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="workspace-shell-backdrop fixed inset-x-0 bottom-0 z-drawer"
            style={{ background: 'var(--scrim-soft)', backdropFilter: 'var(--scrim-soft-blur)' }}
            onClick={onClose}
          />
          <motion.div
            key="developer-drawer-panel"
            ref={panelRef}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 340 }}
            className="workspace-shell-drawer fixed right-0 z-drawer flex w-full max-w-[680px] flex-col overflow-hidden outline-none"
            style={{
              background: 'var(--bg-primary)',
              borderLeft: '1px solid var(--border)',
              boxShadow: 'var(--drawer-shadow)',
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`${day.developer.displayName} developer details`}
          >
            <DrawerToolbar
              day={day}
              date={date}
              readOnly={readOnly}
              condensed={condensed}
              actions={menuActions}
              onClose={onClose}
            />

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto"
              onScroll={(event) => setCondensed(event.currentTarget.scrollTop > 64)}
            >
              <div className="space-y-7 px-6 pb-10 pt-5">
                <DeveloperHero
                  day={day}
                  date={date}
                  tasks={checkInTasks}
                  load={assignedTodayCount}
                  readOnly={readOnly}
                  titleId={titleId}
                />

                <DrawerSection icon={<Crosshair size={14} />} title="Current work">
                  {day.currentItem ? (
                    <TrackerItemRow
                      item={day.currentItem}
                      variant="drawer-current"
                      actionPreset="hover-done"
                      viewDate={date}
                      onOpen={readOnly ? undefined : onOpenTaskDetail}
                      onUpdateTitle={readOnly ? undefined : (itemId, title) => onUpdateItemTitle({ itemId, title })}
                      onSetCurrent={readOnly ? undefined : onSetCurrent}
                      onMarkDone={readOnly ? undefined : onMarkDone}
                      onDrop={readOnly ? undefined : onDropItem}
                      readOnly={readOnly}
                      composer={composerFor(day.currentItem)}
                      extraActions={agendaActionFor(day.currentItem)}
                    />
                  ) : (
                    <div
                      className="rounded-xl px-3.5 py-3 text-[12.5px] leading-5"
                      style={{ color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
                    >
                      {readOnly
                        ? 'No active item in this historical snapshot.'
                        : localPlannedItems.length > 0
                          ? 'Nothing in progress. Start a planned task to make it current work.'
                          : 'Nothing in progress and nothing planned yet.'}
                    </div>
                  )}
                </DrawerSection>

                <DrawerSection
                  icon={<ListTodo size={14} />}
                  title="Planned"
                  count={day.plannedItems.length}
                >
                  {localPlannedItems.length > 0 ? (
                    readOnly ? (
                      <div className="space-y-0.5">
                        {localPlannedItems.map((item, index) => (
                          <TrackerItemRow
                            key={item.id}
                            item={item}
                            index={index}
                            variant="drawer-planned"
                            hideActions
                            viewDate={date}
                            onOpen={undefined}
                          />
                        ))}
                      </div>
                    ) : (
                      <Reorder.Group
                        axis="y"
                        values={localPlannedItems}
                        onReorder={handleDragReorder}
                        className="space-y-0.5"
                        as="div"
                      >
                        {localPlannedItems.map((item, index) => (
                          <PlannedReorderItem
                            key={item.id}
                            item={item}
                            index={index}
                            date={date}
                            onDragStart={() => {
                              isDraggingRef.current = true;
                              draggedItemIdRef.current = item.id;
                            }}
                            onDragEnd={handleDragEnd}
                            onOpenTaskDetail={onOpenTaskDetail}
                            onUpdateItemTitle={onUpdateItemTitle}
                            onSetCurrent={onSetCurrent}
                            onMarkDone={onMarkDone}
                            onDropItem={onDropItem}
                            onMove={movePlannedItem}
                            canMoveUp={index > 0}
                            canMoveDown={index < localPlannedItems.length - 1}
                            composer={composerFor(item)}
                            extraActions={agendaActionFor(item)}
                          />
                        ))}
                      </Reorder.Group>
                    )
                  ) : (
                    readOnly && <EmptyLine>Nothing planned.</EmptyLine>
                  )}
                  {!readOnly && (
                    <AddTrackerItemForm
                      onAdd={(params) => onAddItem({ accountId: day.developer.accountId, ...params })}
                      date={date}
                      targetAccountId={day.developer.accountId}
                      onOpenExistingAssignment={(itemId) => onOpenTaskDetail(itemId)}
                      issues={issueList}
                      isPending={isAddItemPending}
                    />
                  )}
                </DrawerSection>

                {(day.completedItems.length > 0 || day.droppedItems.length > 0) && (
                  <div className="-mt-3 space-y-0.5">
                    <HistorySection
                      title="Completed"
                      items={day.completedItems}
                      open={completedOpen}
                      onToggle={() => setCompletedOpen((current) => !current)}
                    />
                    <HistorySection
                      title="Dropped"
                      items={day.droppedItems}
                      open={droppedOpen}
                      onToggle={() => setDroppedOpen((current) => !current)}
                    />
                  </div>
                )}

                <Divider />

                {!readOnly && (
                  <ManagerFollowUpRow
                    day={day}
                    items={managerFollowUps}
                    isLoading={managerDesk.isLoading}
                    onComplete={(itemId) => updateManagerDeskItem.mutate({ itemId, status: 'done' })}
                    onCapture={() => setDeskCaptureOpen(true)}
                  />
                )}

                <DrawerSection icon={<NotebookPen size={14} />} title="Notes" hint={readOnly ? undefined : 'Private to you'}>
                  <div className="-mx-2">
                    <InlineTextField
                      value={day.managerNotes ?? ''}
                      placeholder="Add a private note about today…"
                      ariaLabel={`Notes about ${day.developer.displayName}`}
                      multiline
                      disabled={readOnly}
                      onCommit={(managerNotes) => onUpdateDay({ accountId: day.developer.accountId, managerNotes })}
                    />
                  </div>
                </DrawerSection>

                <OneOnOneSection accountId={day.developer.accountId} onOpenWorkspace={onOpenOneOnOne} />

                <Divider />

                <DrawerSection
                  icon={<MessagesSquare size={14} />}
                  title="Check-ins"
                  count={day.checkIns.length + day.recentCheckIns.length}
                >
                  <div className="pt-1">
                    <CheckInTimeline checkIns={day.checkIns} recentCheckIns={day.recentCheckIns} readOnly={readOnly} />
                  </div>
                </DrawerSection>
              </div>
            </div>

            {readOnly ? (
              <div
                className="hidden shrink-0 border-t px-6 py-2 sm:block"
                style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 60%, transparent)' }}
              >
                <ShortcutLegend hints={shortcutHints} />
              </div>
            ) : (
              <CheckInComposer
                key={day.developer.accountId}
                developerName={day.developer.displayName}
                tasks={checkInTasks}
                inputRef={checkInInputRef}
                shortcutHints={shortcutHints}
                onSubmit={(summary, taskKeys) => onAddCheckIn({ accountId: day.developer.accountId, summary, taskKeys })}
              />
            )}
          </motion.div>
        </>
      )}
      {!readOnly && deskCaptureOpen && day && (
        <ManagerDeskCaptureDialog
          key="developer-drawer-capture"
          date={date}
          onClose={() => setDeskCaptureOpen(false)}
          onOpenManagerDesk={onOpenManagerDesk}
          heading="Capture Developer Follow-Up"
          description="Create a manager task from this tracker view while keeping the developer linked."
          initialTitle={`Follow up with ${day.developer.displayName}`}
          initialCategory="team_management"
          initialContextNote={formatTrackerIssueContextNote(day.currentItem)}
          initialLinks={[
            { linkType: 'developer', developerAccountId: day.developer.accountId },
            ...getTrackerIssueLinks(day.currentItem),
          ]}
          contextChips={[
            { label: 'Developer', value: day.developer.displayName, tone: 'developer' },
            ...getTrackerIssueContextChips(day.currentItem),
          ]}
        />
      )}
    </AnimatePresence>
  );
}

// ── Planned row (handle-only drag) ──────────────────────────────────

function PlannedReorderItem({
  item,
  index,
  date,
  onDragStart,
  onDragEnd,
  onOpenTaskDetail,
  onUpdateItemTitle,
  onSetCurrent,
  onMarkDone,
  onDropItem,
  onMove,
  canMoveUp,
  canMoveDown,
  composer,
  extraActions,
}: {
  item: TrackerWorkItem;
  index: number;
  date: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenTaskDetail: (itemId: number, managerDeskItemId?: number) => void;
  onUpdateItemTitle: (params: { itemId: number; title: string }) => void;
  onSetCurrent: (itemId: number) => void;
  onMarkDone: (itemId: number) => void;
  onDropItem: (itemId: number) => void;
  onMove: (itemId: number, direction: 'up' | 'down') => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  composer?: ReactNode;
  extraActions?: ReactNode;
}) {
  // Only the handle starts a drag, so clicking into the update composer or
  // selecting text never picks the row up.
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      as="div"
      data-planned-item={item.id}
      whileDrag={{
        scale: 1.015,
        boxShadow: 'var(--panel-shadow)',
        borderRadius: '10px',
        background: 'var(--bg-elevated)',
        zIndex: 50,
      }}
      style={{ position: 'relative' }}
    >
      <TrackerItemRow
        item={item}
        index={index}
        draggable
        onDragHandlePointerDown={(event: PointerEvent<HTMLDivElement>) => controls.start(event)}
        variant="drawer-planned"
        actionPreset="hover-start"
        viewDate={date}
        onOpen={onOpenTaskDetail}
        onUpdateTitle={(itemId, title) => onUpdateItemTitle({ itemId, title })}
        onSetCurrent={onSetCurrent}
        onMarkDone={onMarkDone}
        onDrop={onDropItem}
        onMoveUp={canMoveUp ? (itemId) => onMove(itemId, 'up') : undefined}
        onMoveDown={canMoveDown ? (itemId) => onMove(itemId, 'down') : undefined}
        composer={composer}
        extraActions={extraActions}
      />
    </Reorder.Item>
  );
}

// ── Check-in composer ───────────────────────────────────────────────

/**
 * Pinned footer composer. At rest it is a single line plus the drawer's
 * shortcut legend; once engaged, the legend gives way to the task picker so
 * the note can be linked to specific tasks.
 */
function CheckInComposer({
  developerName,
  tasks,
  inputRef,
  shortcutHints,
  onSubmit,
}: {
  developerName: string;
  tasks: TaskPickerTask[];
  inputRef: RefObject<HTMLInputElement>;
  shortcutHints: [string, string][];
  onSubmit: (summary: string, taskKeys: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const engaged = focused || Boolean(text.trim()) || selectedKeys.length > 0;
  const canSubmit = Boolean(text.trim());

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(text.trim(), taskKeysForSubmit(selectedKeys, text, tasks));
    setText('');
    setSelectedKeys([]);
  };

  return (
    <div
      className="shrink-0 border-t px-5 pb-3 pt-3"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 60%, transparent)' }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        className="rounded-xl transition-[border-color,box-shadow] duration-150"
        style={{
          background: 'var(--bg-primary)',
          border: `1px solid ${engaged ? 'var(--border-active)' : 'var(--border)'}`,
          boxShadow: engaged ? '0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent)' : undefined,
        }}
      >
        <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
          <label htmlFor={inputId} className="sr-only">
            Check-in note for {developerName}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            data-task-shortcut="c"
            placeholder="Add a check-in note…"
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-opacity disabled:opacity-40 ${FOCUS_RING}`}
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            title="Save check-in (Enter)"
          >
            <CornerDownLeft size={12} aria-hidden="true" />
            Save
          </button>
        </div>
        {engaged && tasks.length > 0 && (
          // Keep focus in the input while chips are clicked (Safari does not focus buttons on click).
          <div
            className="border-t px-3 py-2"
            style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <TaskPicker tasks={tasks} text={text} selected={selectedKeys} onChange={setSelectedKeys} />
          </div>
        )}
      </div>
      {!engaged && <ShortcutLegend hints={shortcutHints} className="mt-2 hidden px-1 sm:flex" />}
    </div>
  );
}

// ── Layer behavior ──────────────────────────────────────────────────

/**
 * Modal behavior for the drawer, aware of what stacks above it: while any
 * later modal layer is mounted (task detail, rationale dialog, capture
 * dialog, command palette), Esc and Tab belong to that layer. On its own,
 * the first Esc leaves a text field (keeping the draft) and the next closes;
 * Tab cycles inside the panel; focus returns to the opener on close.
 */
function useDrawerLayer(panelRef: RefObject<HTMLElement>, active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // docs/54 V3: Tab trap, stacking and focus return come from the shared hook.
  useModalFocus(active, panelRef);

  useEffect(() => {
    if (!active) return;
    panelRef.current?.focus({ preventScroll: true });

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isCoveredByLaterLayer(panelRef.current)) return;
      const panel = panelRef.current;
      const focused = document.activeElement;
      if (panel && focused instanceof HTMLElement && panel.contains(focused) && isEditable(focused)) {
        focused.blur();
        panel.focus({ preventScroll: true });
        return;
      }
      onCloseRef.current();
    };

    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [active, panelRef]);
}

// ── Manager follow-ups selection ────────────────────────────────────

const managerFollowUpStatusRank: Record<ManagerDeskItem['status'], number> = {
  in_progress: 0,
  waiting: 1,
  inbox: 2,
  planned: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
};

function getDeveloperManagerFollowUps(items: ManagerDeskItem[], developerAccountId: string) {
  return items
    .filter((item) => {
      if (item.status === 'cancelled' || item.status === 'backlog') {
        return false;
      }

      return item.links.some(
        (link) => link.linkType === 'developer' && link.developerAccountId === developerAccountId
      );
    })
    .sort((left, right) => {
      const statusDelta = managerFollowUpStatusRank[left.status] - managerFollowUpStatusRank[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}

// ── 1:1 ─────────────────────────────────────────────────────────────

/** docs/48 §4.3: the drawer "1:1" section — next session, agenda count, and
 * a link into the workspace. Hidden entirely while the flag is off. */
function OneOnOneSection({
  accountId,
  onOpenWorkspace,
}: {
  accountId: string;
  onOpenWorkspace?: (accountId: string) => void;
}) {
  // Flag-off renders nothing — the inner component owns the query hooks so a
  // disabled feature never mounts React Query calls.
  const enabled = useOneOnOneEnabled();
  if (!enabled) return null;
  return <OneOnOneSectionBody accountId={accountId} onOpenWorkspace={onOpenWorkspace} />;
}

function OneOnOneSectionBody({
  accountId,
  onOpenWorkspace,
}: {
  accountId: string;
  onOpenWorkspace?: (accountId: string) => void;
}) {
  const { addToast } = useToast();
  const { series, isLoading } = useOneOnOneSeriesForDeveloper(accountId);
  const createSeries = useCreateOneOnOneSeries();

  const overdue = (series?.nextSessionOverdueDays ?? 0) > 0;
  const next = series?.nextSessionDate ? describePlanDate(series.nextSessionDate, 'open', getLocalIsoDate()) : null;

  return (
    <DrawerSection
      icon={<CalendarClock size={14} />}
      title="1:1"
      action={
        series && onOpenWorkspace ? (
          <button
            type="button"
            onClick={() => onOpenWorkspace(accountId)}
            className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--accent-glow)] ${FOCUS_RING}`}
            style={{ color: 'var(--accent)' }}
            data-testid="one-on-one-open-workspace"
          >
            Open workspace
            <ArrowUpRight size={13} />
          </button>
        ) : undefined
      }
    >
      {isLoading ? (
        <EmptyLine>Loading…</EmptyLine>
      ) : series ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 text-[13px]">
          <span style={{ color: 'var(--text-secondary)' }}>
            {series.nextSessionDate ? (
              <>
                Next{' '}
                <span className="font-medium" style={{ color: 'var(--text-primary)' }} title={series.nextSessionDate}>
                  {next?.label ?? series.nextSessionDate}
                </span>
              </>
            ) : (
              'No session scheduled'
            )}
          </span>
          {overdue && (
            <span className="text-[12px] font-semibold" style={{ color: 'var(--danger)' }}>
              overdue {series.nextSessionOverdueDays}d
            </span>
          )}
          <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            {series.openAgendaCount} on agenda{series.active ? '' : ' · paused'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            No recurring 1:1 yet — adding a task to the agenda starts one.
          </span>
          <button
            type="button"
            onClick={() =>
              createSeries.mutate(
                { developerAccountId: accountId, cadence: 'weekly' },
                {
                  onSuccess: () => onOpenWorkspace?.(accountId),
                  onError: (error) =>
                    addToast(error instanceof Error ? error.message : 'Could not create the 1:1 series', 'error'),
                },
              )
            }
            disabled={createSeries.isPending}
            className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition-opacity disabled:opacity-50 ${FOCUS_RING}`}
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            {createSeries.isPending ? 'Starting…' : 'Start a 1:1 series'}
          </button>
        </div>
      )}
    </DrawerSection>
  );
}
