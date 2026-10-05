import { useId, useState } from 'react';
import { Folder, Search } from 'lucide-react';
import { useProject, useProjects } from '@/hooks/useProjects';
import type { TaskPlacement } from '@/types';
import './projects.css';

export function PlacementPicker({ value, onChange, today, disabled = false }: {
  value: TaskPlacement | null | undefined;
  onChange: (value: TaskPlacement | null) => void;
  today: string;
  disabled?: boolean;
}) {
  const projects = useProjects(today);
  const detail = useProject(value?.projectId, today);
  const [search, setSearch] = useState('');
  const groupId = useId();
  const options = projects.data?.projects.filter((project) => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  const selected = detail.data?.project;
  const selectedTrack = detail.data?.tracks.find((track) => track.id === value?.trackId);
  return (
    <div className="space-y-3">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-[13px] font-medium">Project</legend>
        <label className="project-search flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <Search size={14} aria-hidden="true" />
          <input aria-label="Search projects" placeholder="Search projects…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: 'var(--text-primary)' }} />
        </label>
        <div className="placement-options mt-2 max-h-52 overflow-y-auto rounded-lg border p-1" style={{ borderColor: 'var(--border)' }}>
          <label className="placement-option" data-selected={!value}>
            <input type="radio" name={groupId} checked={!value} onChange={() => onChange(null)} />
            <span className="min-w-0"><span className="block font-medium">No project</span><span className="project-field-hint">Keep tasks outside projects</span></span>
          </label>
          {options.map((project) => (
            <label key={project.id} className="placement-option" data-selected={value?.projectId === project.id}>
              <input type="radio" name={groupId} checked={value?.projectId === project.id} onChange={() => onChange({ projectId: project.id, trackId: null })} />
              <span className="min-w-0 flex-1"><span className="block break-words font-medium">{project.name}</span>{project.outcome && <span className="project-field-hint block truncate" title={project.outcome}>{project.outcome}</span>}</span>
              <Folder size={14} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
            </label>
          ))}
          {projects.isLoading && <p className="project-caption px-3 py-4" role="status">Loading projects…</p>}
          {!projects.isLoading && !projects.error && options.length === 0 && <p className="project-caption px-3 py-4" role="status">{search ? 'No matching projects. Try another name.' : 'No active projects. Create one in Tasks → Projects.'}</p>}
        </div>
      </fieldset>
      {value && (
        <div className="space-y-2">
          <p className="project-field-hint break-words">Selected: <strong style={{ color: 'var(--text-secondary)' }}>{selected?.name ?? 'Selected project'}</strong>{selected?.archivedAt ? ' · Archived' : ''}</p>
          <label className="flex flex-col gap-2 text-[13px] font-medium">
            Track (optional)
            <select aria-label="Track (optional)" className="ui-field" disabled={disabled || detail.isLoading || Boolean(selected?.archivedAt)} value={value.trackId ?? ''} onChange={(event) => onChange({ projectId: value.projectId, trackId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">No track · project only</option>
              {detail.data?.tracks.filter((track) => !track.archivedAt).map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              {value.trackId && (!selectedTrack || selectedTrack.archivedAt) && <option value={value.trackId} disabled>{selectedTrack?.name ?? 'Selected track'}{selectedTrack?.archivedAt ? ' · Archived' : ''}</option>}
            </select>
          </label>
          {detail.isLoading && <p className="project-field-hint" role="status">Loading tracks…</p>}
          {(selected?.archivedAt || selectedTrack?.archivedAt) && <p className="project-field-hint">Choose an active project or track to move tasks into it.</p>}
        </div>
      )}
      {(projects.error || detail.error) && <p role="alert" className="text-[13px]" style={{ color: 'var(--danger)' }}>Could not load projects or tracks. <button className="ui-link" onClick={() => { if (projects.error) void projects.refetch(); if (detail.error) void detail.refetch(); }}>Try again</button></p>}
    </div>
  );
}
