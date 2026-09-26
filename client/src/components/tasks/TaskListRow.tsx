import { memo, type MouseEvent, type ReactNode } from 'react';
import { Bell, CalendarClock, Check, Ellipsis, Flag, GitCompareArrows, Hourglass, RotateCcw } from 'lucide-react';
import { taskLabelDisplayName, type TaskSignals, type TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import { impliedMeta, isOpenStatus, meetingTime, relativeTaskDate, type ListTask, type RelativeDateTone } from '@/lib/task-list';
import { labelChipStyle } from './label-colors';
import { TaskStatusGlyph, TASK_STATUS_META } from './TaskMenus';

export type RowTask = ListTask & { signals?: TaskSignals };

export interface TaskRowHandlers {
  onFocusRow: (taskKey: string) => void;
  onOpen: (taskKey: string) => void;
  onSelect: (taskKey: string, mode: 'toggle' | 'range') => void;
  onMenu: (taskKey: string, kind: 'status' | 'schedule' | 'more', anchor: HTMLElement) => void;
  onToggleDone: (taskKey: string) => void;
}

const DATE_TONES: Record<RelativeDateTone, string> = {
  default: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/**
 * docs/49 §5: one dense row — selection box · status glyph · key · title ·
 * labels · signals · Jira ref · owner · relative date, with a `nextAction`
 * second line and at most three hover actions.
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

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${task.taskKey} ${task.title}, ${TASK_STATUS_META[task.status].label}`}
      data-task-row={task.taskKey}
      tabIndex={focused ? 0 : -1}
      onClick={handleClick}
      onFocus={(event) => { if (event.target === event.currentTarget) handlers.onFocusRow(task.taskKey); }}
      className="group relative cursor-pointer px-3 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
      style={{
        background: selected ? 'var(--accent-glow)' : focused ? 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' : undefined,
        opacity: task.lingering ? 0.55 : undefined,
      }}
    >
      <div className="flex min-h-[38px] items-center gap-2">
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => { stop(event); handlers.onSelect(task.taskKey, event.shiftKey ? 'range' : 'toggle'); }}
          aria-label={selected ? `Deselect ${task.taskKey}` : `Select ${task.taskKey}`}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-opacity ${selected || selectionActive || focused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ borderColor: selected ? 'var(--accent)' : 'var(--border-strong)', background: selected ? 'var(--accent)' : 'transparent', color: 'var(--bg-primary)' }}
        >
          {selected && <Check size={11} strokeWidth={3} />}
        </button>
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
        <span className="hidden w-12 shrink-0 font-mono text-[11px] tabular-nums md:inline" style={{ color: 'var(--text-disabled)' }}>
          {task.taskKey}
        </span>
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
        {task.labels.slice(0, 2).map((label) => (
          <span key={label} className="hidden shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold sm:inline" style={labelChipStyle(labelColor(label))}>
            {taskLabelDisplayName(label)}
          </span>
        ))}
        {task.labels.length > 2 && (
          <span className="hidden shrink-0 text-[10.5px] font-semibold sm:inline" style={{ color: 'var(--text-muted)' }} title={task.labels.slice(2).map(taskLabelDisplayName).join(', ')}>
            +{task.labels.length - 2}
          </span>
        )}
        {task.lingering && isOpenStatus(task.status) && (
          <span className="shrink-0 text-[10.5px] italic" style={{ color: 'var(--text-muted)' }}>moved</span>
        )}

        <span className="flex-1" />

        <span className="flex shrink-0 items-center gap-1.5">
          {attentionMode && signals ? (
            <>
              {signals.overdue && <ReasonChip tone="danger" label={`Overdue ${signals.overdueDays}d`} />}
              {signals.stale && <ReasonChip tone="warning" label={`Stale ${signals.staleDays}d`} />}
              {signals.drift && <ReasonChip tone="warning" label="Jira drift" />}
            </>
          ) : (
            <>
              {task.priority === 'high' && <SignalIcon label="High priority" color="var(--danger)"><Flag size={12} /></SignalIcon>}
              {(task.followUpAt || task.labels.includes('category:follow_up')) && (
                <SignalIcon label={signals?.followUpDue ? 'Follow-up due' : 'Follow-up'} color={signals?.followUpDue ? 'var(--danger)' : 'var(--accent)'}><Bell size={12} /></SignalIcon>
              )}
              {signals?.stale && <SignalIcon label={`No activity for ${signals.staleDays}d`} color="var(--warning)"><Hourglass size={12} /></SignalIcon>}
              {signals?.drift && <SignalIcon label="Jira and task disagree on done-ness" color="var(--warning)"><GitCompareArrows size={12} /></SignalIcon>}
            </>
          )}
        </span>
        {jira && (
          <span className="hidden shrink-0 rounded px-1 py-px font-mono text-[10px] font-semibold lg:inline" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            {jira.ref}
          </span>
        )}
        {showOwner && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: task.ownerType ? '1px solid var(--border)' : '1px dashed var(--border-strong)',
            }}
            title={owner}
            aria-label={`Owner: ${owner}`}
          >
            {task.ownerType ? initials(owner) : ''}
          </span>
        )}
        <span className="flex w-[92px] shrink-0 justify-end text-[11.5px] tabular-nums" title={date?.title}>
          {date && (date.tone === 'danger' || date.tone === 'warning' ? (
            <span
              className="rounded-md px-1.5 py-px font-semibold"
              style={{ color: DATE_TONES[date.tone], background: `color-mix(in srgb, ${DATE_TONES[date.tone]} 13%, transparent)` }}
            >
              {date.label}
            </span>
          ) : (
            <span style={{ color: DATE_TONES[date.tone] }}>{date.label}</span>
          ))}
        </span>

        <span
          className={`absolute right-2 top-[7px] flex items-center gap-0.5 rounded-lg px-0.5 transition-opacity ${focused ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <RowAction label="Schedule (s)" onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'schedule', event.currentTarget); }}>
            <CalendarClock size={13} />
          </RowAction>
          <RowAction label={closed ? 'Reopen (space)' : 'Mark done (space)'} onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onToggleDone(task.taskKey); }}>
            {closed ? <RotateCcw size={13} /> : <Check size={13} />}
          </RowAction>
          <RowAction label="More actions" onClick={(event) => { stop(event); handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'more', event.currentTarget); }}>
            <Ellipsis size={13} />
          </RowAction>
        </span>
      </div>
      {task.nextAction && (
        <p className="-mt-1.5 truncate pb-2 pl-[60px] text-[12px] md:pl-[108px]" style={{ color: 'var(--text-muted)' }}>
          → {task.nextAction}
        </p>
      )}
    </div>
  );
});

function RowAction({ label, onClick, children }: { label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={label === 'More actions' || label.startsWith('Schedule') ? 'menu' : undefined}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]"
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

function ReasonChip({ label, tone }: { label: string; tone: 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'var(--danger)' : 'var(--warning)';
  return (
    <span
      className="rounded-md px-1.5 py-px text-[10.5px] font-semibold tabular-nums"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 24%, transparent)` }}
    >
      {label}
    </span>
  );
}
