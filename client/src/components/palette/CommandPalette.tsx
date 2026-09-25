import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useToast } from '@/context/ToastContext';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { useCreateManagerDeskItem } from '@/hooks/useManagerDesk';
import { getLocalIsoDate } from '@/lib/utils';
import { GLOBAL_SEARCH_MIN_LENGTH, useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import {
  buildNavigationCommands,
  buildQuickActions,
  buildQuickAddItem,
  buildResultGroups,
  filterCommands,
  pinExactTaskKey,
  placeQuickAddItem,
  type PaletteItem,
} from './paletteItems';

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
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
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

  const searchQuery = useGlobalSearch(query);
  const isSearching = searchQuery.isFetching;
  const hasResults = query.trim().length >= GLOBAL_SEARCH_MIN_LENGTH;

  const navigationCommands = useMemo(buildNavigationCommands, []);
  const quickActions = useMemo(buildQuickActions, []);

  const items = useMemo<PaletteItem[]>(() => {
    const actions = filterCommands([...navigationCommands, ...quickActions], query);
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
    return pinExactTaskKey(placeQuickAddItem([...actions, ...resultRows], buildQuickAddItem(query)), query);
  }, [hasResults, navigationCommands, query, quickActions, searchQuery.data, tasksPhase3]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

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
  }, [activeIndex]);

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
        if (!title || createDeskItem.isPending) {
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
              addToast('Added to Desk', 'success');
            },
            onError: (error) => {
              addToast(error.message, 'error');
            },
          },
        );
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
    [addToast, createDeskItem, onClose, onOpenTarget, onViewChange, openCapture, query, today, triggerSync],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
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
    [activeIndex, items, runItem],
  );

  let lastGroup: PaletteItem['group'] | null = null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[400]"
        style={{ background: 'rgba(4, 8, 14, 0.55)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="fixed z-[401] inset-x-4 mx-auto w-full max-w-[560px] overflow-hidden rounded-2xl"
        style={{
          top: '14vh',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 96%, transparent) 0%, var(--bg-secondary) 100%)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.03) inset, 0 32px 80px rgba(0,0,0,0.48)',
        }}
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
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search, or type to add to Desk…"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-placeholder"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Search"
          />
          {isSearching ? <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--text-muted)' }} /> : null}
          <kbd className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {hasResults ? 'No matches found.' : 'Type to search, pick a destination, or start typing to add to Desk.'}
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
                    <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {GROUP_LABELS[item.group]}
                    </div>
                  )}
                  <button
                    ref={active ? activeItemRef : undefined}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
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
                        <span className="block truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                          {item.description}
                        </span>
                      )}
                    </span>
                    {active && (
                      <kbd className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        ↵
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
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
