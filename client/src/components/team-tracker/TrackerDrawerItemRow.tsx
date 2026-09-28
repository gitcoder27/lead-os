import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, GripVertical, Link2, Lock, StickyNote, X } from 'lucide-react';
import type { TrackerWorkItem } from '@/types';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { formatAbsoluteDateTime, formatDate } from '@/lib/utils';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { FOCUS_RING } from '@/components/ui/focus';
import { TrackerItemRowActions, type TrackerItemActionPreset } from './TrackerItemRowActions';
import { RelatedIssueChips } from './RelatedIssueChips';
import { continuedDays, describeLatestEvent, formatCompactRelative } from './trackerItemFormat';
import { TaskStatusGlyph } from '@/components/tasks/TaskMenus';

export type TrackerDrawerItemVariant = 'drawer-current' | 'drawer-planned' | 'drawer-history';

export interface TrackerDrawerItemRowProps {
  item: TrackerWorkItem;
  variant: TrackerDrawerItemVariant;
  onOpen?: (id: number, managerDeskItemId?: number) => void;
  onSetCurrent?: (id: number) => void;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onMoveUp?: (id: number) => void;
  onMoveDown?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  viewDate?: string;
  draggable?: boolean;
  /** Zero-based queue position, shown in the handle until the row is hovered. */
  index?: number;
  /** Starts a drag from the handle (the row itself never drags). */
  onDragHandlePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  actionPreset?: TrackerItemActionPreset;
  hideActions?: boolean;
  readOnly?: boolean;
  composer?: ReactNode;
  /** Extra hover-toolbar buttons for open rows (e.g. "Add to 1:1 agenda"). */
  extraActions?: ReactNode;
}

/** Days carried before the provenance line turns amber. */
const AGING_DAYS = 3;

/**
 * Developer drawer rows. One grammar for current, planned and history: a
 * leading glyph column, key + title, one quiet meta line (provenance, Jira,
 * latest activity), the note, and actions that float in on hover/focus.
 */
export function TrackerDrawerItemRow({
  item,
  variant,
  onOpen,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onMoveUp,
  onMoveDown,
  onUpdateTitle,
  viewDate,
  draggable = false,
  index,
  onDragHandlePointerDown,
  actionPreset = 'default',
  hideActions = false,
  readOnly = false,
  composer,
  extraActions,
}: TrackerDrawerItemRowProps) {
  const [titleEditing, setTitleEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);

  useEffect(() => setDraftTitle(item.title), [item.id, item.title]);
  useEffect(() => setTitleEditing(false), [item.id]);

  const isCurrent = variant === 'drawer-current';
  const isHistory = variant === 'drawer-history';
  const isClosed = item.state === 'done' || item.state === 'dropped';
  const isLinked = !item.canonicalTask && Boolean(item.managerDeskItemId);
  const canOpen = Boolean(onOpen) && !titleEditing;
  const isTitleEditable = !readOnly && !isHistory && Boolean(onUpdateTitle) && !isClosed && !isLinked && item.canRename !== false;
  const hasExplicitTitleEditAction = isTitleEditable && Boolean(onOpen);
  const isInlineTitleEditable = isTitleEditable && !hasExplicitTitleEditAction;
  const resolvedActionPreset = hideActions || readOnly ? 'none' : actionPreset;

  const isContinued = Boolean(viewDate && item.originDate && item.originDate !== viewDate);
  const carriedDays = isContinued && viewDate ? continuedDays(item.originDate, viewDate) : 0;
  const latest = item.latestEvent && !isHistory ? describeLatestEvent(item.latestEvent) : null;

  const commitTitle = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== item.title) onUpdateTitle?.(item.id, trimmed);
    setTitleEditing(false);
  };
  const cancelTitle = () => {
    setDraftTitle(item.title);
    setTitleEditing(false);
  };
  const handleOpen = () => onOpen?.(item.id, item.managerDeskItemId);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the row itself — Enter on a nested button must activate that button.
    if (event.target !== event.currentTarget) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const move = event.key === 'ArrowUp' ? onMoveUp : onMoveDown;
      if (move) {
        event.preventDefault();
        move(item.id);
      }
      return;
    }
    if (canOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      handleOpen();
    }
  };

  const titleClass = isCurrent
    ? 'text-[14px] font-semibold leading-5 tracking-[-0.005em]'
    : isHistory
      ? 'text-[13px] leading-5'
      : 'text-[13px] font-medium leading-5';
  const titleColor = isClosed ? 'var(--text-secondary)' : 'var(--text-primary)';
  const titleDecoration = item.state === 'dropped' ? 'line-through' : 'none';

  const meta: ReactNode[] = [];
  if (item.jiraKey) {
    meta.push(
      <JiraIssueLink
        key="jira"
        issueKey={item.jiraKey}
        className="font-mono text-[12px] font-semibold hover:underline"
        style={{ color: 'var(--accent)' }}
        title={item.jiraSummary && item.jiraSummary !== item.title ? `${item.jiraKey} · ${item.jiraSummary}` : item.jiraKey}
      >
        {item.jiraKey}
      </JiraIssueLink>,
    );
  }
  if (item.relatedIssueKeys?.length) {
    meta.push(<RelatedIssueChips key="related" issueKeys={item.relatedIssueKeys} compact muted={isClosed} />);
  }
  if (isLinked && !isHistory) {
    meta.push(
      <span key="delegated" className="inline-flex items-center gap-1" style={{ color: 'var(--md-accent, var(--warning))' }} title="Managed from Manager Desk — title edits must be made there">
        <Link2 size={11} />
        Delegated
      </span>,
    );
  }
  if (isContinued && !isHistory) {
    const aging = carriedDays >= AGING_DAYS && !isClosed;
    meta.push(
      <span key="continued" style={{ color: aging ? 'var(--warning)' : undefined }} title={`Carried forward since ${formatDate(item.originDate)}`}>
        Continued from {formatDate(item.originDate)}
        {carriedDays > 0 && <span className="tabular-nums"> · {carriedDays}d</span>}
      </span>,
    );
  } else if (!isHistory && typeof item.ageDays === 'number' && item.ageDays > 0) {
    meta.push(<span key="age" className="tabular-nums">{item.ageDays}d old</span>);
  }
  if (latest && item.latestEvent) {
    meta.push(
      <span key="latest" className="inline-flex min-w-0 max-w-full items-center gap-1">
        {item.latestEvent.visibility === 'private' && <Lock size={10} className="shrink-0" aria-label="Private" />}
        <span className="truncate" style={{ color: latest.tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)' }} title={item.latestEvent.excerpt}>
          {latest.text}
        </span>
        <time
          className="shrink-0 tabular-nums"
          dateTime={item.latestEvent.occurredAt}
          title={formatAbsoluteDateTime(item.latestEvent.occurredAt)}
        >
          {item.latestEvent.approximateTime ? '~' : ''}
          {formatCompactRelative(item.latestEvent.occurredAt)}
        </time>
      </span>,
    );
  }
  if (isHistory && item.completedAt) {
    meta.push(
      <time key="closed" dateTime={item.completedAt} title={formatAbsoluteDateTime(item.completedAt)}>
        {formatCompactRelative(item.completedAt)}
      </time>,
    );
  }

  return (
    <div
      data-task-key={item.taskKey ?? undefined}
      className={`group relative flex items-start gap-2.5 transition-colors ${FOCUS_RING} ${
        isCurrent
          ? 'rounded-xl px-3 py-3'
          : isHistory
            ? 'rounded-lg px-2 py-1.5'
            : 'rounded-lg px-2 py-2'
      } ${canOpen ? 'cursor-pointer' : ''} ${canOpen && !isCurrent ? 'hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_55%,transparent)]' : ''}`}
      style={
        isCurrent
          ? {
              background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-primary))',
              border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
            }
          : undefined
      }
      onClick={canOpen ? (event) => {
        event.stopPropagation();
        handleOpen();
      } : undefined}
      onKeyDown={handleKeyDown}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-keyshortcuts={onMoveUp || onMoveDown ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
    >
      <LeadingGlyph
        item={item}
        variant={variant}
        draggable={draggable}
        index={index}
        onDragHandlePointerDown={onDragHandlePointerDown}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {item.taskKey && <TaskKeyChip taskKey={item.taskKey} className="mt-[1px]" />}
          <div className="min-w-0 flex-1">
            {titleEditing && isTitleEditable ? (
              <div className="flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle();
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      cancelTitle();
                    }
                  }}
                  className={`min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-[13.5px] ${FOCUS_RING}`}
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-active)' }}
                  aria-label="Edit title"
                />
                <button
                  type="button"
                  onClick={commitTitle}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
                  style={{ color: 'var(--success)' }}
                  title="Save title"
                  aria-label="Save title"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={cancelTitle}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
                  style={{ color: 'var(--text-muted)' }}
                  title="Cancel"
                  aria-label="Cancel title edit"
                >
                  <X size={13} />
                </button>
              </div>
            ) : isInlineTitleEditable ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setTitleEditing(true);
                }}
                className={`block w-full min-w-0 rounded text-left ${FOCUS_RING}`}
                aria-label={`Edit title: ${item.title}`}
                title={item.title}
              >
                <span className={`line-clamp-2 break-words hover:underline ${titleClass}`} style={{ color: titleColor }}>
                  {item.title}
                </span>
              </button>
            ) : (
              <span
                className={`line-clamp-2 break-words ${titleClass}`}
                style={{ color: titleColor, textDecoration: titleDecoration }}
                title={item.title}
              >
                {item.title}
              </span>
            )}
          </div>
        </div>

        {meta.length > 0 && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-[18px]" style={{ color: 'var(--text-muted)' }}>
            {meta.map((node, position) => (
              <span key={position} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                {position > 0 && <span aria-hidden="true" className="opacity-60">·</span>}
                {node}
              </span>
            ))}
          </div>
        )}

        {item.note && !isHistory && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <StickyNote size={12} className="mt-[3px] shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="line-clamp-2 whitespace-pre-line break-words text-[12.5px] leading-[18px]" style={{ color: 'var(--text-secondary)' }}>
              {item.note}
            </span>
          </div>
        )}

        {composer && (
          <div
            className={
              isCurrent
                ? 'mt-1.5'
                : // Planned rows keep the update affordance out of the way until the row is engaged.
                  'mt-0.5 has-[textarea]:opacity-100 [@media(hover:hover)]:opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
            }
          >
            {composer}
          </div>
        )}
      </div>

      {!isClosed && resolvedActionPreset !== 'none' && (
        <TrackerItemRowActions
          itemId={item.id}
          itemTitle={item.title}
          itemState={item.state}
          actionPreset={resolvedActionPreset}
          draggable={draggable}
          onSetCurrent={onSetCurrent}
          onMarkDone={onMarkDone}
          onDrop={onDrop}
          onToggleTitleEditor={hasExplicitTitleEditAction ? () => setTitleEditing(true) : undefined}
          extraActions={extraActions}
        />
      )}
    </div>
  );
}

function LeadingGlyph({
  item,
  variant,
  draggable,
  index,
  onDragHandlePointerDown,
}: {
  item: TrackerWorkItem;
  variant: TrackerDrawerItemVariant;
  draggable: boolean;
  index?: number;
  onDragHandlePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const box = 'flex h-5 w-5 shrink-0 items-center justify-center';

  // docs/54 V7: the shared task glyph — current work is "active", closed
  // work reads exactly as it does on Tasks, Standup and My Day.
  if (variant === 'drawer-current') {
    return <span className={box} aria-hidden="true"><TaskStatusGlyph status="active" /></span>;
  }
  if (item.state === 'done' || item.state === 'dropped') {
    return <span className={box} aria-hidden="true"><TaskStatusGlyph status={item.state} /></span>;
  }

  const number = typeof index === 'number' ? (
    <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>{index + 1}</span>
  ) : null;

  if (!draggable) {
    return <span className={box} aria-hidden="true">{number}</span>;
  }

  return (
    <div
      data-drag-handle
      onClick={(event) => event.stopPropagation()}
      onPointerDown={onDragHandlePointerDown}
      className={`${box} relative cursor-grab touch-none rounded active:cursor-grabbing`}
      style={{ color: 'var(--text-muted)' }}
      title="Drag to reorder"
    >
      {number && <span className="transition-opacity group-hover:opacity-0">{number}</span>}
      <GripVertical
        size={14}
        className={`absolute transition-opacity ${number ? 'opacity-0 group-hover:opacity-100' : ''}`}
        aria-hidden="true"
      />
    </div>
  );
}
