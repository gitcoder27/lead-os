import type { TaskPlacementContext } from '@/types';
export function TaskPlacementLabel({ placement }: { placement?: TaskPlacementContext | null }) {
  if (!placement) return null;
  return (
    <span
      className="block truncate text-xs"
      style={{ color: 'var(--text-muted)' }}
      title={`${placement.projectName}${placement.trackName ? ` / ${placement.trackName}` : ''}`}
    >
      {placement.projectName}
      {placement.trackName ? ` / ${placement.trackName}` : ''}
    </span>
  );
}
