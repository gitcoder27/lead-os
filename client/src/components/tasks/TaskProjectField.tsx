import { useState } from 'react';
import { Folder } from 'lucide-react';
import type { ManagerTask } from '@/types';
import { PropertyButton, PropertyRow } from './TaskDetailPrimitives';
import { PlacementDialog } from './PlacementDialog';
export function TaskProjectField({ task, readOnly }: { task: ManagerTask; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return <><dl><PropertyRow icon={<Folder size={14} />} label="Project"><PropertyButton ariaLabel="Change project" disabled={readOnly} onClick={() => setOpen(true)}>{task.placement ? `${task.placement.projectName}${task.placement.trackName ? ` / ${task.placement.trackName}` : ''}` : 'No project'}</PropertyButton></PropertyRow></dl>{open && <PlacementDialog keys={[task.taskKey]} initial={task.placement} onClose={() => setOpen(false)} />}</>;
}
