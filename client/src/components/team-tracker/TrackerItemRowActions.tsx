import type { ReactNode } from 'react';
import { Check, CircleCheck, GripVertical, PencilLine, Play, CircleX } from 'lucide-react';
import { FOCUS_RING } from '@/components/ui/focus';
import type { TrackerItemState } from '@/types';

export type TrackerItemActionPreset = 'default' | 'none' | 'hover-start' | 'hover-done';

interface TrackerItemRowActionsProps {
  itemId: number;
  itemTitle: string;
  itemState: TrackerItemState;
  actionPreset?: TrackerItemActionPreset;
  draggable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onSetCurrent?: (id: number) => void;
  onMarkDone?: (id: number) => void;
  onDrop?: (id: number) => void;
  onMoveUp?: (id: number) => void;
  onMoveDown?: (id: number) => void;
  onToggleTitleEditor?: () => void;
}

export function TrackerItemRowActions({
  itemId,
  itemTitle,
  itemState,
  actionPreset = 'default',
  draggable,
  canMoveUp = false,
  canMoveDown = false,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onMoveUp,
  onMoveDown,
  onToggleTitleEditor,
}: TrackerItemRowActionsProps) {
  if (actionPreset === 'none') {
    return null;
  }

  const hoverStart = actionPreset === 'hover-start';
  const hoverDone = actionPreset === 'hover-done';
  const hoverPrimaryOnly = hoverStart || hoverDone;

  if (hoverPrimaryOnly) {
    // Drawer rows: a floating mini-toolbar that surfaces on hover/focus (and
    // stays put on touch screens), so the list reads as text until needed.
    return (
      <div
        className="pointer-events-none absolute right-1.5 top-1.5 z-[2] flex items-center gap-0.5 rounded-lg p-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--soft-shadow)' }}
      >
        {onToggleTitleEditor && (
          <ToolbarButton
            label={`Edit title: ${itemTitle}`}
            onClick={onToggleTitleEditor}
          >
            <PencilLine size={13} style={{ color: 'var(--text-secondary)' }} />
          </ToolbarButton>
        )}
        {hoverStart && itemState !== 'in_progress' && onSetCurrent && (
          <ToolbarButton label={`Start ${itemTitle}`} title="Start — make this current work" onClick={() => onSetCurrent(itemId)}>
            <Play size={13} style={{ color: 'var(--accent)' }} />
          </ToolbarButton>
        )}
        {hoverDone && onMarkDone && (
          <ToolbarButton label={`Mark ${itemTitle} done`} title="Mark done" onClick={() => onMarkDone(itemId)}>
            <Check size={14} style={{ color: 'var(--success)' }} />
          </ToolbarButton>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
      {!draggable && itemState === 'planned' && onMoveUp && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMoveUp(itemId);
          }}
          disabled={!canMoveUp}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors disabled:opacity-30"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Move up"
        >
          <GripVertical size={10} style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}
      {!draggable && itemState === 'planned' && onMoveDown && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMoveDown(itemId);
          }}
          disabled={!canMoveDown}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors disabled:opacity-30"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Move down"
        >
          <GripVertical size={10} style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}
      {onToggleTitleEditor && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleTitleEditor();
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title={`Edit title: ${itemTitle}`}
          aria-label={`Edit title: ${itemTitle}`}
        >
          <PencilLine size={12} style={{ color: 'var(--text-secondary)' }} />
        </button>
      )}
      {itemState !== 'in_progress' && onSetCurrent && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onSetCurrent(itemId);
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Set as current"
        >
          <Play size={12} style={{ color: 'var(--accent)' }} />
        </button>
      )}
      {onMarkDone && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMarkDone(itemId);
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Mark done"
        >
          <CircleCheck size={10} style={{ color: 'var(--success)' }} />
        </button>
      )}
      {onDrop && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDrop(itemId);
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Drop"
        >
          <CircleX size={10} style={{ color: 'var(--text-muted)' }} />
        </button>
      )}
    </div>
  );
}

function ToolbarButton({ label, title, onClick, children }: { label: string; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      title={title ?? label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
