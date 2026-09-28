import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, GripVertical, Play, RotateCcw, X } from 'lucide-react';
import { format } from 'date-fns';
import type { TrackerWorkItem } from '@/types';
import { TaskKeyChip } from '@/components/tasks/TaskKeyChip';
import { FOCUS_RING } from '@/components/ui/focus';
import { formatAbsoluteDateTime } from '@/lib/utils';
import { IconAction } from './MyDayUI';
import { InlineTaskActions, RowComposer, TaskMeta, TaskNote, TaskTitle, canRenameItem, usePrefetchHandlers } from './MyDayTaskParts';
import { useMyDayTaskDetail } from './MyDayTaskDetailContext';
import { TaskStatusGlyph } from '@/components/tasks/TaskMenus';

export type MyDayTaskRowVariant = 'planned' | 'done' | 'dropped';

export interface MyDayTaskRowProps {
  item: TrackerWorkItem;
  variant: MyDayTaskRowVariant;
  viewDate: string;
  /** Zero-based queue position for planned rows. */
  index?: number;
  readOnly?: boolean;
  onSetCurrent?: (id: number) => void;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onReopen?: (id: number) => void;
  onUpdateTitle?: (id: number, title: string) => void;
  onMove?: (id: number, direction: 'up' | 'down') => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** Starts a drag from the handle; the row body never drags. */
  onDragHandlePointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}

/**
 * Up next / Done rows. Text first: a leading glyph (queue number that turns
 * into a drag handle), key + title, one meta line, the note. Actions float
 * in on hover or focus and stay visible on touch screens. Clicking a keyed
 * row (or its title) opens the shared task drawer.
 */
export function MyDayTaskRow({
  item,
  variant,
  viewDate,
  index,
  readOnly = false,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onReopen,
  onUpdateTitle,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
  onDragHandlePointerDown,
}: MyDayTaskRowProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const { openTask } = useMyDayTaskDetail();
  const prefetch = usePrefetchHandlers(item.taskKey);
  const closed = variant !== 'planned';
  const reorderable = variant === 'planned' && !readOnly && Boolean(onDragHandlePointerDown || onMove);

  const completedTime = variant === 'done' && item.completedAt ? (
    <time dateTime={item.completedAt} title={formatAbsoluteDateTime(item.completedAt)} className="tabular-nums">
      {format(new Date(item.completedAt), 'h:mm a')}
    </time>
  ) : null;

  return (
    <div
      data-task-key={item.taskKey ?? undefined}
      onPointerEnter={prefetch.onPointerEnter}
      onClick={(event) => {
        // The whole row is a click target for the drawer; its own controls
        // (title, chip, actions, composer) keep their behaviour. Keyboard
        // users open it from the title button.
        if (!item.taskKey || composerOpen) return;
        if ((event.target as HTMLElement).closest('button, a, input, textarea, [role="menu"], [role="dialog"]')) return;
        if (window.getSelection()?.toString()) return;
        openTask(item.taskKey);
      }}
      className={`group relative flex items-start gap-3 px-3 transition-colors sm:px-4 ${closed ? 'py-2.5' : 'py-3'} ${item.taskKey ? 'cursor-pointer' : ''} hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_35%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--bg-tertiary)_35%,transparent)]`}
    >
      <LeadingGlyph
        item={item}
        variant={variant}
        index={index}
        reorderable={reorderable}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMove={onMove}
        onDragHandlePointerDown={onDragHandlePointerDown}
      />

      {/* Touch screens show the toolbar permanently — keep titles clear of it. */}
      <div className={`min-w-0 flex-1 ${readOnly ? '' : closed ? '[@media(hover:none)]:pr-9' : '[@media(hover:none)]:pr-[92px]'}`}>
        <div className="flex min-w-0 items-start gap-2">
          {item.taskKey && <TaskKeyChip taskKey={item.taskKey} className="mt-[1px]" />}
          <TaskTitle
            item={item}
            editable={canRenameItem(item, readOnly, Boolean(onUpdateTitle))}
            onCommit={onUpdateTitle}
            className={closed ? 'text-[13px] leading-5' : 'text-[13px] font-medium leading-5'}
            color={closed ? 'var(--text-secondary)' : 'var(--text-primary)'}
            strike={variant === 'dropped'}
          />
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <TaskMeta
            item={item}
            viewDate={viewDate}
            closed={closed}
            trailing={variant === 'dropped' ? 'Dropped' : completedTime}
          />
          {variant === 'planned' && item.taskKey && (
            <InlineTaskActions
              taskKey={item.taskKey}
              readOnly={readOnly}
              composerOpen={composerOpen}
              onOpenComposer={() => setComposerOpen(true)}
            />
          )}
        </div>
        <TaskNote note={item.note} className="mt-1.5" />

        {composerOpen && item.taskKey && !readOnly && (
          <RowComposer taskKey={item.taskKey} viewDate={viewDate} onClose={() => setComposerOpen(false)} />
        )}
      </div>

      {!readOnly && <RowActions item={item} variant={variant} onSetCurrent={onSetCurrent} onMarkDone={onMarkDone} onDrop={onDrop} onReopen={onReopen} />}
    </div>
  );
}

function RowActions({
  item,
  variant,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onReopen,
}: Pick<MyDayTaskRowProps, 'item' | 'variant' | 'onSetCurrent' | 'onMarkDone' | 'onDrop' | 'onReopen'>) {
  const actions =
    variant === 'planned'
      ? [
          onSetCurrent && (
            <IconAction key="start" size="sm" label={`Start ${item.title}`} title="Start — make this your focus" onClick={() => onSetCurrent(item.id)} tone="var(--accent)">
              <Play size={13} fill="currentColor" />
            </IconAction>
          ),
          onMarkDone && (
            <IconAction key="done" size="sm" label={`Mark ${item.title} done`} title="Mark done" onClick={() => onMarkDone(item.id)} tone="var(--success)">
              <Check size={15} />
            </IconAction>
          ),
          onDrop && (
            <IconAction key="drop" size="sm" label={`Drop ${item.title}`} title="Drop from today" onClick={() => onDrop(item.id)} tone="var(--text-muted)">
              <X size={14} />
            </IconAction>
          ),
        ]
      : [
          onReopen && (
            <IconAction key="reopen" size="sm" label={`Move ${item.title} back to Up next`} title="Back to Up next" onClick={() => onReopen(item.id)} tone="var(--text-secondary)">
              <RotateCcw size={13} />
            </IconAction>
          ),
        ];

  const visible = actions.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute right-2.5 top-2 z-[2] flex items-center gap-0.5 rounded-lg p-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--soft-shadow)' }}
    >
      {visible}
    </div>
  );
}

function LeadingGlyph({
  item,
  variant,
  index,
  reorderable,
  canMoveUp,
  canMoveDown,
  onMove,
  onDragHandlePointerDown,
}: {
  item: TrackerWorkItem;
  variant: MyDayTaskRowVariant;
  index?: number;
  reorderable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove?: (id: number, direction: 'up' | 'down') => void;
  onDragHandlePointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const box = 'mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center';

  // docs/54 V7: closed work wears the same glyph it has on Tasks and Standup.
  if (variant === 'done' || variant === 'dropped') {
    return <span className={box} aria-hidden="true"><TaskStatusGlyph status={variant} /></span>;
  }

  const number = typeof index === 'number' ? (
    <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>{index + 1}</span>
  ) : null;

  if (!reorderable) {
    return <span className={box} aria-hidden="true">{number}</span>;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const direction = event.key === 'ArrowUp' ? 'up' : 'down';
    if ((direction === 'up' && !canMoveUp) || (direction === 'down' && !canMoveDown)) return;
    event.preventDefault();
    onMove?.(item.id, direction);
  };

  return (
    <button
      type="button"
      data-drag-handle
      data-reorder-handle={item.id}
      onPointerDown={onDragHandlePointerDown}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      className={`${box} relative cursor-grab touch-none rounded-md active:cursor-grabbing ${FOCUS_RING}`}
      style={{ color: 'var(--text-muted)' }}
      aria-label={`Reorder ${item.title}. Use arrow keys to move.`}
      title="Drag, or focus and use ↑ ↓, to reorder"
    >
      {number && <span className="transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">{number}</span>}
      <GripVertical
        size={14}
        className={`absolute transition-opacity ${number ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}
