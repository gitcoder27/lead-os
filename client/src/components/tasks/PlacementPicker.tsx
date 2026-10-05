import { useState } from 'react';
import { useProject, useProjects } from '@/hooks/useProjects';
import type { TaskPlacement } from '@/types';
import { PROJECT_CONTROL, PROJECT_STYLE } from './ProjectEditor';
export function PlacementPicker({ value, onChange, today }: { value: TaskPlacement | null | undefined; onChange: (value: TaskPlacement | null) => void; today: string }) {
  const projects = useProjects(today);
  const detail = useProject(value?.projectId, today);
  const [search, setSearch] = useState('');
  const options = projects.data?.projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="flex flex-col gap-2">
    <label className="flex flex-col gap-1 text-sm">Find project<input className={PROJECT_CONTROL} style={PROJECT_STYLE} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" /></label>
    <label className="flex flex-col gap-1 text-sm">Project<select className={PROJECT_CONTROL} style={PROJECT_STYLE} value={value?.projectId ?? ''} onChange={(event) => onChange(event.target.value ? { projectId: Number(event.target.value), trackId: null } : null)}><option value="">No project</option>{options.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}{value && !options.some((project) => project.id === value.projectId) && <option value={value.projectId}>{detail.data?.project.name ?? 'Selected project'}{detail.data?.project.archivedAt ? ' · Archived' : ''}</option>}</select></label>
    {value && <label className="flex flex-col gap-1 text-sm">Track<select className={PROJECT_CONTROL} style={PROJECT_STYLE} value={value.trackId ?? ''} onChange={(event) => onChange({ projectId: value.projectId, trackId: event.target.value ? Number(event.target.value) : null })}><option value="">No track</option>{detail.data?.tracks.filter((track) => !track.archivedAt).map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>}
    {(projects.error || detail.error) && <p role="alert">Could not load placement options.</p>}
  </div>;
}
