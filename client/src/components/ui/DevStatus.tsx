import type { TrackerDeveloperStatus } from '@/types';

/**
 * docs/54 V6: the one developer-status vocabulary — Team roster, drawer,
 * Standup, Today and My Day all read labels and colours from here.
 * Sentence case; "Done" (not "Done for today", not "On Track").
 */
export const STATUS_META: Record<TrackerDeveloperStatus, { label: string; color: string; key: string }> = {
  on_track: { label: 'On track', color: 'var(--success)', key: 'o' },
  at_risk: { label: 'At risk', color: 'var(--warning)', key: 'r' },
  blocked: { label: 'Blocked', color: 'var(--danger)', key: 'b' },
  waiting: { label: 'Waiting', color: 'var(--info)', key: 'w' },
  done_for_today: { label: 'Done', color: 'var(--accent)', key: 'd' },
};

export const DEV_STATUS_ORDER: TrackerDeveloperStatus[] = ['on_track', 'at_risk', 'blocked', 'waiting', 'done_for_today'];

export function StatusDot({ status, size = 7 }: { status: TrackerDeveloperStatus; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: STATUS_META[status].color }}
    />
  );
}

/** Statuses that are exceptions worth a tint; the rest read as quiet text. */
const LOUD_STATUSES: ReadonlySet<TrackerDeveloperStatus> = new Set(['blocked', 'at_risk', 'waiting']);

/**
 * A dot and a sentence-case label. "On track" and "Done" are the expected
 * states and stay quiet; exceptions get a soft tint so they are found without
 * every row shouting. Pass `emphasis` to tint every status (e.g. a selected value).
 */
export function DevStatusMark({ status, emphasis = false }: { status: TrackerDeveloperStatus; emphasis?: boolean }) {
  const meta = STATUS_META[status];
  const loud = emphasis || LOUD_STATUSES.has(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-[18px] ${loud ? 'rounded-full px-1.5 font-semibold' : 'font-medium'}`}
      style={
        loud
          ? {
              color: meta.color,
              background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 24%, transparent)`,
            }
          : { color: 'var(--text-muted)' }
      }
    >
      <StatusDot status={status} size={6} />
      {meta.label}
    </span>
  );
}
