import { useState } from 'react';
import { Folder } from 'lucide-react';
import type { ManagerTask } from '@/types';
import { useQuickPlacement } from '@/hooks/useQuickPlacement';
import { PropertyButton, PropertyRow } from './TaskDetailPrimitives';
import { PlacementDialog } from './PlacementDialog';
import { ProjectPickMenu } from './ProjectPickMenu';

/** docs/73 UXD-16: the Project property opens a one-pick menu; "More options…" keeps the full dialog (subtasks). */
export function TaskProjectField({ task, readOnly }: { task: ManagerTask; readOnly: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <dl>
        <PropertyRow icon={<Folder size={14} />} label="Project">
          <PropertyButton ariaLabel="Change project" disabled={readOnly} popup="menu" expanded={Boolean(anchor)} onClick={(el) => setAnchor(anchor ? null : el)}>
            {task.placement
              ? `${task.placement.projectName}${task.placement.trackName ? ` / ${task.placement.trackName}` : ''}`
              : 'No project'}
          </PropertyButton>
        </PropertyRow>
      </dl>
      {anchor && (
        <ProjectFieldMenu
          anchor={anchor}
          task={task}
          onClose={() => setAnchor(null)}
          onMore={() => { setAnchor(null); setDialog(true); }}
        />
      )}
      {dialog && <PlacementDialog keys={[task.taskKey]} initial={task.placement} onClose={() => setDialog(false)} />}
    </>
  );
}

/** Mounted only while open, like the dialog it fronts, so the drawer itself needs no write hooks. */
function ProjectFieldMenu({ anchor, task, onClose, onMore }: { anchor: HTMLElement; task: ManagerTask; onClose: () => void; onMore: () => void }) {
  const { move } = useQuickPlacement();
  return (
    <ProjectPickMenu
      anchor={anchor}
      current={task.placement}
      onClose={onClose}
      onPick={(placement) => { onClose(); void move([task.taskKey], placement); }}
      onMore={onMore}
    />
  );
}
