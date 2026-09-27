import type { TrackerDeveloperStatus } from '@/types';

/** Sentence-case status vocabulary shared by the roster and the developer drawer. */
export const STATUS_META: Record<TrackerDeveloperStatus, { label: string; color: string; key: string }> = {
  on_track: { label: 'On track', color: 'var(--success)', key: 'o' },
  at_risk: { label: 'At risk', color: 'var(--warning)', key: 'r' },
  blocked: { label: 'Blocked', color: 'var(--danger)', key: 'b' },
  waiting: { label: 'Waiting', color: 'var(--info)', key: 'w' },
  done_for_today: { label: 'Done', color: 'var(--accent)', key: 'd' },
};

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
 * Roster status: a dot and a sentence-case label. "On track" and "Done" are
 * the expected states and stay quiet; exceptions get a soft tint so they are
 * found without every row shouting.
 */
export function TrackerStatusMark({ status }: { status: TrackerDeveloperStatus }) {
  const meta = STATUS_META[status];
  const loud = LOUD_STATUSES.has(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] leading-[18px] ${loud ? 'rounded-full px-1.5 font-semibold' : 'font-medium'}`}
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

const statusConfig: Record<TrackerDeveloperStatus, { label: string; color: string; bg: string }> = {
  on_track: { label: 'On Track', color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.15)' },
  at_risk: { label: 'At Risk', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.15)' },
  blocked: { label: 'Blocked', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.15)' },
  waiting: { label: 'Waiting', color: 'var(--info)', bg: 'rgba(139, 92, 246, 0.15)' },
  done_for_today: { label: 'Done', color: 'var(--accent)', bg: 'rgba(6, 182, 212, 0.15)' },
};

interface TrackerStatusPillProps {
  status: TrackerDeveloperStatus;
  size?: 'sm' | 'md';
}

export function TrackerStatusPill({ status, size = 'sm' }: TrackerStatusPillProps) {
  const cfg = statusConfig[status];
  const fontSize = size === 'sm' ? '10px' : '11px';
  const padding = size === 'sm' ? '2px 8px' : '3px 10px';

  return (
    <span
      className="inline-flex items-center rounded-full font-semibold uppercase whitespace-nowrap"
      style={{
        fontSize,
        letterSpacing: '0.06em',
        padding,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}`,
        borderColor: `color-mix(in srgb, ${cfg.color} 30%, transparent)`,
      }}
    >
      {cfg.label}
    </span>
  );
}
