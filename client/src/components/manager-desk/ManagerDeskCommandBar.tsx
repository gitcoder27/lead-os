import { Search, Filter, X } from 'lucide-react';
import type { ManagerDeskItem } from '@/types/manager-desk';
import { QuickCapture } from './QuickCapture';
import type { ManagerDeskFilterState, ManagerDeskQuickFilter } from './workbench-utils';
import { getQuickFilterCount } from './workbench-utils';

const quickFilters: Array<{ key: ManagerDeskQuickFilter; label: string }> = [
  { key: 'all', label: 'Today' },
  { key: 'now', label: 'Now' },
  { key: 'inbox', label: 'Triage' },
  { key: 'planned', label: 'Planned' },
  { key: 'backlog', label: 'Later' },
  { key: 'done', label: 'Done' },
  { key: 'carried', label: 'Carried' },
];

interface Props {
  items: ManagerDeskItem[];
  viewDate: string;
  searchQuery: string;
  quickFilter: ManagerDeskQuickFilter;
  defaultQuickFilter: ManagerDeskQuickFilter;
  filters: ManagerDeskFilterState;
  showFilters: boolean;
  isCreatePending: boolean;
  variant?: 'panel' | 'inline';
  captureDisabled?: boolean;
  captureDisabledLabel?: string;
  onSearchChange: (value: string) => void;
  onQuickFilterChange: (value: ManagerDeskQuickFilter) => void;
  onToggleFilters: () => void;
  onClearSearch: () => void;
  onClearFilters: () => void;
  onResetView: () => void;
  onChangeFilters: (value: ManagerDeskFilterState) => void;
  onCapture: Parameters<typeof QuickCapture>[0]['onCapture'];
}

export function ManagerDeskCommandBar({
  items,
  viewDate,
  searchQuery,
  quickFilter,
  defaultQuickFilter,
  filters,
  showFilters,
  isCreatePending,
  variant = 'panel',
  captureDisabled = false,
  captureDisabledLabel,
  onSearchChange,
  onQuickFilterChange,
  onToggleFilters,
  onClearSearch,
  onClearFilters,
  onResetView,
  onChangeFilters,
  onCapture,
}: Props) {
  const hasStructuredFilters = filters.kind !== null || filters.category !== null || filters.status !== null;
  const hasSearch = searchQuery.trim().length > 0;
  const hasCustomView = quickFilter !== defaultQuickFilter || hasSearch || hasStructuredFilters;
  const isInline = variant === 'inline';

  return (
    <div className={isInline ? 'min-w-0' : 'pt-1.5'}>
      <div
        className={isInline ? 'min-w-0' : 'rounded-xl border p-1.5'}
        style={isInline
          ? undefined
          : {
              background: 'color-mix(in srgb, var(--bg-primary) 86%, transparent)',
              borderColor: 'color-mix(in srgb, var(--border) 68%, transparent)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
            }}
      >
        <div className={`flex flex-col gap-1.5 ${isInline ? 'lg:flex-row lg:items-center' : 'xl:flex-row xl:items-center'}`}>
          <div className={isInline ? 'min-w-[240px] flex-[1_1_300px] 2xl:max-w-[420px]' : 'min-w-0 flex-1'}>
            <QuickCapture
              onCapture={onCapture}
              isPending={isCreatePending}
              disabled={captureDisabled}
              disabledLabel={captureDisabledLabel}
            />
          </div>

          <div
            className="flex min-w-0 flex-[0_1_auto] flex-wrap items-center gap-0.5 rounded-lg border p-0.5"
            style={{
              background: 'color-mix(in srgb, var(--bg-secondary) 46%, transparent)',
              borderColor: 'color-mix(in srgb, var(--border) 62%, transparent)',
            }}
            role="group"
            aria-label="Manager Desk map"
          >
            {quickFilters.map(({ key, label }) => {
              const count = getQuickFilterCount(items, key, viewDate);
              if (key === 'carried' && count === 0 && quickFilter !== 'carried') {
                return null;
              }
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onQuickFilterChange(key)}
                  className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px active:scale-[0.98]"
                  style={{
                    background: quickFilter === key ? 'color-mix(in srgb, var(--md-accent-glow) 82%, var(--bg-tertiary) 18%)' : 'transparent',
                    borderColor: quickFilter === key ? 'color-mix(in srgb, var(--md-accent) 46%, transparent)' : 'transparent',
                    color: quickFilter === key ? 'var(--md-accent)' : 'var(--text-secondary)',
                  }}
                  aria-pressed={quickFilter === key}
                >
                  <span>{label}</span>
                  <span
                    className="rounded px-1 font-mono text-[11px] font-semibold tabular-nums"
                    style={{
                      background: quickFilter === key ? 'color-mix(in srgb, var(--md-accent) 14%, transparent)' : 'color-mix(in srgb, var(--bg-tertiary) 72%, transparent)',
                      color: quickFilter === key ? 'var(--md-accent)' : 'var(--text-muted)',
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-[1_1_230px] items-stretch gap-1.5 lg:max-w-[340px]">
            <div className="flex min-w-[150px] flex-1 items-center gap-1.5 rounded-lg border px-2" style={{ borderColor: 'color-mix(in srgb, var(--border) 66%, transparent)', background: 'color-mix(in srgb, var(--bg-secondary) 58%, transparent)' }}>
              <Search size={12} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search…"
                className="h-7 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-placeholder"
                style={{ color: 'var(--text-primary)' }}
                aria-label="Search manager desk tasks"
              />
              {searchQuery && (
                <button type="button" onClick={onClearSearch} aria-label="Clear task search" style={{ color: 'var(--text-muted)' }}>
                  <X size={12} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onToggleFilters}
              aria-label={hasStructuredFilters ? 'Filtered' : 'Filters'}
              className="flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px active:scale-[0.98]"
              style={{
                background: hasStructuredFilters ? 'var(--md-accent-glow)' : 'color-mix(in srgb, var(--bg-secondary) 58%, transparent)',
                borderColor: hasStructuredFilters ? 'color-mix(in srgb, var(--md-accent) 52%, transparent)' : 'color-mix(in srgb, var(--border) 66%, transparent)',
                color: hasStructuredFilters ? 'var(--md-accent)' : 'var(--text-secondary)',
              }}
            >
              <Filter size={10} />
              <span className="hidden sm:inline">{hasStructuredFilters ? 'Filtered' : 'Filters'}</span>
            </button>

            {hasCustomView && (
              <button
                type="button"
                onClick={onResetView}
                className="h-7 rounded-lg border px-2 text-[11px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px active:scale-[0.98]"
                style={{
                  background: 'color-mix(in srgb, var(--bg-secondary) 58%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--border) 66%, transparent)',
                  color: 'var(--text-secondary)',
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <StructuredFilters filters={filters} onChange={onChangeFilters} onClear={onClearFilters} />
        )}
      </div>
    </div>
  );
}

function StructuredFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: ManagerDeskFilterState;
  onChange: (value: ManagerDeskFilterState) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-2 grid gap-1.5 rounded-lg border p-2 md:grid-cols-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
      <SelectControl
        label="Kind"
        value={filters.kind ?? ''}
        onChange={(value) => onChange({ ...filters, kind: (value || null) as ManagerDeskFilterState['kind'] })}
        options={['action', 'meeting', 'decision']}
      />
      <SelectControl
        label="Category"
        value={filters.category ?? ''}
        onChange={(value) => onChange({ ...filters, category: (value || null) as ManagerDeskFilterState['category'] })}
        options={['analysis', 'design', 'team_management', 'cross_team', 'follow_up', 'escalation', 'admin', 'planning', 'other']}
      />
      <SelectControl
        label="Status"
        value={filters.status ?? ''}
        onChange={(value) => onChange({ ...filters, status: (value || null) as ManagerDeskFilterState['status'] })}
        options={['inbox', 'planned', 'in_progress', 'backlog', 'done', 'cancelled']}
      />
      <button
        type="button"
        onClick={onClear}
        className="self-end rounded-lg border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        Clear
      </button>
    </div>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border px-2 py-1.5 text-[12px] font-medium outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
