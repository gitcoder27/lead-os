import { useState } from 'react';
import { Eye, EyeOff, History, Lock, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  useMyDayTaskEvents,
  useRedactTaskEvent,
  useTaskEvents,
  useUpdateTaskEventVisibility,
} from '@/hooks/useTasks';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import type { TaskEvent, TaskEventType } from '@/types';

const EVENT_TYPE_LABELS: Record<TaskEventType, string> = {
  created: 'Created',
  update: 'Update',
  instruction: 'Told them',
  decision: 'Decision',
  blocker: 'Blocker',
  status: 'Status',
  assign: 'Reassigned',
  focus: 'Focus',
  title: 'Renamed',
  schedule: 'Scheduled',
  link: 'Linked',
  checkin_ref: 'Check-in',
  note_ref: 'Note',
  merged: 'Merged',
};

const AUTHOR_LABELS: Record<string, string> = {
  manager: 'Manager',
  developer: 'Developer',
  copilot: 'Copilot',
  system: 'System',
};

function eventMeta(event: TaskEvent): Record<string, unknown> {
  return event.meta && typeof event.meta === 'object' ? (event.meta as Record<string, unknown>) : {};
}

function blockerAction(event: TaskEvent): 'raised' | 'cleared' | undefined {
  const action = eventMeta(event).action;
  return action === 'raised' || action === 'cleared' ? action : undefined;
}

function eventDescription(event: TaskEvent): string {
  if (event.body) return event.body;
  const meta = eventMeta(event);
  const text = (field: string, fallback = 'Not set') => typeof meta[field] === 'string' && meta[field] ? String(meta[field]) : fallback;
  const readable = (field: string) => text(field).replace(/_/g, ' ');
  switch (event.type) {
    case 'created': return `Created ${text('title', event.taskKey)}${meta.ownerId ? ` for ${text('ownerId')}` : ''}`;
    case 'status': return `${readable('from')} → ${readable('to')}${meta.reason ? ` (${readable('reason')})` : ''}`;
    case 'assign': {
      const reset = meta.stateReset as { from?: string; to?: string } | undefined;
      return `${text('fromId', 'Unassigned')} → ${text('toId', 'Unassigned')}${reset?.from && reset.to ? ` (${reset.from.replace(/_/g, ' ')} → ${reset.to.replace(/_/g, ' ')})` : ''}`;
    }
    case 'focus': return `${meta.action === 'set_current' ? 'Set as current work' : 'Removed from current work'} on ${text('date')}`;
    case 'title': return `${text('from')} → ${text('to')}`;
    case 'schedule': return `${readable('field')}: ${text('from')} → ${text('to')}`;
    case 'link': return `${meta.action === 'removed' ? 'Removed' : 'Added'} ${text('kind', 'link')}: ${text('ref')}${meta.role ? ` (${text('role')})` : ''}`;
    case 'checkin_ref': return `Check-in on ${text('date')}${meta.developerAccountId ? ` for ${text('developerAccountId')}` : ''}${meta.excerpt ? `: ${text('excerpt')}` : ''}`;
    case 'note_ref': return `${meta.relation === 'created_from' ? 'Created from note' : meta.relation === 'update_from' ? 'Updated from note' : 'Mentioned in note'} on ${text('noteDate')}${meta.excerpt ? `: ${text('excerpt')}` : ''}`;
    case 'merged': return `${text('mergedKey')} → ${text('survivorKey')} (${text('decisionRef')})`;
    case 'blocker': return meta.action === 'cleared' ? 'Blocker cleared' : 'Blocker raised';
    default: return EVENT_TYPE_LABELS[event.type];
  }
}

function canToggleVisibility(event: TaskEvent, accountId: string | undefined): boolean {
  const meta = eventMeta(event);
  return Boolean(
    accountId &&
      !event.redacted &&
      event.author.id === accountId &&
      (event.author.type === 'manager' || event.author.type === 'copilot') &&
      ['update', 'instruction', 'decision', 'blocker'].includes(event.type) &&
      !meta.imported &&
      meta.via !== 'context_note_field',
  );
}

function canRedact(event: TaskEvent, accountId: string | undefined): boolean {
  return Boolean(
    accountId &&
      !event.redacted &&
      event.author.type !== 'developer' &&
      event.author.id === accountId &&
      Date.now() - new Date(event.occurredAt).getTime() <= 30 * 86_400_000,
  );
}

function authorLabel(event: TaskEvent): string {
  return event.author.displayName ?? `${AUTHOR_LABELS[event.author.type] ?? event.author.type}${event.author.id ? ` (${event.author.id})` : ''}`;
}

function EventBadges({ event }: { event: TaskEvent }) {
  const meta = eventMeta(event);
  const imported = Boolean(meta.imported);
  const via = typeof meta.via === 'string' ? meta.via : undefined;
  const action = blockerAction(event);

  return (
    <>
      {event.visibility === 'private' && (
        <span
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.24)' }}
          title="Only visible to its author"
        >
          <Lock size={9} />
          Private
        </span>
      )}
      {action && (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{
            background: action === 'raised' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
            color: action === 'raised' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          {action === 'raised' ? 'Raised' : 'Cleared'}
        </span>
      )}
      {via && (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {via.replace(/_/g, ' ')}
        </span>
      )}
      {imported && (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Imported from the previous notes field"
        >
          Imported
        </span>
      )}
      {event.approximateTime && (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Approximate time"
        >
          ~time
        </span>
      )}
    </>
  );
}

interface TaskTimelineProps {
  taskKey: string;
  mode: 'manager' | 'developer';
  emptyLabel?: string;
}

export function TaskTimelineDisclosure({ taskKey, mode }: TaskTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-w-0 px-2 pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`Activity for ${taskKey}`}
        className="flex items-center gap-1.5 py-1 text-[12px]"
        style={{ color: 'var(--text-secondary)' }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
      >
        <History size={12} />
        {expanded ? 'Hide activity' : 'Activity'}
      </button>
      {expanded && <TaskTimeline taskKey={taskKey} mode={mode} />}
    </div>
  );
}

export function TaskTimeline({ taskKey, mode, emptyLabel = 'No activity yet.' }: TaskTimelineProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const managerQuery = useTaskEvents(taskKey, { enabled: mode === 'manager' });
  const developerQuery = useMyDayTaskEvents(taskKey, { enabled: mode === 'developer' });
  const query = mode === 'manager' ? managerQuery : developerQuery;
  const updateVisibility = useUpdateTaskEventVisibility(taskKey);
  const redactEvent = useRedactTaskEvent(taskKey);

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="text-[12px]">Loading timeline…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="py-3 text-[12px]" style={{ color: 'var(--danger)' }}>
        Could not load the timeline.{' '}
        <button type="button" onClick={() => void query.refetch()} style={{ color: 'var(--accent)' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-0">
        {events.length === 0 && (
          <div className="py-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {emptyLabel}
          </div>
        )}
        {events.map((event) => {
          const typeLabel =
            event.type === 'blocker' && blockerAction(event) === 'cleared' ? 'Blocker cleared' : EVENT_TYPE_LABELS[event.type];
          const showVisibilityToggle = mode === 'manager' && canToggleVisibility(event, user?.accountId);
          const showRedact = mode === 'manager' && canRedact(event, user?.accountId);
          return (
            <div key={event.id} className="group/event flex gap-2.5 py-2.5" style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)' }}>
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: event.visibility === 'private' ? 'var(--warning)' : 'var(--accent)', opacity: event.redacted ? 0.35 : 0.9 }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
                    {typeLabel}
                  </span>
                  <EventBadges event={event} />
                  <span className="ml-auto flex items-center gap-1">
                    {showVisibilityToggle && (
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/event:opacity-100"
                        style={{ color: 'var(--text-muted)' }}
                        title={event.visibility === 'private' ? 'Make shared' : 'Make private'}
                        aria-label={event.visibility === 'private' ? 'Make event shared' : 'Make event private'}
                        onClick={() =>
                          updateVisibility.mutate(
                            { eventId: event.id, visibility: event.visibility === 'private' ? 'shared' : 'private' },
                            { onError: (err) => addToast(err.message, 'error') },
                          )
                        }
                      >
                        {event.visibility === 'private' ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                    )}
                    {showRedact && (
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/event:opacity-100"
                        style={{ color: 'var(--danger)' }}
                        title="Remove this event's content"
                        aria-label="Redact event"
                        onClick={() => redactEvent.mutate(event.id, { onError: (err) => addToast(err.message, 'error') })}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {event.redacted ? (
                    <span className="italic" style={{ color: 'var(--text-muted)' }}>
                      This entry was removed.
                    </span>
                  ) : (
                    eventDescription(event)
                  )}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {authorLabel(event)} · <span title={formatAbsoluteDateTime(event.occurredAt)}>{formatRelativeTime(event.occurredAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="mt-2 text-[12px] font-medium disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
}
