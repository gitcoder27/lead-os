import type { Ref } from 'react';
import { Archive, ChevronRight, Folder, Plus, Search, X } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { ProjectFactsRow } from './ProjectFactsRow';

export const ProjectDirectory = ({ today, archived, query, searchRef, onQuery, onArchiveFilter, onNavigate, onCreate, openTask }: {
  today: string;
  archived: boolean;
  query: string;
  searchRef?: Ref<HTMLInputElement>;
  onQuery: (query: string) => void;
  onArchiveFilter: (archived: boolean) => void;
  onNavigate: (project: number) => void;
  onCreate: () => void;
  openTask: (key: string) => void;
}) => {
  const list = useProjects(today, archived);
  const entries = list.data?.projects.filter((entry) => `${entry.name} ${entry.outcome ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  return (
    <section className="project-page" aria-label="Project directory">
      <header className="project-controls flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="project-heading">Projects</h1>
          <p className="project-caption mt-2">Keep an outcome and its next actions together.</p>
        </div>
        <button className="ui-btn" onClick={onCreate}><Plus size={14} aria-hidden="true" /> New project</button>
      </header>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="ui-segment" role="group" aria-label="Project status">
          <button aria-pressed={!archived} onClick={() => onArchiveFilter(false)}>Active</button>
          <button aria-pressed={archived} onClick={() => onArchiveFilter(true)}>Archived</button>
        </div>
        <label className="project-search flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 max-sm:w-full" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <Search size={14} aria-hidden="true" />
          <input ref={searchRef} aria-label="Search projects" placeholder="Search projects…" value={query} onChange={(event) => onQuery(event.target.value)} className="min-w-0 bg-transparent text-[13px] outline-none" style={{ color: 'var(--text-primary)' }} />
          {query && <button className="ui-icon-btn" aria-label="Clear project search" onClick={() => onQuery('')}><X size={13} /></button>}
        </label>
      </div>
      {list.isLoading && <div className="project-loading animate-pulse motion-reduce:animate-none" role="status"><span className="sr-only">Loading projects…</span>{[0, 1, 2].map((key) => <span key={key} aria-hidden="true" />)}</div>}
      {list.error && <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 text-sm"><p>{list.error.message}</p><button className="ui-btn-secondary" onClick={() => void list.refetch()}>Try again</button></div>}
      {!list.isLoading && !list.error && entries.length === 0 && (
        <div className="project-empty">
          <span className="project-icon">{archived ? <Archive size={18} /> : <Folder size={18} />}</span>
          <h2 className="text-sm font-semibold">{query ? 'No matching projects' : archived ? 'No archived projects' : 'No projects yet'}</h2>
          <p className="project-caption">{query ? 'Try another name or outcome.' : archived ? 'Projects you archive will appear here. Their open tasks stay actionable.' : 'Start with an outcome. Add tasks directly, then use optional tracks to organize larger projects.'}</p>
          {query ? <button className="ui-btn" onClick={() => onQuery('')}>Clear search</button> : archived ? <button className="ui-btn" onClick={() => onArchiveFilter(false)}>View active projects</button> : <button className="ui-btn" onClick={onCreate}><Plus size={14} /> Create your first project</button>}
        </div>
      )}
      {entries.length > 0 && (
        <>
          <p className="project-caption mt-5" role="status">{entries.length} {query ? 'matching ' : ''}{archived ? 'archived ' : ''}{entries.length === 1 ? 'project' : 'projects'}</p>
          <ul className="mt-2">
            {entries.map((entry) => (
              <li className="project-row" key={entry.id}>
                <span className="project-icon" aria-hidden="true"><Folder size={17} /></span>
                <div className="min-w-0">
                  <button className="project-open" onClick={() => onNavigate(entry.id)}>{entry.name}<ChevronRight size={15} aria-hidden="true" /></button>
                  {entry.outcome && <p className="project-caption mt-1 truncate" title={entry.outcome}>{entry.outcome}</p>}
                  <div className="mt-2"><ProjectFactsRow facts={entry.facts} openTask={openTask} /></div>
                </div>
                {entry.archivedAt && <span className="project-caption">Archived</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
