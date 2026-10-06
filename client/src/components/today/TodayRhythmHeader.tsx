import { useRef } from 'react';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Keyboard, Loader2, RefreshCw } from 'lucide-react';
import { formatClock, metricLabel, todayHeaderMetrics } from '@/lib/today-layout';
import { todayShortcuts } from '@/lib/keyboard-shortcuts';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useTeamMode } from '@/hooks/useTeamMode';
import type { TodayFreshness } from '@/lib/today-freshness';
import type { TodayActionTarget, TodayResponse } from '@/types';
import { ShortcutSheet } from '@/components/ui/ShortcutSheet';

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
  /** Mobile access to the existing plan (including wrap-up); absent on failed/legacy reads. */
  onFocusPlan?: () => void;
}

/**
 * docs/53 D2/R2/R3: desktop has one 40px line — stage, date, four decision
 * metrics as text buttons, then freshness. Below `md` it scrolls
 * horizontally as one row; mobile commitment/queue jumps stay first with 44px targets.
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
  onFocusPlan,
}: TodayRhythmHeaderProps) {
  const { openKeyboardShortcuts } = useQuickActions();
  const teamMode = useTeamMode();
  const shortcutsRef = useRef<HTMLButtonElement>(null);
  const date = parseISO(today.date);
  const until = formatClock(today.rhythm.nextStage?.startsAt);
  const updated = formatDistanceToNowStrict(parseISO(today.generatedAt), { addSuffix: true });
  const isStale = freshness?.state === 'stale';
  const metrics = todayHeaderMetrics(today.summary);

  return (
    <div className="today-band" role="region" aria-label="Today summary">
      {onFocusPlan && <div className="today-mobile-jumps">
        <button type="button" onClick={onFocusPlan} aria-label="Jump to My plan">My plan</button>
        <button type="button" onClick={onFocusQueue} aria-label="Jump to attention queue">Queue</button>
      </div>}
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
          className="ui-icon-btn"
          aria-label={isStale ? 'Retry' : 'Refresh today'}
          title={isStale ? 'Retry' : 'Refresh'}
        >
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <button
          ref={shortcutsRef}
          type="button"
          onClick={(event) => openKeyboardShortcuts ? openKeyboardShortcuts(event.currentTarget) : onToggleShortcuts(!shortcutsOpen)}
          className="ui-icon-btn hidden md:inline-flex"
          aria-label="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard size={14} />
        </button>
      </span>
      {shortcutsOpen ? (
        <ShortcutSheet
          anchor={shortcutsRef.current}
          groups={todayShortcuts(teamMode)}
          onClose={() => onToggleShortcuts(false)}
        />
      ) : null}
    </div>
  );
}
