import { useState, type Ref } from 'react';
import { useProject } from '@/hooks/useProjects';
import type { Project, ProjectTrack } from '@/types';
import { ProjectEditor } from './ProjectEditor';
import { ProjectDirectory } from './ProjectDirectory';
import { ProjectOverview } from './ProjectOverview';
import { ProjectArchiveDialog, type ProjectArchiveTarget } from './ProjectArchiveDialog';
import './projects.css';

export function ProjectsPanel({ today, projectId, trackId, archived, query, searchRef, onQuery, onNavigate, onArchiveFilter, openTask }: {
  today: string;
  projectId?: number;
  trackId?: number;
  archived: boolean;
  query: string;
  searchRef?: Ref<HTMLInputElement>;
  onQuery: (query: string) => void;
  onNavigate: (project?: number, track?: number) => void;
  onArchiveFilter: (archived: boolean) => void;
  openTask: (key: string) => void;
}) {
  const detail = useProject(projectId, today);
  const [edit, setEdit] = useState<{ item?: Project | ProjectTrack; projectId?: number } | null>(null);
  const [archive, setArchive] = useState<ProjectArchiveTarget | null>(null);
  const unavailable = detail.isError || Boolean(trackId && detail.data && !detail.data.tracks.some((entry) => entry.id === trackId));
  return (
    <div className="projects-workspace">
      {!projectId ? <ProjectDirectory {...{ today, archived, query, searchRef, onQuery, onArchiveFilter, onNavigate, openTask }} onCreate={() => setEdit({})} /> : (
        <>
          {detail.isLoading && <div className="project-page" role="status"><p className="project-caption">Loading project…</p><div className="project-loading animate-pulse motion-reduce:animate-none"><span aria-hidden="true" /><span aria-hidden="true" /></div></div>}
          {unavailable && <div className="project-page space-y-3"><button className="ui-link" onClick={() => onNavigate()}>Back to projects</button><p role="alert" className="text-sm">Project or track unavailable.</p>{detail.isError && <button className="ui-btn-secondary" onClick={() => void detail.refetch()}>Try again</button>}</div>}
          {detail.data && !unavailable && <ProjectOverview detail={detail.data} {...{ trackId, archived, onNavigate, onArchiveFilter, openTask }} onEdit={(item, parent) => setEdit({ item, projectId: parent })} onArchive={(item, facts, parent) => setArchive({ item, facts, projectId: parent })} />}
        </>
      )}
      {edit && <ProjectEditor {...edit} onClose={() => setEdit(null)} onCreated={(created) => { setEdit(null); onNavigate(edit.projectId ?? created.id, edit.projectId ? created.id : undefined); }} />}
      {archive && <ProjectArchiveDialog {...archive} onClose={() => setArchive(null)} />}
    </div>
  );
}
