import { forwardRef, useRef, useState, type MouseEvent } from 'react';
import { Check, Keyboard, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { taskLabelDisplayName, type TaskAttentionSignal, type TaskLabel, type TaskStatus, type TaskViewCount, type TaskViewMeta, type TaskViewSort } from '@/types';
import { OWNER_TOKENS, type TaskViewGroupOverride, type TaskViewOverrides } from '@/lib/task-views';
import { labelChipStyle } from './label-colors';
import { TASK_STATUS_META } from './TaskMenus';
import { TASK_LIST_CONTAINER } from './TaskList';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/Kbd';

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
  { value: 'checkBy', label: 'Check-by date' },
];
// docs/51 F16: no Label grouping — multi-label tasks would duplicate rows and
// break counts, selection, and j/k. The `?group=label` URL param still parses.
const GROUPS: { value: TaskViewGroupOverride; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'scheduled', label: 'Schedule' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'party', label: 'Waiting on' },
];

// docs/51 F18: no 'kind' menu — the ?kind= URL param stays for the meetings alias.
// All widths share one options menu.
type OpenMenu = 'options' | null;

interface TaskToolbarProps {
  title: string;
  count: number | undefined;
  /**
   * docs/51 D2: filters or search narrow the list below the rail's count, so
   * the toolbar states the match count. Otherwise the rail already says it —
   * the toolbar count only shows where the rail is hidden (below md).
   */
  narrowed?: boolean;
  updating: boolean;
  views: TaskViewMeta[];
  /** docs/51 R1: the mobile view picker shows per-view counts. */
  counts?: Record<string, TaskViewCount>;
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
  onShowShortcuts: (anchor: HTMLElement) => void;
  onSaveView: (name: string) => Promise<boolean>;
  saving: boolean;
  canSave: boolean;
}

/** Search, consolidated options and keyboard help at every width. */
export const TaskToolbar = forwardRef<HTMLInputElement, TaskToolbarProps>(function TaskToolbar(props, searchRef) {
  const {
    title, count, narrowed = false, updating, views, counts, viewId, onSelectView, overrides, onOverrides, query, onQuery,
    effectiveSort, effectiveGroup, developers, labels, isSavedView, hasOverrides, onUpdateView, onRevert, onShowShortcuts, onSaveView, saving, canSave,
  } = props;
  const [menu, setMenu] = useState<{ kind: OpenMenu; anchor: HTMLElement | null }>({ kind: null, anchor: null });
  const open = (kind: OpenMenu) => (event: MouseEvent<HTMLElement>) =>
    setMenu((current) => (current.kind === kind ? { kind: null, anchor: null } : { kind, anchor: event.currentTarget }));
  const close = () => setMenu({ kind: null, anchor: null });

  const optionsRef = useRef<HTMLButtonElement>(null);
  const closeSave = () => { if (!saving) { setSaveOpen(false); requestAnimationFrame(() => optionsRef.current?.focus()); } };
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState(false);
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
  const activeFilterCount = Object.values(overrides).filter((value) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
  const summary = Object.entries(overrides).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${key === 'owner' ? String(value).split(',').map(ownerLabel).join(', ') : Array.isArray(value) ? value.map(String).join(', ') : value}`).join('; ');
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaveError(false);
    if (await onSaveView(name.trim())) { setSaveOpen(false); setName(''); requestAnimationFrame(() => optionsRef.current?.focus()); }
    else setSaveError(true);
  };

  return (
    <header className="shrink-0 pb-3 pt-4" style={{ borderBottom: '1px solid var(--border)' }}>
      {/* docs/51 D5: same centered column as the list; px-2 puts the title on the rows' glyph edge. */}
      <div className={TASK_LIST_CONTAINER}>
        <div className="px-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <select
              value={viewId}
              onChange={(event) => onSelectView(event.target.value)}
              className="rounded-lg px-2 py-1 text-[12px] md:hidden"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              aria-label="Task view"
            >
              {views.map((view) => {
                const count = counts?.[view.id]?.count;
                return (
                  <option key={view.id} value={view.id}>
                    {count ? `${view.name} (${count})` : view.name}
                  </option>
                );
              })}
            </select>
            <h1 className="ui-page-title flex items-center gap-2">
              {title}
              {isSavedView && hasOverrides && (
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--warning)' }} title="Unsaved filter changes" aria-label="Unsaved filter changes" />
              )}
            </h1>
            {count !== undefined && (
              <span className={`text-[12px] tabular-nums ${narrowed ? '' : 'md:hidden'}`} style={{ color: 'var(--text-muted)' }}>
                {narrowed ? `${count} matching` : `${count} task${count === 1 ? '' : 's'}`}
              </span>
            )}
            {updating && (
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }} aria-live="polite">
                <Loader2 size={11} className="animate-spin" /> Updating…
              </span>
            )}
            <span className="flex-1" />

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
                <Kbd variant="subtle">/</Kbd>
              )}
            </label>

            <button ref={optionsRef} type="button" onClick={open('options')} aria-haspopup="menu" aria-describedby={activeFilterCount ? 'task-options-summary' : undefined}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: activeFilterCount ? 'var(--accent)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <SlidersHorizontal size={12} />View options{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
            <span id="task-options-summary" className="sr-only">{summary ? `Applied options: ${summary}` : 'View defaults'}</span>
            <button
              type="button"
              onClick={(event) => onShowShortcuts(event.currentTarget)}
              data-shortcuts-anchor=""
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Shared combined sections preserve existing filter and display choices. */}
      {menu.kind === 'options' && menu.anchor && (
        <TaskPopover anchor={menu.anchor} onClose={close} label="View options" width={280}>
          <MenuHeading>Owner</MenuHeading>
          {[
            ...OWNER_TOKENS.map((token) => ({ value: token as string, label: ownerLabel(token) })),
            ...developers.map((dev) => ({ value: dev.accountId, label: dev.displayName })),
          ].map((option) => (
            <MenuItem
              key={option.value}
              role="menuitemcheckbox"
              checked={ownerValues.includes(option.value)}
              label={option.label}
              onSelect={() => toggleOwner(option.value)}
            />
          ))}
          <MenuDivider />
          <MenuHeading>Status</MenuHeading>
          {STATUSES.map((status) => (
            <MenuItem
              key={status}
              role="menuitemcheckbox"
              checked={(overrides.status ?? []).includes(status)}
              icon={<span className="h-2 w-2 rounded-full" style={{ background: TASK_STATUS_META[status].color }} />}
              label={TASK_STATUS_META[status].label}
              onSelect={() => onOverrides({ status: toggleIn(overrides.status, status) })}
            />
          ))}
          <MenuDivider />
          <MenuHeading>Label — has all of</MenuHeading>
          {labels.map((label) => (
            <MenuItem
              key={label.name}
              role="menuitemcheckbox"
              checked={(overrides.label ?? []).includes(label.name)}
              icon={<span className="h-2 w-2 rounded-full" style={{ background: labelChipStyle(label.color).color as string }} />}
              label={taskLabelDisplayName(label.name)}
              onSelect={() => onOverrides({ label: toggleIn(overrides.label, label.name) })}
            />
          ))}
          {viewId === 'attention' && (
            <>
              <MenuDivider />
              <MenuHeading>Signal</MenuHeading>
              {SIGNALS.map((signal) => (
                <MenuItem
                  key={signal.value}
                  role="menuitemcheckbox"
                  checked={(overrides.signal ?? []).includes(signal.value)}
                  label={signal.label}
                  onSelect={() => onOverrides({ signal: toggleIn(overrides.signal, signal.value) })}
                />
              ))}
            </>
          )}
          <MenuDivider />
          <MenuHeading>Sort</MenuHeading>
          {SORTS.map((sort) => (
            <MenuItem key={sort.value} role="menuitemradio" checked={effectiveSort === sort.value} label={sort.label} onSelect={() => onOverrides({ sort: sort.value })} />
          ))}
          <MenuHeading>Group</MenuHeading>
          {GROUPS.map((group) => (
            <MenuItem key={group.value} role="menuitemradio" checked={effectiveGroup === group.value} label={group.label} onSelect={() => onOverrides({ group: group.value })} />
          ))}
          <MenuDivider />
          <MenuHeading>View</MenuHeading>
          <MenuItem label="Save current view" disabled={!canSave} onSelect={() => { close(); setSaveOpen(true); setSaveError(false); }} />
          {hasOverrides && isSavedView && <MenuItem label="Update view" onSelect={() => { close(); onUpdateView(); }} />}
          {hasOverrides && <MenuItem label={isSavedView ? 'Revert' : 'Reset'} onSelect={() => { close(); onRevert(); }} />}
          {activeFilterCount > 0 && (
            <>
              <MenuDivider />
              <MenuItem icon={<Check size={13} />} label="Clear all filters" onSelect={onRevert} />
            </>
          )}
        </TaskPopover>
      )}
      {saveOpen && (
        <Dialog title="Save view" size="sm" onClose={closeSave}>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label className="block text-[13px]">View name
              <input data-autofocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} aria-label="Saved view name" disabled={saving} className="ui-input mt-2 w-full" />
            </label>
            {saveError && <p role="alert" className="mt-2 text-[13px]">Could not save view. Try again.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="ui-btn-ghost" disabled={saving} onClick={closeSave}>Cancel</button>
              <button type="submit" className="ui-btn-primary" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Save view'}</button>
            </div>
          </form>
        </Dialog>
      )}
    </header>
  );
});
