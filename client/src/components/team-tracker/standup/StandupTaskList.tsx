import { useState, type ReactNode } from 'react';
import { ChevronDown, CirclePlus, Flag } from 'lucide-react';
import type { StandupTask } from '@/lib/standup';
import { formatRelativeTime } from '@/lib/utils';
import { TaskStatusGlyph } from '@/components/tasks/TaskMenus';
import { Kbd, SectionLabel } from './StandupPrimitives';
import { EmptyState } from '@/components/ui/EmptyState';

const MESSAGE_EVENTS = new Set(['update', 'instruction', 'decision', 'blocker']);

/**
 * docs/50 S8: the /tasks row idiom — status glyph · muted key · title ·
 * signals, with the latest message event as a second line. Roving tabindex;
 * j/k is handled by the standup keymap.
 */
export function StandupTaskList({
  ownerName,
  tasks,
  doneToday,
  focusedIndex,
  activeKeys,
  registerRow,
  onFocusIndex,
  onOpen,
  onAdd,
  composer,
}: {
  ownerName: string;
  tasks: StandupTask[];
  doneToday: Array<{ taskKey: string; title: string }>;
  focusedIndex: number;
  activeKeys: Set<string>;
  registerRow: (taskKey: string, el: HTMLButtonElement | null) => void;
  onFocusIndex: (index: number) => void;
  onOpen: (taskKey: string) => void;
  onAdd: () => void;
  /** Update composer for the focused task, rendered directly under the list. */
  composer?: ReactNode;
}) {
  const [showDone, setShowDone] = useState(true);

  return (
    <section>
      <SectionLabel
        right={
          tasks.length > 0 ? (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <Kbd subtle>j</Kbd>
              <Kbd subtle>k</Kbd>
              to move
            </span>
          ) : null
        }
      >
        Open tasks · {tasks.length}
      </SectionLabel>

      {tasks.length === 0 ? (
        <div className="rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <EmptyState
            compact
            title="No open tasks"
            body={`Nothing planned for ${ownerName.split(' ')[0]} — add what they said they're picking up.`}
            action={
              <button type="button" onClick={onAdd} className="ui-btn">
                <CirclePlus size={13} /> Add task <Kbd subtle>n</Kbd>
              </button>
            }
          />
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          role="listbox"
          aria-label={`${ownerName}'s tasks`}
        >
          {tasks.map((task, index) => {
            const focused = index === focusedIndex;
            const latest = task.latestEvent && MESSAGE_EVENTS.has(task.latestEvent.type) ? task.latestEvent : undefined;
            const isNew = activeKeys.has(task.taskKey);
            return (
              <button
                key={task.taskKey}
                type="button"
                role="option"
                aria-selected={focused}
                tabIndex={focused ? 0 : -1}
                ref={(el) => registerRow(task.taskKey, el)}
                onClick={() => onFocusIndex(index)}
                onDoubleClick={() => onOpen(task.taskKey)}
                // docs/54 D3: the list-row idiom from /tasks — focus is a tint plus a
                // keyboard ring; the left accent bar is reserved for "featured".
                // j/k moves the focus state without moving DOM focus, so the ring
                // is rendered from state, not :focus-visible.
                className="relative block w-full px-3 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] focus-visible:shadow-[inset_0_0_0_2px_var(--border-active)] [&:not(:first-child)]:border-t"
                style={{
                  borderColor: 'var(--border)',
                  background: focused ? 'color-mix(in srgb, var(--bg-tertiary) 85%, transparent)' : undefined,
                  boxShadow: focused ? 'inset 0 0 0 1.5px var(--border-active)' : undefined,
                }}
              >
                <span className="flex min-h-[38px] items-center gap-2.5">
                  <TaskStatusGlyph status={task.status} />
                  <span className="w-12 shrink-0 font-mono text-[12px] tabular-nums" style={{ color: 'var(--text-disabled)' }}>
                    {task.taskKey}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {task.title}
                  </span>
                  {isNew && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--accent)' }} title="Activity since last standup">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                      new
                    </span>
                  )}
                  {task.highPriority && <Flag size={12} fill="currentColor" style={{ color: 'var(--text-primary)' }} aria-label="High priority" />}
                  {task.jiraKey && (
                    <span className="hidden shrink-0 rounded px-1 py-px font-mono text-[11px] font-semibold lg:inline" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {task.jiraKey}
                    </span>
                  )}
                  {task.status === 'active' && <StatusTag color="var(--accent)">Current</StatusTag>}
                  {task.status === 'blocked' && <StatusTag color="var(--danger)">Blocked</StatusTag>}
                </span>
                {latest && (
                  <span className="-mt-1.5 flex items-center gap-1.5 pb-2 pl-[83px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="min-w-0 truncate">↳ {latest.excerpt}</span>
                    <span className="shrink-0 tabular-nums">· {formatRelativeTime(latest.occurredAt)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {composer && <div className="mt-2">{composer}</div>}

      {doneToday.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            aria-expanded={showDone}
            className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.09em]"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronDown size={12} className={`transition-transform ${showDone ? '' : '-rotate-90'}`} />
            Done today · {doneToday.length}
          </button>
          {showDone && (
            <ul className="space-y-0.5 pl-1">
              {doneToday.map((task) => (
                <li key={task.taskKey}>
                  <button
                    type="button"
                    onClick={() => onOpen(task.taskKey)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <TaskStatusGlyph status="done" size={14} />
                    <span className="w-12 shrink-0 font-mono text-[12px]" style={{ color: 'var(--text-disabled)' }}>{task.taskKey}</span>
                    <span className="min-w-0 truncate text-[12.5px] line-through" style={{ color: 'var(--text-muted)' }}>{task.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function StatusTag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.04em]"
      style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}
    >
      {children}
    </span>
  );
}
