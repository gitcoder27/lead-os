import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useProjectWrites } from '@/hooks/useProjects';
import type { Project, ProjectTrack } from '@/types';
export const PROJECT_CONTROL =
  'min-h-[40px] rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
export const PROJECT_STYLE = {
  borderColor: 'var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
};
export function ProjectEditor({
  item,
  projectId,
  onClose,
}: {
  item?: Project | ProjectTrack;
  projectId?: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [outcome, setOutcome] = useState(item?.outcome ?? '');
  const [summary, setSummary] = useState(item?.summary ?? '');
  const write = useProjectWrites();
  const save = () => {
    if (name.trim() && !write.isPending)
      write.mutate(
        { id: item?.id, projectId, track: Boolean(projectId), changes: { name, outcome, summary } },
        { onSuccess: onClose },
      );
  };
  return (
    <Dialog
      title={`${item ? 'Edit' : 'New'} ${projectId ? 'track' : 'project'}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <button
          className={PROJECT_CONTROL}
          style={PROJECT_STYLE}
          disabled={!name.trim() || write.isPending}
          onClick={save}
        >
          {write.isPending ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            data-autofocus
            className={PROJECT_CONTROL}
            style={PROJECT_STYLE}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Outcome
          <textarea
            className={PROJECT_CONTROL}
            style={PROJECT_STYLE}
            maxLength={4000}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Summary
          <textarea
            className={PROJECT_CONTROL}
            style={PROJECT_STYLE}
            rows={4}
            maxLength={10000}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        {write.error && <p role="alert">{write.error.message}</p>}
      </div>
    </Dialog>
  );
}
