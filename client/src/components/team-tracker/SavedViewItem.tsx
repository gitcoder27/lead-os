import { Pencil, Trash2 } from 'lucide-react';
import type { TeamTrackerSavedView } from '@/types';
import type { SavedViewOption } from './SavedViewsMenu';

const sortLabels: Record<string, string> = {
  name: 'Name',
  attention: 'Attention',
  stale_age: 'Stale',
  load: 'Load',
  blocked_first: 'Blocked',
};

const groupLabels: Record<string, string> = {
  none: '',
  status: 'Status',
  attention_state: 'Attention',
};

export function describeTeamTrackerView(view: TeamTrackerSavedView): string | undefined {
  const parts: string[] = [];
  if (view.q) parts.push(`"${view.q}"`);
  if (view.summaryFilter !== 'all') parts.push(view.summaryFilter.replace(/_/g, ' '));
  if (view.sortBy !== 'name') parts.push(`sort: ${sortLabels[view.sortBy] ?? view.sortBy}`);
  if (view.groupBy !== 'none') parts.push(`group: ${groupLabels[view.groupBy] ?? view.groupBy}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function SavedViewItemDescription({ description }: { description?: string }) {
  if (!description) return null;

  return (
    <div className="text-[12px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
      {description}
    </div>
  );
}

interface SavedViewItemProps {
  view: SavedViewOption;
  isActive: boolean;
  isDeleting: boolean;
  onApply: () => void;
  onStartRename: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

export function SavedViewItem({
  view,
  isActive,
  isDeleting,
  onApply,
  onStartRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: SavedViewItemProps) {
  if (isDeleting) {
    return (
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'color-mix(in srgb, var(--danger) 6%, transparent)' }}
      >
        <span className="text-[12px]" style={{ color: 'var(--danger)' }}>
          Delete &ldquo;{view.name}&rdquo;?
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onConfirmDelete}
            className="text-[12px] font-medium px-1.5 py-0.5 rounded"
            style={{ color: 'var(--danger)' }}
          >
            Delete
          </button>
          <button
            onClick={onCancelDelete}
            className="text-[12px] px-1.5 py-0.5 rounded"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
      style={{
        background: isActive ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
      }}
      onClick={onApply}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: isActive ? 'var(--accent)' : 'transparent' }}
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-medium truncate"
          style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {view.name}
        </div>
        <SavedViewItemDescription description={view.description} />
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onStartRename(); }}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="Rename"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onStartDelete(); }}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
