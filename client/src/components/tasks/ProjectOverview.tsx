import { ChevronRight, Layers, Pencil, Plus } from 'lucide-react';
import type { Project, ProjectDetail, ProjectFacts, ProjectTrack } from '@/types';
import { ProjectFactsRow } from './ProjectFactsRow';

export const ProjectOverview = ({ detail, trackId, archived, onNavigate, onArchiveFilter, onEdit, onArchive, openTask }: {
  detail: ProjectDetail;
  trackId?: number;
  archived: boolean;
  onNavigate: (project?: number, track?: number) => void;
  onArchiveFilter: (archived: boolean) => void;
  onEdit: (item?: Project | ProjectTrack, projectId?: number) => void;
  onArchive: (item: Project | ProjectTrack, facts: ProjectFacts, projectId?: number) => void;
  openTask: (key: string) => void;
}) => {
  const { project } = detail;
  const track = detail.tracks.find((entry) => entry.id === trackId);
  const item = track ?? project;
  const facts = track?.facts ?? detail.facts;
  const isArchived = Boolean(project.archivedAt || item.archivedAt);
  const tracks = detail.tracks.filter((entry) => !entry.archivedAt || Boolean(project.archivedAt) || archived);
  return (
    <section className="project-page" aria-label={track ? 'Track overview' : 'Project overview'}>
      <nav aria-label="Project breadcrumbs" className="project-breadcrumb">
        <button onClick={() => onNavigate()}>Projects</button><ChevronRight size={12} aria-hidden="true" />
        {track ? <><button onClick={() => onNavigate(project.id)}>{project.name}</button><ChevronRight size={12} aria-hidden="true" /><span aria-current="page">{track.name}</span></> : <span aria-current="page">{project.name}</span>}
      </nav>
      <div className="project-controls mt-5 flex flex-wrap items-start justify-between gap-3 max-sm:flex-col">
        <div className="min-w-0 flex-1">
          <p className="project-caption mb-1">{track ? 'Track' : 'Project'}{isArchived ? ' · Archived' : ''}</p>
          <h1 className="project-heading">{item.name}</h1>
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="ui-btn-quiet" onClick={() => onEdit(item, track?.projectId)}><Pencil size={12} aria-hidden="true" /> Edit details</button>
          <button className="ui-btn-quiet" onClick={() => onArchive(item, facts, track?.projectId)}>{item.archivedAt ? 'Restore' : 'Archive'}</button>
        </div>
      </div>
      {item.outcome && <div className="mt-4 max-w-[72ch]"><p className="project-caption">Outcome</p><p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed">{item.outcome}</p></div>}
      <div className="mt-4"><ProjectFactsRow facts={facts} openTask={openTask} /></div>
      {isArchived && <p className="project-caption mt-3">Open tasks stay actionable. {project.archivedAt && track ? 'Restore the project to add tasks or tracks.' : `Restore this ${track ? 'track' : 'project'} to add new tasks${track ? '.' : ' or tracks.'}`}</p>}
      {item.summary && (
        <details className="project-summary">
          <summary>Latest summary{item.summaryUpdatedAt && <span className="ml-2 project-caption">Updated {new Date(item.summaryUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</summary>
          <p>{item.summary}</p>
        </details>
      )}
      {!track && (
        <section className="project-tracks" aria-label="Tracks">
          <div className="project-controls flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Layers size={14} aria-hidden="true" /><h2 className="text-[13px] font-semibold">Tracks</h2><span className="project-caption">Optional</span></div>
            {!isArchived && <button className="ui-btn-quiet" onClick={() => onEdit(undefined, project.id)}><Plus size={13} aria-hidden="true" /> New track</button>}
          </div>
          {tracks.length ? (
            <ul className="project-track-list">
              {tracks.map((entry) => (
                <li className="project-track" key={entry.id}>
                  <button className="project-open" onClick={() => onNavigate(project.id, entry.id)}>{entry.name}<ChevronRight size={14} aria-hidden="true" /></button>
                  {entry.archivedAt && <p className="project-caption mt-1">Archived</p>}
                  <div className="mt-2"><ProjectFactsRow facts={entry.facts} openTask={openTask} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="project-caption mt-2">{isArchived ? 'No tracks in this project.' : 'Add tasks directly below. Use tracks to group work, such as Design or Rollout.'}</p>}
          {detail.tracks.some((entry) => entry.archivedAt) && !project.archivedAt && <label className="project-caption mt-3 flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent-solid)]" checked={archived} onChange={(event) => onArchiveFilter(event.target.checked)} />Show archived tracks</label>}
        </section>
      )}
    </section>
  );
};
