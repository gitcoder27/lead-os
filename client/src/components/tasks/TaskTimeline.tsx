import { useState } from 'react';
import {
  CalendarClock,
  ClipboardCheck,
  Crosshair,
  Eye,
  EyeOff,
  Gavel,
  GitMerge,
  History,
  Link2,
  Lock,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  OctagonAlert,
  PenLine,
  Sparkles,
  Trash2,
  UserRound,
  CircleDot,
  ShieldCheck,
} from 'lucide-react';
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

type NameResolver = (accountId: string) => string | undefined;

function eventDescription(event: TaskEvent, resolveName?: NameResolver): string {
  if (event.body) return event.body;
  const meta = eventMeta(event);
  const raw = (field: string, fallback = 'Not set') => typeof meta[field] === 'string' && meta[field] ? String(meta[field]) : fallback;
  // Account-id fields read as people when the caller can resolve them.
  const PERSON_FIELDS = new Set(['ownerId', 'fromId', 'toId', 'developerAccountId']);
  const text = (field: string, fallback = 'Not set') => {
    const value = raw(field, fallback);
    return PERSON_FIELDS.has(field) && value !== fallback ? resolveName?.(value) ?? value : value;
  };
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

function authorLabel(event: TaskEvent, accountId?: string): string {
  if (!event.author.displayName && event.author.type === 'manager' && accountId && event.author.id === accountId) return 'You';
  return event.author.displayName ?? `${AUTHOR_LABELS[event.author.type] ?? event.author.type}${event.author.id ? ` (${event.author.id})` : ''}`;
}

const BADGE = 'rounded-full px-1.5 text-[11px] font-semibold leading-[18px]';

function EventBadges({ event }: { event: TaskEvent }) {
  const meta = eventMeta(event);
  const imported = Boolean(meta.imported);
  const via = typeof meta.via === 'string' ? meta.via : undefined;
  const action = blockerAction(event);

  return (
    <>
      {event.visibility === 'private' && (
        <span
          className={`${BADGE} inline-flex items-center gap-1`}
          style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}
          title="Only visible to its author"
        >
          <Lock size={9} />
          Private
        </span>
      )}
      {action && (
        <span
          className={BADGE}
          style={{
            background: action === 'raised' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'color-mix(in srgb, var(--success) 12%, transparent)',
            color: action === 'raised' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          {action === 'raised' ? 'Raised' : 'Cleared'}
        </span>
      )}
      {via && (
        <span
          className={BADGE}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {via.replace(/_/g, ' ')}
        </span>
      )}
      {imported && (
        <span
          className={BADGE}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Imported from the previous notes field"
        >
          Imported
        </span>
      )}
      {event.approximateTime && (
        <span
          className={BADGE}
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Approximate time"
        >
          ~time
        </span>
      )}
    </>
  );
}

/** Event types that carry a human message — rendered as cards; the rest are compact system lines. */
const MESSAGE_TYPES = new Set<TaskEventType>(['update', 'instruction', 'decision', 'blocker', 'note_ref', 'checkin_ref']);

function eventVisual(event: TaskEvent): { Icon: typeof History; color: string } {
  switch (event.type) {
    case 'update': return { Icon: MessageSquareText, color: 'var(--accent)' };
    case 'instruction': return { Icon: Megaphone, color: 'var(--info)' };
    case 'decision': return { Icon: Gavel, color: 'var(--success)' };
    case 'blocker':
      return blockerAction(event) === 'cleared'
        ? { Icon: ShieldCheck, color: 'var(--success)' }
        : { Icon: OctagonAlert, color: 'var(--danger)' };
    case 'note_ref': return { Icon: NotebookPen, color: 'var(--md-accent)' };
    case 'checkin_ref': return { Icon: ClipboardCheck, color: 'var(--accent)' };
    case 'created': return { Icon: Sparkles, color: 'var(--text-muted)' };
    case 'status': return { Icon: CircleDot, color: 'var(--text-muted)' };
    case 'assign': return { Icon: UserRound, color: 'var(--text-muted)' };
    case 'focus': return { Icon: Crosshair, color: 'var(--text-muted)' };
    case 'title': return { Icon: PenLine, color: 'var(--text-muted)' };
    case 'schedule': return { Icon: CalendarClock, color: 'var(--text-muted)' };
    case 'link': return { Icon: Link2, color: 'var(--text-muted)' };
    case 'merged': return { Icon: GitMerge, color: 'var(--text-muted)' };
    default: return { Icon: History, color: 'var(--text-muted)' };
  }
}

const CLAMP_CHARS = 420;
const CLAMP_LINES = 7;

function EventBody({ text }: { text: string }) {
  const long = text.length > CLAMP_CHARS || text.split('\n').length > CLAMP_LINES;
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div
        className={`whitespace-pre-wrap break-words text-[13px] leading-[1.6] ${long && !expanded ? 'line-clamp-6' : ''}`}
        style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-[12px] font-medium outline-none hover:underline focus-visible:underline"
          style={{ color: 'var(--accent)' }}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

interface TaskTimelineProps {
  taskKey: string;
  mode: 'manager' | 'developer';
  emptyLabel?: string;
  /** Maps account ids in system events (owner, reassignment, check-in) to display names. */
  resolveName?: NameResolver;
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

const ACTION_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded-md outline-none transition-opacity hover:bg-[var(--bg-tertiary)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--border-active)] group-hover/event:opacity-100 group-focus-within/event:opacity-100 [@media(hover:hover)]:opacity-0';

export function TaskTimeline({ taskKey, mode, emptyLabel = 'No activity yet.', resolveName }: TaskTimelineProps) {
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
      <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading timeline">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3">
            <span className="h-6 w-6 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="flex-1 space-y-1.5 pt-1">
              <span className="block h-2.5 w-24 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)' }} />
              <span className="block h-2.5 w-3/4 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)', opacity: 0.7 }} />
            </div>
          </div>
        ))}
        <span className="sr-only">Loading timeline…</span>
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

  if (events.length === 0) {
    return (
      <div className="py-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div>
      <ol className="relative">
        {events.map((event, index) => {
          const typeLabel =
            event.type === 'blocker' && blockerAction(event) === 'cleared' ? 'Blocker cleared' : EVENT_TYPE_LABELS[event.type];
          const showVisibilityToggle = mode === 'manager' && canToggleVisibility(event, user?.accountId);
          const showRedact = mode === 'manager' && canRedact(event, user?.accountId);
          const isPrivate = event.visibility === 'private';
          const message = MESSAGE_TYPES.has(event.type) || (event.type === 'created' && Boolean(event.body));
          const last = index === events.length - 1 && !query.hasNextPage;
          const { Icon, color } = eventVisual(event);
          const nodeColor = event.redacted ? 'var(--text-disabled)' : isPrivate && !message ? 'var(--warning)' : color;
          const description = event.redacted ? null : eventDescription(event, resolveName);

          const actions = (showVisibilityToggle || showRedact) && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5 self-start">
              {showVisibilityToggle && (
                <button
                  type="button"
                  className={ACTION_BUTTON}
                  style={{ color: 'var(--text-muted)' }}
                  title={isPrivate ? 'Make shared' : 'Make private'}
                  aria-label={isPrivate ? 'Make event shared' : 'Make event private'}
                  onClick={() =>
                    updateVisibility.mutate(
                      { eventId: event.id, visibility: isPrivate ? 'shared' : 'private' },
                      { onError: (err) => addToast(err.message, 'error') },
                    )
                  }
                >
                  {isPrivate ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              )}
              {showRedact && (
                <button
                  type="button"
                  className={ACTION_BUTTON}
                  style={{ color: 'var(--danger)' }}
                  title="Remove this event's content"
                  aria-label="Redact event"
                  onClick={() => redactEvent.mutate(event.id, { onError: (err) => addToast(err.message, 'error') })}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </span>
          );

          const meta = (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span>{authorLabel(event, user?.accountId)}</span>
              <span aria-hidden="true"> · </span>
              <time dateTime={event.occurredAt} title={formatAbsoluteDateTime(event.occurredAt)}>{formatRelativeTime(event.occurredAt)}</time>
            </span>
          );

          return (
            <li key={event.id} className={`group/event relative flex gap-3 ${last ? '' : message ? 'pb-5' : 'pb-3.5'}`}>
              {!last && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[11.5px] top-[26px] w-px"
                  style={{ background: 'color-mix(in srgb, var(--border) 75%, transparent)' }}
                />
              )}
              <span
                aria-hidden="true"
                className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{
                  color: nodeColor,
                  background: message ? `color-mix(in srgb, ${nodeColor} 14%, var(--bg-primary))` : 'var(--bg-primary)',
                  border: `1px solid ${message ? `color-mix(in srgb, ${nodeColor} 32%, transparent)` : 'var(--border)'}`,
                }}
              >
                <Icon size={message ? 12 : 11} strokeWidth={2.1} />
              </span>

              {message ? (
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-[24px] flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[12.5px] font-semibold" style={{ color: event.redacted ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {typeLabel}
                    </span>
                    <EventBadges event={event} />
                    {meta}
                    {actions}
                  </div>
                  <div
                    className="mt-1.5 rounded-xl px-3 py-2.5"
                    style={{
                      background: isPrivate ? 'color-mix(in srgb, var(--warning) 5%, var(--bg-secondary))' : 'var(--bg-secondary)',
                      border: `1px solid ${isPrivate ? 'color-mix(in srgb, var(--warning) 22%, transparent)' : 'var(--border)'}`,
                    }}
                  >
                    {event.redacted ? (
                      <span className="text-[13px] italic" style={{ color: 'var(--text-muted)' }}>
                        This entry was removed.
                      </span>
                    ) : (
                      <EventBody text={description ?? ''} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[24px] min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                  <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{typeLabel}</span>
                  {event.redacted ? (
                    <span className="italic" style={{ color: 'var(--text-muted)' }}>This entry was removed.</span>
                  ) : (
                    <span className="min-w-0 break-words" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{description}</span>
                  )}
                  <EventBadges event={event} />
                  {meta}
                  {actions}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="ml-9 mt-1 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
}
