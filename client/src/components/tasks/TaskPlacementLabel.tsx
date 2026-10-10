import type { TaskPlacementContext } from '@/types';
/**
 * "Project / Track". docs/73 UXD-12: `scope` drops what the list already says — inside a
 * project only the track shows, and inside a track nothing does.
 */
export function TaskPlacementLabel({ placement, scope = 'none' }: { placement?: TaskPlacementContext | null; scope?: 'none' | 'project' | 'track' }) {
  if (!placement || scope === 'track') return null;
  if (scope === 'project') {
    if (!placement.trackName) return null;
    return (
      <span className="task-placement-label block truncate text-ui leading-4" style={{ color: 'var(--text-muted)' }} title={`${placement.projectName} / ${placement.trackName}`}>
        {placement.trackName}
      </span>
    );
  }
  return (
    <span
      className="task-placement-label block truncate text-ui leading-4"
      style={{ color: 'var(--text-muted)' }}
      title={`${placement.projectName}${placement.trackName ? ` / ${placement.trackName}` : ''}`}
    >
      {placement.projectName}
      {placement.trackName ? ` / ${placement.trackName}` : ''}
    </span>
  );
}
