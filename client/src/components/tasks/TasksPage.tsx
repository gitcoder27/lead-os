import { PlacementDialog } from './PlacementDialog';
import { TaskWorkspaceSelect } from './TaskWorkspaceSelect';
import { ProjectsPanel } from './ProjectsPanel';
import { ProjectFilters } from './ProjectFilters';
import { useProject } from '@/hooks/useProjects';
import { taskViewParamsFromState } from '@/lib/task-views';
import { csvFileName, downloadCsv, tasksCsv } from '@/lib/csv';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuickActions } from '@/context/QuickActionsContext';
import { shouldIgnoreShortcutHelp } from '@/lib/keyboard-shortcuts';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useLocalDate } from '@/hooks/useLocalDate';
import { useTaskLabels } from '@/hooks/useTaskLabels';
import { useTaskListMutations, type TaskChangeItem } from '@/hooks/useTaskListMutations';
import {
  useDeleteTaskView,
  useSaveTaskView,
  useTaskViewCounts,
  useTaskViewTasks,
  useTaskViews,
  useUpdateTaskView,
} from '@/hooks/useTaskViews';
import {
  DEFAULT_TASK_VIEW_ID,
  applyTaskViewOverrides,
  groupTaskViewTasks,
  hasTaskViewOverrides,
  taskViewStateFromParams,
  type TaskGroupContext,
  type TaskViewOverrides,
  type TaskViewUrlState,
} from '@/lib/task-views';
import {
  applyLingering,
  inlineCaptureDefaults,
  isOpenStatus,
  lingerEntriesFor,
  lingerHint,
  optimisticTask,
  scheduleChanges,
  searchTasks,
  taskPlanDate,
  localDateOf,
  shortDay,
  toggledDoneStatus,
  type LingerEntry,
  type ListTask,
  type RenderGroup,
  type SchedulePreset,
} from '@/lib/task-list';
import { taskKeyFromParams, writeTaskParam } from '@/lib/view-params';
import type { ManagerTask, TaskStatus, TaskViewDefinition, TaskViewMeta, TaskWaitingOnInput, UpdateTaskRequest } from '@/types';
import { TaskDrawer, navigateToTaskPage } from './TaskDrawer';
import { TaskBulkBar } from './TaskBulkBar';
import { InlineAddRow, TASK_LIST_CONTAINER, TaskList } from './TaskList';
import type { TaskRowHandlers } from './TaskListRow';
import { TaskListEmpty, TaskListError, TaskListSkeleton, TaskShortcutsDialog } from './TaskListStates';
import { AssignMenu, CheckByMenu, LabelMenu, MoreMenu, PriorityMenu, ScheduleMenu, StatusMenu, TASK_STATUS_META, WaitingMenu, checkByTimestamp, type AssignTarget, type TaskMenuKind, type TaskPriority } from './TaskMenus';
import { useContacts } from '@/hooks/useContacts';
import { TaskToolbar } from './TaskToolbar';
import { TodayTextCaptureDialog } from '@/components/today/TodayTextCaptureDialog';
import { TaskViewRail } from './TaskViewRail';
import { UNDO_WINDOW_MS } from '@/lib/undo';

interface TasksPageProps {
  /** URL state pushed in by App on popstate/navigation. */
  urlState?: TaskViewUrlState;
  urlStateNonce?: number;
  onUrlStateChange?: (state: TaskViewUrlState) => void;
  /** Deep-linked task (e.g. from a Today action target while already on /tasks). */
  openTaskKey?: string;
  openTaskNonce?: number;
}

interface OpenMenuState {
  kind: TaskMenuKind;
  keys: string[];
  anchor: HTMLElement;
}

const SCHEDULE_LABELS: Record<SchedulePreset, string> = {
  today: 'Scheduled for today',
  tomorrow: 'Scheduled for tomorrow',
  'next-week': 'Scheduled for next week',
  later: 'Moved to Later',
  clear: 'Date cleared',
};

/** §7: `g` then a letter jumps to a rail view — same target as clicking it. */
const GO_CHORD_VIEWS: Record<string, string> = {
  t: 'today',
  i: 'inbox',
  m: 'my-tasks',
  w: 'waiting',
  e: 'meetings',
  l: 'later',
  h: 'high-priority',
  a: 'attention',
  c: 'closed-week',
};
const GO_CHORD_TIMEOUT_MS = 1200;

/** docs/51 F14: pseudo-group key for the standalone add row on empty views. */
const EMPTY_ADD_KEY = 'empty-view';

/**
 * docs/51 U6: rows pinned by a *mouse* action stay long enough to read their
 * new state, then release as soon as the pointer is not over them — lingering
 * exists so rows never vanish under the cursor, not to pile up ghosts for a
 * mouse user who never moves keyboard focus. Keyboard pins keep R2 semantics.
 */
const POINTER_LINGER_DWELL_MS = 1500;

function isEditable(element: HTMLElement): boolean {
  return element.isContentEditable || ['TEXTAREA', 'SELECT'].includes(element.tagName) || (element.tagName === 'INPUT' && (element as HTMLInputElement).type !== 'checkbox');
}

function plural(count: number, noun = 'task'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function rowElement(taskKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-row="${taskKey}"]`);
}

/**
 * Phase 3 (P3-D1) + docs/49: the Tasks workspace — where the manager builds
 * and maintains the plan. View rail with live counts, filter chips, a dense
 * keyboard-first grouped list with inline actions, bulk edits, inline add,
 * and the shared TaskDrawer. URL: `/tasks?view=<id>` plus flat overrides.
 */
export function TasksPage({ urlState, urlStateNonce, onUrlStateChange, openTaskKey, openTaskNonce }: TasksPageProps = {}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const today = useLocalDate();
  const views = useTaskViews(true, today);
  const counts = useTaskViewCounts(true, today);
  const saveView = useSaveTaskView();
  const updateView = useUpdateTaskView();
  const deleteView = useDeleteTaskView();
  const developers = useDevelopers();
  const labels = useTaskLabels();
  const mutations = useTaskListMutations();

  const listScrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<TaskViewUrlState>(() =>
    taskViewStateFromParams(new URLSearchParams(window.location.search)),
  );
  const [drawerTaskKey, setDrawerTaskKey] = useState<string | undefined>(() =>
    taskKeyFromParams(new URLSearchParams(window.location.search)),
  );
  const drawerOrigin = useRef<string | undefined>(undefined);
  const [focusedKey, setFocusedKey] = useState<string | undefined>();
  const focusedKeyRef = useRef<string | undefined>(undefined);
  const lastFocusedIndex = useRef(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectionAnchor = useRef<string | undefined>(undefined);
  const goChordArmed = useRef(false);
  const goChordTimer = useRef<number | null>(null);
  const [lingering, setLingering] = useState<Map<string, LingerEntry>>(() => new Map());
  const [menu, setMenu] = useState<OpenMenuState | null>(null);
  // docs/56 UX-08: the meeting whose outcome is being captured from its row.
  const [outcomeTask, setOutcomeTask] = useState<ManagerTask | null>(null);
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  // The sheet anchors to the toolbar's keyboard button (docs/54 K2).
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLElement | null>(null);
  const { openKeyboardShortcuts } = useQuickActions();
  const showShortcuts = shortcutsAnchor !== null;
  const openShortcuts = (anchor = mainRef.current?.querySelector<HTMLElement>('[data-shortcuts-anchor]') ?? document.body) => {
    if (openKeyboardShortcuts) openKeyboardShortcuts(anchor);
    else setShortcutsAnchor(anchor);
  };
  const [doneTodayOpen, setDoneTodayOpen] = useState(false);
  // docs/51 U6: which input drove the last action, and the mouse-pinned rows.
  const lastInput = useRef<'pointer' | 'keyboard'>('keyboard');
  const hoveredRow = useRef<string | null>(null);
  const pointerPins = useRef<{ keys: Set<string>; since: number } | null>(null);
  const pointerPinTimer = useRef<number | null>(null);

  // External URL changes (popstate, palette deep links) replace local state.
  useEffect(() => {
    if (urlStateNonce !== undefined && urlStateNonce > 0) {
      setState(urlState ?? { view: undefined, overrides: {} });
      setDrawerTaskKey(taskKeyFromParams(new URLSearchParams(window.location.search)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateNonce]);

  // App-level deep links (Today targets) pushState without popstate — the
  // nonce opens the drawer instead.
  useEffect(() => {
    if (openTaskNonce !== undefined && openTaskNonce > 0 && openTaskKey) {
      setDrawerTaskKey(openTaskKey);
      writeTaskParam(openTaskKey);
    }
  }, [openTaskNonce, openTaskKey]);

  useEffect(() => {
    onUrlStateChange?.(state);
  }, [onUrlStateChange, state]);

  // docs/51 B5: an armed `g` chord must not outlive the page.
  useEffect(() => () => {
    if (goChordTimer.current) window.clearTimeout(goChordTimer.current);
    if (pointerPinTimer.current) window.clearTimeout(pointerPinTimer.current);
  }, []);

  // docs/51 U6: remember whether the latest interaction was pointer or keys.
  useEffect(() => {
    const onPointer = () => { lastInput.current = 'pointer'; };
    const onKey = () => { lastInput.current = 'keyboard'; };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // ── View + data ──────────────────────────────────────────────────────────
  const allViews = useMemo<TaskViewMeta[]>(() => [...(views.data?.views ?? []), { id: 'projects', name: 'Projects', builtin: true, section: 'plan', definition: { sort: 'scheduled' } }], [views.data]);
  const selectedId = state.view ?? DEFAULT_TASK_VIEW_ID;
  const selectedView: TaskViewMeta | undefined =
    allViews.find((view) => view.id === selectedId) ?? allViews.find((view) => view.id === DEFAULT_TASK_VIEW_ID) ?? allViews[0];
  const definition = useMemo(
    () => (selectedView ? applyTaskViewOverrides(selectedView.definition, state.overrides) : undefined),
    [selectedView, state.overrides],
  );
  const projectId = typeof definition?.filters?.project === 'number' ? definition.filters.project : undefined;
  const trackId = typeof definition?.filters?.track === 'number' ? definition.filters.track : undefined;
  const projectDetail = useProject(projectId, today);
  const projectsMode = selectedId === 'projects';
  const projectUnavailable = Boolean(projectId && (projectDetail.isError || (trackId && projectDetail.data && !projectDetail.data.tracks.some((track) => track.id === trackId))));
  const showTaskList = (!projectsMode || Boolean(projectId && projectDetail.data)) && !projectUnavailable;
  const tasks = useTaskViewTasks(definition, Boolean(definition) && showTaskList, today);
  const taskList = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const toolbarOverrides = projectsMode ? { ...state.overrides, project: undefined, track: undefined } : state.overrides;
  const overridesActive = hasTaskViewOverrides(state.overrides);
  const listNarrowed = hasTaskViewOverrides(toolbarOverrides) || Boolean(state.q);

  // docs/51 F5: the Today view appends a collapsed "Done today" group — tasks
  // closed today stay visible as progress instead of vanishing. Hidden while
  // the view is filtered or searched.
  const doneTodayEnabled = selectedView?.id === 'today' && !overridesActive && !state.q;
  const doneTodayDefinition = useMemo<TaskViewDefinition>(
    () => ({ filters: { owner: 'me', closed: { from: today, to: today } }, sort: 'updated' }),
    [today],
  );
  const doneTodayQuery = useTaskViewTasks(doneTodayDefinition, doneTodayEnabled, today);
  const doneTodayRows = useMemo(
    () => (doneTodayEnabled ? (doneTodayQuery.data?.tasks ?? []) : []),
    [doneTodayEnabled, doneTodayQuery.data],
  );

  const developerList = useMemo(() => developers.data ?? [], [developers.data]);
  // docs/51 F3: my linked developer account is me — same identity the server
  // uses (the session accountId IS the developer id for linked managers).
  const selfAccountId = user?.accountId;
  const contacts = useContacts();
  const assignableDevelopers = useMemo(
    () => developerList.filter((dev) => dev.accountId !== selfAccountId),
    [developerList, selfAccountId],
  );
  const ownerName = useCallback(
    (ownerType: string | null, ownerId: string | null) => {
      if (ownerType === 'developer' && ownerId) {
        // docs/56 UX-09: the manager is "You" everywhere.
        if (ownerId === selfAccountId) return 'You';
        return developerList.find((dev) => dev.accountId === ownerId)?.displayName ?? 'Unknown owner';
      }
      if (!ownerType) return 'Unassigned';
      return ownerId === selfAccountId ? 'You' : 'Another manager';
    },
    [developerList, selfAccountId],
  );
  const labelRegistry = useMemo(() => labels.data?.labels ?? [], [labels.data]);
  const labelColors = useMemo(() => new Map(labelRegistry.map((label) => [label.name, label.color])), [labelRegistry]);
  const labelColor = useCallback((name: string) => labelColors.get(name), [labelColors]);

  const baseGroups = useMemo<RenderGroup[]>(
    () => groupTaskViewTasks(searchTasks(taskList, state.q), definition?.group, today, ownerName, selfAccountId),
    [taskList, state.q, definition?.group, today, ownerName, selfAccountId],
  );
  const groups = useMemo(() => applyLingering(baseGroups, lingering), [baseGroups, lingering]);
  const displayGroups = useMemo<RenderGroup[]>(() => {
    if (!doneTodayRows.length) return groups;
    return [
      ...groups,
      {
        key: 'done-today',
        label: 'Done today',
        context: { mode: 'none' },
        tasks: doneTodayOpen ? (doneTodayRows as ListTask[]) : [],
        collapsible: true,
        collapsed: !doneTodayOpen,
        count: doneTodayRows.length,
      },
    ];
  }, [groups, doneTodayRows, doneTodayOpen]);
  const doneTodayKeys = useMemo(() => new Set(doneTodayRows.map((task) => task.taskKey)), [doneTodayRows]);
  const flatRows = useMemo(() => displayGroups.flatMap((group) => group.tasks), [displayGroups]);
  const rowByKey = useMemo(() => new Map(flatRows.map((row) => [row.taskKey, row])), [flatRows]);

  // ── Lingering / selection / focus housekeeping ───────────────────────────
  const clearLingering = useCallback(() => {
    pointerPins.current = null;
    setLingering((current) => (current.size ? new Map() : current));
  }, []);

  /** docs/51 U6: drop mouse-pinned rows the pointer isn't over, once they've been seen. */
  const releasePointerPins = useCallback(() => {
    const pins = pointerPins.current;
    if (!pins || Date.now() - pins.since < POINTER_LINGER_DWELL_MS - 50) return;
    const release = [...pins.keys].filter((key) => key !== hoveredRow.current);
    if (!release.length) return;
    for (const key of release) pins.keys.delete(key);
    if (!pins.keys.size) pointerPins.current = null;
    setLingering((current) => {
      if (!release.some((key) => current.has(key))) return current;
      const next = new Map(current);
      for (const key of release) next.delete(key);
      return next;
    });
  }, []);

  const viewSignature = `${selectedView?.id}|${JSON.stringify(state.overrides)}|${state.q ?? ''}`;
  useEffect(() => {
    // R2(b): view, overrides or search changes drop lingering rows.
    clearLingering();
    setAddingGroup(null);
    setDoneTodayOpen(false);
  }, [viewSignature, clearLingering]);
  useEffect(() => {
    setSelected((current) => (current.size ? new Set() : current));
  }, [selectedView?.id, state.overrides]);

  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((key) => rowByKey.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [rowByKey]);

  const focusDom = useCallback((key: string | undefined) => {
    if (!key) return;
    requestAnimationFrame(() => {
      // Fast repeated keys can queue several focus frames. A stale frame must
      // not focus an older row and rewind the logical keyboard position.
      if (focusedKeyRef.current !== key) return;
      const element = rowElement(key)?.querySelector<HTMLElement>('[data-task-open]');
      element?.focus({ preventScroll: true });
      element?.scrollIntoView?.({ block: 'nearest' });
    });
  }, []);

  const focusRow = useCallback((key: string | undefined, options: { dom?: boolean } = {}) => {
    // R2(a): moving focus to another row releases lingering rows.
    if (key !== focusedKeyRef.current) clearLingering();
    focusedKeyRef.current = key;
    setFocusedKey(key);
    if (options.dom) focusDom(key);
  }, [clearLingering, focusDom]);

  useEffect(() => {
    const index = flatRows.findIndex((row) => row.taskKey === focusedKey);
    if (index >= 0) {
      lastFocusedIndex.current = index;
      return;
    }
    if (!focusedKey || !flatRows.length) return;
    // The focused row left the list: focus the row now at the same index.
    const fallback = flatRows[Math.min(lastFocusedIndex.current, flatRows.length - 1)]?.taskKey;
    const hadFocus = document.activeElement === document.body || Boolean(mainRef.current?.contains(document.activeElement));
    focusedKeyRef.current = fallback;
    setFocusedKey(fallback);
    if (hadFocus) focusDom(fallback);
  }, [flatRows, focusedKey, focusDom]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const targetsFor = useCallback((key?: string): ManagerTask[] => {
    const anchorKey = key ?? focusedKeyRef.current;
    if (selected.size && (!anchorKey || selected.has(anchorKey))) {
      return flatRows.filter((row) => selected.has(row.taskKey));
    }
    const row = anchorKey ? rowByKey.get(anchorKey) : undefined;
    return row ? [row] : [];
  }, [flatRows, rowByKey, selected]);

  const applyChanges = useCallback(async (
    targets: ManagerTask[],
    changesFor: (task: ManagerTask) => UpdateTaskRequest | null,
    label: (applied: number) => string,
    options: { undoable?: boolean } = {},
  ) => {
    const items: TaskChangeItem[] = [];
    for (const task of targets) {
      const changes = changesFor(task);
      if (changes) items.push({ task, changes });
    }
    const skipped = targets.length - items.length;
    // docs/51 F12: an all-skip action is a no-op — say nothing.
    if (!items.length) return;
    // docs/51 B4: a bulk action that removes rows from the view drops their
    // selection too, so the bulk bar never counts invisible rows.
    const removedKeys = items
      .filter((item) => item.changes.status === 'done' || item.changes.status === 'dropped' || item.changes.later === true)
      .map((item) => item.task.taskKey);
    if (removedKeys.length) {
      setSelected((current) => {
        if (!removedKeys.some((key) => current.has(key))) return current;
        const next = new Set(current);
        for (const key of removedKeys) next.delete(key);
        return next;
      });
    }
    // R1 + docs/51 F13: pin acted-on rows where they are, showing their new
    // state and a hint naming where the change sent them. Done-today rows
    // don't pin — the appended group only exists in displayGroups.
    const lingerable = items.filter((item) => !doneTodayKeys.has(item.task.taskKey));
    const entries = lingerEntriesFor(
      groups,
      lingerable.map((item) => optimisticTask(item.task, item.changes)),
      new Map(lingerable.map((item) => [item.task.taskKey, lingerHint(item.changes, today, ownerName)])),
    );
    setLingering((current) => {
      const next = new Map(current);
      for (const [key, entry] of entries) {
        const pinned = current.get(key);
        next.set(key, pinned ? { ...pinned, task: entry.task, hint: entry.hint ?? pinned.hint } : entry);
      }
      return next;
    });
    if (entries.size && lastInput.current === 'pointer') {
      const pins = pointerPins.current ?? { keys: new Set<string>(), since: 0 };
      for (const key of entries.keys()) pins.keys.add(key);
      pins.since = Date.now();
      pointerPins.current = pins;
      if (pointerPinTimer.current) window.clearTimeout(pointerPinTimer.current);
      pointerPinTimer.current = window.setTimeout(releasePointerPins, POINTER_LINGER_DWELL_MS);
    } else if (pointerPins.current) {
      for (const key of entries.keys()) pointerPins.current.keys.delete(key);
    }
    const applied = await mutations.apply(items, {
      label: `${label(items.length)}${skipped ? ` · skipped ${skipped}` : ''}`,
      undoable: options.undoable,
      onUndo: clearLingering,
    });
    // docs/61 TS-01: a refused or failed action leaves nothing pinned or selected on its behalf.
    if (applied === false) {
      const failed = new Set(items.map((item) => item.task.taskKey));
      setLingering((current) => {
        if (![...failed].some((key) => current.has(key))) return current;
        const next = new Map(current);
        for (const key of failed) next.delete(key);
        return next;
      });
      setSelected((current) => {
        if (![...failed].some((key) => current.has(key))) return current;
        const next = new Set(current);
        for (const key of failed) next.delete(key);
        return next;
      });
      for (const key of failed) pointerPins.current?.keys.delete(key);
    }
  }, [clearLingering, releasePointerPins, groups, mutations, today, ownerName, doneTodayKeys]);

  const toggleDone = useCallback((targets: ManagerTask[]) => {
    const reopen = targets.every((task) => !isOpenStatus(task.status));
    void applyChanges(
      targets,
      (task) => (reopen || isOpenStatus(task.status) ? { status: toggledDoneStatus(task.status) } : null),
      (count) => (reopen ? `Reopened ${plural(count)}` : `Marked ${plural(count)} done`),
    );
  }, [applyChanges]);

  const setStatus = useCallback((targets: ManagerTask[], status: TaskStatus) => {
    void applyChanges(
      targets,
      (task) => (task.status === status ? null : { status }),
      // docs/51 F12: toasts name the status label, not the raw enum value.
      (count) => `${plural(count)} → ${TASK_STATUS_META[status].label}`,
    );
  }, [applyChanges]);

  // docs/57 §4 (P3-03): `w` sets who a task waits on, `c` its check-by date (followUpAt).
  const setWaitingOn = useCallback((targets: ManagerTask[], waitingOn: TaskWaitingOnInput | null) => {
    const sameParty = (task: ManagerTask) => waitingOn
      ? task.waitingOn?.type === waitingOn.type && (task.waitingOn.ref ?? null) === (waitingOn.ref ?? null) && (waitingOn.type !== 'text' || task.waitingOn.label === waitingOn.label)
      : !task.waitingOn;
    void applyChanges(
      targets,
      (task) => (sameParty(task) ? null : { waitingOn }),
      (count) => (waitingOn ? `${plural(count)} → waiting on ${waitingOn.label ?? 'them'}` : `${plural(count)} → no longer waiting`),
    );
  }, [applyChanges]);

  const setCheckBy = useCallback((targets: ManagerTask[], date: string | null) => {
    void applyChanges(
      targets,
      (task) => (localDateOf(task.followUpAt) === date ? null : { followUpAt: date ? checkByTimestamp(date) : null }),
      (count) => (date ? `Check ${shortDay(date, today)} · ${plural(count)}` : `Check date cleared · ${plural(count)}`),
    );
  }, [applyChanges, today]);

  const setPriority = useCallback((targets: ManagerTask[], priority: TaskPriority) => {
    void applyChanges(
      targets,
      (task) => (task.priority === priority ? null : { priority }),
      (count) => `${plural(count)} → ${priority === 'high' ? 'High' : 'Normal'} priority`,
    );
  }, [applyChanges]);

  /**
   * docs/51 F7: Alt+↑/↓ reorders the focused task inside its plan-date block
   * (only on schedule-grouped views). The whole same-date block is rewritten
   * with dense positions so new inserts land predictably. Reorder goes through
   * `mutations.apply` directly — pinning rows would defeat the point.
   */
  const reorderInBucket = useCallback((taskKey: string, delta: -1 | 1) => {
    if (definition?.group !== 'scheduled') return;
    const group = groups.find(
      (candidate) => candidate.context.mode === 'scheduled' && candidate.tasks.some((row) => row.taskKey === taskKey),
    );
    if (!group) return;
    const rows = group.tasks;
    const index = rows.findIndex((row) => row.taskKey === taskKey);
    if (index < 0) return;
    const planDate = taskPlanDate(rows[index]!).date;
    let lo = index;
    let hi = index;
    while (lo > 0 && taskPlanDate(rows[lo - 1]!).date === planDate) lo -= 1;
    while (hi < rows.length - 1 && taskPlanDate(rows[hi + 1]!).date === planDate) hi += 1;
    const target = index + delta;
    if (target < lo || target > hi) return;
    const order = rows.slice(lo, hi + 1).map((row) => row.taskKey);
    order.splice(target - lo, 0, ...order.splice(index - lo, 1));
    const items: TaskChangeItem[] = order
      .map((key, position) => ({ task: rowByKey.get(key)!, changes: { schedulePosition: position } }))
      .filter((item) => item.task.schedulePosition !== item.changes.schedulePosition);
    if (!items.length) return;
    void mutations.apply(items, { label: 'Reordered tasks' });
  }, [definition?.group, groups, mutations, rowByKey]);

  const schedule = useCallback((targets: ManagerTask[], preset: SchedulePreset) => {
    const changes = scheduleChanges(preset, today);
    void applyChanges(
      targets,
      // Developer-owned tasks cannot be Later (server rule) — skip them.
      (task) => (preset === 'later' && task.ownerType === 'developer' ? null : changes),
      (count) => `${SCHEDULE_LABELS[preset]} · ${plural(count)}`,
    );
  }, [applyChanges, today]);

  const assign = useCallback((targets: ManagerTask[], target: AssignTarget) => {
    const ownerId = target.ownerType === 'manager' ? user?.accountId ?? null : target.ownerId;
    const name = target.ownerType ? ownerName(target.ownerType, ownerId) : 'Inbox';
    void applyChanges(
      targets,
      (task) => {
        // Closed work must be reopened before reassigning (server rule).
        if (!isOpenStatus(task.status) || (task.ownerType === target.ownerType && task.ownerId === ownerId)) return null;
        return { ownerType: target.ownerType, ownerId, ...(target.ownerType === 'developer' && task.later ? { later: false } : {}) };
      },
      (count) => `Assigned ${plural(count)} to ${name}`,
    );
  }, [applyChanges, ownerName, user?.accountId]);

  const drop = useCallback((targets: ManagerTask[]) => {
    void applyChanges(targets, (task) => (task.status === 'dropped' ? null : { status: 'dropped' }), (count) => `Dropped ${plural(count)}`);
  }, [applyChanges]);

  const toggleLabel = useCallback((targets: ManagerTask[], label: string, on: boolean) => {
    // Label toggles are reversible in the open menu itself — no undo toast.
    void applyChanges(
      targets,
      (task) => {
        const has = task.labels.includes(label);
        if (has === on) return null;
        return { labels: on ? [...task.labels, label] : task.labels.filter((entry) => entry !== label) };
      },
      (count) => `Labels updated on ${plural(count)}`,
      { undoable: false },
    );
  }, [applyChanges]);

  // ── Drawer ───────────────────────────────────────────────────────────────
  const openTask = useCallback((taskKey: string) => {
    drawerOrigin.current = taskKey;
    setDrawerTaskKey(taskKey);
    writeTaskParam(taskKey);
  }, []);
  const closeDrawer = () => {
    setDrawerTaskKey(undefined);
    writeTaskParam(undefined);
    // §7: focus returns to the row that opened the drawer.
    if (drawerOrigin.current) focusRow(drawerOrigin.current, { dom: true });
  };

  // ── Menus ────────────────────────────────────────────────────────────────
  const openMenu = useCallback((kind: TaskMenuKind, keys: string[], anchor: HTMLElement | null) => {
    if (!keys.length || !anchor) return;
    setMenu({ kind, keys, anchor });
  }, []);
  const closeMenu = useCallback(() => {
    const anchor = menu?.anchor;
    setMenu(null);
    requestAnimationFrame(() => {
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
      else focusDom(focusedKeyRef.current);
    });
  }, [focusDom, menu]);
  const menuTargets = useMemo(
    () => (menu ? menu.keys.map((key) => rowByKey.get(key)).filter((task): task is NonNullable<typeof task> => Boolean(task)) : []),
    [menu, rowByKey],
  );

  // ── Selection ────────────────────────────────────────────────────────────
  const selectRow = useCallback((key: string, mode: 'toggle' | 'range') => {
    setSelected((current) => {
      const next = new Set(current);
      if (mode === 'range' && selectionAnchor.current) {
        const keys = flatRows.map((row) => row.taskKey);
        const [a, b] = [keys.indexOf(selectionAnchor.current), keys.indexOf(key)].sort((x, y) => x - y);
        if (a! >= 0 && b! >= 0) for (const rangeKey of keys.slice(a, b! + 1)) next.add(rangeKey);
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    selectionAnchor.current = key;
    focusRow(key);
  }, [flatRows, focusRow]);

  const handlers = useRef<TaskRowHandlers>(null as unknown as TaskRowHandlers);
  handlers.current = {
    onFocusRow: (key) => focusRow(key),
    onOpen: openTask,
    onSelect: selectRow,
    onMenu: (key, kind, anchor) => openMenu(kind, targetsFor(key).map((task) => task.taskKey), anchor),
    onToggleDone: (key) => toggleDone(targetsFor(key)),
    onCaptureOutcome: (key) => setOutcomeTask(rowByKey.get(key) ?? null),
  };
  const stableHandlers = useMemo<TaskRowHandlers>(() => ({
    onFocusRow: (key) => handlers.current.onFocusRow(key),
    onOpen: (key) => handlers.current.onOpen(key),
    onSelect: (key, mode) => handlers.current.onSelect(key, mode),
    onMenu: (key, kind, anchor) => handlers.current.onMenu(key, kind, anchor),
    onToggleDone: (key) => handlers.current.onToggleDone(key),
    onCaptureOutcome: (key) => handlers.current.onCaptureOutcome?.(key),
  }), []);

  // ── Keyboard (§7) ────────────────────────────────────────────────────────
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    // Overlays (drawer, menus, cheat sheet) own the keyboard while open.
    if (drawerTaskKey || menu || showShortcuts) return;
    const move = (delta: number, extend: boolean) => {
      if (!flatRows.length) return;
      const index = flatRows.findIndex((row) => row.taskKey === focusedKeyRef.current);
      const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(flatRows.length - 1, index + delta));
      const nextKey = flatRows[nextIndex]!.taskKey;
      if (extend) {
        const previousKey = focusedKeyRef.current;
        setSelected((current) => {
          const next = new Set(current);
          if (previousKey) next.add(previousKey);
          next.add(nextKey);
          return next;
        });
      }
      focusRow(nextKey, { dom: true });
    };
    const focused = focusedKeyRef.current;
    const anchor = focused ? rowElement(focused)?.querySelector<HTMLElement>('[data-task-open]') ?? null : null;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    // docs/51 F7: Alt+↑/↓ reorders the focused row within its day bucket on
    // schedule-grouped views. Alt+anything-else keeps its normal behavior.
    if (event.altKey) {
      goChordArmed.current = false;
      if (focused && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        reorderInBucket(focused, event.key === 'ArrowDown' ? 1 : -1);
        event.preventDefault();
      }
      return;
    }
    // `g` arms a view chord; the next letter switches the rail view. A
    // non-view key after `g` falls through and works normally.
    if (goChordArmed.current) {
      goChordArmed.current = false;
      const viewId = GO_CHORD_VIEWS[key];
      if (viewId) {
        setView(viewId);
        event.preventDefault();
        return;
      }
    }
    if (key === 'g') {
      goChordArmed.current = true;
      if (goChordTimer.current) window.clearTimeout(goChordTimer.current);
      goChordTimer.current = window.setTimeout(() => { goChordArmed.current = false; }, GO_CHORD_TIMEOUT_MS);
      event.preventDefault();
      return;
    }
    let handled = true;
    switch (key) {
      case 'j': case 'ArrowDown': move(1, event.shiftKey); break;
      case 'k': case 'ArrowUp': move(-1, event.shiftKey); break;
      case 'Enter': case 'o': if (focused) openTask(focused); else handled = false; break;
      case 'x': if (focused) selectRow(focused, 'toggle'); break;
      case 'e': toggleDone(targetsFor()); break;
      case 's': openMenu('schedule', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'a': openMenu('assign', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'l': openMenu('label', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'p': openMenu('priority', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'w': openMenu('waiting', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'c': openMenu('checkBy', targetsFor().map((task) => task.taskKey), anchor); break;
      case '#': drop(targetsFor()); break;
      case 'n': {
        const group = groups.find((candidate) => candidate.tasks.some((row) => row.taskKey === focused)) ?? groups[0];
        // docs/51 F14: an empty, unfiltered view still hosts an add row.
        if (group) setAddingGroup(group.key);
        else if (canAddToEmptyView) setAddingGroup(EMPTY_ADD_KEY);
        else handled = false;
        break;
      }
      case '/': searchRef.current?.focus(); break;
      case 'z': if (!mutations.undoLast()) handled = false; break;
      case '?': if (!openKeyboardShortcuts) openShortcuts(); else handled = false; break;
      case 'Escape':
        if (selected.size) setSelected(new Set());
        else if (state.q) setState((current) => ({ ...current, q: undefined }));
        else handled = false;
        break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey) return;
      if (event.key === '?' && shouldIgnoreShortcutHelp(event)) return;
      // docs/51 F7: Alt pairs only with ↑/↓ — every other Alt combo is ignored.
      if (event.altKey && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !mainRef.current?.contains(active)) return;
      if (active && isEditable(active)) return;
      // Let focused buttons (chips, rail items) keep Space/Enter.
      if ((['BUTTON', 'SUMMARY'].includes(active?.tagName ?? '') || (active instanceof HTMLInputElement && active.type === 'checkbox')) && (event.key === ' ' || event.key === 'Enter')) return;
      keyHandler.current(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── View state setters ───────────────────────────────────────────────────
  const setView = (view: string | undefined) =>
    setState((current) => (view === current.view && view !== 'projects' ? current : { view, overrides: {} }));
  const setOverrides = (overrides: Partial<TaskViewOverrides>) =>
    setState((current) => {
      const merged: TaskViewOverrides = { ...current.overrides, ...overrides };
      for (const field of Object.keys(merged) as (keyof TaskViewOverrides)[]) if (merged[field] === undefined) delete merged[field];
      return { ...current, overrides: merged };
    });
  const navigateProject = (project?: number, track?: number) => {
    const next: TaskViewUrlState = { view: 'projects', overrides: { ...(project && { project }), ...(track && { track }) } };
    window.history.pushState(null, '', `/tasks?${taskViewParamsFromState(next)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setState(next);
  };
  const clearFilters = () => setState((current) => ({ view: current.view, overrides: projectsMode ? { ...(projectId && { project: projectId }), ...(trackId && { track: trackId }) } : {} }));

  const savedSelected = selectedView && !selectedView.builtin ? selectedView : undefined;

  const handleSaveView = async (name: string): Promise<boolean> => {
    if (!definition) return false;
    try {
      const created = await saveView.mutateAsync({ name, definition });
      setState({ view: `saved:${created.id}`, overrides: {} });
      addToast('View saved', 'success');
      return true;
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not save view', 'error');
      return false;
    }
  };
  const handleUpdateSaved = () => {
    if (!savedSelected || !definition) return;
    void updateView.mutateAsync({ id: Number(savedSelected.id.slice(6)), updates: { definition } }).then(
      () => {
        setState((current) => ({ ...current, overrides: {} }));
        addToast('View updated', 'success');
      },
      (error: Error) => addToast(error.message, 'error'),
    );
  };
  const handleDeleteSaved = async (view: TaskViewMeta) => {
    try {
      await deleteView.mutateAsync(Number(view.id.slice(6)));
      if (view.id === selectedId) setState({ view: undefined, overrides: {} });
      // docs/51 F10: deletes are undoable — Undo recreates the view with its
      // original definition so nothing is lost.
      addToast({
        type: 'success',
        title: `Deleted view "${view.name}"`,
        duration: UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            void saveView.mutateAsync({ name: view.name, definition: view.definition }).then(
              () => addToast('View restored', 'success'),
              (error: Error) => addToast(error.message, 'error'),
            );
          },
        },
      });
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not delete view', 'error');
    }
  };
  const handleRenameSaved = async (view: TaskViewMeta, name: string): Promise<boolean> => {
    if (!name.trim() || name.trim() === view.name) return true;
    try {
      await updateView.mutateAsync({ id: Number(view.id.slice(6)), updates: { name: name.trim() } });
      addToast('View renamed', 'success');
      return true;
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not rename view', 'error');
      return false;
    }
  };

  const handleInlineAdd = async (context: TaskGroupContext, title: string): Promise<boolean> => {
    try {
      // docs/57 §3 (P3-05): inline add is a capture — tokens in the title work,
      // and the group's context (date, owner, waiting party…) fills the rest.
      const { warnings } = await mutations.create.mutateAsync({
        text: title,
        defaults: inlineCaptureDefaults(selectedView?.id, definition, context, today),
      });
      if (warnings.length) addToast({ type: 'warning', title: 'Added with warnings', message: warnings.map((warning) => warning.message).join(' ') });
      return true;
    } catch (error) {
      addToast({ type: 'error', title: 'Could not add task', message: error instanceof Error ? error.message : undefined });
      return false;
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const countData = counts.data?.counts;
  const candidates = Math.max(0, (countData?.['my-tasks']?.count ?? 0) - (countData?.today?.count ?? 0)) + (countData?.inbox?.count ?? 0);
  const firstLoad = tasks.isLoading && !tasks.data;
  const updating = tasks.isFetching && tasks.isPlaceholderData;
  // docs/51 F14: add is offered on empty views unless filters/search narrowed
  // the result or the view is a read-only queue.
  const canAddToEmptyView = !(projectDetail.data?.project.archivedAt || projectDetail.data?.tracks.find((track) => track.id === trackId)?.archivedAt) && (!overridesActive || projectsMode) && !state.q && selectedView?.id !== 'attention' && selectedView?.id !== 'closed-week';
  const visibleCount = tasks.data
    ? flatRows.filter((row) => !row.lingering && !doneTodayKeys.has(row.taskKey)).length
    : undefined;
  const menuTarget = menuTargets[0];
  const orderedKeys = useMemo(() => flatRows.map((row) => row.taskKey), [flatRows]);

  const taskToolbar = (
    <TaskToolbar
          ref={searchRef}
          projectContext={projectsMode}
          title={projectsMode ? (trackId ? 'Track tasks' : definition?.filters?.track === 'none' ? 'Project tasks · no track' : 'Project tasks · all tracks') : selectedView?.name ?? 'Tasks'}
          count={showTaskList ? visibleCount : undefined}
          narrowed={listNarrowed}
          updating={updating}
          views={allViews}
          counts={countData}
          viewId={selectedView?.id ?? selectedId}
          onSelectView={(id) => setView(id)}
          overrides={toolbarOverrides}
          onOverrides={setOverrides}
          query={state.q ?? ''}
          onQuery={(q) => setState((current) => ({ ...current, q: q || undefined }))}
          effectiveSort={definition?.sort}
          effectivePriority={definition?.filters?.priority}
          defaultPriority={selectedView?.definition.filters?.priority}
          effectiveGroup={definition?.group ?? 'none'}
          developers={assignableDevelopers}
          labels={labelRegistry}
          isSavedView={Boolean(savedSelected)}
          hasOverrides={hasTaskViewOverrides(toolbarOverrides)}
          // A CSV is read by others, so the manager stays "Me" there.
          onExport={() => downloadCsv(tasksCsv(baseGroups.flatMap((group) => group.tasks), (type, id) => { const name = ownerName(type, id); return name === 'You' ? 'Me' : name; }, today), csvFileName('tasks', selectedId, today))}
          canExport={Boolean(tasks.data) && !tasks.isPlaceholderData}
          onSaveView={handleSaveView}
          saving={saveView.isPending}
          canSave={Boolean(definition)}
          onUpdateView={handleUpdateSaved}
          onRevert={clearFilters}
          onShowShortcuts={openShortcuts}
        />
  );

  return (
    <main ref={mainRef} className="flex min-h-0 flex-1 overflow-hidden" aria-label="Tasks">
      <TaskViewRail
        views={allViews}
        counts={countData}
        selectedId={selectedView?.id ?? selectedId}
        onSelect={(id) => setView(id)}
        onRename={handleRenameSaved}
        onDelete={handleDeleteSaved}
      />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {!projectsMode && taskToolbar}
        {projectsMode && <div className="px-5 pt-3 md:hidden"><TaskWorkspaceSelect views={allViews} counts={countData} viewId={selectedId} onSelectView={setView} /></div>}

        <div
          ref={listScrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          // docs/51 U6: track the row under the pointer so mouse pins release once it moves on.
          onPointerMove={(event) => {
            hoveredRow.current = (event.target as Element).closest?.('[data-task-row]')?.getAttribute('data-task-row') ?? null;
            if (pointerPins.current) releasePointerPins();
          }}
          onPointerLeave={() => {
            hoveredRow.current = null;
            if (pointerPins.current) releasePointerPins();
          }}
        >
          {projectsMode ? <ProjectsPanel query={state.q ?? ''} searchRef={searchRef} onQuery={(q) => setState((current) => ({ ...current, q: q || undefined }))} today={today} projectId={projectId} trackId={trackId} archived={state.archived ?? false} onNavigate={navigateProject} onArchiveFilter={(archived) => setState((current) => ({ ...current, archived }))} openTask={(key) => { setDrawerTaskKey(key); writeTaskParam(key); }} /> : <ProjectFilters today={today} definition={definition} onChange={setOverrides} />}
          {projectsMode && showTaskList && taskToolbar}
          {showTaskList && tasks.isError && (
            <TaskListError
              message={tasks.error instanceof Error ? tasks.error.message : 'Could not load tasks'}
              onRetry={() => void tasks.refetch()}
            />
          )}
          {!showTaskList ? null : firstLoad ? (
            <TaskListSkeleton grouped={Boolean(definition?.group)} />
          ) : !tasks.data ? null : flatRows.length === 0 && !doneTodayRows.length ? (
            <>
              <TaskListEmpty
                viewId={selectedView?.id}
                archived={projectsMode && Boolean(projectDetail.data?.project.archivedAt || projectDetail.data?.tracks.find((track) => track.id === trackId)?.archivedAt)}
                filtered={listNarrowed}
                signal={state.overrides.signal}
                candidates={candidates}
                onPlanDay={() => setView('my-tasks')}
                onClearFilters={clearFilters}
              />
              {/* docs/51 F14: a real add row, not a fake second task list — `n` opens it. */}
              {canAddToEmptyView && (
                <div className={TASK_LIST_CONTAINER}>
                  <InlineAddRow
                    active={addingGroup === EMPTY_ADD_KEY}
                    onStart={() => setAddingGroup(EMPTY_ADD_KEY)}
                    onCancel={() => setAddingGroup(null)}
                    onSubmit={(title) => handleInlineAdd({ mode: 'none' }, title)}
                    groupLabel=""
                  />
                </div>
              )}
            </>
          ) : (
            <TaskList
              scrollRef={listScrollRef}
              allowAdd={!(projectDetail.data?.project.archivedAt || projectDetail.data?.tracks.find((track) => track.id === trackId)?.archivedAt)}
              groups={displayGroups}
              definition={definition}
              today={today}
              attentionMode={selectedView?.id === 'attention'}
              focusedKey={focusedKey}
              selected={selected}
              ownerName={ownerName}
              labelColor={labelColor}
              handlers={stableHandlers}
              addingGroup={addingGroup}
              onStartAdd={setAddingGroup}
              onCancelAdd={() => setAddingGroup(null)}
              onSubmitAdd={handleInlineAdd}
              onMoveOverdueToToday={(rows) => schedule(rows, 'today')}
              onToggleGroup={(key) => { if (key === 'done-today') setDoneTodayOpen((open) => !open); }}
            />
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <AnimatePresence>
            {selected.size > 0 && (
              <TaskBulkBar
                count={selected.size}
                onDone={() => toggleDone(targetsFor())}
                onMenu={(kind, anchor) => openMenu(kind, [...selected], anchor)}
                onDrop={() => drop(targetsFor())}
                onClear={() => setSelected(new Set())}
              />
            )}
          </AnimatePresence>
        </div>
      </section>

      {menu?.kind === 'project' && <PlacementDialog keys={menu.keys} initial={menuTargets.length === 1 ? menuTargets[0]?.placement : null} onClose={closeMenu} />}
      {menu?.kind === 'status' && (
        <StatusMenu
          anchor={menu.anchor}
          current={menuTargets.length === 1 ? menuTarget?.status : undefined}
          onClose={closeMenu}
          onSelect={(status) => { setStatus(menuTargets, status); closeMenu(); }}
        />
      )}
      {menu?.kind === 'schedule' && (
        <ScheduleMenu
          anchor={menu.anchor}
          today={today}
          current={menuTargets.length === 1 ? menuTarget?.scheduledOn : undefined}
          laterActive={menuTargets.length === 1 ? menuTarget?.later : undefined}
          allowLater={menuTargets.some((task) => task.ownerType !== 'developer')}
          onClose={closeMenu}
          onSelect={(preset) => { schedule(menuTargets, preset); closeMenu(); }}
          onPickDate={(date) => {
            void applyChanges(
              menuTargets,
              (task) => (task.scheduledOn === date && !task.later ? null : { scheduledOn: date, later: false }),
              (count) => `Scheduled for ${shortDay(date, today)} · ${plural(count)}`,
            );
            closeMenu();
          }}
        />
      )}
      {menu?.kind === 'assign' && (
        <AssignMenu
          anchor={menu.anchor}
          developers={assignableDevelopers}
          onClose={closeMenu}
          onSelect={(target) => { assign(menuTargets, target); closeMenu(); }}
        />
      )}
      {menu?.kind === 'label' && (
        <LabelMenu
          anchor={menu.anchor}
          labels={labelRegistry}
          stateFor={(name) => {
            const having = menuTargets.filter((task) => task.labels.includes(name)).length;
            return having === 0 ? false : having === menuTargets.length ? true : 'mixed';
          }}
          onClose={closeMenu}
          onToggle={(name, on) => toggleLabel(menuTargets, name, on)}
        />
      )}
      {menu?.kind === 'priority' && (
        <PriorityMenu
          anchor={menu.anchor}
          current={menuTargets.length === 1 ? menuTarget?.priority : undefined}
          onClose={closeMenu}
          onSelect={(priority) => { setPriority(menuTargets, priority); closeMenu(); }}
        />
      )}
      {menu?.kind === 'waiting' && (
        <WaitingMenu
          anchor={menu.anchor}
          developers={assignableDevelopers}
          contacts={contacts.data ?? []}
          current={menuTargets.some((task) => Boolean(task.waitingOn))}
          onClose={closeMenu}
          onSelect={(waitingOn) => { setWaitingOn(menuTargets, waitingOn); closeMenu(); }}
        />
      )}
      {outcomeTask && (
        <TodayTextCaptureDialog
          title="Capture outcome"
          description={outcomeTask.title}
          label="Meeting outcome"
          saveLabel="Save outcome"
          multiline
          isSaving={false}
          onClose={() => setOutcomeTask(null)}
          onSave={(value) => {
            const target = outcomeTask;
            setOutcomeTask(null);
            // The same write as Today's Capture outcome: the outcome closes the meeting.
            void applyChanges([target], () => ({ outcome: value.trim(), status: 'done' }), () => `Outcome saved for ${target.taskKey}`);
          }}
        />
      )}
      {menu?.kind === 'checkBy' && (
        <CheckByMenu
          anchor={menu.anchor}
          today={today}
          current={menuTargets.length === 1 ? localDateOf(menuTarget?.followUpAt) : undefined}
          onClose={closeMenu}
          onPick={(date) => { setCheckBy(menuTargets, date); closeMenu(); }}
        />
      )}
      {menu?.kind === 'more' && menuTarget && (
        <MoreMenu
          anchor={menu.anchor}
          canLater={menuTargets.some((task) => task.ownerType !== 'developer')}
          onClose={closeMenu}
          onSchedule={() => setMenu({ ...menu, kind: 'schedule' })}
          onStatus={() => setMenu({ ...menu, kind: 'status' })}
          onAssign={() => setMenu({ ...menu, kind: 'assign' })}
          onProject={() => setMenu({ ...menu, kind: 'project' })}
          onLabels={() => setMenu({ ...menu, kind: 'label' })}
          onPriority={() => setMenu({ ...menu, kind: 'priority' })}
          onWaiting={() => setMenu({ ...menu, kind: 'waiting' })}
          onCheckBy={() => setMenu({ ...menu, kind: 'checkBy' })}
          onLater={() => { schedule(menuTargets, 'later'); closeMenu(); }}
          onDrop={() => { drop(menuTargets); closeMenu(); }}
          onCopyLink={() => {
            // docs/51 F11: toast only after the clipboard write really lands.
            const url = `${window.location.origin}/t/${menuTarget.taskKey}`;
            closeMenu();
            if (!navigator.clipboard?.writeText) {
              addToast('Clipboard unavailable — could not copy link', 'error');
              return;
            }
            navigator.clipboard.writeText(url).then(
              () => addToast('Link copied', 'success'),
              () => addToast('Could not copy link', 'error'),
            );
          }}
        />
      )}
      {showShortcuts && <TaskShortcutsDialog anchor={shortcutsAnchor} onClose={() => setShortcutsAnchor(null)} />}

      <TaskDrawer
        taskKey={drawerTaskKey ?? null}
        orderedKeys={orderedKeys}
        onStepTask={(key) => {
          // docs/51 F19: j/k inside the drawer steps through the list order.
          drawerOrigin.current = key;
          setDrawerTaskKey(key);
          writeTaskParam(key);
          focusRow(key);
        }}
        onClose={closeDrawer}
        onNavigateTask={(key) => {
          closeDrawer();
          navigateToTaskPage(key);
        }}
      />
    </main>
  );
}
