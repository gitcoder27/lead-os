import { useState, type CSSProperties, type ReactNode } from 'react';
import { TriangleAlert, CalendarCheck, CheckCheck, Inbox, RefreshCw, SearchX, X } from 'lucide-react';
import { TASK_LIST_CONTAINER } from './TaskList';
import { Kbd } from '@/components/ui/Kbd';
import { ShortcutSheet, type ShortcutGroup } from '@/components/ui/ShortcutSheet';
import { EmptyState } from '@/components/ui/EmptyState';

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

const Key = Kbd;

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
      className="mt-4 hidden flex-wrap items-center gap-x-3.5 gap-y-1.5 px-2 text-[12px] md:flex [@media(hover:none)]:hidden"
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
        <TriangleAlert size={14} />
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
  return (
    <EmptyState
      icon={<copy.Icon size={22} />}
      title={copy.title}
      body={copy.body}
      tone={copy.tone === 'success' ? 'success' : 'default'}
      action={viewId === 'today' ? <button type="button" onClick={onPlanDay} className="ui-btn">Plan your day</button> : undefined}
    />
  );
}

// docs/54 K2: grouped, key-left, lowercase — the same format as every sheet.
export const TASK_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Move',
    keys: [
      ['j / k', 'Next / previous task'],
      ['Enter / o', 'Open task'],
      ['x', 'Select / deselect'],
      ['⇧ j / ⇧ k', 'Extend selection'],
      ['⌥ ↑ / ⌥ ↓', 'Reorder within the day'],
    ],
  },
  {
    group: 'Act',
    keys: [
      ['e / Space', 'Toggle done'],
      ['s', 'Schedule — then t m w l c or 1–7'],
      ['a', 'Assign'],
      ['l', 'Labels'],
      ['p', 'Priority'],
      ['#', 'Drop'],
      ['n', 'New task in this group'],
      ['z', 'Undo last change'],
    ],
  },
  {
    group: 'Views',
    keys: [
      ['g → t', 'Planned today'],
      ['g → i', 'Inbox'],
      ['g → m', 'My tasks'],
      ['g → w', 'Waiting'],
      ['g → l', 'Later'],
      ['g → a', 'Needs attention'],
      ['g → c', 'Closed'],
      ['/', 'Search'],
      ['?', 'This sheet'],
      ['Esc', 'Close menu, clear selection, clear search'],
    ],
  },
];

export function TaskShortcutsDialog({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  return (
    <ShortcutSheet
      anchor={anchor}
      groups={TASK_SHORTCUTS}
      footnote="Shortcuts work when the task list has focus — never inside inputs."
      onClose={onClose}
    />
  );
}
