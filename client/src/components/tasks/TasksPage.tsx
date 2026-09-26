import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
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
  inlineAddDefaults,
  isOpenStatus,
  lingerEntriesFor,
  optimisticTask,
  scheduleChanges,
  searchTasks,
  toggledDoneStatus,
  type LingerEntry,
  type RenderGroup,
  type SchedulePreset,
} from '@/lib/task-list';
import { taskKeyFromParams, writeTaskParam } from '@/lib/view-params';
import type { ManagerTask, TaskStatus, TaskViewMeta, UpdateTaskRequest } from '@/types';
import { TaskDrawer, navigateToTaskPage } from './TaskDrawer';
import { TaskBulkBar } from './TaskBulkBar';
import { TaskList } from './TaskList';
import type { TaskRowHandlers } from './TaskListRow';
import { TaskListEmpty, TaskListError, TaskListSkeleton, TaskShortcutsDialog } from './TaskListStates';
import { AssignMenu, LabelMenu, MoreMenu, ScheduleMenu, StatusMenu, type AssignTarget, type TaskMenuKind } from './TaskMenus';
import { TaskToolbar } from './TaskToolbar';
import { TaskViewRail } from './TaskViewRail';

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

function isEditable(element: HTMLElement): boolean {
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
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
  const [lingering, setLingering] = useState<Map<string, LingerEntry>>(() => new Map());
  const [menu, setMenu] = useState<OpenMenuState | null>(null);
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  // ── View + data ──────────────────────────────────────────────────────────
  const allViews = useMemo(() => views.data?.views ?? [], [views.data]);
  const selectedId = state.view ?? DEFAULT_TASK_VIEW_ID;
  const selectedView: TaskViewMeta | undefined =
    allViews.find((view) => view.id === selectedId) ?? allViews.find((view) => view.id === DEFAULT_TASK_VIEW_ID) ?? allViews[0];
  const definition = useMemo(
    () => (selectedView ? applyTaskViewOverrides(selectedView.definition, state.overrides) : undefined),
    [selectedView, state.overrides],
  );
  const tasks = useTaskViewTasks(definition, Boolean(definition), today);
  const taskList = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const overridesActive = hasTaskViewOverrides(state.overrides);

  const developerList = useMemo(() => developers.data ?? [], [developers.data]);
  const ownerName = useCallback(
    (ownerType: string | null, ownerId: string | null) => {
      if (ownerType === 'developer' && ownerId) {
        return developerList.find((dev) => dev.accountId === ownerId)?.displayName ?? 'Developer';
      }
      return ownerType ? 'Me' : 'Inbox';
    },
    [developerList],
  );
  const labelRegistry = useMemo(() => labels.data?.labels ?? [], [labels.data]);
  const labelColors = useMemo(() => new Map(labelRegistry.map((label) => [label.name, label.color])), [labelRegistry]);
  const labelColor = useCallback((name: string) => labelColors.get(name), [labelColors]);

  const baseGroups = useMemo<RenderGroup[]>(
    () => groupTaskViewTasks(searchTasks(taskList, state.q), definition?.group, today, ownerName),
    [taskList, state.q, definition?.group, today, ownerName],
  );
  const groups = useMemo(() => applyLingering(baseGroups, lingering), [baseGroups, lingering]);
  const flatRows = useMemo(() => groups.flatMap((group) => group.tasks), [groups]);
  const rowByKey = useMemo(() => new Map(flatRows.map((row) => [row.taskKey, row])), [flatRows]);

  // ── Lingering / selection / focus housekeeping ───────────────────────────
  const clearLingering = useCallback(() => setLingering((current) => (current.size ? new Map() : current)), []);

  const viewSignature = `${selectedView?.id}|${JSON.stringify(state.overrides)}|${state.q ?? ''}`;
  useEffect(() => {
    // R2(b): view, overrides or search changes drop lingering rows.
    clearLingering();
    setAddingGroup(null);
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
      const element = rowElement(key);
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
    if (!items.length) {
      if (skipped) addToast({ type: 'info', title: `Nothing to change — skipped ${plural(skipped)}` });
      return;
    }
    // R1: pin acted-on rows where they are, showing their new state.
    const entries = lingerEntriesFor(groups, items.map((item) => optimisticTask(item.task, item.changes)));
    setLingering((current) => {
      const next = new Map(current);
      for (const [key, entry] of entries) next.set(key, current.get(key) ? { ...current.get(key)!, task: entry.task } : entry);
      return next;
    });
    await mutations.apply(items, {
      label: `${label(items.length)}${skipped ? ` · skipped ${skipped}` : ''}`,
      undoable: options.undoable,
      onUndo: clearLingering,
    });
  }, [addToast, clearLingering, groups, mutations]);

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
      (count) => `${plural(count)} → ${status}`,
    );
  }, [applyChanges]);

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
    setMenu(null);
    focusDom(focusedKeyRef.current);
  }, [focusDom]);
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
  };
  const stableHandlers = useMemo<TaskRowHandlers>(() => ({
    onFocusRow: (key) => handlers.current.onFocusRow(key),
    onOpen: (key) => handlers.current.onOpen(key),
    onSelect: (key, mode) => handlers.current.onSelect(key, mode),
    onMenu: (key, kind, anchor) => handlers.current.onMenu(key, kind, anchor),
    onToggleDone: (key) => handlers.current.onToggleDone(key),
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
        setSelected((current) => {
          const next = new Set(current);
          if (focusedKeyRef.current) next.add(focusedKeyRef.current);
          next.add(nextKey);
          return next;
        });
      }
      focusRow(nextKey, { dom: true });
    };
    const focused = focusedKeyRef.current;
    const anchor = focused ? rowElement(focused) : null;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let handled = true;
    switch (key) {
      case 'j': case 'ArrowDown': move(1, event.shiftKey); break;
      case 'k': case 'ArrowUp': move(-1, event.shiftKey); break;
      case 'Enter': case 'o': if (focused) openTask(focused); else handled = false; break;
      case 'x': if (focused) selectRow(focused, 'toggle'); break;
      case ' ': case 'e': toggleDone(targetsFor()); break;
      case 's': openMenu('schedule', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'a': openMenu('assign', targetsFor().map((task) => task.taskKey), anchor); break;
      case 'l': openMenu('label', targetsFor().map((task) => task.taskKey), anchor); break;
      case '#': drop(targetsFor()); break;
      case 'n': {
        const group = groups.find((candidate) => candidate.tasks.some((row) => row.taskKey === focused)) ?? groups[0];
        if (group) setAddingGroup(group.key);
        break;
      }
      case '/': searchRef.current?.focus(); break;
      case '?': setShowShortcuts(true); break;
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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !mainRef.current?.contains(active)) return;
      if (active && isEditable(active)) return;
      // Let focused buttons (chips, rail items) keep Space/Enter.
      if (active?.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
      keyHandler.current(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── View state setters ───────────────────────────────────────────────────
  const setView = (view: string | undefined) =>
    setState((current) => (view === current.view ? current : { view, overrides: {} }));
  const setOverrides = (overrides: Partial<TaskViewOverrides>) =>
    setState((current) => {
      const merged: TaskViewOverrides = { ...current.overrides, ...overrides };
      for (const field of Object.keys(merged) as (keyof TaskViewOverrides)[]) if (merged[field] === undefined) delete merged[field];
      return { ...current, overrides: merged };
    });
  const clearFilters = () => setState((current) => ({ view: current.view, overrides: {} }));

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
      addToast('View deleted', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not delete view', 'error');
    }
  };
  const handleRenameSaved = async (view: TaskViewMeta) => {
    const name = window.prompt('Rename view', view.name)?.trim();
    if (!name || name === view.name) return;
    try {
      await updateView.mutateAsync({ id: Number(view.id.slice(6)), updates: { name } });
      addToast('View renamed', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not rename view', 'error');
    }
  };

  const handleInlineAdd = async (context: TaskGroupContext, title: string): Promise<boolean> => {
    try {
      await mutations.create.mutateAsync({ title, ...inlineAddDefaults(selectedView?.id, definition, context, today) });
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
  const visibleCount = tasks.data ? flatRows.filter((row) => !row.lingering).length : undefined;
  const menuTarget = menuTargets[0];

  return (
    <main ref={mainRef} className="flex min-h-0 flex-1 overflow-hidden" aria-label="Tasks">
      <TaskViewRail
        views={allViews}
        counts={countData}
        selectedId={selectedView?.id ?? selectedId}
        onSelect={(id) => setView(id)}
        onRename={handleRenameSaved}
        onDelete={handleDeleteSaved}
        onSaveView={handleSaveView}
        saving={saveView.isPending}
        canSave={Boolean(definition)}
      />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TaskToolbar
          ref={searchRef}
          title={selectedView?.name ?? 'Tasks'}
          count={visibleCount}
          updating={updating}
          views={allViews}
          viewId={selectedView?.id ?? selectedId}
          onSelectView={(id) => setView(id)}
          overrides={state.overrides}
          onOverrides={setOverrides}
          query={state.q ?? ''}
          onQuery={(q) => setState((current) => ({ ...current, q: q || undefined }))}
          effectiveSort={definition?.sort}
          effectiveGroup={definition?.group ?? 'none'}
          developers={developerList}
          labels={labelRegistry}
          isSavedView={Boolean(savedSelected)}
          hasOverrides={overridesActive}
          onUpdateView={handleUpdateSaved}
          onRevert={clearFilters}
          onShowShortcuts={() => setShowShortcuts(true)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tasks.isError && (
            <TaskListError
              message={tasks.error instanceof Error ? tasks.error.message : 'Could not load tasks'}
              onRetry={() => void tasks.refetch()}
            />
          )}
          {firstLoad ? (
            <TaskListSkeleton />
          ) : !tasks.data ? null : flatRows.length === 0 ? (
            <>
              <TaskListEmpty
                viewId={selectedView?.id}
                filtered={overridesActive || Boolean(state.q)}
                signal={state.overrides.signal}
                candidates={candidates}
                onPlanDay={() => setView('my-tasks')}
                onClearFilters={() => setState((current) => ({ view: current.view, overrides: {} }))}
              />
              {!overridesActive && !state.q && selectedView?.id !== 'attention' && selectedView?.id !== 'closed-week' && (
                <div className="mx-auto max-w-md">
                  <TaskList
                    groups={[{ key: 'empty', label: '', tasks: [], context: { mode: 'none' } }]}
                    definition={definition}
                    today={today}
                    attentionMode={false}
                    focusedKey={undefined}
                    selected={selected}
                    ownerName={ownerName}
                    labelColor={labelColor}
                    handlers={stableHandlers}
                    addingGroup={addingGroup}
                    onStartAdd={setAddingGroup}
                    onCancelAdd={() => setAddingGroup(null)}
                    onSubmitAdd={handleInlineAdd}
                    onMoveOverdueToToday={() => {}}
                  />
                </div>
              )}
            </>
          ) : (
            <TaskList
              groups={groups}
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
          allowLater={menuTargets.some((task) => task.ownerType !== 'developer')}
          onClose={closeMenu}
          onSelect={(preset) => { schedule(menuTargets, preset); closeMenu(); }}
        />
      )}
      {menu?.kind === 'assign' && (
        <AssignMenu
          anchor={menu.anchor}
          developers={developerList}
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
      {menu?.kind === 'more' && menuTarget && (
        <MoreMenu
          anchor={menu.anchor}
          canLater={menuTargets.some((task) => task.ownerType !== 'developer')}
          onClose={closeMenu}
          onOpen={() => { closeMenu(); openTask(menuTarget.taskKey); }}
          onStatus={() => setMenu({ ...menu, kind: 'status' })}
          onAssign={() => setMenu({ ...menu, kind: 'assign' })}
          onLabels={() => setMenu({ ...menu, kind: 'label' })}
          onLater={() => { schedule(menuTargets, 'later'); closeMenu(); }}
          onDrop={() => { drop(menuTargets); closeMenu(); }}
          onCopyLink={() => {
            void navigator.clipboard?.writeText(`${window.location.origin}/t/${menuTarget.taskKey}`);
            addToast('Link copied', 'success');
            closeMenu();
          }}
        />
      )}
      {showShortcuts && <TaskShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      <TaskDrawer
        taskKey={drawerTaskKey ?? null}
        onClose={closeDrawer}
        onNavigateTask={(key) => {
          closeDrawer();
          navigateToTaskPage(key);
        }}
      />
    </main>
  );
}
