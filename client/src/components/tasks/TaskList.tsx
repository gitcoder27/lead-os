import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarClock, ChevronDown, ChevronRight, Plus, UserRound } from 'lucide-react';
import type { TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import { groupShowsDate, worstOverdueTone, type RenderGroup } from '@/lib/task-list';
import { Avatar } from './TaskDetailPrimitives';
import { TaskListRow, type RowTask, type TaskRowHandlers } from './TaskListRow';

/**
 * docs/51 D5: toolbar, list, skeleton and empty states share one centered
 * column so their left edges line up at every width. Content inside it is
 * inset `px-2` (rows, labels, toolbar) so text starts on the same line.
 */
export const TASK_LIST_CONTAINER = 'mx-auto w-full max-w-[1180px] px-3 sm:px-5';

/** Hairline used between rows and under section labels. */
const RULE = 'color-mix(in srgb, var(--border) 55%, transparent)';

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
  onToggleGroup?: (groupKey: string) => void;
  /** Rendered after the last group, inside the list column (keyboard hint). */
  footer?: ReactNode;
}

/**
 * docs/49 §5/§6.1 + docs/51 D2: grouped, dense list. Groups are flat
 * sections — a quiet sticky label (indicator · name · count) over hairline-
 * divided rows — not bordered cards, so chrome never outweighs a three-task
 * day. Each section is a labelled `role="group"` containing a real `listbox`
 * of `option` rows (docs/51 A1), with exit-only row motion.
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
  onToggleGroup,
  footer,
}: TaskListProps) {
  const reduceMotion = useReducedMotion();
  const selectionActive = selected.size > 0;
  return (
    <div className={`${TASK_LIST_CONTAINER} pb-28 pt-2`}>
      {groups.map((group, index) => {
        const collapsed = group.collapsed === true;
        const dateColumn = groupShowsDate(definition, group.context, group.tasks, today);
        return (
          <section
            key={group.key}
            role="group"
            aria-labelledby={group.label ? `task-group-${group.key}` : undefined}
            aria-label={group.label ? undefined : 'Tasks'}
            className={`group/section ${index > 0 && group.label ? 'mt-5' : ''}`}
          >
            {group.label && (
              <GroupLabel
                group={group}
                headerId={`task-group-${group.key}`}
                collapsed={collapsed}
                today={today}
                ownerName={ownerName}
                onAdd={() => onStartAdd(group.key)}
                onMoveOverdueToToday={onMoveOverdueToToday}
                onToggle={() => onToggleGroup?.(group.key)}
              />
            )}
            {!collapsed && (
              <div
                role="listbox"
                aria-label={group.label || 'Tasks'}
                aria-multiselectable="true"
                className="divide-y"
                style={{ borderColor: RULE }}
              >
                <AnimatePresence initial={false}>
                  {group.tasks.map((task) => (
                    <motion.div
                      key={task.taskKey}
                      role="presentation"
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.15 }}
                      style={{ borderColor: RULE, overflow: 'hidden' }}
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
                        dateColumn={dateColumn}
                        ownerName={ownerName}
                        labelColor={labelColor}
                        handlers={handlers}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            {/* Labeled groups add from the label's "+"; unlabeled lists keep a footer row. Collapsed groups keep both hidden. */}
            {!collapsed && !group.collapsible && (addingGroup === group.key || !group.label) && (
              <div className="border-t" style={{ borderColor: RULE }}>
                <InlineAddRow
                  active={addingGroup === group.key}
                  onStart={() => onStartAdd(group.key)}
                  onCancel={onCancelAdd}
                  onSubmit={(title) => onSubmitAdd(group.context, title)}
                  groupLabel={group.label}
                />
              </div>
            )}
          </section>
        );
      })}
      {footer}
    </div>
  );
}

/**
 * docs/51 D2: the section label. A fixed 24px indicator slot sits exactly over
 * the rows' status glyphs (tone dot, owner avatar, or the collapse chevron),
 * so every label's text starts on the task-key column. The count is a quiet
 * numeral, not a pill. docs/51 D1: the Overdue label takes the loudest tone of
 * its rows — red only when one of them missed a deadline.
 */
function GroupLabel({ group, headerId, collapsed, today, ownerName, onAdd, onMoveOverdueToToday, onToggle }: {
  group: RenderGroup;
  headerId: string;
  collapsed: boolean;
  today: string;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  onAdd: () => void;
  onMoveOverdueToToday: (tasks: RowTask[]) => void;
  onToggle: () => void;
}) {
  const context = group.context;
  const overdue = group.key === 'Overdue';
  const severity = overdue ? worstOverdueTone(group.tasks, today) : null;
  const tone = severity
    ? `var(--${severity})`
    : context.mode === 'scheduled' && context.bucket === 'Today' ? 'var(--accent)' : undefined;
  const movable = overdue ? group.tasks.filter((task) => !task.lingering) : [];
  const count = group.count ?? group.tasks.length;

  let indicator: ReactNode = null;
  if (group.collapsible) {
    indicator = (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
        className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{ color: 'var(--text-muted)' }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
    );
  } else if (context.mode === 'owner') {
    const name = context.ownerType ? ownerName(context.ownerType, context.ownerId) : null;
    indicator = name === 'Me' ? (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }} aria-hidden="true">
        <UserRound size={11} />
      </span>
    ) : name ? (
      <Avatar name={name} seed={context.ownerId ?? group.label} size={18} />
    ) : (
      <span className="h-[18px] w-[18px] rounded-full" style={{ border: '1px dashed var(--border-strong)' }} aria-hidden="true" />
    );
  } else if (context.mode === 'party') {
    // docs/57 §4: the party waited on; my own blocked work has no avatar.
    indicator = context.waitingOn
      ? <Avatar name={group.label} seed={context.waitingOn.ref ?? group.label} size={18} />
      : <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--danger)' }} aria-hidden="true" />;
  } else if (tone) {
    indicator = <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden="true" />;
  }

  return (
    <header
      className="sticky top-0 z-[1] flex h-9 items-center gap-2 border-b px-2"
      // Translucent + blur so the stuck label matches the panel's tint while rows scroll under it.
      style={{ background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)', backdropFilter: 'blur(8px)', borderColor: RULE }}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">{indicator}</span>
      <h2
        id={headerId}
        className="truncate text-[12.5px] font-semibold tracking-[-0.005em]"
        style={{ color: severity ? tone : group.collapsible ? 'var(--text-secondary)' : 'var(--text-primary)' }}
      >
        {group.label}
      </h2>
      <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }} aria-label={`${count} tasks`}>
        {count}
      </span>
      <span className="flex-1" />
      {movable.length > 0 && (
        <button
          type="button"
          onClick={() => onMoveOverdueToToday(movable)}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: 'var(--accent)' }}
        >
          <CalendarClock size={12} /> Move all to today
        </button>
      )}
      {!group.collapsible && (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--bg-tertiary)] focus-visible:opacity-100 group-hover/section:opacity-100 [@media(hover:none)]:opacity-100"
          style={{ color: 'var(--text-secondary)' }}
          aria-label={`Add task to ${group.label}`}
          title="Add task (n)"
        >
          <Plus size={14} />
        </button>
      )}
    </header>
  );
}

/** docs/51 F14: exported so an empty view can host its own add row. */
export function InlineAddRow({ active, onStart, onCancel, onSubmit, groupLabel }: {
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
        className="flex h-[36px] w-full items-center gap-2 px-2 text-left text-[12.5px] transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] hover:text-[var(--text-secondary)]"
        style={{ color: 'var(--text-muted)' }}
        aria-label={groupLabel ? `Add task to ${groupLabel}` : 'Add task'}
      >
        <span className="flex w-6 shrink-0 justify-center"><Plus size={13} /></span>
        Add task
      </button>
    );
  }
  return (
    <form
      className="flex h-[38px] items-center gap-2 px-2"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)' }}
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
      <span className="flex w-6 shrink-0 justify-center"><Plus size={13} style={{ color: 'var(--accent)' }} /></span>
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
