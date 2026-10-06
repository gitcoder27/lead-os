import type { CSSProperties, ReactNode } from 'react';
import { TriangleAlert, CalendarCheck, CheckCheck, Flag, Inbox, RefreshCw, SearchX, X } from 'lucide-react';
import { TASK_LIST_CONTAINER } from './TaskList';
import { TASK_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { ShortcutSheet } from '@/components/ui/ShortcutSheet';
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
    <div key={index} className="task-row" aria-hidden="true">
      <div className="task-row-layout">
        <span className="task-row-control"><Bone className="h-4 w-4" /></span>
        <span className="task-row-control"><Bone className="h-[15px] w-[15px] rounded-full" /></span>
        <div className="task-row-content">
          <span className="task-row-open"><Bone className="h-3" style={{ width: SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length] }} /></span>
          <span className="task-row-metadata"><Bone className="h-2.5 w-12" /></span>
        </div>
        <span className="task-row-control"><Bone className="h-2 w-4" /></span>
      </div>
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
      return { title: 'Inbox zero', body: 'Everything captured has been triaged.', tone: 'success', Icon: CheckCheck };
    case 'projects':
      return { title: 'No tasks yet', body: 'Add a task below, or capture one for this project or track.', Icon: Inbox };
    case 'my-tasks':
      return { title: 'No open tasks', body: 'Add one below or capture with ⌘I.', Icon: CalendarCheck };
    case 'waiting':
      return { title: 'No tasks in Waiting.', Icon: CheckCheck };
    case 'meetings':
      return { title: 'No meetings in the last two weeks or ahead.', body: 'Capture one with /m, for example "/m Design review !fri".', Icon: CalendarCheck };
    case 'later':
      return { title: 'Nothing parked for later.', Icon: Inbox };
    case 'high-priority':
      return { title: 'No open high-priority tasks', body: 'Add one below, or include !! when capturing a task.', Icon: Flag };
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
  archived = false,
  signal,
  candidates,
  onPlanDay,
  onClearFilters,
}: {
  viewId: string | undefined;
  filtered: boolean;
  archived?: boolean;
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
  const copy = viewId === 'projects' && archived
    ? { title: 'No open tasks', body: 'Restore this project or track to add new tasks.', Icon: Inbox }
    : emptyCopy(viewId, signal, candidates);
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
export { TASK_SHORTCUTS } from '@/lib/keyboard-shortcuts';

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
