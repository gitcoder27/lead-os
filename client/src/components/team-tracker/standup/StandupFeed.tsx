import { useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  TriangleAlert,
  ArrowUpRight,
  CircleCheck,
  CirclePlus,
  MessageSquare,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  UserRoundCheck,
} from 'lucide-react';
import type { StandupFeedEntry, StandupFeedResponse } from '@/types';
import { describeFeedEntry, groupStandupFeed, type FeedGroup } from '@/lib/standup';
import { useAuth } from '@/context/AuthContext';
import { formatRelativeTime } from '@/lib/utils';
import { SectionLabel, TONE_COLORS } from './StandupPrimitives';

function entryIcon(entry: StandupFeedEntry) {
  if (entry.kind === 'checkin') return MessageSquareText;
  switch (entry.type) {
    case 'blocker': return entry.blockerAction === 'cleared' ? CircleCheck : TriangleAlert;
    case 'status': return entry.statusTo === 'done' ? CircleCheck : Activity;
    case 'assign': return UserRoundCheck;
    case 'created': return CirclePlus;
    default: return MessageSquare;
  }
}

function windowLabel(windowStart: string): string {
  try {
    return new Date(windowStart).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return windowStart;
  }
}

/** docs/50 S5: rolling-window feed grouped by task, importance-first. */
export function StandupFeed({
  data,
  isLoading,
  isError,
  onRetry,
  onSelectTask,
  onOpenTask,
  onCollapse,
  note = false,
  onReadThrough,
}: {
  data: StandupFeedResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectTask: (taskKey: string) => void;
  onOpenTask: (taskKey: string) => void;
  /** docs/56 P1-07: hides the feed; the page keeps a slim rail to bring it back. */
  onCollapse?: () => void;
  note?: boolean;
  onReadThrough?: () => void;
}) {
  const groups = useMemo(() => groupStandupFeed(data?.entries ?? []), [data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && element.clientHeight > 0 && element.scrollHeight <= element.clientHeight && !data?.truncated && !isError && !isLoading) onReadThrough?.();
  }, [data, isError, isLoading, onReadThrough]);

  return (
    <section className="flex min-h-0 flex-col" aria-label="Since last standup">
      <SectionLabel
        right={(
          <span className="flex items-center gap-1.5">
            {data ? (
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {data.anchoredToSession ? `since ${windowLabel(data.windowStart)}` : `${data.windowHours}h window`}
              </span>
            ) : null}
            {onCollapse ? (
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Hide feed"
                title="Hide feed"
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-[var(--bg-tertiary)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <PanelRightClose size={13} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        )}
      >
        Changes
      </SectionLabel>

      {data?.truncated && <p role="status" className="mb-3 text-xs">Showing the latest 120 events and 120 notes. Earlier changes remain in task history; this feed boundary will not advance.</p>}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-0.5" onScroll={(event) => {
        const element = event.currentTarget;
        if (element.clientHeight > 0 && element.scrollTop + element.clientHeight >= element.scrollHeight - 4 && !data?.truncated && !isError && !isLoading) onReadThrough?.();
      }}>
        {isLoading ? (
          // Calm and static: a pulsing skeleton on every person switch reads as flicker. Prefetching normally
          // means this is never seen; when it is, it holds the space without moving.
          <div aria-busy="true" aria-label="Loading feed" className="min-h-[120px]" />
        ) : isError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
            style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 24%, transparent)' }}
          >
            <TriangleAlert size={14} />
            <span className="flex-1">Feed unavailable.</span>
            <button type="button" onClick={onRetry} className="flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold" style={{ border: '1px solid currentColor' }}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div
            className="py-3"
          >
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No changes in this window.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <FeedGroupCard key={group.id} group={group} onSelectTask={onSelectTask} onOpenTask={onOpenTask} note={note} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FeedGroupCard({
  group,
  onSelectTask,
  onOpenTask,
  note,
}: {
  group: FeedGroup;
  onSelectTask: (taskKey: string) => void;
  onOpenTask: (taskKey: string) => void;
  note: boolean;
}) {
  const { user } = useAuth();
  const urgent = group.importance >= 3;
  return (
    <div
      className="overflow-hidden border-b py-2"
      style={{
        borderColor: urgent ? 'var(--danger)' : 'var(--border)',
      }}
    >
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        {group.kind === 'task' && group.taskKey ? (
          <>
            <button
              type="button"
              onClick={() => onSelectTask(group.taskKey!)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
              title={`Focus ${group.taskKey}`}
            >
              <span className="shrink-0 font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>{group.taskKey}</span>
              <span className="break-words text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{group.title}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenTask(group.taskKey!)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label={`Open ${group.taskKey}`}
              title="Open task"
            >
              <ArrowUpRight size={13} />
            </button>
          </>
        ) : (
          <span className="flex-1 text-[12.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{note ? 'Notes' : 'Notes and check-ins'}</span>
        )}
      </div>
      <ol className="px-3 pb-2.5">
        {group.entries.map((entry, index) => {
          const view = describeFeedEntry(entry);
          const Icon = entryIcon(entry);
          const color = TONE_COLORS[view.tone];
          const last = index === group.entries.length - 1;
          return (
            <li key={entry.id} className="relative flex gap-2.5 pt-1.5">
              {!last && <span className="absolute bottom-0 left-[6.5px] top-[22px] w-px" style={{ background: 'var(--border)' }} aria-hidden="true" />}
              <span className="mt-[3px] shrink-0" style={{ color }}>
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold" style={{ color: view.tone === 'muted' ? 'var(--text-secondary)' : color }}>
                    {entry.kind === 'checkin' && (note || entry.authorType === 'manager') ? 'Note' : view.label}
                  </span>
                  {entry.authorType === 'manager' && (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {entry.authorId === user?.accountId ? 'you' : 'manager'}</span>
                  )}
                    <span className="ml-auto text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} title={entry.occurredAt}>
                    {formatRelativeTime(entry.occurredAt)}
                  </span>
                </div>
                {view.text && (
                  <p className="whitespace-pre-line break-words text-[12.5px] leading-[1.45]" style={{ color: 'var(--text-secondary)' }}>
                    {view.text}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The feed's collapsed state: one slim button that carries the entry count. */
export function StandupFeedRail({ count, onExpand }: { count: number | undefined; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={count ? `Show feed (${count} since last standup)` : 'Show feed'}
      title="Show feed"
      className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg hover:bg-[var(--bg-tertiary)]"
      style={{ color: 'var(--text-muted)' }}
    >
      <PanelRightOpen size={14} aria-hidden="true" />
      {count ? <span className="text-[10px] font-semibold tabular-nums leading-none">{count}</span> : null}
    </button>
  );
}
