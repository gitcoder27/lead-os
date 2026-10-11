import { useEffect, useRef, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Dialog } from '@/components/ui/Dialog';
import { previewPlacement, usePlacementWrites, useProject } from '@/hooks/useProjects';
import { useLocalDate } from '@/hooks/useLocalDate';
import type { PlacementPreview, TaskPlacement } from '@/types';
import { UNDO_WINDOW_MS } from '@/lib/undo';
import { PlacementPicker } from './PlacementPicker';

export function PlacementDialog({
  keys,
  initial,
  onClose,
}: {
  keys: string[];
  initial?: TaskPlacement | null;
  onClose: () => void;
}) {
  const today = useLocalDate();
  const [placement, setPlacement] = useState<TaskPlacement | null>(initial ?? null);
  // docs/73 UXD-16: nothing to save until the destination changes — no "Remove from project"
  // offered for a task that has none. Bulk moves start untouched (their tasks may differ).
  const [touched, setTouched] = useState(false);
  const samePlacement = (a: TaskPlacement | null | undefined, b: TaskPlacement | null | undefined) =>
    (a?.projectId ?? null) === (b?.projectId ?? null) && (a?.trackId ?? null) === (b?.trackId ?? null);
  const [includeSubtasks, setIncludeSubtasks] = useState(false);
  const changed = touched && (keys.length > 1 || includeSubtasks || !samePlacement(placement, initial ?? null));
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [error, setError] = useState('');
  const [previewRevision, setPreviewRevision] = useState(0);
  const write = usePlacementWrites();
  const destination = useProject(placement?.projectId, today);
  const destinationTrack = destination.data?.tracks.find((track) => track.id === placement?.trackId);
  const destinationName = placement
    ? `${destination.data?.project.name ?? 'Selected project'}${placement.trackId ? ` / ${destinationTrack?.name ?? 'Selected track'}` : ''}`
    : 'No project';
  const count = preview?.tasks.length ?? 0;
  const countLabel = `${count} ${count === 1 ? 'task' : 'tasks'}`;
  const { addToast } = useToast();
  const scope = useAuthScopeKey();
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const keysSignature = JSON.stringify(keys);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError('');
    void previewPlacement({ keys: JSON.parse(keysSignature) as string[], includeSubtasks }).then(
      (value) => {
        if (!cancelled) setPreview(value);
      },
      (reason: Error) => {
        if (!cancelled) setError(reason.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [keysSignature, includeSubtasks, scope, previewRevision]);
  const save = async () => {
    if (!preview || !preview.tasks.length || write.isPending || !changed) return;
    try {
      const receipt = await write.mutateAsync({ preview, placement });
      if (currentScope.current !== scope) return;
      addToast({
        type: 'success',
        title: `Project updated · ${receipt.count} ${receipt.count === 1 ? 'task' : 'tasks'}`,
        duration: UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (currentScope.current !== scope) return;
            void write.mutateAsync(receipt.undo).then(
              () => addToast('Project placement restored', 'success'),
              (reason: Error) => addToast(reason.message, 'error'),
            );
          },
        },
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not move tasks');
    }
  };
  return (
    <Dialog
      title="Move to project"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <button className="ui-btn-quiet" onClick={onClose}>Cancel</button>
          <button className="ui-btn-solid" disabled={!preview || !count || write.isPending || !changed} onClick={() => void save()}>
            {write.isPending ? 'Moving…' : placement || (!initial && keys.length === 1) ? `Move ${countLabel}` : 'Remove from project'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <PlacementPicker today={today} value={placement} onChange={(next) => { setPlacement(next); setTouched(true); }} disabled={write.isPending} />
        <label className="flex items-center gap-2 text-body leading-5">
          <input
            type="checkbox"
            className="accent-[var(--accent-solid)]"
            checked={includeSubtasks}
            disabled={write.isPending}
            onChange={(event) => { setIncludeSubtasks(event.target.checked); setTouched(true); }}
          />
          Include subtasks
        </label>
        <section className="rounded-lg border p-3" aria-label="Move preview" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          <p className="text-body font-medium" role="status">{preview ? `${countLabel} will ${placement ? 'move' : 'have no project'}` : 'Checking affected tasks…'}</p>
          <p className="project-field-hint mt-1 break-words">Destination: {destinationName}</p>
          <ul className="mt-3 max-h-36 space-y-2 overflow-auto text-ui" style={{ color: 'var(--text-secondary)' }}>
            {preview?.tasks.map((task) => <li key={task.taskKey} className="break-words"><span className="mr-2 font-mono" style={{ color: 'var(--text-muted)' }}>{task.taskKey}</span>{task.title}{!preview.keys.includes(task.taskKey) && <span className="project-field-hint ml-2">Subtask</span>}</li>)}
          </ul>
          <p className="project-field-hint mt-3">Only project organization changes. You can undo this move.</p>
        </section>
        {error && <div role="alert" className="space-y-2 text-body"><p style={{ color: 'var(--danger)' }}>{error}</p><button className="ui-btn-secondary" disabled={write.isPending} onClick={() => setPreviewRevision((revision) => revision + 1)}>Review affected tasks</button></div>}
      </div>
    </Dialog>
  );
}
