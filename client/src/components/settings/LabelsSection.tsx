import { useMemo, useState } from 'react';
import { Check, Loader2, Lock, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useCreateTaskLabel, useDeleteTaskLabel, useTaskLabels, useUpdateTaskLabel } from '@/hooks/useTaskLabels';
import { TASK_LABEL_COLORS, taskLabelDisplayName, type TaskLabel, type TaskLabelColor } from '@/types';
import { labelChipStyle } from '@/components/tasks/label-colors';
import { TaskLabelChip } from '@/components/tasks/TaskLabelPicker';

/**
 * Phase 3 (P3-D13): the label manager — add, rename, recolor, delete. System
 * labels are locked: `category:follow_up` feeds the Follow-ups predicate and
 * `kind:*`/`priority:*` back existing semantics.
 */
export function LabelsSection() {
  const { addToast } = useToast();
  const labels = useTaskLabels();
  const createLabel = useCreateTaskLabel();
  const updateLabel = useUpdateTaskLabel();
  const deleteLabel = useDeleteTaskLabel();

  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<TaskLabelColor>('slate');
  const [editing, setEditing] = useState<{ name: string; draft: string } | null>(null);

  const rows = useMemo(() => labels.data?.labels ?? [], [labels.data]);

  const handleCreate = () => {
    const name = draftName.trim();
    if (!name || createLabel.isPending) return;
    createLabel.mutate(
      { name, color: draftColor },
      {
        onSuccess: () => setDraftName(''),
        onError: (error) => addToast({ type: 'error', title: 'Could not create label', message: error.message }),
      },
    );
  };

  const handleRename = (label: TaskLabel) => {
    const next = editing?.draft.trim();
    if (!next || updateLabel.isPending) {
      setEditing(null);
      return;
    }
    updateLabel.mutate(
      { name: label.name, rename: next },
      {
        onSuccess: () => {
          setEditing(null);
          addToast({ type: 'success', title: 'Label renamed', message: `Every task labelled "${label.name}" now uses the new name.` });
        },
        onError: (error) => addToast({ type: 'error', title: 'Could not rename label', message: error.message }),
      },
    );
  };

  const handleDelete = (label: TaskLabel) => {
    if (deleteLabel.isPending) return;
    deleteLabel.mutate(label.name, {
      onSuccess: () => addToast({ type: 'success', title: `Deleted label "${taskLabelDisplayName(label.name)}"` }),
      onError: (error) => addToast({ type: 'error', title: 'Could not delete label', message: error.message }),
    });
  };

  return (
    <div className="max-w-[680px]">
      {/* Add row */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Tag size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreate();
            }}
            placeholder="New label name…"
            aria-label="New label name"
            className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
            style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
          />
        </div>
        <ColorSwatches value={draftColor} onChange={setDraftColor} aria-label="New label color" />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!draftName.trim() || createLabel.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40"
          style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
        >
          {createLabel.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Add
        </button>
      </div>

      {/* Label list */}
      <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
        {labels.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={13} className="animate-spin" />
            Loading labels…
          </div>
        ) : labels.isError ? (
          <div className="px-4 py-5 text-[13px]" style={{ color: 'var(--danger)' }}>
            Labels are unavailable{labels.error instanceof Error ? `: ${labels.error.message}` : '.'}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No labels yet — add one above, or assign one from a task.
          </div>
        ) : (
          rows.map((label, index) => (
            <div
              key={label.name}
              className="flex items-center gap-3 px-3 py-2"
              style={{
                background: index % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)',
                borderTop: index > 0 ? 'var(--settings-row-divider)' : 'none',
              }}
            >
              {editing?.name === label.name ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={editing.draft}
                    onChange={(event) => setEditing({ name: label.name, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleRename(label);
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[12.5px] outline-none"
                    style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                    aria-label={`Rename ${label.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => handleRename(label)}
                    className="flex shrink-0 items-center rounded-md px-2 py-1 text-[11.5px] font-semibold"
                    style={{ background: 'var(--settings-success-soft-bg)', color: 'var(--success)', border: 'var(--settings-success-soft-border)' }}
                    aria-label="Save rename"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="flex shrink-0 items-center rounded-md px-2 py-1 text-[11.5px] font-semibold"
                    style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
                    aria-label="Cancel rename"
                  >
                    <X size={11} />
                  </button>
                </>
              ) : (
                <>
                  <TaskLabelChip name={label.name} color={label.color} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {label.name}
                  </span>
                  {label.system && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em]"
                      style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
                      title={`"${taskLabelDisplayName(label.name)}" is a system label`}
                    >
                      <Lock size={9} />
                      System
                    </span>
                  )}
                  <ColorSwatches
                    compact
                    value={label.color as TaskLabelColor}
                    onChange={(color) =>
                      updateLabel.mutate(
                        { name: label.name, color },
                        { onError: (error) => addToast({ type: 'error', title: 'Could not recolor label', message: error.message }) },
                      )
                    }
                    aria-label={`Color for ${label.name}`}
                  />
                  {!label.system && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing({ name: label.name, draft: label.name })}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors"
                        style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
                        aria-label={`Rename label ${label.name}`}
                      >
                        <Pencil size={10} />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(label)}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors"
                        style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
                        aria-label={`Delete label ${label.name}`}
                      >
                        <Trash2 size={10} />
                        Delete
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      <p className="mt-2 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        Renaming a label rewrites it on every task. Deleting removes it from every task and the registry.
        System labels can be recolored but not renamed or deleted.
      </p>
    </div>
  );
}

function ColorSwatches({
  value,
  onChange,
  compact = false,
  'aria-label': ariaLabel,
}: {
  value: TaskLabelColor;
  onChange: (color: TaskLabelColor) => void;
  compact?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-1'}`} role="radiogroup" aria-label={ariaLabel}>
      {TASK_LABEL_COLORS.map((color) => {
        const style = labelChipStyle(color);
        const active = value === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={color}
            onClick={() => onChange(color)}
            className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} rounded-full transition-transform hover:scale-110`}
            style={{
              background: style.color as string,
              boxShadow: active ? `0 0 0 2px var(--bg-primary), 0 0 0 3.5px ${style.color as string}` : `0 0 0 1px ${style.color as string}`,
            }}
          />
        );
      })}
    </div>
  );
}
