import { Fragment, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTaskListWindow } from '@/hooks/useTaskListWindow';
import { CalendarClock, ChevronDown, ChevronRight, Plus, UserRound } from 'lucide-react';
import type { TaskViewDefinition } from '@/types';
import type { TaskGroupContext } from '@/lib/task-views';
import { groupShowsDate, worstOverdueTone, type RenderGroup } from '@/lib/task-list';
import { useCaptureAttempt } from '@/hooks/useCaptureAttempt';
import type { CreateViaCapture } from '@/hooks/useCapture';
import type { CaptureDefaults } from 'shared/capture-grammar';
import { useCaptureTypeahead } from '@/hooks/useCaptureTypeahead';
import { TokenSuggestionList } from '@/components/capture/TokenSuggestionList';
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
  scrollRef: RefObject<HTMLElement | null>;
  groups: RenderGroup[];
  allowAdd?: boolean;
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
  addDefaults: (context: TaskGroupContext) => CaptureDefaults;
  onSubmitAdd: (context: TaskGroupContext, input: CreateViaCapture) => Promise<boolean>;
  onMoveOverdueToToday: (tasks: RowTask[]) => void;
  onToggleGroup?: (groupKey: string) => void;
  /** Rendered after the last group, inside the list column (keyboard hint). */
  footer?: ReactNode;
}

/**
 * docs/49 §5/§6.1 + docs/51 D2: grouped, dense list. Groups are flat
 * sections — a quiet sticky label (indicator · name · count) over hairline-
 * divided rows — not bordered cards, so chrome never outweighs a three-task
 * day. Each visible section owns a labelled native list; measured spacers preserve its sticky label.
 */
export function TaskList({
  scrollRef,
  groups,
  allowAdd = true,
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
  addDefaults,
  onMoveOverdueToToday,
  onToggleGroup,
  footer,
}: TaskListProps) {
  const dateColumns = useMemo(() => groups.map((group) => groupShowsDate(definition, group.context, group.tasks, today)), [groups, definition, today]);
  const { anchorRef, model, virtualizer, sections, scrollMargin } = useTaskListWindow(groups, scrollRef, focusedKey, addingGroup, allowAdd);
  return (
    <div className={`${TASK_LIST_CONTAINER} pb-28 pt-2`}>
      <div ref={anchorRef}>
        {sections.map(({ group, groupIndex, items, start, end }, sectionIndex) => {
          const header = items[0]!;
          const dateColumn = dateColumns[groupIndex]!;
          const gap = start - (sections[sectionIndex - 1]?.end ?? 0);
          const body = items.filter((item) => model.entries[item.index]!.kind !== 'header');
          return (
            <Fragment key={group.key}>
              {gap > 0 && <div aria-hidden="true" style={{ height: gap }} />}
              <section role="group" aria-labelledby={group.label ? `task-group-${group.key}` : undefined} aria-label={group.label ? undefined : 'Tasks'} className="group/section" style={{ paddingTop: group.label && groupIndex ? 20 : 0 }}>
                {group.label ? (
                  <GroupLabel group={group} headerId={`task-group-${group.key}`} collapsed={group.collapsed === true}
                    today={today} ownerName={ownerName} onAdd={allowAdd ? () => onStartAdd(group.key) : undefined}
                    onMoveOverdueToToday={onMoveOverdueToToday} onToggle={() => onToggleGroup?.(group.key)}
                    measureRef={virtualizer.measureElement} virtualIndex={header.index} />
                ) : <div aria-hidden="true" ref={virtualizer.measureElement} data-index={header.index} style={{ height: 1 }} />}
                {body.length > 0 && (
                  <ul aria-label={group.label || 'Tasks'} className="divide-y" style={{ borderColor: RULE }}>
                    {body.map((item, bodyIndex) => {
                      const entry = model.entries[item.index]!;
                      const before = item.start - (body[bodyIndex - 1]?.end ?? header.end);
                      const task = entry.kind === 'task' ? group.tasks[entry.taskIndex!]! : undefined;
                      return (
                        <Fragment key={entry.key}>
                          {before > 0 && <li aria-hidden="true" style={{ height: before, border: 0 }} />}
                          <li ref={virtualizer.measureElement} data-index={item.index} style={{ borderColor: RULE }}
                            aria-posinset={task ? entry.taskIndex! + 1 : undefined} aria-setsize={task ? group.tasks.length : undefined}>
                            {task ? (
                              <TaskListRow task={task as RowTask} context={group.context} definition={definition} today={today}
                                attentionMode={attentionMode} focused={task.taskKey === focusedKey} selected={selected.has(task.taskKey)}
                                dateColumn={dateColumn} ownerName={ownerName} labelColor={labelColor} handlers={handlers} />
                            ) : (
                              <InlineAddRow active={addingGroup === group.key} onStart={() => onStartAdd(group.key)} onCancel={onCancelAdd}
                                defaults={addDefaults(group.context)} onSubmit={(input) => onSubmitAdd(group.context, input)} groupLabel={group.label} />
                            )}
                          </li>
                        </Fragment>
                      );
                    })}
                  </ul>
                )}
                <div aria-hidden="true" style={{ height: Math.max(0, end - (items.at(-1)!.end - scrollMargin)) }} />
              </section>
            </Fragment>
          );
        })}
        <div aria-hidden="true" style={{ height: Math.max(0, virtualizer.getTotalSize() - (sections.at(-1)?.end ?? 0)) }} />
      </div>
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
function GroupLabel({ group, headerId, collapsed, today, ownerName, onAdd, onMoveOverdueToToday, onToggle, measureRef, virtualIndex }: {
  measureRef: (element: HTMLElement | null) => void;
  virtualIndex: number;
  group: RenderGroup;
  headerId: string;
  collapsed: boolean;
  today: string;
  ownerName: (ownerType: string | null, ownerId: string | null) => string;
  onAdd?: () => void;
  onMoveOverdueToToday: (tasks: RowTask[]) => void;
  onToggle: () => void;
}) {
  const context = group.context;
  const overdue = group.key === 'Overdue';
  const severity = overdue ? worstOverdueTone(group.tasks, today) : null;
  const tone = severity
    ? severity === 'danger' ? 'var(--task-danger-text)' : 'var(--task-warning-text)'
    : context.mode === 'scheduled' && context.bucket === 'Today' ? 'var(--accent)'
      : context.mode === 'meeting' && context.bucket === 'Today' ? 'var(--accent)'
        : context.mode === 'meeting' && context.bucket === 'Needs outcome' ? 'var(--task-warning-text)' : undefined;
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
    indicator = name === 'You' ? (
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
      ref={measureRef}
      data-index={virtualIndex}
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
      {!group.collapsible && onAdd && (
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
export function InlineAddRow({ active, onStart, onCancel, onSubmit, groupLabel, defaults }: {
  active: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSubmit: (input: CreateViaCapture) => Promise<boolean>;
  defaults?: CaptureDefaults;
  groupLabel: string;
}) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onStart}
        className="flex h-11 w-full items-center gap-2 px-2 text-left text-[12.5px] transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] hover:text-[var(--text-secondary)]"
        style={{ color: 'var(--text-muted)' }}
        aria-label={groupLabel ? `Add task to ${groupLabel}` : 'Add task'}
      >
        <span className="flex w-6 shrink-0 justify-center"><Plus size={13} /></span>
        Add task
      </button>
    );
  }
  return <InlineAddForm onCancel={onCancel} onSubmit={onSubmit} groupLabel={groupLabel} defaults={defaults} />;
}

/** The open add row: a capture input, so tokens and the `@` / `#` / `+` typeahead work. */
function InlineAddForm({ onCancel, onSubmit, groupLabel, defaults }: {
  onCancel: () => void;
  onSubmit: (input: CreateViaCapture) => Promise<boolean>;
  defaults?: CaptureDefaults;
  groupLabel: string;
}) {
  const [title, setTitle] = useState('');
  const [caret, setCaret] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeahead = useCaptureTypeahead(title, caret);
  const attempt = useCaptureAttempt({ text: typeahead.toWire(title.trim()), defaults });
  const pending = attempt.isPending;
  /** Put a typeahead choice into the input and park the caret after it. */
  const applyEdit = (next: { text: string; caret: number }) => {
    setTitle(next.text);
    setCaret(next.caret);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  return (
    <form
      className="relative flex h-[38px] items-center gap-2 px-2"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value || pending) return;
        const ok = await attempt.run(onSubmit);
        if (ok) { setTitle(''); setCaret(0); }
      }}
    >
      <span className="flex w-6 shrink-0 justify-center"><Plus size={13} style={{ color: 'var(--accent)' }} /></span>
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(event) => { setTitle(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => {
          // docs/57 §3 (P3-05): `@person`, `#JIRA-KEY` and `+label` typeahead.
          const nav = typeahead.handleKey(event);
          if (typeof nav === 'object') { applyEdit(nav); return; }
          if (nav) return;
          if (event.key === 'Enter' && typeahead.open) {
            const chosen = typeahead.choose();
            if (chosen) { event.preventDefault(); applyEdit(chosen); return; }
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setTitle('');
            setCaret(0);
            onCancel();
          }
        }}
        onBlur={() => { if (!title.trim()) onCancel(); }}
        placeholder={`New task${groupLabel ? ` in ${groupLabel}` : ''} — @person !date +label · Enter to add, Esc to close`}
        aria-label={groupLabel ? `New task in ${groupLabel}` : 'New task'}
        readOnly={pending}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        style={{ color: 'var(--text-primary)' }}
      />
      {typeahead.open && typeahead.fragment ? (
        <TokenSuggestionList
          trigger={typeahead.fragment.trigger}
          suggestions={typeahead.suggestions}
          activeIndex={typeahead.activeIndex}
          onHover={typeahead.setActiveIndex}
          onChoose={(suggestion) => {
            const chosen = typeahead.choose(suggestion);
            if (chosen) applyEdit(chosen);
          }}
        />
      ) : null}
    </form>
  );
}
