import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { useTaskLabels } from '@/hooks/useTaskLabels';
import { taskLabelDisplayName } from '@/types';
import { labelChipStyle } from './label-colors';

export function TaskLabelChip({ name, color, onRemove }: { name: string; color?: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={labelChipStyle(color)}
    >
      <Tag size={9} className="opacity-60" />
      {taskLabelDisplayName(name)}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label={`Remove label ${name}`}
        >
          <X size={9} />
        </button>
      )}
    </span>
  );
}

interface TaskLabelPickerProps {
  labels: string[];
  onChange: (labels: string[]) => void;
  disabled?: boolean;
}

/**
 * Phase 3 (P3-D13): chip picker with typeahead over the `task_labels`
 * registry. Typing a new name offers to create+assign it (the server
 * auto-registers unregistered names on PATCH /tasks).
 */
export function TaskLabelPicker({ labels, onChange, disabled = false }: TaskLabelPickerProps) {
  const registry = useTaskLabels();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const label of registry.data?.labels ?? []) map.set(label.name, label.color);
    return map;
  }, [registry.data]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setDraft('');
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setDraft('');
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const normalizedDraft = draft.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const selected = new Set(labels);
    return (registry.data?.labels ?? [])
      .filter((label) => !selected.has(label.name))
      .filter((label) => !normalizedDraft || label.name.includes(normalizedDraft) || taskLabelDisplayName(label.name).includes(normalizedDraft))
      .slice(0, 8);
  }, [labels, normalizedDraft, registry.data]);

  const canCreate = Boolean(
    normalizedDraft &&
      /^[a-z0-9][a-z0-9:_-]{0,49}$/.test(normalizedDraft) &&
      !labels.includes(normalizedDraft) &&
      !suggestions.some((label) => label.name === normalizedDraft),
  );

  const add = (name: string) => {
    const next = name.trim().toLowerCase();
    if (!next || labels.includes(next)) return;
    onChange([...labels, next]);
    setDraft('');
  };

  if (disabled) {
    if (!labels.length) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {labels.map((name) => (
          <TaskLabelChip key={name} name={name} color={colorByName.get(name)} />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {labels.map((name) => (
          <TaskLabelChip
            key={name}
            name={name}
            color={colorByName.get(name)}
            onRemove={() => onChange(labels.filter((l) => l !== name))}
          />
        ))}
        <input
          type="text"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (suggestions[0]) add(suggestions[0].name);
              else if (canCreate) add(normalizedDraft);
            }
            if (event.key === 'Backspace' && !draft && labels.length) {
              onChange(labels.slice(0, -1));
            }
          }}
          placeholder={labels.length ? '' : 'Add label…'}
          className="min-w-[72px] flex-1 rounded-md bg-transparent px-1 py-0.5 text-[12px] outline-none"
          style={{ color: 'var(--text-primary)' }}
          aria-label="Add a label"
        />
      </div>
      {open && (suggestions.length > 0 || canCreate) && (
        <div
          className="absolute z-20 mt-1 w-full min-w-[200px] overflow-hidden rounded-lg border py-1"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)' }}
          role="listbox"
        >
          {suggestions.map((label) => (
            <button
              key={label.name}
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:brightness-110"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => add(label.name)}
            >
              <TaskLabelChip name={label.name} color={label.color} />
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:brightness-110"
              style={{ color: 'var(--accent)' }}
              onClick={() => add(normalizedDraft)}
            >
              <Plus size={11} />
              Create "{normalizedDraft}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
