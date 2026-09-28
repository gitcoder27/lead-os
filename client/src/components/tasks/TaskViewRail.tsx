import { useState } from 'react';
import { BookmarkPlus, Check, Pencil, Trash2, X } from 'lucide-react';
import type { TaskViewCount, TaskViewMeta } from '@/types';
import { FOCUS_RING } from './TaskDetailPrimitives';

/**
 * docs/49 §4: colored badges only on actionable views. docs/51 D1: a badge
 * takes the loudest tone of the rows it counts — red only when one of them
 * missed a `dueAt` deadline, amber for slipped plan dates — so the rail, the
 * group header, and the row always agree.
 */
function severityTone(count: TaskViewCount, fallback: string): string {
  if ((count.missed ?? 0) > 0) return 'var(--danger)';
  if (count.overdue > 0) return 'var(--warning)';
  return fallback;
}

function badgeStyle(viewId: string, count: TaskViewCount | undefined): { tone: string | null; value: number } {
  if (!count) return { tone: null, value: 0 };
  if (count.count === 0) return { tone: null, value: 0 };
  switch (viewId) {
    case 'inbox': return { tone: 'var(--accent)', value: count.count };
    case 'today': return { tone: severityTone(count, 'var(--accent)'), value: count.count };
    case 'attention': return { tone: severityTone(count, 'var(--warning)'), value: count.count };
    default: return { tone: null, value: count.count };
  }
}

export function TaskViewRail({
  views,
  counts,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  onSaveView,
  saving,
  canSave,
}: {
  views: TaskViewMeta[];
  counts: Record<string, TaskViewCount> | undefined;
  selectedId: string;
  onSelect: (id: string) => void;
  /** docs/51 F10: commits the inline rename; return false to keep editing. */
  onRename: (view: TaskViewMeta, name: string) => Promise<boolean>;
  onDelete: (view: TaskViewMeta) => void;
  onSaveView: (name: string) => Promise<boolean>;
  saving: boolean;
  canSave: boolean;
}) {
  const plan = views.filter((view) => view.builtin && view.section !== 'review');
  const review = views.filter((view) => view.builtin && view.section === 'review');
  const saved = views.filter((view) => !view.builtin);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const commitRename = async (view: TaskViewMeta) => {
    if (await onRename(view, editingName)) setEditingId(null);
  };

  const renderItems = (items: TaskViewMeta[]) => (
    <ul className="space-y-px">
      {items.map((view) => {
        const selected = view.id === selectedId;
        const { tone, value } = badgeStyle(view.id, counts?.[view.id]);
        if (editingId === view.id) {
          return (
            <li key={view.id} className="flex items-center rounded-lg px-1 py-0.5">
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await commitRename(view);
                }}
              >
                <input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => { void commitRename(view); }}
                  aria-label={`Rename ${view.name}`}
                  className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[12.5px] ${FOCUS_RING}`}
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-active)' }}
                />
                <button type="submit" disabled={!editingName.trim()} className="flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-40" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }} aria-label="Save name">
                  <Check size={12} />
                </button>
                <button type="button" onClick={() => setEditingId(null)} className="flex h-6 w-6 items-center justify-center rounded-md" style={{ color: 'var(--text-muted)' }} aria-label="Cancel rename">
                  <X size={12} />
                </button>
              </form>
            </li>
          );
        }
        return (
          <li key={view.id} className="group flex items-center rounded-lg" style={{ background: selected ? 'var(--accent-glow)' : 'transparent' }}>
            <button
              type="button"
              onClick={() => onSelect(view.id)}
              aria-current={selected ? 'page' : undefined}
              aria-label={counts?.[view.id] ? `${view.name}, ${value} task${value === 1 ? '' : 's'}` : view.name}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition-colors hover:text-[var(--text-primary)]"
              style={{ color: selected ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: selected ? 600 : 500 }}
            >
              <span className="truncate">{view.name}</span>
              <span className="flex-1" />
              {value > 0 && (
                <span
                  className={`min-w-[20px] rounded-full px-1.5 text-center text-[11px] tabular-nums ${tone ? 'font-bold' : 'font-medium'}`}
                  style={{
                    color: tone ?? 'var(--text-muted)',
                    background: tone ? `color-mix(in srgb, ${tone} 16%, transparent)` : 'transparent',
                  }}
                >
                  {value}
                </span>
              )}
            </button>
            {!view.builtin && (
              <span className="hidden shrink-0 items-center pr-1 group-hover:flex group-focus-within:flex">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(view.id);
                    setEditingName(view.name);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label={`Rename ${view.name}`}
                >
                  <Pencil size={10} />
                </button>
                <button type="button" onClick={() => onDelete(view)} className="flex h-5 w-5 items-center justify-center rounded" style={{ color: 'var(--text-muted)' }} aria-label={`Delete ${view.name}`}>
                  <Trash2 size={10} />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );

  const heading = (text: string) => (
    <p className="px-2 pb-1.5 pt-5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>{text}</p>
  );

  return (
    <nav
      className="hidden w-56 shrink-0 flex-col overflow-y-auto px-3 py-4 md:flex"
      style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
      aria-label="Task views"
    >
      {renderItems(plan)}
      {review.length > 0 && (<>{heading('Review')}{renderItems(review)}</>)}
      {saved.length > 0 && (<>{heading('My views')}{renderItems(saved)}</>)}
      {naming ? (
        <form
          className="mt-3 flex items-center gap-1.5 px-1"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            if (await onSaveView(name.trim())) {
              setNaming(false);
              setName('');
            }
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setNaming(false); }}
            placeholder="View name"
            className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="Saved view name"
          />
          <button type="submit" disabled={!name.trim() || saving} className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }} aria-label="Save view">
            <Check size={12} />
          </button>
          <button type="button" onClick={() => setNaming(false)} className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Cancel save">
            <X size={12} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={!canSave}
          className="mt-4 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors hover:brightness-110 disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          <BookmarkPlus size={12} />
          Save current view
        </button>
      )}
    </nav>
  );
}
