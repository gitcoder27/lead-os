import { useRef } from 'react';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Keyboard, Loader2, RefreshCw } from 'lucide-react';
import { TaskPopover } from '@/components/tasks/TaskPopover';
import { formatClock, headerMetrics, metricLabel } from '@/lib/today-layout';
import { TODAY_TRIAGE_KEYS } from '@/lib/today-triage';
import type { TodayFreshness } from '@/lib/today-freshness';
import type { TodayActionTarget, TodayResponse } from '@/types';

interface TodayRhythmHeaderProps {
  today: TodayResponse;
  isFetching: boolean;
  /** docs/53 U8: stale-after-failed-poll state for the freshness line. */
  freshness?: TodayFreshness;
  shortcutsOpen: boolean;
  onToggleShortcuts: (open: boolean) => void;
  onRefresh: () => void;
  onOpenMetric: (target: TodayActionTarget) => void;
  /** The attention count has no page to open — it jumps to the queue. */
  onFocusQueue: () => void;
}

/**
 * docs/53 D2/R2/R3: one 40px line — stage first, the date, four decision
 * metrics as text buttons, then freshness. Below `md` it scrolls
 * horizontally as a single chip row instead of stacking tiles.
 */
export function TodayRhythmHeader({
  today,
  isFetching,
  freshness,
  shortcutsOpen,
  onToggleShortcuts,
  onRefresh,
  onOpenMetric,
  onFocusQueue,
}: TodayRhythmHeaderProps) {
  const shortcutsRef = useRef<HTMLButtonElement>(null);
  const date = parseISO(today.date);
  const until = formatClock(today.rhythm.nextStage?.startsAt);
  const updated = formatDistanceToNowStrict(parseISO(today.generatedAt), { addSuffix: true });
  const isStale = freshness?.state === 'stale';
  const metrics = headerMetrics(today.summary);

  return (
    <div className="today-band" role="region" aria-label="Today summary">
      <span className="today-stage" title={today.rhythm.detail}>
        <span className="today-stage-dot" aria-hidden="true" />
        {today.rhythm.label}
        {until ? <span className="today-stage-until">until {until}</span> : null}
      </span>
      <h1 className="today-band-title">
        <span className="sr-only">Today, </span>
        {format(date, 'EEE d MMM')}
      </h1>
      <span className="today-band-sep" aria-hidden="true" />
      {metrics.map((metric) => {
        const hot = metric.value > 0 && (metric.severity === 'warning' || metric.severity === 'critical');
        const label = metricLabel(metric.id, metric.value, metric.label.toLowerCase());
        return (
          <button
            key={metric.id}
            type="button"
            className={`today-metric today-tone-${metric.severity}`}
            data-hot={hot ? 'true' : undefined}
            onClick={() => (metric.target ? onOpenMetric(metric.target) : onFocusQueue())}
            aria-label={`${metric.value} ${label}`}
          >
            <span className="today-metric-value">{metric.value}</span>
            <span>{label}</span>
          </button>
        );
      })}
      <span className="today-band-end">
        <span className="today-freshness" data-state={freshness?.state ?? 'fresh'} role={isStale ? 'status' : undefined}>
          {isFetching ? 'Refreshing…' : isStale ? `Couldn't refresh · ${updated}` : `Updated ${updated}`}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="today-icon-btn"
          aria-label={isStale ? 'Retry' : 'Refresh today'}
          title={isStale ? 'Retry' : 'Refresh'}
        >
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <button
          ref={shortcutsRef}
          type="button"
          onClick={() => onToggleShortcuts(!shortcutsOpen)}
          className="today-icon-btn hidden md:inline-flex"
          aria-label="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard size={14} />
        </button>
      </span>
      {shortcutsOpen ? (
        <TaskPopover anchor={shortcutsRef.current} role="dialog" label="Keyboard shortcuts" width={236} onClose={() => onToggleShortcuts(false)}>
          <div className="px-2 pb-1 pt-1.5">
            <p className="pb-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Queue shortcuts</p>
            <dl className="space-y-1">
              {[...TODAY_TRIAGE_KEYS, { keys: ['?'], label: 'This sheet' }].map((entry) => (
                <div key={entry.label} className="flex items-center justify-between gap-3 text-[12px]">
                  <dt style={{ color: 'var(--text-secondary)' }}>{entry.label}</dt>
                  <dd className="flex gap-1">
                    {entry.keys.map((key) => <kbd key={key} className="today-kbd">{key}</kbd>)}
                  </dd>
                </div>
              ))}
            </dl>
            <button type="button" data-autofocus className="sr-only" onClick={() => onToggleShortcuts(false)}>Close</button>
          </div>
        </TaskPopover>
      ) : null}
    </div>
  );
}
