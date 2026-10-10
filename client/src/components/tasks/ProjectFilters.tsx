import { useRef, useState } from 'react';
import { ChevronDown, FolderKanban } from 'lucide-react';
import { useProjects, useProject } from '@/hooks/useProjects';
import type { TaskViewOverrides } from '@/lib/task-views';
import type { TaskViewDefinition } from '@/types';
import { MenuDivider, MenuHeading, MenuItem, TaskPopover } from '@/components/ui/Popover';

const parse = (value: string): number | 'none' | 'all' => (value === 'none' || value === 'all' ? value : Number(value));

/**
 * docs/73 UXD-12: the Project (and Track) filter as one toolbar chip — "Project: All ▾" — instead
 * of a full-width band on every view. It writes the same `project`/`track` overrides, so URLs
 * (`?project=`) and saved views are unchanged. Hidden in a workspace without projects unless a
 * project filter is already applied.
 */
export function ProjectFilterChip({
  today,
  definition,
  onChange,
}: {
  today: string;
  definition?: TaskViewDefinition;
  onChange: (overrides: Partial<TaskViewOverrides>) => void;
}) {
  const projects = useProjects(today);
  const project = definition?.filters?.project ?? 'all';
  const track = definition?.filters?.track ?? 'all';
  const id = typeof project === 'number' ? project : undefined;
  const detail = useProject(id, today);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const list = projects.data?.projects ?? [];
  if (!list.length && project === 'all') return null;

  const projectName = id ? list.find((entry) => entry.id === id)?.name ?? detail.data?.project.name ?? 'Unavailable project' : project === 'none' ? 'No project' : 'All';
  const trackName = typeof track === 'number' ? detail.data?.tracks.find((entry) => entry.id === track)?.name : track === 'none' && id ? 'No track' : undefined;
  const label = trackName ? `${projectName} / ${trackName}` : projectName;
  const active = project !== 'all';
  const choose = (overrides: Partial<TaskViewOverrides>) => { onChange(overrides); setOpen(false); };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project filter: ${label}`}
        className="task-toolbar-chip flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg px-2 text-ui font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{ color: active ? 'var(--accent-text)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
      >
        <FolderKanban size={12} aria-hidden="true" />
        <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>Project:</span>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <TaskPopover anchor={buttonRef.current} onClose={() => setOpen(false)} label="Project filter" width={248}>
          <MenuHeading>Project</MenuHeading>
          <MenuItem role="menuitemradio" checked={project === 'all'} label="All projects" onSelect={() => choose({ project: 'all', track: 'all' })} />
          <MenuItem role="menuitemradio" checked={project === 'none'} label="No project" onSelect={() => choose({ project: 'none', track: 'all' })} />
          {list.map((entry) => (
            <MenuItem key={entry.id} role="menuitemradio" checked={id === entry.id} label={entry.name} onSelect={() => choose({ project: parse(String(entry.id)), track: 'all' })} />
          ))}
          {id && !list.some((entry) => entry.id === id) && (
            <MenuItem role="menuitemradio" checked label={detail.data?.project.name ?? 'Unavailable project'} onSelect={() => setOpen(false)} />
          )}
          {id && (detail.data?.tracks.length ?? 0) > 0 && (
            <>
              <MenuDivider />
              <MenuHeading>Track</MenuHeading>
              <MenuItem role="menuitemradio" checked={track === 'all'} label="All tracks" onSelect={() => choose({ track: 'all' })} />
              <MenuItem role="menuitemradio" checked={track === 'none'} label="No track" onSelect={() => choose({ track: 'none' })} />
              {detail.data?.tracks.map((entry) => (
                <MenuItem key={entry.id} role="menuitemradio" checked={track === entry.id} label={entry.name} onSelect={() => choose({ track: entry.id })} />
              ))}
            </>
          )}
        </TaskPopover>
      )}
    </>
  );
}
