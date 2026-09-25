import { useState, useRef, useEffect, useCallback } from 'react';
import { Presentation, Search, SlidersHorizontal, X } from 'lucide-react';
import type { TeamTrackerBoardSort, TeamTrackerBoardGroupBy, TeamTrackerSavedView } from '@/types';
import { SavedViewsMenu } from './SavedViewsMenu';
import type { SavedViewsMenuProps } from './SavedViewsMenu';

interface TrackerBoardToolbarProps extends SavedViewsMenuProps<TeamTrackerSavedView> {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortBy: TeamTrackerBoardSort;
  onSortChange: (sort: TeamTrackerBoardSort) => void;
  groupBy: TeamTrackerBoardGroupBy;
  onGroupChange: (group: TeamTrackerBoardGroupBy) => void;
  visibleCount: number;
  totalCount: number;
  /** Phase 3 (P3-D5): present only when standup mode is available. */
  onStartStandup?: () => void;
}

const sortOptions: Array<{ value: TeamTrackerBoardSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'attention', label: 'Attention' },
  { value: 'stale_age', label: 'Stale age' },
  { value: 'load', label: 'Workload' },
  { value: 'blocked_first', label: 'Blocked first' },
];

const groupOptions: Array<{ value: TeamTrackerBoardGroupBy; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'By status' },
  { value: 'attention_state', label: 'By attention' },
];

export function TrackerBoardToolbar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  groupBy,
  onGroupChange,
  visibleCount,
  totalCount,
  onStartStandup,
  ...savedViewProps
}: TrackerBoardToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchInput = useCallback((value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(value), 300);
  }, [onSearchChange]);

  const clearSearch = useCallback(() => {
    setLocalSearch('');
    onSearchChange('');
    inputRef.current?.focus();
  }, [onSearchChange]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const isFiltered = visibleCount < totalCount;
  const currentSort = sortOptions.find((o) => o.value === sortBy);
  const currentGroup = groupOptions.find((o) => o.value === groupBy);
  const isSortNonDefault = sortBy !== 'name';
  const isGroupActive = groupBy !== 'none';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SearchInput
        ref={inputRef}
        value={localSearch}
        onChange={handleSearchInput}
        onClear={clearSearch}
      />

      <div className="flex items-center gap-1.5 ml-auto">
        {isFiltered && (
          <span
            className="h-8 rounded-lg px-2 text-[12px] font-mono font-medium inline-flex items-center"
            style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
          >
            {visibleCount}/{totalCount}
          </span>
        )}

        {onStartStandup && (
          <button
            type="button"
            onClick={onStartStandup}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
            style={{
              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              color: 'var(--accent)',
            }}
            aria-label="Start standup"
            title="Start standup"
          >
            <Presentation size={12} />
            Standup
          </button>
        )}

        <ViewOptionsMenu
          sortBy={sortBy}
          groupBy={groupBy}
          currentSortLabel={currentSort?.label ?? 'Name'}
          currentGroupLabel={currentGroup?.label ?? 'No grouping'}
          sortActive={isSortNonDefault}
          groupActive={isGroupActive}
          onSortChange={onSortChange}
          onGroupChange={onGroupChange}
        />

        <SavedViewsMenu {...savedViewProps} />
      </div>
    </div>
  );
}

import { forwardRef } from 'react';

const SearchInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}>(({ value, onChange, onClear }, ref) => (
  <div
    className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 flex-1 min-w-[220px] max-w-[420px]"
    style={{
      background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)',
      border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`,
    }}
  >
    <Search size={13} className="shrink-0" style={{ color: value ? 'var(--accent)' : 'var(--text-muted)' }} />
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search developers, tasks, Jira keys…"
      maxLength={200}
      className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-placeholder"
      style={{ color: 'var(--text-primary)' }}
    />
    {value && (
      <button
        onClick={onClear}
        className="shrink-0 rounded-md p-0.5 transition-colors hover:brightness-125"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Clear search"
      >
        <X size={12} />
      </button>
    )}
  </div>
));
SearchInput.displayName = 'SearchInput';

function ViewOptionsMenu({
  sortBy,
  groupBy,
  currentSortLabel,
  currentGroupLabel,
  sortActive,
  groupActive,
  onSortChange,
  onGroupChange,
}: {
  sortBy: TeamTrackerBoardSort;
  groupBy: TeamTrackerBoardGroupBy;
  currentSortLabel: string;
  currentGroupLabel: string;
  sortActive: boolean;
  groupActive: boolean;
  onSortChange: (sort: TeamTrackerBoardSort) => void;
  onGroupChange: (group: TeamTrackerBoardGroupBy) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = sortActive || groupActive;

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--border-active)]"
        style={{
          background: isActive ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
          border: `1px solid ${isActive ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)'}`,
          color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <SlidersHorizontal size={12} />
        View options
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-[260px] overflow-hidden rounded-xl border p-2"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--soft-shadow)' }}
        >
          <OptionGroup
            label={`Sort · ${currentSortLabel}`}
            activeValue={sortBy}
            options={sortOptions}
            onSelect={(value) => onSortChange(value as TeamTrackerBoardSort)}
          />
          <div className="my-2 h-px" style={{ background: 'var(--border)' }} />
          <OptionGroup
            label={`Group · ${currentGroupLabel}`}
            activeValue={groupBy}
            options={groupOptions}
            onSelect={(value) => onGroupChange(value as TeamTrackerBoardGroupBy)}
          />
        </div>
      )}
    </div>
  );
}

function OptionGroup({
  label,
  activeValue,
  options,
  onSelect,
}: {
  label: string;
  activeValue: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="grid gap-1">
        {options.map((option) => {
          const active = option.value === activeValue;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors"
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--bg-tertiary)' : 'transparent',
              }}
            >
              {option.label}
              {active && <span className="h-1.5 w-1.5 rounded-sm" style={{ background: 'var(--accent)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
