import { toneText } from '@/lib/tone-text';
import { AlertCircle, ArrowRight, CalendarClock, ClipboardList, Loader2, RadioTower, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppView } from '@/App';
import { useOverview } from '@/hooks/useOverview';
import { useToday } from '@/hooks/useToday';
import { headerMetrics } from '@/lib/today-layout';
import type { FilterType, TodayActionSeverity, TodayActionTarget, TodaySummaryMetric } from '@/types';

interface WorkFocusStripProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  /** Open a Today metric's target (the same opener Today's own rows use). */
  onOpenTarget?: (target: TodayActionTarget) => void;
  onViewChange?: (view: AppView) => void;
  actions?: ReactNode;
}

const severityColor: Record<TodayActionSeverity, string> = {
  critical: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  success: 'var(--success)',
  neutral: 'var(--text-secondary)',
};

/**
 * docs/56 P1-06: the right-hand tiles are Today's own summary metrics (the
 * server ranks them, mode-aware), not a second client-side attention model.
 * "Due today" is left out because the defect tiles already carry it.
 */
const TODAY_TILE_IDS = new Set(['attention', 'stale', 'promises', 'sync']);

export function WorkFocusStrip({ activeFilter, onFilterChange, onOpenTarget, onViewChange, actions }: WorkFocusStripProps) {
  const { data: overview, isLoading: overviewLoading } = useOverview();
  const today = useToday();
  const todayTiles = headerMetrics(today.data?.summary ?? []).filter((metric) => TODAY_TILE_IDS.has(metric.id));

  // A metric without a target is the "Attention" total, which is what Today itself lists.
  const handleClick = (metric: TodaySummaryMetric) => {
    if (metric.target && onOpenTarget) {
      onOpenTarget(metric.target);
      return;
    }
    onViewChange?.('today');
  };

  const defectSignals = [
    {
      id: 'all',
      label: 'All defects',
      value: overview?.total ?? 0,
      detail: 'active',
      icon: ClipboardList,
      color: 'var(--accent)',
      filter: 'all' as FilterType,
    },
    {
      id: 'recentlyAssigned',
      label: 'New to team',
      value: overview?.recentlyAssigned ?? 0,
      detail: '24h',
      icon: Sparkles,
      color: 'var(--warning)',
      filter: 'recentlyAssigned' as FilterType,
    },
    {
      id: 'dueToday',
      label: 'Due today',
      value: overview?.dueToday ?? 0,
      detail: 'defects',
      icon: CalendarClock,
      color: 'var(--warning)',
      filter: 'dueToday' as FilterType,
    },
    {
      id: 'overdue',
      label: 'Overdue',
      value: overview?.overdue ?? 0,
      detail: 'late',
      icon: AlertCircle,
      color: 'var(--danger)',
      filter: 'overdue' as FilterType,
    },
    {
      id: 'inProgress',
      label: 'In progress',
      value: overview?.inProgress ?? 0,
      detail: 'moving',
      icon: RadioTower,
      color: 'var(--success)',
      filter: 'inProgress' as FilterType,
    },
  ];

  return (
    <section
      className="border-b px-3 py-2"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-secondary) 42%, transparent)',
      }}
      aria-label="Work focus"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="flex min-w-[220px] items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ background: 'var(--accent-glow)', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}>
            <ClipboardList size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>Work</p>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Defects, owners, due dates</p>
          </div>
          {today.isFetching || overviewLoading ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
          {defectSignals.map((signal) => {
            const Icon = signal.icon;
            const active = activeFilter === signal.filter;
            return (
              <button
                key={signal.id}
                type="button"
                onClick={() => onFilterChange(signal.filter)}
                className="group flex h-10 min-w-[128px] items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
                style={{
                  borderColor: active ? `color-mix(in srgb, ${signal.color} 42%, var(--border))` : 'var(--border)',
                  background: active ? `color-mix(in srgb, ${signal.color} 10%, var(--bg-primary))` : 'color-mix(in srgb, var(--bg-primary) 66%, transparent)',
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon size={13} className="shrink-0" style={{ color: active || signal.value > 0 ? signal.color : 'var(--text-muted)' }} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{signal.label}</span>
                    <span className="block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{signal.detail}</span>
                  </span>
                </span>
                <span className="font-mono text-[15px] font-semibold tabular-nums" style={{ color: active || signal.value > 0 ? toneText(signal.color) : 'var(--text-muted)' }}>
                  {signal.value}
                </span>
              </button>
            );
          })}

          <span className="mx-1 h-7 w-px shrink-0" style={{ background: 'var(--border)' }} />

          {todayTiles.length > 0 ? <span className="mx-1 h-7 w-px shrink-0" style={{ background: 'var(--border)' }} /> : null}

          {todayTiles.map((metric) => {
            const color = severityColor[metric.value > 0 ? metric.severity : 'neutral'];
            return (
              <button
                key={metric.id}
                type="button"
                onClick={() => handleClick(metric)}
                className="group flex h-10 min-w-[132px] items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
                style={{
                  borderColor: metric.value > 0 ? `color-mix(in srgb, ${severityColor[metric.severity]} 30%, var(--border))` : 'var(--border)',
                  background: metric.value > 0 ? `color-mix(in srgb, ${severityColor[metric.severity]} 8%, var(--bg-primary))` : 'color-mix(in srgb, var(--bg-primary) 66%, transparent)',
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{metric.label}</span>
                  <span className="block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{metric.detail}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-[13px] font-semibold tabular-nums" style={{ color: toneText(color) }}>
                    {metric.value}
                  </span>
                  <ArrowRight size={10} className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--text-muted)' }} />
                </span>
              </button>
            );
          })}
        </div>

        {actions && (
          <div className="flex shrink-0 items-center gap-1.5 xl:self-start">{actions}</div>
        )}
      </div>
    </section>
  );
}
