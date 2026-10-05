import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Bell, BellRing, Ellipsis, Flag, GitCompareArrows, Hourglass } from 'lucide-react';
import { taskLabelDisplayName, type TaskSignals, type TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import {
  impliedMeta,
  isOpenStatus,
  meetingNeedsOutcome,
  meetingTime,
  relativeTaskDate,
  waitingChips,
  type ListTask,
  type OverdueLevel,
  type RelativeDateTone,
} from '@/lib/task-list';
import { labelChipStyle } from './label-colors';
import { TaskStatusGlyph, TASK_STATUS_META } from './TaskMenus';

export type RowTask = ListTask & { signals?: TaskSignals };

export interface TaskRowHandlers {
  onFocusRow: (taskKey: string) => void;
  onOpen: (taskKey: string) => void;
  onSelect: (taskKey: string, mode: 'toggle' | 'range') => void;
  onMenu: (taskKey: string, kind: 'status' | 'schedule' | 'more', anchor: HTMLElement) => void;
  onToggleDone: (taskKey: string) => void;
  /** docs/56 UX-08: the row action for a past meeting with no outcome. */
  onCaptureOutcome?: (taskKey: string) => void;
}

/** docs/51 D4: the bell carries follow-up state (due or not) — the label chip would only repeat it. */
const FOLLOW_UP_LABEL = 'category:follow_up';

const DATE_TONES: Record<RelativeDateTone, string> = {
  default: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  warning: 'var(--task-warning-text)',
  danger: 'var(--task-danger-text)',
};

/**
 * docs/51 D1: one visual scale for "late", shared by row dates and the
 * attention view's reason chips. Level 1 is tinted text, 2 a tinted pill,
 * 3 an outlined pill — so 15 days late never reads like 1 day late.
 */
export function SeverityMark({ tone, level, children }: { tone: 'danger' | 'warning'; level: OverdueLevel; children: ReactNode }) {
  const color = DATE_TONES[tone];
  const style: CSSProperties = { color };
  if (level >= 2) style.background = `color-mix(in srgb, var(--${tone}) ${level === 3 ? 20 : 12}%, transparent)`;
  if (level === 3) style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, var(--${tone}) 45%, transparent)`;
  return (
    <span className={`whitespace-nowrap rounded-md px-1.5 py-px tabular-nums ${level === 3 ? 'font-bold' : 'font-semibold'}`} style={style}>
      {children}
    </span>
  );
}

/**
 * Native sibling controls: selection, completion, open and More. Metadata
 * wraps below the title on phones, with no hover-only actions.
 */
export const TaskListRow = memo(function TaskListRow({
  task,
  context,
  definition,
  today,
  attentionMode,
  focused,
  selected,
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
  const owner = ownerName(task.ownerType, task.ownerId);
  const labels = task.labels.filter((label) => label !== FOLLOW_UP_LABEL);
  // docs/51 A2: the row's aria-label, attention chips, and icon cluster all
  // describe the same visible signals — compute the wording once.
  const attentionReasons: { label: string; tone: 'danger' | 'warning'; level: OverdueLevel }[] = [];
  const iconSignals: { label: string; color: string; icon: ReactNode }[] = [];
  // Shape marks priority in every view; red stays reserved for missed deadlines.
  if (task.priority === 'high') iconSignals.push({ label: 'High priority', color: 'var(--text-primary)', icon: <Flag size={12} fill="currentColor" /> });
  if (attentionMode && signals) {
    if (signals.stale) attentionReasons.push({ label: `Stale ${signals.staleDays}d`, tone: 'warning', level: 2 });
    if (signals.drift) attentionReasons.push({ label: 'Jira drift', tone: 'warning', level: 2 });
  } else {
    if (task.followUpAt || task.labels.includes(FOLLOW_UP_LABEL)) {
      iconSignals.push(signals?.followUpDue
        ? { label: 'Follow-up due', color: 'var(--task-warning-text)', icon: <BellRing size={12} /> }
        : { label: 'Follow-up', color: 'var(--text-muted)', icon: <Bell size={12} /> });
    }
    if (signals?.stale) iconSignals.push({ label: `No activity for ${signals.staleDays}d`, color: 'var(--task-warning-text)', icon: <Hourglass size={12} /> });
    if (signals?.drift) iconSignals.push({ label: 'Jira and task disagree on done-ness', color: 'var(--task-warning-text)', icon: <GitCompareArrows size={12} /> });
  }
  // docs/57 §4 (P3-03): the Waiting lens reads as aging + check-by text.
  const waiting = context.mode === 'party' || definition?.filters?.waiting === true ? waitingChips(task, today) : null;
  const waitingText = waiting ? [waiting.check?.label, waiting.aging].filter((label): label is string => Boolean(label)) : [];
  // docs/57 §4 (P3-06): a meeting's action items are its child tasks — "2/3 actions".
  const actions = task.kind === 'meeting' && signals?.actions && signals.actions.total > 0 ? `${signals.actions.done}/${signals.actions.total} actions` : null;
  const signalText = [...(actions ? [actions] : []), ...waitingText, ...attentionReasons.map((reason) => reason.label), ...iconSignals.map((signal) => signal.label)];

  const ariaLabel = [
    `${task.taskKey} ${task.title}`,
    TASK_STATUS_META[task.status].label,
    date?.label,
    showOwner ? `owner ${owner}` : null,
    ...signalText,
    task.lingering ? (task.lingerHint ?? 'moved') : null,
  ].filter(Boolean).join(', ');

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) {
      event.preventDefault();
      handlers.onSelect(task.taskKey, 'range');
    } else if (event.metaKey || event.ctrlKey) {
      handlers.onSelect(task.taskKey, 'toggle');
    } else {
      event.currentTarget.focus();
      handlers.onFocusRow(task.taskKey);
      handlers.onOpen(task.taskKey);
    }
  };
  const stop = (event: MouseEvent) => event.stopPropagation();
  const dim = task.lingering ? 0.6 : undefined;

  return (
    <div data-task-row={task.taskKey} className="task-row ui-row-focus" data-focused={focused || undefined}
      onFocus={() => handlers.onFocusRow(task.taskKey)}
      style={{ background: selected ? 'var(--accent-glow)' : focused ? 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' : undefined }}>
      <div className="task-row-layout">
        <label className="task-row-control task-row-selection" title="Select (x) · Shift-click for a range">
          <input type="checkbox" checked={selected} aria-label={`${selected ? 'Deselect' : 'Select'} ${task.taskKey}`}
            onChange={() => {}}
            onClick={(event) => { stop(event); handlers.onSelect(task.taskKey, event.shiftKey ? 'range' : 'toggle'); }} />
        </label>
        <button type="button" className="task-row-control" onClick={() => handlers.onToggleDone(task.taskKey)}
          aria-label={`${closed ? 'Reopen' : 'Mark done'} ${task.taskKey}`} title={`${closed ? 'Reopen' : 'Mark done'} (e)`}>
          <TaskStatusGlyph status={task.status} />
        </button>
        <div className="task-row-content" style={{ opacity: dim }}>
          <button type="button" className="task-row-open" data-task-open={task.taskKey} aria-label={ariaLabel} aria-describedby={date ? `task-date-description-${task.taskKey}` : undefined} onClick={handleClick}>
            <span className="task-row-key font-mono text-[12px] tabular-nums" style={{ color: 'var(--text-disabled)' }}>{task.taskKey}</span>
            {time && <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>{time}</span>}
            <span className="task-row-title text-[13px] font-medium" style={{ color: closed ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: closed ? 'line-through' : undefined }}>{task.title}</span>
          </button>
          <span className="task-row-metadata">
            {labels.slice(0, 2).map((label) => <span key={label} className="task-row-label hidden max-w-[120px] truncate rounded-md px-1.5 py-px text-[11px] font-semibold sm:inline" title={taskLabelDisplayName(label)} style={labelChipStyle(labelColor(label))}>{taskLabelDisplayName(label)}</span>)}
            {labels.length > 2 && <span className="hidden shrink-0 text-[11px] sm:inline" style={{ color: 'var(--text-muted)' }} title={labels.slice(2).map(taskLabelDisplayName).join(', ')}>+{labels.length - 2}</span>}
            {task.lingering && isOpenStatus(task.status) && <span className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>{task.lingerHint ?? 'moved'}</span>}
            {actions && <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} data-testid="meeting-actions">{actions}</span>}
            {waiting?.check && <span className="text-[11px]" data-testid="waiting-check">{waiting.check.tone === 'muted' ? <span style={{ color: 'var(--text-muted)' }}>{waiting.check.label}</span> : <SeverityMark tone={waiting.check.tone} level={waiting.check.tone === 'danger' ? 3 : 2}>{waiting.check.label}</SeverityMark>}</span>}
            {waiting?.aging && <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} data-testid="waiting-aging">{waiting.aging}</span>}
            {attentionReasons.map((reason) => <span key={reason.label} className="text-[11px]"><SeverityMark tone={reason.tone} level={reason.level}>{reason.label}</SeverityMark></span>)}
            {iconSignals.map((signal) => <SignalIcon key={signal.label} label={signal.label} color={signal.color}>{signal.icon}</SignalIcon>)}
            {jira && <span className="hidden rounded px-1 py-px font-mono text-[11px] font-semibold lg:inline" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{jira.ref}</span>}
            {handlers.onCaptureOutcome && meetingNeedsOutcome(task, today) && (
              <button type="button" className="task-row-outcome shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold"
                aria-label={`Capture outcome for ${task.taskKey}`}
                style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}
                onClick={() => { handlers.onFocusRow(task.taskKey); handlers.onCaptureOutcome?.(task.taskKey); }}>
                Capture outcome
              </button>
            )}
            {showOwner && <span className="task-row-owner text-[12px]" aria-label={`Owner: ${owner}`} title={owner} style={{ color: 'var(--text-secondary)' }}>{owner}</span>}
            {(dateColumn || date) && <span className="task-row-date text-[12px] tabular-nums" title={date?.title} aria-label={date?.title}>
              {date && (date.level && (date.tone === 'danger' || date.tone === 'warning') ? <SeverityMark tone={date.tone} level={date.level}>{date.label}</SeverityMark> : <span className="whitespace-nowrap px-1.5" style={{ color: DATE_TONES[date.tone] }}>{date.label}</span>)}
            </span>}
          </span>
        </div>
        <button type="button" className="task-row-control" aria-label={`More actions for ${task.taskKey}`} aria-haspopup="menu"
          onClick={(event) => { handlers.onFocusRow(task.taskKey); handlers.onMenu(task.taskKey, 'more', event.currentTarget); }}><Ellipsis size={15} /></button>
      </div>
      {date && <span className="sr-only" id={`task-date-description-${task.taskKey}`}>{date.title}</span>}
      {task.nextAction && <p className="task-row-next text-[12px]" style={{ color: 'var(--text-muted)', opacity: dim }}>→ {task.nextAction}</p>}
    </div>
  );
});

function SignalIcon({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center" style={{ color }}>
      {children}
    </span>
  );
}
