import { Dialog } from '@/components/ui/Dialog';
import { useProjectWrites } from '@/hooks/useProjects';
import type { Project, ProjectFacts, ProjectTrack } from '@/types';

export interface ProjectArchiveTarget { item: Project | ProjectTrack; facts: ProjectFacts; projectId?: number }
export const ProjectArchiveDialog = ({ item, facts, projectId, onClose }: ProjectArchiveTarget & { onClose: () => void }) => {
  const write = useProjectWrites();
  const restoring = Boolean(item.archivedAt);
  const kind = projectId ? 'track' : 'project';
  return (
    <Dialog
      title={`${restoring ? 'Restore' : 'Archive'} ${kind}?`}
      subtitle={item.name}
      onClose={onClose}
      footer={<><button className="ui-btn-quiet" onClick={onClose}>Cancel</button><button className="ui-btn-solid" disabled={write.isPending} onClick={() => write.mutate({ id: item.id, projectId, track: Boolean(projectId), changes: { archived: !restoring } }, { onSuccess: onClose })}>{write.isPending ? 'Saving…' : `${restoring ? 'Restore' : 'Archive'} ${kind}`}</button></>}
    >
      <p className="text-[13px] leading-relaxed">{restoring ? `This ${kind} will be available for new tasks again${projectId ? ' when its project is active' : ''}.` : `This ${kind} will move out of your active view and stop accepting new tasks. You can restore it later.`}</p>
      {!restoring && <p className="mt-3 text-[13px] font-medium">{facts.open} open {facts.open === 1 ? 'task remains' : 'tasks remain'} actionable.</p>}
      {write.error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{write.error.message}</p>}
    </Dialog>
  );
};
