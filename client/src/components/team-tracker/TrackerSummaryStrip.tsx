import type { TrackerBoardSummary, TrackerBoardSummaryFilter } from '@/types';
import { FOCUS_RING } from '@/components/ui/focus';
import { STATUS_META } from './TrackerStatusPill';

interface TrackerSummaryStripProps {
  summary: TrackerBoardSummary;
  activeFilter: TrackerBoardSummaryFilter;
  onFilterChange: (filter: TrackerBoardSummaryFilter) => void;
}

/** Most severe first, so the eye lands on what needs the manager. */
const chips: Array<{
  key: TrackerBoardSummaryFilter;
  label: string;
  countKey: keyof TrackerBoardSummary;
  color: string;
}> = [
  { key: 'blocked', label: 'blocked', countKey: 'blocked', color: 'var(--danger)' },
  { key: 'overdue_linked', label: 'overdue Jira', countKey: 'overdueLinkedWork', color: 'var(--danger)' },
  { key: 'at_risk', label: 'at risk', countKey: 'atRisk', color: 'var(--warning)' },
  { key: 'stale', label: 'stale', countKey: 'stale', color: 'var(--warning)' },
  { key: 'status_follow_up', label: 'needs follow-up', countKey: 'statusFollowUp', color: 'var(--warning)' },
  { key: 'waiting', label: 'waiting', countKey: 'waiting', color: 'var(--info)' },
  { key: 'no_current', label: 'no current', countKey: 'noCurrent', color: 'var(--text-muted)' },
  { key: 'done_for_today', label: 'done', countKey: 'doneForToday', color: 'var(--accent)' },
];

/** Person statuses are exclusive, so on-track is what the others leave. */
function statusSegments(summary: TrackerBoardSummary) {
  const onTrack = Math.max(0, summary.total - summary.blocked - summary.atRisk - summary.waiting - summary.doneForToday);
  return [
    { key: 'on_track' as const, count: onTrack },
    { key: 'at_risk' as const, count: summary.atRisk },
    { key: 'blocked' as const, count: summary.blocked },
    { key: 'waiting' as const, count: summary.waiting },
    { key: 'done_for_today' as const, count: summary.doneForToday },
  ].filter((segment) => segment.count > 0);
}

function StatusMeter({ summary }: { summary: TrackerBoardSummary }) {
  const segments = statusSegments(summary);
  if (summary.total === 0 || segments.length === 0) return null;
  return (
    <span aria-hidden="true" className="flex h-1.5 w-12 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
      {segments.map((segment, index) => (
        <span
          key={segment.key}
          className="h-full"
          style={{
            width: `${(segment.count / summary.total) * 100}%`,
            background: STATUS_META[segment.key].color,
            opacity: segment.key === 'on_track' || segment.key === 'done_for_today' ? 0.7 : 1,
            marginLeft: index === 0 ? 0 : 1,
          }}
        />
      ))}
    </span>
  );
}

export function TrackerSummaryStrip({ summary, activeFilter, onFilterChange }: TrackerSummaryStripProps) {
  const visibleChips = chips.filter((chip) => summary[chip.countKey] > 0 || activeFilter === chip.key);
  const allActive = activeFilter === 'all';
  const meterTitle = statusSegments(summary)
    .map((segment) => `${segment.count} ${STATUS_META[segment.key].label.toLowerCase()}`)
    .join(' · ');

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Filter by signal">
      <button
        type="button"
        onClick={() => onFilterChange('all')}
        aria-pressed={allActive}
        title={meterTitle || undefined}
        className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
        style={{
          background: allActive ? 'var(--bg-tertiary)' : 'transparent',
          boxShadow: allActive ? 'inset 0 0 0 1px var(--border)' : 'none',
        }}
      >
        <span>
          <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{summary.total}</span>
          <span style={{ color: 'var(--text-muted)' }}> total</span>
        </span>
        <StatusMeter summary={summary} />
      </button>

      <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0" style={{ background: 'var(--border)' }} />

      {visibleChips.length === 0 && (
        <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />
          No active risk signals
        </span>
      )}

      {visibleChips.map((chip) => {
        const count = summary[chip.countKey];
        const isActive = activeFilter === chip.key;

        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onFilterChange(isActive ? 'all' : chip.key)}
            aria-pressed={isActive}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            style={{
              background: isActive ? `color-mix(in srgb, ${chip.color} 12%, var(--bg-tertiary))` : 'transparent',
              boxShadow: isActive ? `inset 0 0 0 1px color-mix(in srgb, ${chip.color} 36%, transparent)` : 'none',
            }}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chip.color }} />
            <span>
              <span className="font-semibold tabular-nums" style={{ color: isActive ? chip.color : 'var(--text-primary)' }}>{count}</span>
              <span style={{ color: isActive ? chip.color : 'var(--text-secondary)' }}> {chip.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
