import type { TaskViewCount, TaskViewMeta } from '@/types';
import { Select } from '@/components/ui/Select';

/** The same workspace navigation is available when the rail is hidden. */
export const TaskWorkspaceSelect = ({ views, counts, viewId, onSelectView }: {
  views: TaskViewMeta[];
  counts?: Record<string, TaskViewCount>;
  viewId: string;
  onSelectView: (id: string) => void;
}) => (
  <Select size="sm" className="md:hidden"
    value={viewId}
    onChange={(event) => onSelectView(event.target.value)}
    aria-label="Task view"
  >
    {views.map((view) => {
      const count = counts?.[view.id]?.count;
      return <option key={view.id} value={view.id}>{count ? `${view.name} (${count})` : view.name}</option>;
    })}
  </Select>
);
