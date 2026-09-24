import { CheckCircle2, GripVertical, PencilLine, Play, XCircle } from 'lucide-react';
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

  return (
    <div
      className={
        hoverPrimaryOnly
          ? 'pointer-events-none absolute right-1.5 top-1/2 z-[1] flex -translate-y-1/2 translate-x-2 items-center gap-1.5 opacity-0 transition-all group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100'
          : 'flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
      }
      style={
        hoverPrimaryOnly
          ? {
              background:
                'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--bg-secondary) 24%, transparent) 24%, var(--bg-secondary) 100%)',
              padding: '0.25rem 0.25rem 0.25rem 1.25rem',
            }
          : undefined
      }
    >
      {!hoverPrimaryOnly && !draggable && itemState === 'planned' && onMoveUp && (
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
      {!hoverPrimaryOnly && !draggable && itemState === 'planned' && onMoveDown && (
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
          className={
            hoverPrimaryOnly
              ? 'flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:scale-[1.04] active:scale-[0.97]'
              : 'h-6 w-6 rounded-md flex items-center justify-center transition-colors'
          }
          style={
            hoverPrimaryOnly
              ? {
                  background: 'color-mix(in srgb, var(--bg-secondary) 90%, var(--bg-tertiary) 10%)',
                  borderColor: 'color-mix(in srgb, var(--border-strong) 70%, transparent)',
                  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
                }
              : { background: 'var(--bg-tertiary)' }
          }
          title={`Edit title: ${itemTitle}`}
          aria-label={`Edit title: ${itemTitle}`}
        >
          <PencilLine size={12} style={{ color: hoverPrimaryOnly ? 'var(--text-primary)' : 'var(--text-secondary)' }} />
        </button>
      )}
      {itemState !== 'in_progress' && onSetCurrent && !hoverDone && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onSetCurrent(itemId);
          }}
          className={
            hoverStart
              ? 'flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:scale-[1.04] active:scale-[0.97]'
              : 'h-6 w-6 rounded-md flex items-center justify-center transition-colors'
          }
          style={
            hoverStart
              ? {
                  background: 'color-mix(in srgb, var(--accent-glow) 82%, var(--bg-secondary) 18%)',
                  borderColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
                  boxShadow: '0 8px 18px rgba(6, 182, 212, 0.18)',
                }
              : { background: 'var(--bg-tertiary)' }
          }
          title={hoverStart ? `Start ${itemTitle}` : 'Set as current'}
          aria-label={hoverStart ? `Start ${itemTitle}` : undefined}
        >
          <Play size={12} style={{ color: 'var(--accent)' }} />
        </button>
      )}
      {hoverDone && onMarkDone && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMarkDone(itemId);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:scale-[1.04] active:scale-[0.97]"
          style={{
            background: 'color-mix(in srgb, rgba(16,185,129,0.2) 82%, var(--bg-secondary) 18%)',
            borderColor: 'rgba(16, 185, 129, 0.28)',
            boxShadow: '0 8px 18px rgba(16, 185, 129, 0.16)',
          }}
          title={`Mark ${itemTitle} done`}
          aria-label={`Mark ${itemTitle} done`}
        >
          <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
        </button>
      )}
      {!hoverPrimaryOnly && onMarkDone && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMarkDone(itemId);
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Mark done"
        >
          <CheckCircle2 size={10} style={{ color: 'var(--success)' }} />
        </button>
      )}
      {!hoverPrimaryOnly && onDrop && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDrop(itemId);
          }}
          className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
          style={{ background: 'var(--bg-tertiary)' }}
          title="Drop"
        >
          <XCircle size={10} style={{ color: 'var(--text-muted)' }} />
        </button>
      )}
    </div>
  );
}
