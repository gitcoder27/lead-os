import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, X } from 'lucide-react';
import { useCreateOneOnOneSeries, useOneOnOneSeriesList } from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import type { Developer, OneOnOneCadence, OneOnOneSeriesSummary } from '@/types';

const CADENCE_OPTIONS: Array<{ value: OneOnOneCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];

const CADENCE_LABELS: Record<OneOnOneCadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  ad_hoc: 'Ad hoc',
};

interface OneOnOneSeriesPanelProps {
  /** Team-board developers (drives the "new series" picker). */
  developers: Developer[];
  onOpenDeveloper: (developerAccountId: string) => void;
  onClose: () => void;
}

/**
 * docs/48 §4.1: the Team-level "1:1s" overview — every series with developer,
 * cadence, next session (overdue in red), and open agenda count.
 */
export function OneOnOneSeriesPanel({ developers, onOpenDeveloper, onClose }: OneOnOneSeriesPanelProps) {
  const { addToast } = useToast();
  const list = useOneOnOneSeriesList();
  const createSeries = useCreateOneOnOneSeries();
  const [creating, setCreating] = useState(false);
  const [newDev, setNewDev] = useState('');
  const [newCadence, setNewCadence] = useState<OneOnOneCadence>('weekly');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const availableDevelopers = useMemo(() => {
    const taken = new Set((list.data?.series ?? []).map((series) => series.developerAccountId));
    return developers.filter((developer) => !taken.has(developer.accountId));
  }, [developers, list.data]);

  const submit = () => {
    if (!newDev || createSeries.isPending) return;
    createSeries.mutate(
      { developerAccountId: newDev, cadence: newCadence },
      {
        onSuccess: (detail) => {
          setCreating(false);
          onOpenDeveloper(detail.series.developerAccountId);
        },
        onError: (error) => addToast(error instanceof Error ? error.message : 'Could not create the 1:1 series', 'error'),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="one-on-one-series-panel">
      <div className="mb-3 flex items-center gap-2">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border)' }}
        >
          <CalendarDays size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            1:1s
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Recurring manager-private one-on-one series
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {availableDevelopers.length > 0 && (
            <button
              type="button"
              onClick={() => setCreating((value) => !value)}
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium"
              style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
            >
              <Plus size={12} />
              New series
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            aria-label="Close 1:1 overview"
            title="Close (Esc)"
          >
            <X size={12} />
            Close
          </button>
        </div>
      </div>

      {creating && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}>
          <select
            value={newDev}
            onChange={(event) => setNewDev(event.target.value)}
            className="h-8 rounded-lg px-2 text-[12px]"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="Developer"
          >
            <option value="">Pick a developer…</option>
            {availableDevelopers.map((developer) => (
              <option key={developer.accountId} value={developer.accountId}>
                {developer.displayName}
              </option>
            ))}
          </select>
          <select
            value={newCadence}
            onChange={(event) => setNewCadence(event.target.value as OneOnOneCadence)}
            className="h-8 rounded-lg px-2 text-[12px]"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="Cadence"
          >
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={!newDev || createSeries.isPending}
            className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {createSeries.isPending ? 'Creating…' : 'Create series'}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="h-8 rounded-lg px-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Cancel
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto rounded-xl border"
        style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)' }}
      >
        {list.isLoading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Loading 1:1s…
          </div>
        ) : (list.data?.series ?? []).length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Pick a developer to start a 1:1 series.
            </div>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Use "New series" above, or open a developer's drawer.
            </div>
          </div>
        ) : (
          <ul>
            {(list.data?.series ?? []).map((series) => (
              <SeriesRow key={series.id} series={series} onOpen={() => onOpenDeveloper(series.developerAccountId)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SeriesRow({ series, onOpen }: { series: OneOnOneSeriesSummary; onOpen: () => void }) {
  const overdue = (series.nextSessionOverdueDays ?? 0) > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:brightness-110"
        style={{ borderColor: 'var(--border)' }}
        data-testid={`one-on-one-series-${series.developerAccountId}`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {series.developerName}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {CADENCE_LABELS[series.cadence]}
            {series.active ? '' : ' · paused'}
          </div>
        </div>
        <div className="text-right">
          <div
            className="font-mono text-[12px]"
            style={{ color: overdue ? 'var(--danger)' : 'var(--text-secondary)' }}
          >
            {series.nextSessionDate ?? '—'}
          </div>
          {overdue && (
            <div className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
              overdue {series.nextSessionOverdueDays}d
            </div>
          )}
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Open agenda items"
        >
          {series.openAgendaCount} agenda
        </span>
      </button>
    </li>
  );
}
