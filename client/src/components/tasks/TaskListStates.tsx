import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, CalendarCheck, CheckCheck, Inbox, RefreshCw, SearchX, X } from 'lucide-react';
import { useModalFocus } from '@/hooks/useModalFocus';
import { TASK_LIST_CONTAINER } from './TaskList';

const SKELETON_TITLE_WIDTHS = ['46%', '32%', '54%', '38%', '28%', '44%'];

function Bone({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`block animate-pulse rounded motion-reduce:animate-none ${className}`} style={{ background: 'var(--bg-tertiary)', ...style }} />;
}

/**
 * docs/49 §11 (R5) + docs/51 U5: first-load skeleton drawn on the real
 * geometry — same column, same 38px rows and hairlines, glyph / key / title /
 * date in the same x positions, plus section labels when the view groups —
 * so data lands without the page jumping.
 */
export function TaskListSkeleton({ grouped = false }: { grouped?: boolean }) {
  const rule = 'color-mix(in srgb, var(--border) 55%, transparent)';
  const row = (index: number) => (
    <div key={index} className="flex h-[38px] items-center gap-2 px-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center"><Bone className="h-[15px] w-[15px] rounded-full" /></span>
      <span className="flex w-5 shrink-0 md:w-12"><Bone className="hidden h-2.5 w-9 md:block" /></span>
      <Bone className="h-3" style={{ width: SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length] }} />
      <span className="flex-1" />
      <span className="flex w-[84px] shrink-0 justify-end pr-1.5"><Bone className="h-2.5 w-12" /></span>
    </div>
  );
  const section = (rows: number[], first: boolean) => (
    <div className={first ? '' : 'mt-5'}>
      {grouped && (
        <div className="flex h-9 items-center gap-2 border-b px-2" style={{ borderColor: rule }}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center"><Bone className="h-1.5 w-1.5 rounded-full" /></span>
          <Bone className="h-2.5 w-16" />
        </div>
      )}
      <div className="divide-y" style={{ borderColor: rule }}>{rows.map(row)}</div>
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Loading tasks" className={`${TASK_LIST_CONTAINER} pt-2`}>
      {grouped ? (
        <>
          {section([0, 1], true)}
          {section([2, 3, 4, 5], false)}
        </>
      ) : section([0, 1, 2, 3, 4, 5], true)}
    </div>
  );
}

const KEY_HINT_STORAGE = 'leados.tasks.keyHintDismissed';

function readHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY_HINT_STORAGE) === '1';
  } catch {
    return false;
  }
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-mono text-[10.5px] leading-none"
      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}
    >
      {children}
    </kbd>
  );
}

/**
 * docs/51 U3: one quiet, dismissible line under the list that teaches the
 * five keys that matter and points at `?` for the rest. Dismissal is a
 * per-browser convenience (localStorage); the toolbar keyboard button and `?`
 * remain. Pointer-only devices never see it.
 */
export function TaskKeyboardHint({ onShowAll }: { onShowAll: () => void }) {
  const [dismissed, setDismissed] = useState(readHintDismissed);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY_HINT_STORAGE, '1');
    } catch {
      // Storage unavailable — the hint just returns next visit.
    }
  };
  const item = (keys: ReactNode, label: string) => (
    <span className="flex items-center gap-1">
      {keys}
      <span>{label}</span>
    </span>
  );
  return (
    <div
      className="mt-4 hidden flex-wrap items-center gap-x-3.5 gap-y-1.5 px-2 text-[11.5px] md:flex [@media(hover:none)]:hidden"
      style={{ color: 'var(--text-muted)' }}
      aria-label="Keyboard shortcuts hint"
      role="note"
    >
      {item(<><Key>j</Key><Key>k</Key></>, 'move')}
      {item(<Key>x</Key>, 'select')}
      {item(<Key>e</Key>, 'done')}
      {item(<Key>s</Key>, 'schedule')}
      {item(<Key>a</Key>, 'assign')}
      <button
        type="button"
        onClick={onShowAll}
        className="flex items-center gap-1 rounded-md px-1 transition-colors hover:text-[var(--text-primary)]"
      >
        <Key>?</Key> all shortcuts
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss keyboard hint"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function TaskListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={`${TASK_LIST_CONTAINER} pt-3`}>
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]"
        style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 24%, transparent)' }}
      >
        <AlertTriangle size={14} />
        <span className="min-w-0 flex-1">{message}</span>
        <button type="button" onClick={onRetry} className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold" style={{ border: '1px solid currentColor' }}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
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
    case 'later':
      return { title: 'Nothing parked for later.', Icon: Inbox };
    case 'attention':
      if (signal?.length === 1 && signal[0] === 'drift') return { title: 'Jira and tasks agree.', Icon: CheckCheck, tone: 'success' };
      return { title: 'All clear — nothing overdue, stale, or drifting.', Icon: CheckCheck, tone: 'success' };
    case 'closed-week':
      return { title: 'Nothing closed in the last 7 days.', Icon: Inbox };
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
  ['Alt + ↑ / ↓', 'Reorder within the day (schedule groups)'],
  ['Enter / o', 'Open task'],
  ['x', 'Select / deselect'],
  ['Shift + j / k', 'Extend selection'],
  ['Space / e', 'Toggle done'],
  ['s → t m w l c 1–7', 'Schedule: today, tomorrow, next week, later, clear, or next weekday'],
  ['a', 'Assign'],
  ['l', 'Labels'],
  ['p', 'Priority'],
  ['#', 'Drop'],
  ['g then letter', 'Jump views — t Planned today · i Inbox · m My tasks · w Waiting · l Later · a Attention · c Closed'],
  ['n', 'New task in this group'],
  ['/', 'Search'],
  ['?', 'This cheat sheet'],
  ['Esc', 'Close menu, clear selection, clear search'],
];

export function TaskShortcutsDialog({ onClose }: { onClose: () => void }) {
  // docs/51 A5: the cheat sheet is a modal — Tab cycles inside it and closing
  // returns focus to wherever the `?` key was pressed.
  const ref = useModalFocus<HTMLDivElement>();
  useEffect(() => {
    ref.current?.focus();
  }, [ref]);
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
