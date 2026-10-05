import { useId, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useProjectWrites } from '@/hooks/useProjects';
import type { Project, ProjectTrack } from '@/types';
import './projects.css';

export const PROJECT_CONTROL = 'ui-field';
export const PROJECT_STYLE = { borderColor: 'var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' };

export function ProjectEditor({ item, projectId, onClose, onCreated }: {
  item?: Project | ProjectTrack;
  projectId?: number;
  onClose: () => void;
  onCreated?: (item: Project | ProjectTrack) => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [outcome, setOutcome] = useState(item?.outcome ?? '');
  const [summary, setSummary] = useState(item?.summary ?? '');
  const write = useProjectWrites();
  const hintId = useId();
  const kind = projectId ? 'track' : 'project';
  const save = () => {
    if (!name.trim() || write.isPending) return;
    write.mutate({ id: item?.id, projectId, track: Boolean(projectId), changes: { name: name.trim(), outcome, summary } }, { onSuccess: (created) => { if (!item && onCreated) onCreated(created); else onClose(); } });
  };
  return (
    <Dialog
      title={`${item ? 'Edit' : 'New'} ${kind}`}
      onClose={onClose}
      onSubmit={save}
      footer={<><button className="ui-btn-quiet" onClick={onClose}>Cancel</button><button className="ui-btn-solid" disabled={!name.trim() || write.isPending} onClick={save}>{write.isPending ? 'Saving…' : item ? 'Save changes' : `Create ${kind}`}</button></>}
    >
      <div className="flex flex-col gap-5">
        {!item && <p className="project-field-hint">{projectId ? 'Group a part of this project. Tasks can also stay directly in the project.' : 'Give an outcome a home for its tasks. You can add tracks later.'}</p>}
        <label className="flex flex-col gap-2 text-[13px] font-medium">
          Name
          <input data-autofocus className="ui-field" maxLength={120} value={name} placeholder={projectId ? 'e.g. Rollout' : 'e.g. Platform migration'} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} />
        </label>
        <label className="flex flex-col gap-2 text-[13px] font-medium">
          Outcome (optional)
          <textarea className="ui-field resize-y" rows={2} maxLength={4000} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What will be different when this is done?" aria-describedby={hintId} />
          <span id={hintId} className="project-field-hint">Describe the result you’re working toward.</span>
        </label>
        <details open={item ? true : undefined}>
          <summary className="ui-link cursor-pointer">{item ? 'Summary' : 'Add a summary (optional)'}</summary>
          <label className="mt-3 flex flex-col gap-2 text-[13px] font-medium">
            Summary
            <textarea className="ui-field resize-y" rows={4} maxLength={10000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Where things stand, decisions, and what’s next." />
            <span className="project-field-hint">A private snapshot of progress. LeadOS records when you update it.</span>
          </label>
        </details>
        {write.error && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{write.error.message}</p>}
      </div>
    </Dialog>
  );
}
