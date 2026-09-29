import { useMemo } from 'react';
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
import { describeFeedEntry, feedCounts, groupStandupFeed, type FeedGroup } from '@/lib/standup';
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
}: {
  data: StandupFeedResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectTask: (taskKey: string) => void;
  onOpenTask: (taskKey: string) => void;
  /** docs/56 P1-07: hides the feed; the page keeps a slim rail to bring it back. */
  onCollapse?: () => void;
}) {
  const groups = useMemo(() => groupStandupFeed(data?.entries ?? []), [data]);
  const counts = useMemo(() => feedCounts(data?.entries ?? []), [data]);

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
        Since last standup
      </SectionLabel>

      {data && groups.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {counts.blockers > 0 && <CountChip color={TONE_COLORS.danger} label={`${counts.blockers} blocker${counts.blockers === 1 ? '' : 's'}`} />}
          {counts.statusChanges > 0 && <CountChip label={`${counts.statusChanges} status`} />}
          {counts.updates > 0 && <CountChip label={`${counts.updates} update${counts.updates === 1 ? '' : 's'}`} />}
          {counts.checkins > 0 && <CountChip color={TONE_COLORS.info} label={`${counts.checkins} check-in${counts.checkins === 1 ? '' : 's'}`} />}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading feed">
            {[70, 55, 62].map((width) => (
              <div key={width} className="rounded-xl p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className="h-3 animate-pulse rounded" style={{ width: `${width}%`, background: 'var(--bg-tertiary)' }} />
                <div className="mt-2 h-2.5 w-2/5 animate-pulse rounded" style={{ background: 'var(--bg-tertiary)' }} />
              </div>
            ))}
          </div>
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
            className="rounded-xl px-4 py-8 text-center"
            style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border-strong)' }}
          >
            <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>Quiet since {data ? windowLabel(data.windowStart) : 'the last standup'}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>No updates, status changes, or check-ins in the window.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <FeedGroupCard key={group.id} group={group} onSelectTask={onSelectTask} onOpenTask={onOpenTask} />
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
}: {
  group: FeedGroup;
  onSelectTask: (taskKey: string) => void;
  onOpenTask: (taskKey: string) => void;
}) {
  const urgent = group.importance >= 3;
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: 'var(--bg-secondary)',
        border: `1px solid ${urgent ? 'color-mix(in srgb, var(--danger) 34%, var(--border))' : 'var(--border)'}`,
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
              <span className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{group.title}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenTask(group.taskKey!)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label={`Open ${group.taskKey}`}
              title="Open task"
            >
              <ArrowUpRight size={13} />
            </button>
          </>
        ) : (
          <span className="flex-1 text-[12.5px] font-semibold" style={{ color: 'var(--info)' }}>{group.title}</span>
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
                    {view.label}
                  </span>
                  {entry.authorType === 'manager' && (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· you</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} title={entry.occurredAt}>
                    {formatRelativeTime(entry.occurredAt)}
                  </span>
                </div>
                {view.text && (
                  <p className="line-clamp-3 whitespace-pre-line text-[12.5px] leading-[1.45]" style={{ color: 'var(--text-secondary)' }}>
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

function CountChip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums"
      style={{
        color: color ?? 'var(--text-secondary)',
        background: color ? `color-mix(in srgb, ${color} 11%, transparent)` : 'var(--bg-tertiary)',
        border: `1px solid ${color ? `color-mix(in srgb, ${color} 22%, transparent)` : 'var(--border)'}`,
      }}
    >
      {label}
    </span>
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
