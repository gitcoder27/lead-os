import { useEffect, useState, type ReactNode } from 'react';
import { Check, CheckCircle2, ChevronDown, ChevronUp, GripVertical, Link2, Play, StickyNote, X, XCircle } from 'lucide-react';
import type { TrackerItemState, TrackerWorkItem } from '@/types';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { formatDate, formatRelativeTime, priorityColor } from '@/lib/utils';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { TrackerItemRowActions, type TrackerItemActionPreset } from './TrackerItemRowActions';
import { TrackerItemRowDetails } from './TrackerItemRowDetails';
import { RelatedIssueChips } from './RelatedIssueChips';

type TrackerItemRowVariant = 'default' | 'drawer-planned';

interface TrackerItemRowProps {
  item: TrackerWorkItem;
  onOpen?: (id: number, managerDeskItemId?: number) => void;
  onSetCurrent?: (id: number) => void;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onMoveUp?: (id: number) => void;
  onMoveDown?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  viewDate?: string;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  compact?: boolean;
  draggable?: boolean;
  variant?: TrackerItemRowVariant;
  showDetailsToggle?: boolean;
  actionPreset?: TrackerItemActionPreset;
  hideActions?: boolean;
  readOnly?: boolean;
  /** Inline task-event composer (e.g. standup updates), rendered under the row. */
  composer?: ReactNode;
}

const stateIcons: Record<TrackerItemState, { icon: typeof Play; color: string }> = {
  planned: { icon: GripVertical, color: 'var(--text-muted)' },
  in_progress: { icon: Play, color: 'var(--accent)' },
  done: { icon: CheckCircle2, color: 'var(--success)' },
  dropped: { icon: XCircle, color: 'var(--text-muted)' },
};

function localDayMs(isoDate: string): number | null {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day).getTime();
}

function continuedDays(originDate: string, viewDate: string): number {
  const origin = localDayMs(originDate);
  const view = localDayMs(viewDate);
  if (origin === null || view === null) {
    return 0;
  }
  return Math.max(0, Math.round((view - origin) / 86_400_000));
}

export function TrackerItemRow({
  item,
  onOpen,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onMoveUp,
  onMoveDown,
  onUpdateTitle,
  viewDate,
  canMoveUp = false,
  canMoveDown = false,
  compact,
  draggable,
  variant = 'default',
  showDetailsToggle = false,
  actionPreset = 'default',
  hideActions = false,
  readOnly = false,
  composer,
}: TrackerItemRowProps) {
  const [titleEditing, setTitleEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => setDraftTitle(item.title), [item.id, item.title]);
  useEffect(() => {
    setDetailsOpen(false);
    setTitleEditing(false);
  }, [item.id]);

  const stateInfo = stateIcons[item.state] ?? stateIcons.planned;
  const Icon = stateInfo.icon;
  const isActive = item.state === 'in_progress';
  const isDone = item.state === 'done' || item.state === 'dropped';
  const isLinked = Boolean(item.managerDeskItemId);
  const isDrawerPlanned = variant === 'drawer-planned';
  const canOpen = Boolean(onOpen) && !titleEditing;
  const isTitleEditable = !readOnly && !compact && Boolean(onUpdateTitle) && !isDone && !isLinked;
  const hasExplicitTitleEditAction = isTitleEditable && Boolean(onOpen);
  const isInlineTitleEditable = isTitleEditable && !hasExplicitTitleEditAction;
  const canShowDetails = showDetailsToggle && !compact && !canOpen;
  const detailsRegionId = `tracker-item-details-${item.id}`;
  const jiraLabel = item.jiraSummary && item.jiraSummary !== item.title ? `${item.jiraKey} · ${item.jiraSummary}` : item.jiraKey;
  const jiraMeta = [item.jiraPriorityName, item.jiraDueDate ? `Due ${formatDate(item.jiraDueDate)}` : undefined].filter(Boolean).join(' • ');
  const resolvedActionPreset = hideActions || readOnly ? 'none' : actionPreset;
  const isContinued = Boolean(viewDate && item.originDate && item.originDate !== viewDate);
  const ageDays = isContinued && viewDate && item.originDate ? continuedDays(item.originDate, viewDate) : 0;

  const commitTitle = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== item.title) onUpdateTitle?.(item.id, trimmed);
    setTitleEditing(false);
  };

  const toggleDetails = () => setDetailsOpen((open) => !open);
  const handleOpen = () => onOpen?.(item.id, item.managerDeskItemId);

  return (
    <div
      data-task-key={item.taskKey ?? undefined}
      className={`group relative flex items-center gap-2.5 rounded-xl transition-colors ${canOpen ? 'cursor-pointer' : ''} ${
        isDrawerPlanned ? 'px-3 py-2.5' : 'px-2 py-1.5'
      }`}
      style={{
        background: isActive
          ? 'rgba(6, 182, 212, 0.08)'
          : isDrawerPlanned
            ? 'color-mix(in srgb, var(--bg-tertiary) 36%, transparent)'
            : 'transparent',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
      }}
      onClick={canOpen ? (event) => {
        event.stopPropagation();
        handleOpen();
      } : undefined}
      onKeyDown={canOpen ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      } : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      {draggable ? (
        <div
          data-drag-handle
          onClick={(event) => event.stopPropagation()}
          className="cursor-grab active:cursor-grabbing touch-none shrink-0 flex items-center justify-center h-5 w-5 rounded"
          style={{ color: 'var(--text-muted)' }}
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </div>
      ) : (
        <Icon size={compact ? 12 : 14} style={{ color: stateInfo.color, flexShrink: 0 }} />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          {item.taskKey && <TaskKeyChip taskKey={item.taskKey} className="mt-[1px]" />}
          <div className="flex-1 min-w-0">
            {titleEditing && isTitleEditable ? (
              <div className="flex items-center gap-1 min-w-0">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle();
                    if (event.key === 'Escape') {
                      setDraftTitle(item.title);
                      setTitleEditing(false);
                    }
                  }}
                  className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-active)' }}
                  aria-label="Edit title"
                />
                <button onClick={commitTitle} className="h-5 w-5 rounded flex items-center justify-center shrink-0" style={{ color: 'var(--success)' }} title="Save title">
                  <Check size={10} />
                </button>
                <button
                  onClick={() => {
                    setDraftTitle(item.title);
                    setTitleEditing(false);
                  }}
                  className="h-5 w-5 rounded flex items-center justify-center shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                  title="Cancel"
                >
                  <X size={10} />
                </button>
              </div>
            ) : isInlineTitleEditable ? (
              <button
                type="button"
                onClick={() => {
                  setDetailsOpen(false);
                  setTitleEditing(true);
                }}
                className="block w-full min-w-0 text-left"
                aria-label={`Edit title: ${item.title}`}
                title={item.title}
              >
                <span
                  className={`block truncate text-[13px] hover:underline ${isDrawerPlanned ? 'font-medium' : ''}`}
                  style={{ color: 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none' }}
                >
                  {item.title}
                </span>
              </button>
            ) : (
              <span
                className={`block truncate text-[13px] ${isDrawerPlanned ? 'font-medium' : ''}`}
                style={{ color: isDone ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none' }}
                title={item.title}
              >
                {item.title}
              </span>
            )}
          </div>

          {canShowDetails && !titleEditing && (
            <button
              type="button"
              onClick={toggleDetails}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleDetails();
                }
              }}
              className="mt-[1px] h-5 w-5 shrink-0 rounded flex items-center justify-center"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              aria-expanded={detailsOpen}
              aria-controls={detailsRegionId}
              aria-label={`${detailsOpen ? 'Hide' : 'Show'} task details for ${item.title}`}
              title={detailsOpen ? 'Hide details' : 'Show details'}
            >
              {detailsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
        </div>

        {item.jiraKey && (
          isDrawerPlanned ? (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
              <JiraIssueLink issueKey={item.jiraKey} className="font-mono text-[12px] truncate" style={{ color: 'var(--accent)' }}>
                {item.jiraKey}
              </JiraIssueLink>
              <RelatedIssueChips issueKeys={item.relatedIssueKeys} compact />
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[12px] font-semibold uppercase shrink-0" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                Jira
              </span>
              <JiraIssueLink issueKey={item.jiraKey} className="font-mono text-[12px] truncate" style={{ color: 'var(--accent)' }}>
                {jiraLabel}
              </JiraIssueLink>
            </div>
          )
        )}
        {!isDrawerPlanned && (
          <RelatedIssueChips
            issueKeys={item.relatedIssueKeys}
            muted={isDone}
            compact={compact}
            className="mt-1"
          />
        )}
        {isDrawerPlanned && !item.jiraKey && (
          <RelatedIssueChips issueKeys={item.relatedIssueKeys} compact className="mt-0.5" />
        )}
        {jiraMeta && !isDrawerPlanned && (
          <div className="mt-0.5">
            <span className="text-[12px]" style={{ color: item.jiraPriorityName ? priorityColor(item.jiraPriorityName) : 'var(--text-muted)' }}>
              {jiraMeta}
            </span>
          </div>
        )}
        {isLinked && !compact && !isDrawerPlanned && (
          <div className="mt-0.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
              style={{
                background: 'rgba(217,169,78,0.10)',
                color: 'var(--md-accent, var(--warning))',
                border: '1px solid rgba(217,169,78,0.22)',
              }}
              title="Managed from Manager Desk — title edits must be made there"
            >
              <Link2 size={8} />
              Delegated
            </span>
          </div>
        )}
        {isContinued && !compact && (
          <div className="mt-0.5">
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              Continued from {formatDate(item.originDate)}
              {ageDays > 0 ? ` · ${ageDays}d` : ''}
            </span>
          </div>
        )}
        {item.latestEvent && !compact && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span className="truncate" title={item.latestEvent.excerpt}>
              {item.latestEvent.excerpt}
            </span>
            <span className="shrink-0">· {formatRelativeTime(item.latestEvent.occurredAt)}</span>
            {typeof item.ageDays === 'number' && item.ageDays > 0 && (
              <span className="shrink-0">· {item.ageDays}d</span>
            )}
          </div>
        )}
        {item.note && !compact && (
          <div className="mt-1 flex items-start gap-1.5">
            <StickyNote size={12} className="shrink-0 mt-[2px]" style={{ color: 'var(--text-muted)' }} />
            <span
              className={`text-[13px] leading-5 ${isDrawerPlanned ? 'line-clamp-2' : ''}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              {item.note}
            </span>
          </div>
        )}
        {canShowDetails && detailsOpen && !titleEditing && (
          <TrackerItemRowDetails regionId={detailsRegionId} title={item.title} note={item.note} />
        )}
        {composer}
      </div>

      {!isDone && resolvedActionPreset !== 'none' && (
        <TrackerItemRowActions
          itemId={item.id}
          itemTitle={item.title}
          itemState={item.state}
          actionPreset={resolvedActionPreset}
          draggable={draggable}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onSetCurrent={onSetCurrent}
          onMarkDone={onMarkDone}
          onDrop={onDrop}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onToggleTitleEditor={hasExplicitTitleEditAction ? () => {
            setDetailsOpen(false);
            setTitleEditing(true);
          } : undefined}
        />
      )}
    </div>
  );
}
