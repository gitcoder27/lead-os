import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Play, Plus, X } from 'lucide-react';
import type { TrackerWorkItem } from '@/types';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { EASE_OUT, IconAction, Kbd, surfaceStyle } from './MyDayUI';
import { TaskFooter, TaskMeta, TaskNote, TaskTitle, canRenameItem, usePrefetchHandlers } from './MyDayTaskParts';

interface CurrentTaskProps {
  viewDate: string;
  item?: TrackerWorkItem;
  /** First item in Up next — offered as a one-click start when nothing is in focus. */
  nextItem?: TrackerWorkItem;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  onSetCurrent?: (id: number) => void;
  onAddTask?: () => void;
  readOnly?: boolean;
}

/**
 * The focus card. One task, big and calm: what you're on, how long it has
 * been carried, the latest word on it, and the two moves that matter —
 * post an update, or call it done.
 */
export function CurrentTask({
  viewDate,
  item,
  nextItem,
  onMarkDone,
  onDrop,
  onUpdateTitle,
  onSetCurrent,
  onAddTask,
  readOnly = false,
}: CurrentTaskProps) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {item ? (
        <FocusCard
          key={item.id}
          item={item}
          viewDate={viewDate}
          onMarkDone={onMarkDone}
          onDrop={onDrop}
          onUpdateTitle={onUpdateTitle}
          readOnly={readOnly}
        />
      ) : (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="flex flex-col items-start gap-3 rounded-2xl px-5 py-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ ...surfaceStyle, borderStyle: 'dashed' }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Nothing in focus
            </p>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
              {readOnly
                ? 'No task was in progress.'
                : nextItem
                  ? 'Pick up the next thing in your queue.'
                  : 'Add what you’re working on to get started.'}
            </p>
          </div>
          {!readOnly && nextItem && onSetCurrent && (
            <button
              type="button"
              onClick={() => onSetCurrent(nextItem.id)}
              className={`group/start inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl py-2 pl-2.5 pr-3.5 text-[13px] font-medium transition-colors ${FOCUS_RING}`}
              style={{
                color: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
              }}
              aria-label={`Start ${nextItem.title}`}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-transform group-hover/start:scale-105"
                style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
              >
                <Play size={12} fill="currentColor" aria-hidden="true" />
              </span>
              {nextItem.taskKey && <span className="shrink-0 font-mono text-[11px] font-bold">{nextItem.taskKey}</span>}
              <span className="truncate" style={{ color: 'var(--text-primary)' }}>{nextItem.title}</span>
            </button>
          )}
          {!readOnly && !nextItem && onAddTask && (
            <button
              type="button"
              onClick={onAddTask}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <Plus size={14} aria-hidden="true" />
              Add a task
              <Kbd>N</Kbd>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface FocusCardProps {
  item: TrackerWorkItem;
  viewDate: string;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  readOnly: boolean;
}

// popLayout measures the exiting card through its ref, so this must forward one.
const FocusCard = forwardRef<HTMLElement, FocusCardProps>(function FocusCard(
  { item, viewDate, onMarkDone, onDrop, onUpdateTitle, readOnly },
  ref,
) {
  const prefetch = usePrefetchHandlers(item.taskKey);

  return (
    <motion.article
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.99 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      data-task-key={item.taskKey ?? undefined}
      aria-label={`Now: ${item.title}`}
      onPointerEnter={prefetch.onPointerEnter}
      className="group relative overflow-hidden rounded-2xl"
      style={{
        background:
          'linear-gradient(165deg, color-mix(in srgb, var(--accent) 9%, var(--bg-secondary)) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 55%)',
        border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
        boxShadow: 'var(--soft-shadow)',
      }}
    >
      {/* Accent rail — the only thing on the page that says "this one". */}
      <span
        aria-hidden="true"
        className="absolute inset-y-4 left-0 w-[3px] rounded-r-full"
        style={{ background: 'linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 30%, transparent))' }}
      />

      <div className="px-5 pb-4 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <LiveDot active={!readOnly} />
          <span className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
            {readOnly ? 'In progress' : 'Working on'}
          </span>
          {item.taskKey && <TaskKeyChip taskKey={item.taskKey} className="ml-1" />}

          {!readOnly && (
            <div className="ml-auto flex items-center gap-1">
              {onDrop && (
                <IconAction label={`Drop ${item.title}`} title="Drop from today" onClick={() => onDrop(item.id)} tone="var(--text-muted)">
                  <X size={15} />
                </IconAction>
              )}
              {onMarkDone && (
                <button
                  type="button"
                  onClick={() => onMarkDone(item.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors hover:brightness-110 ${FOCUS_RING}`}
                  style={{
                    color: 'var(--success)',
                    background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
                  }}
                  aria-label={`Mark ${item.title} done`}
                  title="Mark done"
                >
                  <Check size={14} aria-hidden="true" />
                  Done
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex min-w-0">
          <TaskTitle
            item={item}
            editable={canRenameItem(item, readOnly, Boolean(onUpdateTitle))}
            onCommit={onUpdateTitle}
            className="text-[19px] font-semibold leading-[26px] tracking-[-0.015em]"
          />
        </div>

        <TaskMeta item={item} viewDate={viewDate} className="mt-2" hideDetailsHint />
        <TaskNote note={item.note} className="mt-2.5" clamp={false} />
        <DetailsExcerpt details={item.details} />

        <TaskFooter item={item} viewDate={viewDate} readOnly={readOnly} />
      </div>
    </motion.article>
  );
});

/** The focus task's context, a glance deep — the drawer shows it in full. */
function DetailsExcerpt({ details }: { details?: string }) {
  if (!details) return null;
  return (
    <p
      className="mt-2.5 line-clamp-3 whitespace-pre-line break-words border-l-2 pl-3 text-[13px] leading-[19px]"
      style={{ color: 'var(--text-secondary)', borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))' }}
    >
      {details}
    </p>
  );
}

function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: 'var(--accent)', animationDuration: '2.4s' }} />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
    </span>
  );
}
