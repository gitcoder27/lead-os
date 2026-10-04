import { toneText } from '@/lib/tone-text';
import { AlertCircle, CalendarClock, ClipboardList, Loader2, RadioTower, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOverview } from '@/hooks/useOverview';
import type { FilterType } from '@/types';

interface WorkFocusStripProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  actions?: ReactNode;
}

export function WorkFocusStrip({ activeFilter, onFilterChange, actions }: WorkFocusStripProps) {
  const { data: overview, isLoading: overviewLoading } = useOverview();

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
          {overviewLoading ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : null}
        </div>

        {/* docs/56 UX-31: five defect tiles that wrap, never truncate; Today's own metrics live on Today. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {defectSignals.map((signal) => {
            const Icon = signal.icon;
            const active = activeFilter === signal.filter;
            return (
              <button
                key={signal.id}
                type="button"
                onClick={() => onFilterChange(signal.filter)}
                className="group flex h-10 shrink-0 items-center justify-between gap-3 rounded-lg border px-2.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
                style={{
                  borderColor: active ? `color-mix(in srgb, ${signal.color} 42%, var(--border))` : 'var(--border)',
                  background: active ? `color-mix(in srgb, ${signal.color} 10%, var(--bg-primary))` : 'color-mix(in srgb, var(--bg-primary) 66%, transparent)',
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon size={13} className="shrink-0" style={{ color: active || signal.value > 0 ? signal.color : 'var(--text-muted)' }} />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-[12px] font-semibold" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{signal.label}</span>
                    <span className="block whitespace-nowrap text-[11px]" style={{ color: 'var(--text-muted)' }}>{signal.detail}</span>
                  </span>
                </span>
                <span className="font-mono text-[15px] font-semibold tabular-nums" style={{ color: active || signal.value > 0 ? toneText(signal.color) : 'var(--text-muted)' }}>
                  {signal.value}
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
