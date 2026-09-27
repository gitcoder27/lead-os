import { useEffect, useState, type ReactNode } from 'react';
import { Check, History, Link2, StickyNote, X } from 'lucide-react';
import type { TrackerWorkItem } from '@/types';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { formatAbsoluteDateTime, formatDate, isOverdue, priorityColor } from '@/lib/utils';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { RelatedIssueChips } from '@/components/team-tracker/RelatedIssueChips';
import { continuedDays, describeLatestEvent, formatCompactRelative } from '@/components/team-tracker/trackerItemFormat';

/** Days carried before the provenance turns amber — matches the manager's drawer. */
const AGING_DAYS = 3;

export function isLinkedItem(item: TrackerWorkItem): boolean {
  return !item.canonicalTask && Boolean(item.managerDeskItemId);
}

export function canRenameItem(item: TrackerWorkItem, readOnly: boolean, hasHandler: boolean): boolean {
  const closed = item.state === 'done' || item.state === 'dropped';
  return !readOnly && hasHandler && !closed && !isLinkedItem(item) && item.canRename !== false;
}

/** Title that reads as text and edits in place on click. */
export function EditableTitle({
  item,
  editable,
  onCommit,
  className,
  color = 'var(--text-primary)',
  strike = false,
}: {
  item: TrackerWorkItem;
  editable: boolean;
  onCommit?: (id: number, title: string) => void;
  className: string;
  color?: string;
  strike?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  useEffect(() => setDraft(item.title), [item.id, item.title]);
  useEffect(() => setEditing(false), [item.id]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.title) onCommit?.(item.id, trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(item.title);
    setEditing(false);
  };

  if (editing && editable) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancel();
            }
          }}
          className={`min-w-0 flex-1 rounded-md px-1.5 py-0.5 ${className} ${FOCUS_RING}`}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-active)' }}
          aria-label="Edit title"
        />
        <button
          type="button"
          onClick={commit}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--success)' }}
          title="Save title"
          aria-label="Save title"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={cancel}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--text-muted)' }}
          title="Cancel"
          aria-label="Cancel title edit"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (editable) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
        className={`block min-w-0 flex-1 cursor-text rounded-md text-left ${FOCUS_RING}`}
        aria-label={`Edit title: ${item.title}`}
        title="Click to rename"
      >
        <span
          className={`line-clamp-2 break-words decoration-[var(--border-strong)] decoration-1 underline-offset-4 hover:underline ${className}`}
          style={{ color }}
        >
          {item.title}
        </span>
      </button>
    );
  }

  return (
    <span
      className={`line-clamp-2 min-w-0 flex-1 break-words ${className}`}
      style={{ color, textDecoration: strike ? 'line-through' : 'none' }}
      title={item.title}
    >
      {item.title}
    </span>
  );
}

/**
 * One quiet line of context: Jira, related issues, delegation, how long it
 * has been carried, and the latest word on it.
 */
export function TaskMeta({
  item,
  viewDate,
  closed = false,
  hideContinued = false,
  trailing,
  className,
}: {
  item: TrackerWorkItem;
  viewDate?: string;
  closed?: boolean;
  hideContinued?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const meta: ReactNode[] = [];
  const isContinued = Boolean(viewDate && item.originDate && item.originDate !== viewDate);
  const carried = isContinued && viewDate ? continuedDays(item.originDate, viewDate) : 0;
  const latest = item.latestEvent && !closed ? describeLatestEvent(item.latestEvent) : null;

  if (item.jiraKey) {
    meta.push(
      <JiraIssueLink
        key="jira"
        issueKey={item.jiraKey}
        className="font-mono text-[11.5px] font-semibold hover:underline"
        style={{ color: closed ? 'var(--text-muted)' : 'var(--accent)' }}
        title={item.jiraSummary && item.jiraSummary !== item.title ? `${item.jiraKey} · ${item.jiraSummary}` : item.jiraKey}
      >
        {item.jiraKey}
      </JiraIssueLink>
    );
  }
  if (item.jiraPriorityName && !closed) {
    meta.push(
      <span key="priority" style={{ color: priorityColor(item.jiraPriorityName) }}>
        {item.jiraPriorityName}
      </span>
    );
  }
  if (item.jiraDueDate && !closed) {
    meta.push(
      <span key="due" style={{ color: isOverdue(item.jiraDueDate) ? 'var(--danger)' : undefined }}>
        Due {formatDate(item.jiraDueDate)}
      </span>
    );
  }
  if (item.relatedIssueKeys?.length) {
    meta.push(<RelatedIssueChips key="related" issueKeys={item.relatedIssueKeys} compact muted={closed} />);
  }
  if (isLinkedItem(item) && !closed) {
    meta.push(
      <span
        key="delegated"
        className="inline-flex items-center gap-1"
        style={{ color: 'var(--md-accent, var(--warning))' }}
        title="Assigned from your lead’s desk — rename it there"
      >
        <Link2 size={11} aria-hidden="true" />
        From your lead
      </span>
    );
  }
  if (isContinued && !closed && !hideContinued) {
    const aging = carried >= AGING_DAYS;
    meta.push(
      <span key="continued" style={{ color: aging ? 'var(--warning)' : undefined }} title={`Carried forward since ${formatDate(item.originDate)}`}>
        Continued from {formatDate(item.originDate)}
        {carried > 0 && <span className="tabular-nums"> · {carried}d</span>}
      </span>
    );
  }
  if (latest && item.latestEvent) {
    meta.push(
      <span key="latest" className="inline-flex min-w-0 max-w-full items-center gap-1">
        <span className="truncate" style={{ color: latest.tone === 'danger' ? 'var(--danger)' : undefined }} title={item.latestEvent.excerpt}>
          {latest.text}
        </span>
        <time className="shrink-0 tabular-nums" dateTime={item.latestEvent.occurredAt} title={formatAbsoluteDateTime(item.latestEvent.occurredAt)}>
          {item.latestEvent.approximateTime ? '~' : ''}
          {formatCompactRelative(item.latestEvent.occurredAt)}
        </time>
      </span>
    );
  }
  if (trailing) {
    meta.push(<span key="trailing">{trailing}</span>);
  }

  if (meta.length === 0) return null;

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-[18px] ${className ?? ''}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {meta.map((node, position) => (
        <span key={position} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          {position > 0 && <span aria-hidden="true" className="opacity-50">·</span>}
          {node}
        </span>
      ))}
    </div>
  );
}

export function TaskNote({ note, className, clamp = true }: { note?: string; className?: string; clamp?: boolean }) {
  if (!note) return null;
  return (
    <div className={`flex items-start gap-1.5 ${className ?? ''}`}>
      <StickyNote size={12} className="mt-[3px] shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
      <span
        className={`whitespace-pre-line break-words text-[12.5px] leading-[18px] ${clamp ? 'line-clamp-3' : ''}`}
        style={{ color: 'var(--text-secondary)' }}
      >
        {note}
      </span>
    </div>
  );
}

export function ActivityButton({ taskKey, expanded, onToggle }: { taskKey: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`Activity for ${taskKey}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] ${FOCUS_RING}`}
      style={{ color: expanded ? 'var(--text-secondary)' : 'var(--text-muted)', background: expanded ? 'var(--bg-tertiary)' : undefined }}
    >
      <History size={12} aria-hidden="true" />
      {expanded ? 'Hide activity' : 'Activity'}
    </button>
  );
}

export function ActivityPanel({ taskKey }: { taskKey: string }) {
  return (
    <div
      className="mt-2 rounded-xl px-3 py-1"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 32%, transparent)', border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <TaskTimeline taskKey={taskKey} mode="developer" emptyLabel="No activity yet — updates you post land here." />
    </div>
  );
}

/**
 * Per-task update composer + activity toggle. Only keyed tasks carry a
 * timeline; read-only days keep the history but lose the composer.
 */
export function TaskFooter({
  item,
  viewDate,
  readOnly,
  reveal = 'always',
  activityOpen,
  onToggleActivity,
}: {
  item: TrackerWorkItem;
  viewDate: string;
  readOnly?: boolean;
  /** 'intent' keeps the footer out of the way until the row is hovered or focused. */
  reveal?: 'always' | 'intent';
  activityOpen: boolean;
  onToggleActivity: () => void;
}) {
  if (!item.taskKey) return null;
  const quiet = reveal === 'intent' && !activityOpen;
  return (
    <div
      className={`mt-1.5 flex min-w-0 items-start gap-1 ${
        quiet
          ? 'transition-opacity has-[textarea]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0'
          : ''
      }`}
    >
      {/* pr-2 absorbs the quiet composer's hover bleed so it never overlaps the toggle. */}
      <div className="min-w-0 flex-1 pr-2">
        {!readOnly && (
          <TaskUpdateComposer taskKey={item.taskKey} mode="developer" date={viewDate} collapsed quiet placeholder="Add an update…" />
        )}
      </div>
      <ActivityButton taskKey={item.taskKey} expanded={activityOpen} onToggle={onToggleActivity} />
    </div>
  );
}
