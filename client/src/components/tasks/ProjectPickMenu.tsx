import { useProject, useProjects } from '@/hooks/useProjects';
import { useLocalDate } from '@/hooks/useLocalDate';
import { MenuDivider, MenuItem, TaskPopover } from '@/components/ui/Popover';
import type { TaskPlacement } from '@/types';

/**
 * docs/73 UXD-16: pick a project (or one of its tracks) in one click — the row menu's
 * "Project ▸" flyout and the drawer's Project property both use it. "More options…" opens
 * the Move dialog for subtasks and bulk moves.
 */
export function ProjectPickMenu({
  anchor,
  current,
  onPick,
  onMore,
  onClose,
  placement = 'below',
}: {
  anchor: HTMLElement | null;
  current: TaskPlacement | null | undefined;
  onPick: (placement: TaskPlacement | null) => void;
  onMore?: () => void;
  onClose: () => void;
  placement?: 'below' | 'side';
}) {
  const today = useLocalDate();
  const projects = useProjects(today);
  const list = (projects.data?.projects ?? []).filter((project) => !project.archivedAt);
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Move to project" width={240} placement={placement}>
      <MenuItem role="menuitemradio" checked={!current} label="No project" onSelect={() => onPick(null)} />
      {list.length === 0 && !projects.isLoading && (
        <p className="px-2 py-1.5 text-ui" style={{ color: 'var(--text-muted)' }}>No projects yet.</p>
      )}
      {list.map((project) => (
        <ProjectChoices key={project.id} projectId={project.id} name={project.name} today={today} current={current} onPick={onPick} />
      ))}
      {onMore && (
        <>
          <MenuDivider />
          <MenuItem label="More options…" onSelect={onMore} />
        </>
      )}
    </TaskPopover>
  );
}

function ProjectChoices({ projectId, name, today, current, onPick }: {
  projectId: number;
  name: string;
  today: string;
  current: TaskPlacement | null | undefined;
  onPick: (placement: TaskPlacement | null) => void;
}) {
  const detail = useProject(projectId, today);
  const tracks = (detail.data?.tracks ?? []).filter((track) => !track.archivedAt);
  return (
    <>
      <MenuItem role="menuitemradio" checked={current?.projectId === projectId && !current.trackId} label={name} onSelect={() => onPick({ projectId, trackId: null })} />
      {tracks.map((track) => (
        <MenuItem
          key={track.id}
          role="menuitemradio"
          checked={current?.projectId === projectId && current.trackId === track.id}
          label={<span className="pl-3" style={{ color: 'var(--text-secondary)' }}><span className="sr-only">{name}, </span>{track.name}</span>}
          onSelect={() => onPick({ projectId, trackId: track.id })}
        />
      ))}
    </>
  );
}
