import { forwardRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, Keyboard, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { taskLabelDisplayName, type TaskAttentionSignal, type TaskLabel, type TaskStatus, type TaskViewMeta, type TaskViewSort } from '@/types';
import { OWNER_TOKENS, type TaskViewGroupOverride, type TaskViewOverrides } from '@/lib/task-views';
import { labelChipStyle } from './label-colors';
import { FilterMenu, TASK_STATUS_META } from './TaskMenus';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from './TaskPopover';

const STATUSES: TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];
const SIGNALS: { value: TaskAttentionSignal; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'stale', label: 'Stale' },
  { value: 'drift', label: 'Jira drift' },
];
const SORTS: { value: TaskViewSort; label: string }[] = [
  { value: 'scheduled', label: 'Schedule' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'priority', label: 'Priority' },
];
const GROUPS: { value: TaskViewGroupOverride; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'scheduled', label: 'Schedule' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'label', label: 'Label' },
];

type OpenMenu = 'owner' | 'status' | 'label' | 'kind' | 'signal' | 'display' | null;

interface TaskToolbarProps {
  title: string;
  count: number | undefined;
  updating: boolean;
  views: TaskViewMeta[];
  viewId: string;
  onSelectView: (id: string) => void;
  overrides: TaskViewOverrides;
  onOverrides: (next: Partial<TaskViewOverrides>) => void;
  query: string;
  onQuery: (query: string) => void;
  effectiveSort: TaskViewSort | undefined;
  effectiveGroup: TaskViewGroupOverride;
  developers: { accountId: string; displayName: string }[];
  labels: TaskLabel[];
  isSavedView: boolean;
  hasOverrides: boolean;
  onUpdateView: () => void;
  onRevert: () => void;
  onShowShortcuts: () => void;
}

/** docs/49 §9: search · filter chips · Display popover · view actions. */
export const TaskToolbar = forwardRef<HTMLInputElement, TaskToolbarProps>(function TaskToolbar(props, searchRef) {
  const {
    title, count, updating, views, viewId, onSelectView, overrides, onOverrides, query, onQuery,
    effectiveSort, effectiveGroup, developers, labels, isSavedView, hasOverrides, onUpdateView, onRevert, onShowShortcuts,
  } = props;
  const [menu, setMenu] = useState<{ kind: OpenMenu; anchor: HTMLElement | null }>({ kind: null, anchor: null });
  const open = (kind: OpenMenu) => (event: MouseEvent<HTMLElement>) =>
    setMenu((current) => (current.kind === kind ? { kind: null, anchor: null } : { kind, anchor: event.currentTarget }));
  const close = () => setMenu({ kind: null, anchor: null });

  const ownerValues = overrides.owner ? overrides.owner.split(',') : [];
  const devName = (id: string) => developers.find((dev) => dev.accountId === id)?.displayName ?? id;
  const ownerLabel = (value: string) => ({ me: 'Me', team: 'Team', inbox: 'Inbox' } as Record<string, string>)[value] ?? devName(value);
  const toggleOwner = (value: string) => {
    if ((OWNER_TOKENS as readonly string[]).includes(value)) {
      onOverrides({ owner: overrides.owner === value ? undefined : value });
      return;
    }
    const devs = ownerValues.filter((entry) => !(OWNER_TOKENS as readonly string[]).includes(entry));
    const next = devs.includes(value) ? devs.filter((entry) => entry !== value) : [...devs, value];
    onOverrides({ owner: next.length ? next.join(',') : undefined });
  };
  const toggleIn = <T extends string>(list: T[] | undefined, value: T): T[] | undefined => {
    const current = list ?? [];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    return next.length ? next : undefined;
  };

  return (
    <header className="shrink-0 px-5 pb-3 pt-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <select
          value={viewId}
          onChange={(event) => onSelectView(event.target.value)}
          className="rounded-lg px-2 py-1 text-[12px] md:hidden"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          aria-label="Task view"
        >
          {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
        <h1 className="flex items-center gap-2 text-[19px] font-bold" style={{ color: 'var(--text-primary)' }}>
          {title}
          {isSavedView && hasOverrides && (
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--warning)' }} title="Unsaved filter changes" aria-label="Unsaved filter changes" />
          )}
        </h1>
        <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {count === undefined ? '' : `${count} task${count === 1 ? '' : 's'}`}
        </span>
        {updating && (
          <span className="flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }} aria-live="polite">
            <Loader2 size={11} className="animate-spin" /> Updating…
          </span>
        )}
        <span className="flex-1" />
        {hasOverrides && isSavedView && (
          <>
            <ToolbarButton onClick={onUpdateView} accent>Update view</ToolbarButton>
            <ToolbarButton onClick={onRevert}>Revert</ToolbarButton>
          </>
        )}
        {hasOverrides && !isSavedView && <ToolbarButton onClick={onRevert}>Reset</ToolbarButton>}
        <button
          type="button"
          onClick={onShowShortcuts}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard size={14} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <label className="flex h-7 min-w-[180px] flex-1 items-center gap-1.5 rounded-lg px-2 sm:max-w-[260px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          <Search size={12} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onQuery('');
                event.currentTarget.blur();
              }
            }}
            placeholder="Search this view"
            aria-label="Search tasks"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {query ? (
            <button type="button" onClick={() => onQuery('')} aria-label="Clear search" style={{ color: 'var(--text-muted)' }}><X size={12} /></button>
          ) : (
            <kbd className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/</kbd>
          )}
        </label>

        <FilterChip
          label="Owner"
          values={ownerValues.map(ownerLabel)}
          onOpen={open('owner')}
          onClear={() => onOverrides({ owner: undefined })}
        />
        <FilterChip
          label="Status"
          values={(overrides.status ?? []).map((status) => TASK_STATUS_META[status].label)}
          onOpen={open('status')}
          onClear={() => onOverrides({ status: undefined })}
        />
        <FilterChip
          label="Label"
          values={(overrides.label ?? []).map(taskLabelDisplayName)}
          onOpen={open('label')}
          onClear={() => onOverrides({ label: undefined })}
        />
        <FilterChip
          label="Type"
          values={overrides.kind ? [overrides.kind === 'meeting' ? 'Meetings' : 'Tasks'] : []}
          onOpen={open('kind')}
          onClear={() => onOverrides({ kind: undefined })}
        />
        {viewId === 'attention' && (
          <FilterChip
            label="Signal"
            values={(overrides.signal ?? []).map((signal) => SIGNALS.find((entry) => entry.value === signal)?.label ?? signal)}
            onOpen={open('signal')}
            onClear={() => onOverrides({ signal: undefined })}
          />
        )}
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--border)' }} />
        <button
          type="button"
          onClick={open('display')}
          aria-haspopup="menu"
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: overrides.sort || overrides.group ? 'var(--accent)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <SlidersHorizontal size={12} /> Display
        </button>
      </div>

      {menu.kind === 'owner' && menu.anchor && (
        <FilterMenu
          anchor={menu.anchor}
          label="Owner filter"
          options={[
            ...OWNER_TOKENS.map((token) => ({ value: token as string, label: ownerLabel(token) })),
            ...developers.map((dev) => ({ value: dev.accountId, label: dev.displayName })),
          ]}
          selected={ownerValues}
          onClose={close}
          onToggle={toggleOwner}
          onClear={() => onOverrides({ owner: undefined })}
        />
      )}
      {menu.kind === 'status' && menu.anchor && (
        <FilterMenu
          anchor={menu.anchor}
          label="Status filter"
          options={STATUSES.map((status) => ({ value: status, label: TASK_STATUS_META[status].label, dot: TASK_STATUS_META[status].color }))}
          selected={overrides.status ?? []}
          onClose={close}
          onToggle={(status) => onOverrides({ status: toggleIn(overrides.status, status) })}
          onClear={() => onOverrides({ status: undefined })}
        />
      )}
      {menu.kind === 'label' && menu.anchor && (
        <FilterMenu
          anchor={menu.anchor}
          label="Label filter"
          heading="Has all of"
          options={labels.map((label) => ({ value: label.name, label: taskLabelDisplayName(label.name), dot: labelChipStyle(label.color).color as string }))}
          selected={overrides.label ?? []}
          onClose={close}
          onToggle={(label) => onOverrides({ label: toggleIn(overrides.label, label) })}
          onClear={() => onOverrides({ label: undefined })}
        />
      )}
      {menu.kind === 'kind' && menu.anchor && (
        <FilterMenu
          anchor={menu.anchor}
          label="Type filter"
          options={[{ value: 'task' as const, label: 'Tasks' }, { value: 'meeting' as const, label: 'Meetings' }]}
          selected={overrides.kind ? [overrides.kind] : []}
          onClose={close}
          onToggle={(kind) => onOverrides({ kind: overrides.kind === kind ? undefined : kind })}
          onClear={() => onOverrides({ kind: undefined })}
        />
      )}
      {menu.kind === 'signal' && menu.anchor && (
        <FilterMenu
          anchor={menu.anchor}
          label="Signal filter"
          options={SIGNALS}
          selected={overrides.signal ?? []}
          onClose={close}
          onToggle={(signal) => onOverrides({ signal: toggleIn(overrides.signal, signal) })}
          onClear={() => onOverrides({ signal: undefined })}
        />
      )}
      {menu.kind === 'display' && menu.anchor && (
        <TaskPopover anchor={menu.anchor} onClose={close} label="Display options" width={210}>
          <MenuHeading>Sort</MenuHeading>
          {SORTS.map((sort) => (
            <MenuItem key={sort.value} role="menuitemradio" checked={effectiveSort === sort.value} label={sort.label} onSelect={() => onOverrides({ sort: sort.value })} />
          ))}
          <MenuDivider />
          <MenuHeading>Group</MenuHeading>
          {GROUPS.map((group) => (
            <MenuItem key={group.value} role="menuitemradio" checked={effectiveGroup === group.value} label={group.label} onSelect={() => onOverrides({ group: group.value })} />
          ))}
          {(overrides.sort || overrides.group) && (
            <>
              <MenuDivider />
              <MenuItem label="Use view defaults" onSelect={() => onOverrides({ sort: undefined, group: undefined })} />
            </>
          )}
        </TaskPopover>
      )}
    </header>
  );
});

function FilterChip({ label, values, onOpen, onClear }: {
  label: string;
  values: string[];
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onClear: () => void;
}) {
  const active = values.length > 0;
  return (
    <span
      className="flex h-7 items-center rounded-lg text-[12px] font-medium"
      style={{
        border: `1px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
        background: active ? 'var(--accent-glow)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      <button type="button" onClick={onOpen} aria-haspopup="menu" className="flex h-full items-center gap-1 px-2" aria-label={active ? `${label}: ${values.join(', ')}` : `${label} filter`}>
        {active ? (
          <>
            <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
            <span className="max-w-[140px] truncate">{values[0]}</span>
            {values.length > 1 && <span>+{values.length - 1}</span>}
          </>
        ) : (
          <>
            {label} <ChevronDown size={11} />
          </>
        )}
      </button>
      {active && (
        <button type="button" onClick={onClear} className="flex h-full items-center pr-1.5" aria-label={`Clear ${label} filter`}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function ToolbarButton({ onClick, accent, children }: { onClick: () => void; accent?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 rounded-lg px-2.5 text-[12px] font-semibold transition-colors"
      style={accent ? { color: 'var(--accent)', background: 'var(--accent-glow)' } : { color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  );
}
