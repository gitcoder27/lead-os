import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Bell, BellRing, CalendarClock, Check, Ellipsis, Flag, GitCompareArrows, Hourglass, RotateCcw } from 'lucide-react';
import { taskLabelDisplayName, type TaskSignals, type TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import {
  impliedMeta,
  isOpenStatus,
  meetingTime,
  overdueLevel,
  overdueTone,
  relativeTaskDate,
  type ListTask,
  type OverdueLevel,
  type RelativeDateTone,
} from '@/lib/task-list';
import { labelChipStyle } from './label-colors';
import { Avatar } from './TaskDetailPrimitives';
import { TaskStatusGlyph, TASK_STATUS_META } from './TaskMenus';

export type RowTask = ListTask & { signals?: TaskSignals };

export interface TaskRowHandlers {
  onFocusRow: (taskKey: string) => void;
  onOpen: (taskKey: string) => void;
  onSelect: (taskKey: string, mode: 'toggle' | 'range') => void;
  onMenu: (taskKey: string, kind: 'status' | 'schedule' | 'more', anchor: HTMLElement) => void;
  onToggleDone: (taskKey: string) => void;
}

/** docs/51 D4: the bell carries follow-up state (due or not) — the label chip would only repeat it. */
const FOLLOW_UP_LABEL = 'category:follow_up';

const DATE_TONES: Record<RelativeDateTone, string> = {
  default: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

/**
 * docs/51 D1: one visual scale for "late", shared by row dates and the
 * attention view's reason chips. Level 1 is tinted text, 2 a tinted pill,
 * 3 an outlined pill — so 15 days late never reads like 1 day late.
 */
export function SeverityMark({ tone, level, children }: { tone: 'danger' | 'warning'; level: OverdueLevel; children: ReactNode }) {
  const color = DATE_TONES[tone];
  const style: CSSProperties = { color };
  if (level >= 2) style.background = `color-mix(in srgb, ${color} ${level === 3 ? 20 : 12}%, transparent)`;
  if (level === 3) style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)`;
  return (
    <span className={`whitespace-nowrap rounded-md px-1.5 py-px tabular-nums ${level === 3 ? 'font-bold' : 'font-semibold'}`} style={style}>
      {children}
    </span>
  );
}

/**
 * docs/49 §5 + docs/51 D3/U2/U4: one dense row — status glyph · key (which
 * becomes the selection box on hover/focus) · title · labels ·
 * [hover actions] · signals · Jira ref · owner · date. The hover actions sit
 * *left* of the metadata, so the date stays readable on every row, including
 * the focused one. The date column is only reserved when the group has dates.
 */
export const TaskListRow = memo(function TaskListRow({
  task,
  context,
  definition,
  today,
  attentionMode,
  focused,
  selected,
  selectionActive,
  dateColumn = true,
  ownerName,
  labelColor,
  handlers,
}: {
  task: RowTask;
  context: TaskGroupContext;
  definition: TaskViewDefinition | undefined;
  today: string;
  attentionMode: boolean;
  focused: boolean;
  selected: boolean;
  selectionActive: boolean;
  /** docs/51 D3: false when no row in this group shows a date — collapse the column. */
  dateColumn?: boolean;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  labelColor: (name: string) => string | undefined;
  handlers: TaskRowHandlers;
}) {
  const closed = !isOpenStatus(task.status);
  const { showOwner, showDate } = impliedMeta(definition, context, task, today);
  const date = showDate ? relativeTaskDate(task, today) : null;
  const time = meetingTime(task);
  const jira = task.links.find((link) => link.kind === 'jira' && link.role === 'primary') ?? task.links.find((link) => link.kind === 'jira');
  const signals = task.signals;
  const owner = task.ownerType ? ownerName(task.ownerType, task.ownerId) : 'Inbox';
  const labels = task.labels.filter((label) => label !== FOLLOW_UP_LABEL);
  // The checkbox takes over the key slot whenever selecting is in play.
  const checkboxShown = selected || selectionActive || focused;

  // docs/51 A2: the row's aria-label, attention chips, and icon cluster all
  // describe the same visible signals — compute the wording once.
  const attentionReasons: { label: string; tone: 'danger' | 'warning'; level: OverdueLevel }[] = [];
  const iconSignals: { label: string; color: string; icon: ReactNode }[] = [];
  if (attentionMode && signals) {
    if (signals.overdue) {
      const days = signals.overdueDays ?? 0;
      attentionReasons.push({ label: `Overdue ${days}d`, tone: overdueTone(signals.overdueSource), level: overdueLevel(days, signals.overdueSource) });
    }
    if (signals.stale) attentionReasons.push({ label: `Stale ${signals.staleDays}d`, tone: 'warning', level: 2 });
    if (signals.drift) attentionReasons.push({ label: 'Jira drift', tone: 'warning', level: 2 });
  } else {
    // docs/51 D1: shape, not red, marks priority — red is reserved for missed deadlines.
    if (task.priority === 'high') iconSignals.push({ label: 'High priority', color: 'var(--text-primary)', icon: <Flag size={12} fill="currentColor" /> });
    if (task.followUpAt || task.labels.includes(FOLLOW_UP_LABEL)) {
      iconSignals.push(signals?.followUpDue
        ? { label: 'Follow-up due', color: 'var(--warning)', icon: <BellRing size={12} /> }
        : { label: 'Follow-up', color: 'var(--text-muted)', icon: <Bell size={12} /> });
    }
    if (signals?.stale) iconSignals.push({ label: `No activity for ${signals.staleDays}d`, color: 'var(--warning)', icon: <Hourglass size={12} /> });
    if (signals?.drift) iconSignals.push({ label: 'Jira and task disagree on done-ness', color: 'var(--warning)', icon: <GitCompareArrows size={12} /> });
  }
  const signalText = attentionMode ? attentionReasons.map((reason) => reason.label) : iconSignals.map((signal) => signal.label);

  const ariaLabel = [
    `${task.taskKey} ${task.title}`,
    TASK_STATUS_META[task.status].label,
    date?.label,
    showOwner ? `owner ${owner}` : null,
    ...signalText,
    task.lingering ? (task.lingerHint ?? 'moved') : null,
  ].filter(Boolean).join(', ');

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey) {
      event.preventDefault();
      handlers.onSelect(task.taskKey, 'range');
    } else if (event.metaKey || event.ctrlKey) {
      handlers.onSelect(task.taskKey, 'toggle');
    } else {
      handlers.onFocusRow(task.taskKey);
      handlers.onOpen(task.taskKey);
    }
  };
  const stop = (event: MouseEvent) => event.stopPropagation();
  const dim = task.lingering ? 0.6 : undefined;

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={ariaLabel}
      data-task-row={task.taskKey}
      tabIndex={focused ? 0 : -1}
      onClick={handleClick}
      onFocus={(event) => { if (event.target === event.currentTarget) handlers.onFocusRow(task.taskKey); }}
      className="group relative cursor-pointer px-2 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
      style={{
        background: selected ? 'var(--accent-glow)' : focused ? 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' : undefined,
      }}
    >
      <div className="flex min-h-[38px] items-center gap-2">
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'status', event.currentTarget); }}
          aria-label={`Status: ${TASK_STATUS_META[task.status].label}. Change status`}
          aria-haspopup="menu"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]"
        >
          <TaskStatusGlyph status={task.status} />
        </button>

        {/* docs/51 U4/D3: the key slot doubles as the selection box — no
            reserved gutter. It shows on hover, on the focused row, whenever a
            selection exists, and always on touch screens (no hover there). */}
        <span className="relative flex h-6 w-5 shrink-0 items-center md:w-12">
          <span className="hidden md:inline" style={{ opacity: dim }}>
            <span
              className={`font-mono text-[11px] tabular-nums transition-opacity ${checkboxShown ? 'opacity-0' : 'group-hover:opacity-0 [@media(hover:none)]:opacity-0'}`}
              style={{ color: 'var(--text-disabled)' }}
            >
              {task.taskKey}
            </span>
          </span>
          <button
            type="button"
            tabIndex={-1}
            onClick={(event) => { stop(event); handlers.onSelect(task.taskKey, event.shiftKey ? 'range' : 'toggle'); }}
            aria-label={selected ? `Deselect ${task.taskKey}` : `Select ${task.taskKey}`}
            title="Select (x) · Shift-click for a range"
            className={`absolute left-0 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded border transition-opacity ${checkboxShown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'}`}
            style={{ borderColor: selected ? 'var(--accent)' : 'var(--border-strong)', background: selected ? 'var(--accent)' : 'var(--bg-primary)', color: 'var(--bg-primary)' }}
          >
            {selected && <Check size={11} strokeWidth={3} />}
          </button>
        </span>

        {/* docs/51 F13: only title/meta dim on a lingering row — controls stay opaque. */}
        <span className="flex min-w-0 flex-1 items-center gap-2" style={{ opacity: dim }}>
          {time && (
            <span className="shrink-0 font-mono text-[11.5px] font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>{time}</span>
          )}
          <span
            className="min-w-0 truncate text-[13px] font-medium"
            style={{
              color: closed ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: closed ? 'line-through' : undefined,
            }}
          >
            {task.title}
          </span>
          {labels.slice(0, 2).map((label) => (
            <span key={label} className="hidden shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold sm:inline" style={labelChipStyle(labelColor(label))}>
              {taskLabelDisplayName(label)}
            </span>
          ))}
          {labels.length > 2 && (
            <span className="hidden shrink-0 text-[10.5px] font-semibold sm:inline" style={{ color: 'var(--text-muted)' }} title={labels.slice(2).map(taskLabelDisplayName).join(', ')}>
              +{labels.length - 2}
            </span>
          )}
          {task.lingering && isOpenStatus(task.status) && (
            <span className="shrink-0 text-[10.5px] italic" style={{ color: 'var(--text-muted)' }}>{task.lingerHint ?? 'moved'}</span>
          )}
        </span>

        {/* Metadata cluster. `relative` anchors the hover actions to its left edge. */}
        <span className="relative flex shrink-0 items-center gap-2">
          <span
            className="pointer-events-none absolute right-full top-1/2 mr-2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:hidden"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.18)' }}
          >
            <RowAction label="Schedule (s)" menu onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'schedule', event.currentTarget); }}>
              <CalendarClock size={13} />
            </RowAction>
            <RowAction label={closed ? 'Reopen (space)' : 'Mark done (space)'} onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onToggleDone(task.taskKey); }}>
              {closed ? <RotateCcw size={13} /> : <Check size={13} />}
            </RowAction>
            <RowAction label="More actions" menu onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'more', event.currentTarget); }}>
              <Ellipsis size={13} />
            </RowAction>
          </span>

          {(attentionReasons.length > 0 || iconSignals.length > 0) && (
            <span className="flex items-center gap-1.5" style={{ opacity: dim }}>
              {attentionReasons.map((reason) => (
                <span key={reason.label} className="text-[10.5px]">
                  <SeverityMark tone={reason.tone} level={reason.level}>{reason.label}</SeverityMark>
                </span>
              ))}
              {iconSignals.map((signal) => (
                <SignalIcon key={signal.label} label={signal.label} color={signal.color}>{signal.icon}</SignalIcon>
              ))}
            </span>
          )}
          {jira && (
            <span className="hidden rounded px-1 py-px font-mono text-[10px] font-semibold lg:inline" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', opacity: dim }}>
              {jira.ref}
            </span>
          )}
          {showOwner && (
            <span role="img" aria-label={`Owner: ${owner}`} className="flex" title={owner} style={{ opacity: dim }}>
              {task.ownerType ? (
                <Avatar name={owner} seed={task.ownerId ?? owner} size={20} />
              ) : (
                <span className="h-5 w-5 rounded-full" style={{ border: '1px dashed var(--border-strong)' }} aria-hidden="true" />
              )}
            </span>
          )}
          {(dateColumn || date) && (
            <span className="flex w-[84px] justify-end text-[11.5px] tabular-nums" title={date?.title} style={{ opacity: dim }}>
              {date && (date.level && (date.tone === 'danger' || date.tone === 'warning') ? (
                <SeverityMark tone={date.tone} level={date.level}>{date.label}</SeverityMark>
              ) : (
                <span className="whitespace-nowrap px-1.5" style={{ color: DATE_TONES[date.tone] }}>{date.label}</span>
              ))}
            </span>
          )}
        </span>
      </div>
      {task.nextAction && (
        <p className="-mt-1.5 truncate pb-2 pl-[60px] text-[12px] md:pl-[88px]" style={{ color: 'var(--text-muted)', opacity: dim }}>
          → {task.nextAction}
        </p>
      )}
    </div>
  );
});

function RowAction({ label, menu = false, onClick, children }: { label: string; menu?: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={menu ? 'menu' : undefined}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </button>
  );
}

function SignalIcon({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center" style={{ color }}>
      {children}
    </span>
  );
}
