import { useEffect, useRef } from 'react';
import { AlertTriangle, CalendarCheck, CheckCheck, Inbox, RefreshCw, SearchX, X } from 'lucide-react';

/** docs/49 §11: skeleton rows — first load only (R5). */
export function TaskListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tasks" className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-[38px] items-center gap-3 px-3" style={{ borderColor: 'var(--border)' }}>
          <span className="h-4 w-4 animate-pulse rounded-full" style={{ background: 'var(--bg-tertiary)' }} />
          <span className="h-3 w-10 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)' }} />
          <span className="h-3 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)', width: `${40 - index * 4}%` }} />
          <span className="flex-1" />
          <span className="h-3 w-14 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)' }} />
        </div>
      ))}
    </div>
  );
}

export function TaskListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mx-3 my-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]"
      style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 24%, transparent)' }}
    >
      <AlertTriangle size={14} />
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold" style={{ border: '1px solid currentColor' }}>
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

interface EmptyCopy {
  title: string;
  body?: string;
  tone?: 'success';
  Icon: typeof Inbox;
}

function emptyCopy(viewId: string | undefined, signal: string[] | undefined, candidates: number): EmptyCopy {
  switch (viewId) {
    case 'today':
      return {
        title: 'Nothing planned for today',
        body: candidates > 0 ? `${candidates} open task${candidates === 1 ? '' : 's'} could be pulled in.` : 'Capture something with ⌘I, or add a task below.',
        Icon: CalendarCheck,
      };
    case 'inbox':
      return { title: 'Inbox zero', body: 'Everything captured has an owner.', tone: 'success', Icon: CheckCheck };
    case 'my-tasks':
      return { title: 'No open tasks', body: 'Add one below or capture with ⌘I.', Icon: CalendarCheck };
    case 'waiting':
      return { title: 'Nobody owes you anything right now.', Icon: CheckCheck, tone: 'success' };
    case 'upcoming':
      return { title: 'Nothing scheduled ahead.', Icon: CalendarCheck };
    case 'later':
      return { title: 'Nothing parked for later.', Icon: Inbox };
    case 'attention':
      if (signal?.length === 1 && signal[0] === 'drift') return { title: 'Jira and tasks agree.', Icon: CheckCheck, tone: 'success' };
      return { title: 'All clear — nothing overdue, stale, or drifting.', Icon: CheckCheck, tone: 'success' };
    case 'closed-week':
      return { title: 'Nothing closed yet this week.', Icon: Inbox };
    default:
      return { title: 'Nothing in this view', body: 'Capture a task with ⌘I, or loosen the filters.', Icon: Inbox };
  }
}

export function TaskListEmpty({
  viewId,
  filtered,
  signal,
  candidates,
  onPlanDay,
  onClearFilters,
}: {
  viewId: string | undefined;
  filtered: boolean;
  signal?: string[];
  candidates: number;
  onPlanDay: () => void;
  onClearFilters: () => void;
}) {
  if (filtered) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <SearchX size={20} style={{ color: 'var(--text-muted)' }} />
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>No tasks match these filters.</p>
        <button type="button" onClick={onClearFilters} className="mt-1 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
          <X size={12} /> Clear filters
        </button>
      </div>
    );
  }
  const copy = emptyCopy(viewId, signal, candidates);
  const color = copy.tone === 'success' ? 'var(--success)' : 'var(--text-muted)';
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <copy.Icon size={22} style={{ color }} />
      <p className="text-[13.5px] font-semibold" style={{ color: copy.tone === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}>{copy.title}</p>
      {copy.body && <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{copy.body}</p>}
      {viewId === 'today' && (
        <button type="button" onClick={onPlanDay} className="mt-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
          Plan your day
        </button>
      )}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['j / ↓', 'Next task'],
  ['k / ↑', 'Previous task'],
  ['Enter / o', 'Open task'],
  ['x', 'Select / deselect'],
  ['Shift + j / k', 'Extend selection'],
  ['Space / e', 'Toggle done'],
  ['s → t m w l c', 'Schedule: today, tomorrow, next week, later, clear'],
  ['a', 'Assign'],
  ['l', 'Labels'],
  ['#', 'Drop'],
  ['n', 'New task in this group'],
  ['/', 'Search'],
  ['?', 'This cheat sheet'],
  ['Esc', 'Close menu, clear selection, clear search'],
];

export function TaskShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }} onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
        className="w-full max-w-md rounded-2xl p-5 outline-none"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--panel-shadow)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close shortcuts" style={{ color: 'var(--text-muted)' }}><X size={15} /></button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-4 text-[12.5px]">
              <dt style={{ color: 'var(--text-secondary)' }}>{action}</dt>
              <dd><kbd className="rounded-md px-1.5 py-0.5 font-mono text-[11px]" style={{ color: 'var(--text-primary)', border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>{keys}</kbd></dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Shortcuts work when the task list has focus — never inside inputs.</p>
      </div>
    </div>
  );
}
