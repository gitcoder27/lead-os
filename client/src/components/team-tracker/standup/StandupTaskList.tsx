import { useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, CirclePlus, Flag } from 'lucide-react';
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
  const [showDone, setShowDone] = useState(false);

  return (
    <section>
      <SectionLabel right={<button type="button" className="ui-icon-btn" onClick={onAdd} aria-label={`Add task for ${ownerName}`} title="Add task"><CirclePlus size={16} /></button>}>
        Work
      </SectionLabel>

      {tasks.length === 0 ? (
        <div>
          <EmptyState
            compact
            title="No open tasks"
            action={
              <button type="button" onClick={onAdd} className="ui-btn">
                <CirclePlus size={13} /> Add task <Kbd subtle>n</Kbd>
              </button>
            }
          />
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-lg"
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onOpen(task.taskKey); }
                }}
                // The selected task is a soft tint with a thin accent bar on the left. Keyboard focus now lands on it
                // as soon as you move to a person, so a full ring (which :focus-visible would draw permanently)
                // was far too loud; the tint + bar is the focus indicator, rendered from state so it also follows j/k.
                className="standup-task-row relative block w-full px-3 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] [&:not(:first-child)]:border-t"
                style={{
                  borderColor: 'var(--border)',
                  background: focused ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))' : undefined,
                  boxShadow: focused ? 'inset 3px 0 0 var(--accent)' : undefined,
                }}
              >
                <span className="flex min-h-[38px] items-center gap-2.5">
                  <TaskStatusGlyph status={task.status} />
                  <span className="shrink-0 font-mono text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {task.taskKey}
                  </span>
                  <span className="min-w-0 flex-1 break-words py-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
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
                  <span className="flex flex-wrap items-center gap-1.5 pb-2 pl-6 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="min-w-0 truncate">↳ {latest.excerpt}</span>
                    <span className="shrink-0 tabular-nums">· {formatRelativeTime(latest.occurredAt)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {composer && tasks[focusedIndex] && <div className="mt-3 border-l-2 pl-3" style={{ borderColor: 'var(--accent)' }}>
        <div className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 break-words" style={{ color: 'var(--text-secondary)' }}>{tasks[focusedIndex]!.taskKey} · {tasks[focusedIndex]!.title}</span>
          <button type="button" className="ui-icon-btn shrink-0" aria-label={`Open ${tasks[focusedIndex]!.taskKey}`} title="Open task details" onClick={() => onOpen(tasks[focusedIndex]!.taskKey)}><ArrowUpRight size={16} /></button>
        </div>
        {composer}
      </div>}

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
