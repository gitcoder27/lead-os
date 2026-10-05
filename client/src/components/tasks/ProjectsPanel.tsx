import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useProject, useProjects, useProjectWrites } from '@/hooks/useProjects';
import type { Project, ProjectFacts, ProjectTrack } from '@/types';
import { ProjectEditor, PROJECT_CONTROL, PROJECT_STYLE } from './ProjectEditor';
const Facts = ({ facts, openTask }: { facts: ProjectFacts; openTask: (key: string) => void }) => <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
  <span>{facts.open} open</span><span>{facts.blocked} blocked</span><span>{facts.overdue} overdue</span><span>{facts.followUpDue} follow-ups due</span>
  {facts.nextCheck ? <button className="underline" onClick={() => openTask(facts.nextCheck!.taskKey)}>Check {new Date(facts.nextCheck.at).toLocaleDateString()} · {facts.nextCheck.taskKey}</button> : <span>No check scheduled</span>}
</div>;
export function ProjectsPanel({ today, projectId, trackId, archived, onNavigate, onArchiveFilter, openTask }: { today: string; projectId?: number; trackId?: number; archived: boolean; onNavigate: (project?: number, track?: number) => void; onArchiveFilter: (archived: boolean) => void; openTask: (key: string) => void }) {
  const list = useProjects(today, archived);
  const detail = useProject(projectId, today);
  const write = useProjectWrites();
  const [edit, setEdit] = useState<{ item?: Project | ProjectTrack; projectId?: number } | null>(null);
  const [archive, setArchive] = useState<{ item: Project | ProjectTrack; projectId?: number; facts: ProjectFacts } | null>(null);
  const project = detail.data?.project;
  const track = detail.data?.tracks.find((entry) => entry.id === trackId);
  const item = track ?? project;
  const facts = track?.facts ?? detail.data?.facts;
  return <div className="space-y-4 border-b px-4 py-5 sm:px-6" style={{ borderColor: 'var(--border)' }}>
    {!projectId ? <>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Projects</h2><div className="flex gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(event) => onArchiveFilter(event.target.checked)} />Archived</label><button className={PROJECT_CONTROL} style={PROJECT_STYLE} onClick={() => setEdit({})}>New project</button></div></div>
      {list.isLoading && <p role="status">Loading projects…</p>}
      {list.error && <p role="alert">{list.error.message}</p>}
      {list.data?.projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No {archived ? 'archived ' : ''}projects yet. Organize an outcome with its next actions.</p>}
      <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>{list.data?.projects.map((entry) => <li key={entry.id} className="space-y-2 py-4"><button className="text-left font-medium underline decoration-transparent hover:decoration-current" onClick={() => onNavigate(entry.id)}>{entry.name}</button>{entry.outcome && <p className="text-sm">{entry.outcome}</p>}<Facts facts={entry.facts} openTask={openTask} /></li>)}</ul>
    </> : <>
      <nav aria-label="Project breadcrumbs" className="flex flex-wrap gap-2 text-sm"><button className="underline" onClick={() => onNavigate()}>Projects</button>{project && <><span>/</span><button className="underline" onClick={() => onNavigate(project.id)}>{project.name}</button></>}{track && <><span>/</span><span>{track.name}</span></>}</nav>
      {detail.isLoading && <p role="status">Loading project…</p>}
      {(detail.isError || (trackId && detail.data && !track)) && <p role="alert">Project or track unavailable.</p>}
      {item && !(trackId && !track) && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{item.name}{(project?.archivedAt || item.archivedAt) && <span className="ml-2 text-xs">Archived</span>}</h2><div className="flex gap-2"><button className={PROJECT_CONTROL} style={PROJECT_STYLE} onClick={() => setEdit({ item, projectId: track?.projectId })}>Edit</button><button className={PROJECT_CONTROL} style={PROJECT_STYLE} onClick={() => setArchive({ item, projectId: track?.projectId, facts: facts! })}>{item.archivedAt ? 'Restore' : 'Archive'}</button>{!track && !project?.archivedAt && <button className={PROJECT_CONTROL} style={PROJECT_STYLE} onClick={() => setEdit({ projectId })}>New track</button>}</div></div>
        {item.outcome && <p className="text-sm whitespace-pre-wrap">{item.outcome}</p>}
        {item.summary && <div className="space-y-1"><p className="text-sm whitespace-pre-wrap">{item.summary}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Summary · {item.summaryUpdatedAt && new Date(item.summaryUpdatedAt).toLocaleString()}</p></div>}
        {facts && <Facts facts={facts} openTask={openTask} />}
        {!trackId && <ul className="space-y-3">{detail.data?.tracks.filter((entry) => !entry.archivedAt || Boolean(project?.archivedAt) || archived).map((entry) => <li key={entry.id} className="space-y-1"><button className="text-sm underline" onClick={() => onNavigate(projectId, entry.id)}>{entry.name}{entry.archivedAt ? ' · Archived' : ''}</button>{entry.facts.open === 0 ? <p className="text-xs">No tasks yet</p> : <Facts facts={entry.facts} openTask={openTask} />}</li>)}<li><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={archived} onChange={(event) => onArchiveFilter(event.target.checked)} />Show archived tracks</label></li></ul>}
      </>}
    </>}
    {edit && <ProjectEditor {...edit} onClose={() => setEdit(null)} />}
    {archive && <Dialog title={`${archive.item.archivedAt ? 'Restore' : 'Archive'} ${archive.item.name}`} onClose={() => setArchive(null)} footer={<button className={PROJECT_CONTROL} style={PROJECT_STYLE} disabled={write.isPending} onClick={() => write.mutate({ id: archive.item.id, projectId: archive.projectId, track: Boolean(archive.projectId), changes: { archived: !archive.item.archivedAt } }, { onSuccess: () => setArchive(null) })}>{archive.item.archivedAt ? 'Restore' : 'Archive'}</button>}><p>{archive.facts.open} open tasks remain actionable.</p>{!archive.item.archivedAt && <p className="mt-2 text-sm">This container will stop accepting new tasks.</p>}{write.error && <p role="alert">{write.error.message}</p>}</Dialog>}
  </div>;
}
