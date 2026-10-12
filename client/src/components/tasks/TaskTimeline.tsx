import { isTaskActivityAccessLoss } from '@/lib/task-activity-recovery';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInboxTargetEvent } from '@/hooks/useTaskInbox';
import { ChevronDown, ClipboardCheck, Eye, EyeOff, History, Lock, NotebookPen, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  useMyDayTaskEvents,
  useRedactTaskEvent,
  useTaskEvents,
  useUpdateTaskEventVisibility,
} from '@/hooks/useTasks';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { FOCUS_RING } from '@/components/ui/focus';
import {
  INLINE_CHANGE_LIMIT,
  blockerAction,
  buildActivityFeed,
  eventMeta,
  messageBody,
  noteContext,
  viaLabel,
  type ActivityChange,
  type NameResolver,
} from '@/lib/task-activity';
import type { TaskEvent, TaskEventType } from '@/types';
import './task-opened-update.css';

export { friendlyEventValue, plainExcerpt } from '@/lib/task-activity';

const AUTHOR_LABELS: Record<string, string> = {
  manager: 'Manager',
  developer: 'Developer',
  copilot: 'Copilot',
  system: 'LeadOS',
};

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

/** Who wrote or caused an event, by name (the server resolves names within the workspace). */
export function authorLabel(event: TaskEvent, accountId?: string): string {
  // docs/73 UXD-14: a note reference is written by the app on your behalf — say where it came from.
  if (event.type === 'note_ref' && event.author.type === 'system') return 'From your note';
  if (event.author.type === 'copilot') return 'Copilot';
  if (accountId && event.author.id === accountId) return 'You';
  if (event.author.displayName) return event.author.displayName;
  return AUTHOR_LABELS[event.author.type] ?? event.author.type;
}

/** The actor beside a change; an unattributed app job stays unnamed rather than "LeadOS". */
function changeActor(event: TaskEvent, accountId?: string): string | undefined {
  if (event.author.type === 'system' && !event.author.displayName && !(accountId && event.author.id === accountId)) return undefined;
  return authorLabel(event, accountId);
}

const TAG = 'rounded-full px-1.5 text-meta font-semibold leading-[18px]';

/** Message kinds that are not plain updates say so, in their tone. */
function messageTag(event: TaskEvent): { label: string; tone: string } | null {
  switch (event.type) {
    case 'instruction': return { label: 'Instruction', tone: 'var(--info)' };
    case 'decision': return { label: 'Decision', tone: 'var(--success)' };
    case 'blocker': return blockerAction(event) === 'cleared' ? { label: 'Blocker cleared', tone: 'var(--success)' } : { label: 'Blocker', tone: 'var(--danger)' };
    case 'checkin_ref': return { label: 'Check-in', tone: 'var(--accent)' };
    default: return null;
  }
}

function EventBadges({ event }: { event: TaskEvent }) {
  return (
    <>
      {event.visibility === 'private' && (
        <span
          className={`${TAG} inline-flex items-center gap-1`}
          style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning-text, var(--warning))' }}
          title="Only visible to its author"
        >
          <Lock size={9} aria-hidden="true" />
          Private
        </span>
      )}
      {Boolean(eventMeta(event).imported) && (
        <span className={TAG} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }} title="Imported from the previous notes field">
          Imported
        </span>
      )}
      {event.approximateTime && (
        <span className={TAG} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }} title="Approximate time">
          ~time
        </span>
      )}
    </>
  );
}

const CLAMP_CHARS = 420;
const CLAMP_LINES = 7;

function EventBody({ text }: { text: string }) {
  const long = text.length > CLAMP_CHARS || text.split('\n').length > CLAMP_LINES;
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div
        className={`whitespace-pre-wrap wrap-break-word text-body leading-[1.6] ${long && !expanded ? 'line-clamp-6' : ''}`}
        style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-ui font-medium outline-hidden hover:underline focus-visible:underline"
          style={{ color: 'var(--accent-text, var(--accent))' }}
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
        className="flex items-center gap-1.5 py-1 text-ui"
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
  'flex h-6 w-6 items-center justify-center rounded-md outline-hidden transition-opacity hover:bg-(--bg-tertiary) focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-(--border-active) group-hover/event:opacity-100 group-focus-within/event:opacity-100 [@media(hover:hover)]:opacity-0';

const FOCUSED_LABELS: Partial<Record<TaskEventType, string>> = { instruction: 'Instruction', update: 'Update', created: 'Assignment', assign: 'Assignment', schedule: 'Date change', priority: 'Priority change', status: 'Status change' };

/**
 * Centres the element inside its own scroll area only. `scrollIntoView` also scrolls `overflow: hidden` ancestors
 * (the page shell), which slides the toolbar and its Back button out of reach.
 */
function centerInScroller(element: HTMLElement) {
  let scroller = element.parentElement;
  while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
  if (!scroller) return;
  const box = element.getBoundingClientRect();
  const area = scroller.getBoundingClientRect();
  scroller.scrollTop += box.top - area.top - Math.max(0, (area.height - box.height) / 2);
}

export function TaskTimeline(props: TaskTimelineProps) {
  const { user } = useAuth();
  const requestedId = window.location.pathname === `/t/${encodeURIComponent(props.taskKey)}` ? new URLSearchParams(window.location.search).get('event') : null;
  const eventId = requestedId && /^\d+$/.test(requestedId) && Number.isSafeInteger(Number(requestedId)) && Number(requestedId) > 0 ? Number(requestedId) : undefined;
  const target = useInboxTargetEvent(props.taskKey, eventId);
  const ref = useRef<HTMLElement>(null);
  const focusedId = useRef<number>();
  const [dismissed, setDismissed] = useState<number>();
  const event = target.enabled && !target.isError && target.data?.event.id !== dismissed ? target.data?.event : undefined;
  const focusedLabel = !event ? '' : event.type === 'blocker' ? (blockerAction(event) === 'cleared' ? 'Blocker cleared' : 'Blocker raised') : FOCUSED_LABELS[event.type] ?? messageTag(event)?.label ?? 'Change';
  useEffect(() => {
    if (!event || focusedId.current === event.id) return;
    focusedId.current = event.id;
    ref.current?.focus({ preventScroll: true });
    // Instant, not smooth: this runs as the window comes back from the background, when a smooth scroll can stall.
    if (ref.current) centerInScroller(ref.current);
  }, [event]);
  // The highlight is a pointer to the update, not a place to stay: dropping `?event=` puts the page back to normal.
  const dismiss = () => {
    if (!event) return;
    setDismissed(event.id);
    const url = new URL(window.location.href);
    url.searchParams.delete('event');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };
  return (
    <>
      {eventId && target.isLoading ? <p role="status">Opening update…</p> : null}
      {eventId && target.enabled && target.isError ? <p role="alert">This update is unavailable. <button type="button" className="min-h-[44px] rounded-md px-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--focus-ring)" onClick={() => void target.refetch()}>Retry</button></p> : null}
      {event ? (
        <section ref={ref} id={`task-update-${event.id}`} tabIndex={-1} aria-label="Opened task update" className="task-opened-update">
          <div className="task-opened-update-head">
            <span className="task-opened-update-kind">{focusedLabel}</span>
            <span className="task-opened-update-meta">
              {authorLabel(event, user?.accountId)} ·{' '}
              <time dateTime={event.occurredAt} title={formatAbsoluteDateTime(event.occurredAt)}>{formatRelativeTime(event.occurredAt)}</time>
            </span>
            <button type="button" className="task-opened-update-close" aria-label="Dismiss highlight" title="Dismiss" onClick={dismiss}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <EventBody text={messageBody(event, props.resolveName)} />
        </section>
      ) : null}
      <TaskTimelineBody {...props} />
    </>
  );
}

/** The rail every item hangs from; the last item has nothing below it. */
function Rail({ last }: { last: boolean }) {
  if (last) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 left-[11.5px] top-0 w-px"
      style={{ background: 'var(--border)' }}
    />
  );
}

function TimeStamp({ event }: { event: TaskEvent }) {
  return (
    <time dateTime={event.occurredAt} title={formatAbsoluteDateTime(event.occurredAt)}>{formatRelativeTime(event.occurredAt)}</time>
  );
}

function MessageAvatar({ event, label, viewerName }: { event: TaskEvent; label: string; viewerName?: string }) {
  const icon = event.type === 'note_ref' ? NotebookPen : event.author.type === 'copilot' ? Sparkles : event.type === 'checkin_ref' && !event.author.displayName ? ClipboardCheck : null;
  if (icon) {
    const Icon = icon;
    return (
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
        <Icon size={12} strokeWidth={2.1} />
      </span>
    );
  }
  // Initials come from the person's name even when the label reads "You".
  return <Avatar name={event.author.displayName ?? (label === 'You' ? viewerName ?? label : label)} seed={event.author.id ?? label} size={24} muted={event.redacted} />;
}

interface ItemProps {
  last: boolean;
  accountId?: string;
  viewerName?: string;
  resolveName?: NameResolver;
  actions: (event: TaskEvent, change?: boolean) => ReactNode;
}

function MessageItem({ event, last, accountId, viewerName, resolveName, actions }: ItemProps & { event: TaskEvent }) {
  const label = authorLabel(event, accountId);
  const tag = messageTag(event);
  const context = noteContext(event) ?? viaLabel(event);
  const isPrivate = event.visibility === 'private';
  const blockerRaised = event.type === 'blocker' && blockerAction(event) === 'raised';
  return (
    <li className={`group/event relative flex gap-3 ${last ? '' : 'pb-5'}`}>
      <Rail last={last} />
      <span className="relative z-1 h-6 shrink-0 self-start rounded-full" style={{ background: 'var(--bg-primary)' }}>
        <MessageAvatar event={event} label={label} viewerName={viewerName} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-[24px] flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
          {tag && (
            <span className={TAG} style={{ background: `color-mix(in srgb, ${tag.tone} 13%, transparent)`, color: tag.tone }}>{tag.label}</span>
          )}
          <span className="text-ui" style={{ color: 'var(--text-muted)' }}>
            {context ? <>{context}<span aria-hidden="true"> · </span></> : null}
            <TimeStamp event={event} />
          </span>
          <EventBadges event={event} />
          {actions(event)}
        </div>
        <div
          className="mt-1.5 rounded-xl px-3 py-2.5"
          style={{
            background: isPrivate ? 'color-mix(in srgb, var(--warning) 5%, var(--bg-secondary))' : 'var(--bg-secondary)',
            border: `1px solid ${isPrivate ? 'color-mix(in srgb, var(--warning) 22%, transparent)' : blockerRaised ? 'color-mix(in srgb, var(--danger) 28%, transparent)' : 'var(--border)'}`,
          }}
        >
          {event.redacted ? (
            <span className="text-body italic" style={{ color: 'var(--text-muted)' }}>This entry was removed.</span>
          ) : (
            <EventBody text={messageBody(event, resolveName)} />
          )}
        </div>
      </div>
    </li>
  );
}

function ChangeLine({ change, accountId, actions }: { change: ActivityChange; accountId?: string; actions: ItemProps['actions'] }) {
  const actor = changeActor(change.event, accountId);
  return (
    <div className="flex min-h-[24px] min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui">
      <span
        className={`min-w-0 wrap-break-word ${change.event.redacted ? 'italic' : ''}`}
        style={{ color: change.event.redacted ? 'var(--text-muted)' : 'var(--text-secondary)', overflowWrap: 'anywhere' }}
      >
        {change.text}
      </span>
      {change.count > 1 && change.event.type !== 'schedule' && (
        <span className={TAG} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }} title={`${change.count} times`}>×{change.count}</span>
      )}
      <span style={{ color: 'var(--text-muted)' }}>
        {actor ? <>{actor}<span aria-hidden="true"> · </span></> : null}
        <TimeStamp event={change.event} />
      </span>
      <EventBadges event={change.event} />
      {actions(change.event, true)}
    </div>
  );
}

function ChangeDot() {
  return (
    <span aria-hidden="true" className="relative z-1 flex h-6 w-6 shrink-0 items-center justify-center">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--bg-primary)', border: '1.5px solid var(--text-muted)' }} />
    </span>
  );
}

function ChangeRun({ changes, last, accountId, actions }: ItemProps & { changes: ActivityChange[] }) {
  const [open, setOpen] = useState(false);
  const folded = changes.length > INLINE_CHANGE_LIMIT;

  if (!folded || open) {
    return (
      <>
        {changes.map((change, index) => {
          const isLast = last && !folded && index === changes.length - 1;
          return (
            <li key={change.event.id} className={`group/event relative flex gap-3 ${isLast ? '' : 'pb-2.5'}`}>
              <Rail last={isLast} />
              <ChangeDot />
              <ChangeLine change={change} accountId={accountId} actions={actions} />
            </li>
          );
        }).concat(folded ? [
          <li key="collapse" className={`relative flex gap-3 ${last ? '' : 'pb-2.5'}`}>
            <Rail last={last} />
            <span className="h-6 w-6 shrink-0" aria-hidden="true" />
            <button
              type="button"
              aria-expanded
              onClick={() => setOpen(false)}
              className={`-mx-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-ui font-medium transition-colors hover:bg-(--bg-tertiary) ${FOCUS_RING}`}
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronDown size={12} className="rotate-180" aria-hidden="true" />
              Hide {changes.length} changes
            </button>
          </li>,
        ] : [])}
      </>
    );
  }

  // Name the newest kinds of change so the folded line still says what happened.
  const preview = [...new Set(changes.map((change) => change.text))].slice(0, 2).join(', ');
  return (
    <li className={`relative flex gap-3 ${last ? '' : 'pb-2.5'}`}>
      <Rail last={last} />
      <span aria-hidden="true" className="relative z-1 flex h-6 w-6 shrink-0 items-center justify-center">
        <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full" style={{ background: 'var(--bg-primary)', border: '1.5px solid var(--text-muted)' }}>
          <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--text-muted)' }} />
        </span>
      </span>
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className={`-mx-1.5 flex min-h-[24px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-ui transition-colors hover:bg-(--bg-tertiary) ${FOCUS_RING}`}
      >
        <span className="shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>{changes.length} changes</span>
        <span className="min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
          <span aria-hidden="true">· </span>{preview}{changes.length > 2 ? '…' : ''}
        </span>
        <span className="ml-auto shrink-0 pl-2" style={{ color: 'var(--text-muted)' }}>
          <TimeStamp event={changes[0]!.event} />
        </span>
        <ChevronDown size={12} aria-hidden="true" style={{ color: 'var(--text-muted)' }} className="shrink-0" />
      </button>
    </li>
  );
}

function TaskTimelineBody({ taskKey, mode, emptyLabel = 'No activity yet.', resolveName }: TaskTimelineProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const managerQuery = useTaskEvents(taskKey, { enabled: mode === 'manager' });
  const developerQuery = useMyDayTaskEvents(taskKey, { enabled: mode === 'developer' });
  const query = mode === 'manager' ? managerQuery : developerQuery;
  const updateVisibility = useUpdateTaskEventVisibility(taskKey);
  const redactEvent = useRedactTaskEvent(taskKey);

  const accessLost = isTaskActivityAccessLoss(query.error);
  const seen = new Set<number>();
  const events = accessLost ? [] : (query.data?.pages.flatMap((page) => page.events) ?? []).filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  const retryOlder = query.isFetchNextPageError && !accessLost;
  const errorBanner = query.isError ? (
    <div role="alert" className="py-3 text-ui" style={{ color: 'var(--danger)' }}>
      {retryOlder ? 'Could not load older activity.' : query.data && !accessLost ? 'Could not refresh the timeline.' : 'Could not load the timeline.'}{' '}
      <button type="button" disabled={query.isFetching} onClick={() => void (retryOlder ? query.fetchNextPage() : query.refetch())} style={{ color: 'var(--accent)' }}>
        {retryOlder ? 'Retry older activity' : 'Retry'}
      </button>
    </div>
  ) : null;

  if (query.isLoading) {
    return (
      <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading timeline">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3">
            <span className="h-6 w-6 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="flex-1 space-y-1.5 pt-1">
              <span className="block h-2.5 w-24 animate-pulse rounded-sm" style={{ background: 'var(--bg-tertiary)' }} />
              <span className="block h-2.5 w-3/4 animate-pulse rounded-sm" style={{ background: 'var(--bg-tertiary)', opacity: 0.7 }} />
            </div>
          </div>
        ))}
        <span className="sr-only">Loading timeline…</span>
      </div>
    );
  }

  if (query.isError && (!query.data || accessLost)) return errorBanner;

  if (events.length === 0 && !query.isError) {
    return (
      <div className="py-3 text-body" style={{ color: 'var(--text-muted)' }}>
        {emptyLabel}
      </div>
    );
  }

  // Change lines keep their actions to hover devices; on touch they would sit on every line.
  const actions = (event: TaskEvent, change = false) => {
    const showVisibilityToggle = mode === 'manager' && canToggleVisibility(event, user?.accountId);
    const showRedact = mode === 'manager' && canRedact(event, user?.accountId);
    if (!showVisibilityToggle && !showRedact) return null;
    const isPrivate = event.visibility === 'private';
    return (
      <span className={`ml-auto flex shrink-0 items-center gap-0.5 self-start ${change ? '[@media(hover:none)]:hidden' : ''}`}>
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
  };

  const feed = buildActivityFeed(events, resolveName);

  return (
    <div aria-busy={Boolean(query.isFetching)}>
      {errorBanner}
      {query.isFetching && !query.isLoading ? <p role="status" className="sr-only">{query.isFetchingNextPage ? 'Loading older activity…' : 'Refreshing activity…'}</p> : null}
      <ol className="relative">
        {feed.map((item, index) => {
          const last = index === feed.length - 1 && !query.hasNextPage;
          return item.kind === 'message' ? (
            <MessageItem key={item.event.id} event={item.event} last={last} accountId={user?.accountId} viewerName={user?.displayName} resolveName={resolveName} actions={actions} />
          ) : (
            <ChangeRun key={item.key} changes={item.changes} last={last} accountId={user?.accountId} resolveName={resolveName} actions={actions} />
          );
        })}
      </ol>
      {query.hasNextPage && !query.isFetchNextPageError && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetching}
          className="ml-9 mt-1 rounded-lg px-2 py-1 text-ui font-medium transition-colors hover:bg-(--bg-tertiary) disabled:opacity-40"
          style={{ color: 'var(--accent-text, var(--accent))' }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
}
