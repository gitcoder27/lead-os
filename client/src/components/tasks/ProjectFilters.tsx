import { useProjects, useProject } from '@/hooks/useProjects';
import type { TaskViewOverrides } from '@/lib/task-views';
import type { TaskViewDefinition } from '@/types';
import { PROJECT_CONTROL, PROJECT_STYLE } from './ProjectEditor';
const parse = (value: string): number | 'none' | 'all' => (value === 'none' || value === 'all' ? value : Number(value));
export function ProjectFilters({
  today,
  definition,
  onChange,
}: {
  today: string;
  definition?: TaskViewDefinition;
  onChange: (overrides: Partial<TaskViewOverrides>) => void;
}) {
  const projects = useProjects(today);
  const id = typeof definition?.filters?.project === 'number' ? definition.filters.project : undefined;
  const detail = useProject(id, today);
  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
      <label className="flex items-center gap-2 text-xs">
        Project
        <select
          aria-label="Project"
          className={PROJECT_CONTROL}
          style={PROJECT_STYLE}
          value={definition?.filters?.project ?? 'all'}
          onChange={(event) => onChange({ project: parse(event.target.value), track: 'all' })}
        >
          <option value="all">All projects</option>
          <option value="none">No project</option>
          {projects.data?.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
          {id && !projects.data?.projects.some((project) => project.id === id) && (
            <option value={id}>{detail.data?.project.name ?? 'Unavailable project'}</option>
          )}
        </select>
      </label>
      {id && (
        <label className="flex items-center gap-2 text-xs">
          Track
          <select
            aria-label="Track"
            className={PROJECT_CONTROL}
            style={PROJECT_STYLE}
            value={definition?.filters?.track ?? 'all'}
            onChange={(event) => onChange({ track: parse(event.target.value) })}
          >
            <option value="all">All tracks</option>
            <option value="none">No track</option>
            {detail.data?.tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
