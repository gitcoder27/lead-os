import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { CalendarDays, Check, Presentation, Search, SlidersHorizontal, X } from 'lucide-react';
import { FOCUS_RING } from '@/components/ui/focus';
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
  /** docs/48 (OO-D7): present only when `one_on_one_enabled` is on. */
  onOpenOneOnOnes?: () => void;
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
  onOpenOneOnOnes,
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
    <div className="flex flex-wrap items-center gap-1.5">
      <SearchInput
        ref={inputRef}
        value={localSearch}
        onChange={handleSearchInput}
        onClear={clearSearch}
      />

      {isFiltered && (
        <span className="px-1 text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }} aria-live="polite">
          {visibleCount} of {totalCount}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {onOpenOneOnOnes && (
          <ToolbarButton onClick={onOpenOneOnOnes} ariaLabel="Open 1:1s" title="1:1s">
            <CalendarDays size={13} />
            1:1s
          </ToolbarButton>
        )}

        {onStartStandup && (
          <ToolbarButton onClick={onStartStandup} ariaLabel="Start standup" title="Start standup" accent>
            <Presentation size={13} />
            Standup
          </ToolbarButton>
        )}

        {(onOpenOneOnOnes || onStartStandup) && (
          <span aria-hidden="true" className="mx-1 h-4 w-px" style={{ background: 'var(--border)' }} />
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

function ToolbarButton({
  onClick,
  ariaLabel,
  title,
  accent = false,
  active = false,
  expanded,
  children,
}: {
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
  accent?: boolean;
  active?: boolean;
  expanded?: boolean;
  children: ReactNode;
}) {
  const tinted = accent || active;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      title={title}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
        tinted ? 'hover:brightness-110' : 'hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      } ${FOCUS_RING}`}
      style={{
        color: tinted ? 'var(--accent)' : 'var(--text-secondary)',
        background: accent
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : active || expanded
            ? 'var(--bg-tertiary)'
            : 'transparent',
        boxShadow: accent ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

import { forwardRef } from 'react';

const SearchInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}>(({ value, onChange, onClear }, ref) => (
  <label
    className="flex h-8 min-w-[200px] max-w-[340px] flex-1 cursor-text items-center gap-2 rounded-lg border px-2.5 transition-colors focus-within:!border-[color:var(--border-active)]"
    style={{
      background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)',
      borderColor: value ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)',
    }}
  >
    <Search size={13} className="shrink-0" style={{ color: value ? 'var(--accent)' : 'var(--text-muted)' }} aria-hidden="true" />
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search people, tasks, Jira keys…"
      aria-label="Search team"
      maxLength={200}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.preventDefault();
          onClear();
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--text-placeholder)]"
      style={{ color: 'var(--text-primary)' }}
    />
    {value && (
      <button
        type="button"
        onClick={onClear}
        className={`shrink-0 rounded-md p-0.5 transition-colors hover:text-[var(--text-primary)] ${FOCUS_RING}`}
        style={{ color: 'var(--text-muted)' }}
        aria-label="Clear search"
      >
        <X size={12} />
      </button>
    )}
  </label>
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
  const activeLabel = [sortActive ? currentSortLabel : null, groupActive ? currentGroupLabel : null].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <ToolbarButton
        onClick={() => setOpen((current) => !current)}
        active={isActive}
        expanded={open}
        title={`Sort: ${currentSortLabel} · Group: ${currentGroupLabel}`}
      >
        <SlidersHorizontal size={13} />
        {isActive ? activeLabel : 'Display'}
      </ToolbarButton>

      {open && (
        <div
          className="absolute right-0 top-full z-popover mt-1.5 w-[240px] overflow-hidden rounded-xl p-1.5"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--panel-shadow)' }}
        >
          <OptionGroup
            label="Sort by"
            activeValue={sortBy}
            options={sortOptions}
            onSelect={(value) => onSortChange(value as TeamTrackerBoardSort)}
          />
          <div className="mx-1 my-1.5 h-px" style={{ background: 'var(--border)' }} />
          <OptionGroup
            label="Group"
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
      <div className="px-2 pb-1 pt-1 text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="grid gap-px" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = option.value === activeValue;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(option.value)}
              className={`flex h-8 items-center justify-between rounded-lg px-2 text-left text-[13px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
              style={{
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {option.label}
              {active && <Check size={13} style={{ color: 'var(--accent)' }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
