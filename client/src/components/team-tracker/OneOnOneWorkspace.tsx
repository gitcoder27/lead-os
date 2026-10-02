import { QueryReadError } from '@/components/ui/QueryReadError';
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronDown, Keyboard, Pause, Play, X } from 'lucide-react';
import {
  useCreateOneOnOneSeries,
  useOneOnOneSeries,
  useOneOnOneSeriesForDeveloper,
  useUpdateOneOnOneSeries,
} from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import type { OneOnOneCadence, OneOnOneSeriesDetail } from '@/types';
import { isCoveredByLaterLayer } from '@/hooks/useModalFocus';
import { FOCUS_RING, isEditable } from '@/components/ui/focus';
import { EmptyState } from '@/components/ui/EmptyState';
import { MenuItem, TaskPopover } from '@/components/ui/Popover';
import { ShortcutSheet, type ShortcutGroup } from '@/components/ui/ShortcutSheet';
import { AgendaColumn } from './one-on-one/AgendaColumn';
import { SessionColumn } from './one-on-one/SessionColumn';
import { HistoryColumn } from './one-on-one/HistoryColumn';

const CADENCE_OPTIONS: Array<{ value: OneOnOneCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];

// Work week first; weekends last.
const WEEKDAY_OPTIONS: Array<{ value: number | null; label: string; plural: string }> = [
  { value: null, label: 'Any day', plural: 'Any day' },
  { value: 1, label: 'Monday', plural: 'Mondays' },
  { value: 2, label: 'Tuesday', plural: 'Tuesdays' },
  { value: 3, label: 'Wednesday', plural: 'Wednesdays' },
  { value: 4, label: 'Thursday', plural: 'Thursdays' },
  { value: 5, label: 'Friday', plural: 'Fridays' },
  { value: 6, label: 'Saturday', plural: 'Saturdays' },
  { value: 0, label: 'Sunday', plural: 'Sundays' },
];

interface OneOnOneWorkspaceProps {
  developerAccountId: string;
  onClose: () => void;
  onOpenTask?: (taskKey: string) => void;
}

/**
 * docs/48 §4.2: the manager-private 1:1 workspace — Agenda | Session |
 * History inside the Team surface (`/team?dev=<id>&panel=one-on-one`).
 * Esc returns to the board (URL state lives in App.tsx).
 */
export function OneOnOneWorkspace({ developerAccountId, onClose, onOpenTask }: OneOnOneWorkspaceProps) {
  const { addToast } = useToast();
  const list = useOneOnOneSeriesForDeveloper(developerAccountId);
  const { series, isLoading } = list;
  const detail = useOneOnOneSeries(series?.id);
  const createSeries = useCreateOneOnOneSeries();
  const [newCadence, setNewCadence] = useState<OneOnOneCadence>('weekly');

  useEffect(() => {
    // docs/54 §1.7: Esc closes one layer at a time — a drawer or dialog above
    // the workspace takes it first, and the first Esc in a field only blurs it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const root = document.querySelector('[data-testid="one-on-one-workspace"]');
      if (isCoveredByLaterLayer(root)) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isEditable(focused)) {
        focused.blur();
        return;
      }
      onClose();
    };
    const onLetter = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const root = document.querySelector('[data-testid="one-on-one-workspace"]');
      if (isCoveredByLaterLayer(root)) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isEditable(focused)) return;
      if (event.key === 'n') {
        event.preventDefault();
        root?.querySelector<HTMLInputElement>('input[aria-label="Add to agenda"]')?.focus();
      } else if (event.key === '?') {
        event.preventDefault();
        root?.querySelector<HTMLButtonElement>('[data-one-on-one-shortcuts]')?.click();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onLetter);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onLetter);
    };
  }, [onClose]);

  const startSeries = useCallback(() => {
    createSeries.mutate(
      { developerAccountId, cadence: newCadence },
      { onError: (error) => addToast(error instanceof Error ? error.message : 'Could not create the 1:1 series', 'error') },
    );
  }, [addToast, createSeries, developerAccountId, newCadence]);

  if (isLoading) {
    return <WorkspaceFrame name="" onClose={onClose}><PanelMessage>Loading 1:1…</PanelMessage></WorkspaceFrame>;
  }

  if (list.isError && !list.data) {
    return <WorkspaceFrame name="1:1" onClose={onClose}><QueryReadError message="Could not load 1:1s." onRetry={() => list.refetch()} retrying={list.isFetching} /></WorkspaceFrame>;
  }

  if (!series && list.isError) {
    return <WorkspaceFrame name="1:1" onClose={onClose}><QueryReadError message="Could not refresh 1:1s. Retry before creating a series." onRetry={() => list.refetch()} retrying={list.isFetching} /></WorkspaceFrame>;
  }

  if (!series) {
    return (
      <WorkspaceFrame name="1:1" onClose={onClose}>
        <PanelMessage>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            No 1:1 series yet
          </div>
          <div className="mx-auto mt-1 max-w-[420px] text-[13px] leading-5" style={{ color: 'var(--text-muted)' }}>
            A recurring 1:1 keeps a running agenda of topics that carry until you discuss them, private notes per
            session, and a history of what you covered.
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <CadenceSegment value={newCadence} onChange={setNewCadence} />
            <button
              type="button"
              onClick={startSeries}
              disabled={createSeries.isPending}
              className="ui-btn"
            >
              {createSeries.isPending ? 'Starting…' : 'Start 1:1 series'}
            </button>
          </div>
        </PanelMessage>
      </WorkspaceFrame>
    );
  }

  if (!detail.data) {
    return (
      <WorkspaceFrame name={series.developerName} onClose={onClose}>
        {detail.isError ? <QueryReadError message="Could not load the 1:1 workspace." onRetry={() => detail.refetch()} retrying={detail.isFetching} /> : <PanelMessage>Loading 1:1…</PanelMessage>}
      </WorkspaceFrame>
    );
  }

  return <>
    {list.isError && <QueryReadError message="Could not refresh 1:1s. Showing saved content." onRetry={() => list.refetch()} retrying={list.isFetching} />}
    {detail.isError && <QueryReadError message="Could not refresh the 1:1 workspace. Showing saved content." onRetry={() => detail.refetch()} retrying={detail.isFetching} />}
    <Workspace detail={detail.data} onClose={onClose} onOpenTask={onOpenTask} />
  </>;
}

const ONE_ON_ONE_SHORTCUTS: ShortcutGroup[] = [
  { group: 'Agenda', keys: [['n', 'Add to the agenda'], ['⌥ ↑ / ⌥ ↓', 'Reorder the focused item'], ['Enter', 'Open the task']] },
  { group: 'Notes', keys: [['⌘ ⇧ E', 'Line → action item for them'], ['⌘ ⇧ L', 'Line → follow-up for you'], ['/', 'Commands']] },
  { group: 'Workspace', keys: [['?', 'This sheet'], ['Esc', 'Leave a field, then close']] },
];

function WorkspaceFrame({ name, onClose, children }: { name: string; onClose: () => void; children: React.ReactNode }) {
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="one-on-one-workspace">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="ui-dialog-icon" aria-hidden="true">
          <CalendarDays size={14} />
        </span>
        <div className="min-w-0">
          <h2 className="ui-page-title truncate">{name ? `1:1 — ${name}` : '1:1'}</h2>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Private to you — agenda, notes, history
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-one-on-one-shortcuts=""
            onClick={(event) => setShortcutsAnchor(event.currentTarget)}
            className="ui-icon-btn hidden md:inline-flex"
            aria-label="Keyboard shortcuts"
            aria-expanded={shortcutsAnchor !== null}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={14} />
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost" aria-label="Close 1:1 workspace" title="Close (Esc)">
            <X size={12} />
            Close
          </button>
        </div>
      </div>
      {shortcutsAnchor ? (
        <ShortcutSheet anchor={shortcutsAnchor} groups={ONE_ON_ONE_SHORTCUTS} onClose={() => setShortcutsAnchor(null)} />
      ) : null}
      {children}
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState title={children} />
    </div>
  );
}

function Workspace({ detail, onClose, onOpenTask }: { detail: OneOnOneSeriesDetail; onClose: () => void; onOpenTask?: (taskKey: string) => void }) {
  return (
    <WorkspaceFrame name={detail.series.developerName} onClose={onClose}>
      <SeriesControls detail={detail} />
      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.95fr)] lg:gap-0">
        <AgendaColumn detail={detail} onOpenTask={onOpenTask} />
        <SessionColumn detail={detail} onOpenTask={onOpenTask} />
        <HistoryColumn detail={detail} onOpenTask={onOpenTask} />
      </div>
    </WorkspaceFrame>
  );
}

function CadenceSegment({ value, onChange }: { value: OneOnOneCadence; onChange: (value: OneOnOneCadence) => void }) {
  return (
    <div className="ui-segment" role="group" aria-label="Cadence">
      {CADENCE_OPTIONS.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SeriesControls({ detail }: { detail: OneOnOneSeriesDetail }) {
  const { addToast } = useToast();
  const updateSeries = useUpdateOneOnOneSeries(detail.series.id);
  const [weekdayAnchor, setWeekdayAnchor] = useState<HTMLElement | null>(null);
  const onError = (error: unknown) => addToast(error instanceof Error ? error.message : 'Could not update the series', 'error');
  const weekday = WEEKDAY_OPTIONS.find((option) => option.value === detail.series.preferredWeekday) ?? WEEKDAY_OPTIONS[0]!;
  const recurring = detail.series.cadence !== 'ad_hoc';
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
      <CadenceSegment
        value={detail.series.cadence}
        onChange={(cadence) => updateSeries.mutate({ cadence }, { onError })}
      />
      {recurring && (
        <button
          type="button"
          onClick={(event) => setWeekdayAnchor(weekdayAnchor ? null : event.currentTarget)}
          aria-label={`Preferred weekday: ${weekday.label}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(weekdayAnchor)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--text-secondary)', background: weekdayAnchor ? 'var(--bg-tertiary)' : undefined }}
        >
          <CalendarDays size={12} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          {weekday.value === null ? 'Any day' : `On ${weekday.plural}`}
          <ChevronDown size={12} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        </button>
      )}
      {weekdayAnchor && (
        <TaskPopover anchor={weekdayAnchor} onClose={() => setWeekdayAnchor(null)} label="Preferred weekday" width={200}>
          {WEEKDAY_OPTIONS.map((option) => (
            <MenuItem
              key={option.label}
              role="menuitemradio"
              checked={option.value === detail.series.preferredWeekday}
              label={option.label}
              onSelect={() => {
                setWeekdayAnchor(null);
                if (option.value !== detail.series.preferredWeekday) updateSeries.mutate({ preferredWeekday: option.value }, { onError });
              }}
            />
          ))}
        </TaskPopover>
      )}
      <button
        type="button"
        onClick={() => updateSeries.mutate({ active: !detail.series.active }, { onError })}
        className="ui-btn-ghost ml-auto"
        title={detail.series.active ? 'Pause — stop auto-scheduling; the agenda is kept' : 'Resume auto-scheduling'}
      >
        {detail.series.active ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
        {detail.series.active ? 'Pause series' : 'Resume series'}
      </button>
    </div>
  );
}
