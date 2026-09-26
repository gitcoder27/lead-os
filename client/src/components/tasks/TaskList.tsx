import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarClock, Plus } from 'lucide-react';
import type { TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import type { RenderGroup } from '@/lib/task-list';
import { TaskListRow, type RowTask, type TaskRowHandlers } from './TaskListRow';

interface TaskListProps {
  groups: RenderGroup[];
  definition: TaskViewDefinition | undefined;
  today: string;
  attentionMode: boolean;
  focusedKey: string | undefined;
  selected: ReadonlySet<string>;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  labelColor: (name: string) => string | undefined;
  handlers: TaskRowHandlers;
  addingGroup: string | null;
  onStartAdd: (groupKey: string) => void;
  onCancelAdd: () => void;
  onSubmitAdd: (context: TaskGroupContext, title: string) => Promise<boolean>;
  onMoveOverdueToToday: (tasks: RowTask[]) => void;
}

/**
 * docs/49 §5/§6.1: grouped, dense list — `listbox` with roving-tabindex rows,
 * a per-group inline add row, and exit-only row motion (no layout animation).
 */
export function TaskList({
  groups,
  definition,
  today,
  attentionMode,
  focusedKey,
  selected,
  ownerName,
  labelColor,
  handlers,
  addingGroup,
  onStartAdd,
  onCancelAdd,
  onSubmitAdd,
  onMoveOverdueToToday,
}: TaskListProps) {
  const reduceMotion = useReducedMotion();
  const selectionActive = selected.size > 0;
  return (
    <div role="listbox" aria-label="Tasks" aria-multiselectable="true" className="mx-auto w-full max-w-[1180px] space-y-3 px-4 pb-24 pt-3">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={group.label || 'Tasks'}
          className="group/section overflow-hidden rounded-xl"
          style={{ border: '1px solid color-mix(in srgb, var(--border) 75%, transparent)', background: 'color-mix(in srgb, var(--bg-secondary) 55%, transparent)' }}
        >
          {group.label && (
            <GroupHeader
              group={group}
              ownerName={ownerName}
              onAdd={() => onStartAdd(group.key)}
              onMoveOverdueToToday={onMoveOverdueToToday}
            />
          )}
          <div className="divide-y" style={{ borderColor: 'color-mix(in srgb, var(--border) 50%, transparent)' }}>
            <AnimatePresence initial={false}>
              {group.tasks.map((task) => (
                <motion.div
                  key={task.taskKey}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.15 }}
                  style={{ borderColor: 'color-mix(in srgb, var(--border) 50%, transparent)', overflow: 'hidden' }}
                >
                  <TaskListRow
                    task={task as RowTask}
                    context={group.context}
                    definition={definition}
                    today={today}
                    attentionMode={attentionMode}
                    focused={task.taskKey === focusedKey}
                    selected={selected.has(task.taskKey)}
                    selectionActive={selectionActive}
                    ownerName={ownerName}
                    labelColor={labelColor}
                    handlers={handlers}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
            {/* Labeled groups add from the header "+"; unlabeled lists keep a footer row. */}
            {(addingGroup === group.key || !group.label) && (
              <InlineAddRow
                active={addingGroup === group.key}
                onStart={() => onStartAdd(group.key)}
                onCancel={onCancelAdd}
                onSubmit={(title) => onSubmitAdd(group.context, title)}
                groupLabel={group.label}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

const BUCKET_TONES: Record<string, string> = {
  Overdue: 'var(--danger)',
  Today: 'var(--accent)',
  Tomorrow: 'var(--info)',
};

/**
 * Group header band: owner groups lead with an avatar and the person's name
 * in normal case; schedule groups get a tone dot. The inline add lives here
 * as a "+" so empty "Add task" rows don't compete with real tasks.
 */
function GroupHeader({ group, ownerName, onAdd, onMoveOverdueToToday }: {
  group: RenderGroup;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  onAdd: () => void;
  onMoveOverdueToToday: (tasks: RowTask[]) => void;
}) {
  const context = group.context;
  const tone = context.mode === 'scheduled' ? BUCKET_TONES[context.bucket] ?? 'var(--text-muted)' : undefined;
  const movable = group.key === 'Overdue' ? group.tasks.filter((task) => !task.lingering) : [];
  return (
    <header
      className="sticky top-0 z-[1] flex h-10 items-center gap-2.5 px-3"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}
    >
      {context.mode === 'owner' ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={context.ownerType
            ? { background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid var(--border-active)' }
            : { color: 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
          aria-hidden="true"
        >
          {context.ownerType ? ownerInitials(ownerName(context.ownerType, context.ownerId)) : ''}
        </span>
      ) : tone ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden="true" />
      ) : null}
      <h2 className="truncate text-[13px] font-semibold" style={{ color: group.key === 'Overdue' ? 'var(--danger)' : 'var(--text-primary)' }}>
        {group.label}
      </h2>
      <span
        className="rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums"
        style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}
        aria-label={`${group.tasks.length} tasks`}
      >
        {group.tasks.length}
      </span>
      <span className="flex-1" />
      {movable.length > 0 && (
        <button
          type="button"
          onClick={() => onMoveOverdueToToday(movable)}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
        >
          <CalendarClock size={11} /> Move all to today
        </button>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="flex h-6 w-6 items-center justify-center rounded-md opacity-50 transition-opacity hover:bg-[var(--bg-tertiary)] hover:opacity-100 focus-visible:opacity-100 group-hover/section:opacity-100"
        style={{ color: 'var(--text-secondary)' }}
        aria-label={`Add task to ${group.label}`}
        title="Add task (n)"
      >
        <Plus size={14} />
      </button>
    </header>
  );
}

function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

function InlineAddRow({ active, onStart, onCancel, onSubmit, groupLabel }: {
  active: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSubmit: (title: string) => Promise<boolean>;
  groupLabel: string;
}) {
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  if (!active) {
    return (
      <button
        type="button"
        onClick={onStart}
        className="flex h-[34px] w-full items-center gap-2 px-3 pl-10 text-left text-[12.5px] transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}
        aria-label={groupLabel ? `Add task to ${groupLabel}` : 'Add task'}
      >
        <Plus size={13} /> Add task
      </button>
    );
  }
  return (
    <form
      className="flex h-[38px] items-center gap-2 px-3 pl-10"
      style={{ borderColor: 'color-mix(in srgb, var(--border) 50%, transparent)', background: 'var(--bg-tertiary)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value || pending) return;
        setPending(true);
        const ok = await onSubmit(value);
        setPending(false);
        if (ok) setTitle('');
      }}
    >
      <Plus size={13} style={{ color: 'var(--accent)' }} />
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setTitle('');
            onCancel();
          }
        }}
        onBlur={() => { if (!title.trim()) onCancel(); }}
        placeholder={`New task${groupLabel ? ` in ${groupLabel}` : ''} — Enter to add, Esc to close`}
        aria-label={groupLabel ? `New task in ${groupLabel}` : 'New task'}
        readOnly={pending}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        style={{ color: 'var(--text-primary)' }}
      />
    </form>
  );
}
