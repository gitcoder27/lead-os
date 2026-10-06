import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Briefcase,
  Bug,
  CalendarClock,
  ClipboardList,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sunrise,
  User,
  Users,
  Video,
  Loader2,
} from 'lucide-react';
import type { AppView } from '@/App';
import type { TodayActionTarget } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useCreateManagerDeskItem } from '@/hooks/useManagerDesk';
import { useCaptureTask } from '@/hooks/useCapture';
import { getLocalIsoDate } from '@/lib/utils';
import { useDevelopers } from '@/hooks/useDevelopers';
import { GLOBAL_SEARCH_MIN_LENGTH, useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import {
  buildNavigationCommands,
  buildOneOnOneCommands,
  buildQuickActions,
  buildSettingsCommands,
  buildQuickAddItem,
  buildResultGroups,
  buildTaskViewCommands,
  filterCommands,
  pinExactTaskKey,
  placeQuickAddItem,
  type PaletteItem,
} from './paletteItems';
import { useTaskViews } from '@/hooks/useTaskViews';
import { useModalFocus } from '@/hooks/useModalFocus';
import { Kbd } from '@/components/ui/Kbd';

interface CommandPaletteProps {
  onClose: () => void;
  onOpenTarget: (target: TodayActionTarget) => void;
  onViewChange?: (view: AppView) => void;
}

const ACTION_ICONS: Record<string, typeof Sunrise> = {
  'nav-today': Sunrise,
  'nav-work': ClipboardList,
  'nav-team': Users,
  'nav-desk': Briefcase,
  'nav-follow-ups': CalendarClock,
  'nav-meetings': Video,
  'nav-notes': NotebookPen,
  'nav-settings': Settings,
  'action-capture': Plus,
  'action-capture-note': NotebookPen,
  'action-sync': RefreshCw,
  'quick-add-desk': Plus,
};

const RESULT_ICONS: Record<string, typeof Bug> = {
  issues: Bug,
  desk: ClipboardList,
  tracker: ListChecks,
  tasks: ListChecks,
  checkins: MessageSquare,
  developers: User,
  notes: NotebookPen,
};

const GROUP_LABELS: Record<string, string> = {
  actions: 'Actions',
  issues: 'Work items',
  desk: 'Desk items & follow-ups',
  tracker: 'Tracker tasks',
  tasks: 'Tasks',
  checkins: 'Check-ins',
  developers: 'Developers',
  notes: 'Notes',
};

export function CommandPalette({ onClose, onOpenTarget, onViewChange }: CommandPaletteProps) {
  // docs/54 V1: Tab stays inside the layer; focus returns to the opener on close.
  const modalRef = useModalFocus<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [retryingQuery, setRetryingQuery] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const { addToast } = useToast();
  const { openCapture } = useQuickActions();
  const tasksPhase3 = useTasksPhase3();
  const triggerSync = useTriggerSync();
  // The palette remounts on open, so resolving today here keeps quick-add
  // anchored to the day the manager is working in.
  const today = useMemo(() => getLocalIsoDate(), []);
  const createDeskItem = useCreateManagerDeskItem(today);
  // docs/57 §3 (P3-05): with Phase 3 on, quick add is a capture (the typed text is the grammar).
  const captureTask = useCaptureTask();

  const searchQuery = useGlobalSearch(query);
  const isSearching = searchQuery.isSearching;
  const hasResults = query.trim().length >= GLOBAL_SEARCH_MIN_LENGTH;
  const showSearchError = searchQuery.isError || retryingQuery === query.trim();

  const { features } = useAuth();
  const backups = features?.backups ?? false;
  const navigationCommands = useMemo(() => buildNavigationCommands({ tasksPhase3, backups }), [tasksPhase3, backups]);
  // docs/56 UX-21: every Settings section, and "1:1 with <name>" when 1:1s are on.
  const settingsCommands = useMemo(() => buildSettingsCommands({ tasksPhase3 }), [tasksPhase3]);
  const oneOnOneEnabled = features?.oneOnOne ?? false;
  const roster = useDevelopers(undefined, { enabled: oneOnOneEnabled });
  const oneOnOneCommands = useMemo(
    () => (oneOnOneEnabled ? buildOneOnOneCommands(roster.data ?? []) : []),
    [oneOnOneEnabled, roster.data],
  );
  const { data: syncStatus } = useSyncStatus();
  const jiraConfigured = syncStatus?.jiraConfigured;
  const quickActions = useMemo(() => buildQuickActions({ tasksPhase3, jiraConfigured }), [tasksPhase3, jiraConfigured]);
  const surfaceLabel = tasksPhase3 ? 'Tasks' : 'Desk';
  const taskViews = useTaskViews(tasksPhase3);

  const items = useMemo<PaletteItem[]>(() => {
    const viewCommands = tasksPhase3 ? buildTaskViewCommands(taskViews.data?.views ?? []) : [];
    const actions = filterCommands([...navigationCommands, ...quickActions, ...viewCommands, ...oneOnOneCommands, ...settingsCommands], query);
    const resultRows = hasResults
      ? buildResultGroups({
          issues: searchQuery.data?.issues ?? [],
          deskItems: searchQuery.data?.deskItems ?? [],
          trackerItems: searchQuery.data?.trackerItems ?? [],
          tasks: searchQuery.data?.tasks ?? [],
          checkIns: searchQuery.data?.checkIns ?? [],
          developers: searchQuery.data?.developers ?? [],
          notes: searchQuery.data?.notes ?? [],
        }, { showTaxonomy: !tasksPhase3 }).flatMap((group) => group.items)
      : [];
    return pinExactTaskKey(placeQuickAddItem([...actions, ...resultRows], buildQuickAddItem(query, { tasksPhase3 })), query);
  }, [hasResults, navigationCommands, oneOnOneCommands, query, quickActions, searchQuery.data, settingsCommands, tasksPhase3, taskViews.data]);

  // Resolve selection during render so result changes never leave aria-activedescendant
  // pointing at a removed row. An untouched selection starts at the first result.
  // Result builders append their array index; omit that ordinal from DOM IDs
  // so the same entity keeps its option ID and selection when results reorder.
  const optionId = useCallback(
    (item: PaletteItem) =>
      `${listId}-${encodeURIComponent(item.group === 'actions' ? item.id : item.id.replace(/-\d+$/, ''))}`,
    [listId],
  );
  const activeIndex = Math.max(0, items.findIndex((item) => optionId(item) === activeItemId));
  const activeItem = items[activeIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
      // Swallow a repeated Cmd/Ctrl+K while open so the browser never sees it.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handle);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handle);
    };
  }, [onClose]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, activeItem?.id]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      if (item.actionId === 'capture') {
        onClose();
        openCapture();
        return;
      }
      if (item.actionId === 'capture-note') {
        onClose();
        openCapture({ defaultTarget: 'notes' });
        return;
      }
      if (item.actionId === 'sync') {
        onClose();
        triggerSync.mutate();
        return;
      }
      if (item.actionId === 'quick-add-desk') {
        const title = query.trim();
        if (!title || createDeskItem.isPending || captureTask.isPending) {
          return;
        }
        if (tasksPhase3) {
          captureTask.create({ text: title }).then(
            () => {
              onClose();
              addToast(`Added to ${surfaceLabel}`, 'success');
            },
            (error: unknown) => addToast(error instanceof Error ? error.message : 'Could not add the task', 'error'),
          );
          return;
        }
        createDeskItem.mutate(
          {
            date: today,
            title,
            kind: 'action',
            category: 'other',
            status: 'inbox',
            priority: 'medium',
          },
          {
            onSuccess: () => {
              onClose();
              addToast(`Added to ${surfaceLabel}`, 'success');
            },
            onError: (error) => {
              addToast(error.message, 'error');
            },
          },
        );
        return;
      }
      if (item.href) {
        onClose();
        window.history.pushState(null, '', item.href);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      if (item.target) {
        onClose();
        onOpenTarget(item.target);
        return;
      }
      if (item.view) {
        onClose();
        onViewChange?.(item.view);
        return;
      }
    },
    [addToast, captureTask, createDeskItem, onClose, onOpenTarget, onViewChange, openCapture, query, surfaceLabel, tasksPhase3, today, triggerSync],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = items[(activeIndex + 1) % items.length];
        setActiveItemId(next ? optionId(next) : null);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = items[(activeIndex - 1 + items.length) % items.length];
        setActiveItemId(previous ? optionId(previous) : null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) {
          runItem(item);
        }
      }
    },
    [activeIndex, items, optionId, runItem],
  );

  let lastGroup: PaletteItem['group'] | null = null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-dialog"
        style={{ background: 'var(--scrim)', backdropFilter: 'var(--scrim-blur)' }}
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="fixed z-dialog inset-x-4 mx-auto w-full max-w-[560px] overflow-hidden rounded-2xl"
        style={{
          top: '14vh',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 96%, transparent) 0%, var(--bg-secondary) 100%)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--overlay-shadow)',
        }}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <Search size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveItemId(null);
              setRetryingQuery(null);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={`Search, or type to add to ${surfaceLabel}…`}
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-placeholder"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
          />
          {isSearching ? <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--text-muted)' }} /> : null}
          <Kbd variant="subtle">esc</Kbd>
        </div>

        {showSearchError && (
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <p role="alert" className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Search failed. Try again.
            </p>
            <button
              type="button"
              disabled={searchQuery.isFetching || retryingQuery !== null}
              onClick={() => {
                inputRef.current?.focus();
                setRetryingQuery(query.trim());
                void searchQuery.refetch().finally(() => setRetryingQuery(null));
              }}
              className="text-[13px] disabled:opacity-50"
              style={{ color: 'var(--accent-text)' }}
            >
              Retry
            </button>
          </div>
        )}
        {isSearching && (
          <p role="status" className="px-4 py-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Searching…
          </p>
        )}

        <div ref={listRef} id={listId} role="listbox" aria-label="Commands and search results" aria-busy={isSearching} className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 && !isSearching && !showSearchError ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {hasResults ? 'No matches found.' : `Type to search, pick a destination, or start typing to add to ${surfaceLabel}.`}
              </p>
            </div>
          ) : (
            items.map((item, index) => {
              const showGroupLabel = item.group !== lastGroup;
              lastGroup = item.group;
              const Icon = item.group === 'actions' ? ACTION_ICONS[item.id] ?? Sunrise : RESULT_ICONS[item.group] ?? Bug;
              const active = index === activeIndex;
              return (
                <div key={item.id}>
                  {showGroupLabel && (
                    <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {GROUP_LABELS[item.group]}
                    </div>
                  )}
                  <button
                    id={optionId(item)}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    ref={active ? activeItemRef : undefined}
                    type="button"
                    onMouseEnter={() => setActiveItemId(optionId(item))}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runItem(item)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors"
                    style={{ background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: active ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      <Icon size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {item.title}
                      </span>
                      {item.description && (
                        <span className="block truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
                          {item.description}
                        </span>
                      )}
                    </span>
                    {active && (
                      <Kbd variant="subtle">↵</Kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t px-4 py-2 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          {!hasResults && <span className="ml-auto">Search needs at least {GLOBAL_SEARCH_MIN_LENGTH} characters</span>}
        </div>
      </motion.div>
    </>,
    document.body,
  );
}
