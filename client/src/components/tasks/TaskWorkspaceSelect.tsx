import type { TaskViewCount, TaskViewMeta } from '@/types';

/** The same workspace navigation is available when the rail is hidden. */
export const TaskWorkspaceSelect = ({ views, counts, viewId, onSelectView }: {
  views: TaskViewMeta[];
  counts?: Record<string, TaskViewCount>;
  viewId: string;
  onSelectView: (id: string) => void;
}) => (
  <select
    value={viewId}
    onChange={(event) => onSelectView(event.target.value)}
    className="rounded-lg px-2 py-1 text-[12px] md:hidden"
    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    aria-label="Task view"
  >
    {views.map((view) => {
      const count = counts?.[view.id]?.count;
      return <option key={view.id} value={view.id}>{count ? `${view.name} (${count})` : view.name}</option>;
    })}
  </select>
);
