import { useEffect, useRef, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Dialog } from '@/components/ui/Dialog';
import { previewPlacement, usePlacementWrites } from '@/hooks/useProjects';
import { useLocalDate } from '@/hooks/useLocalDate';
import type { PlacementPreview, TaskPlacement } from '@/types';
import { UNDO_WINDOW_MS } from '@/lib/undo';
import { PlacementPicker } from './PlacementPicker';
import { PROJECT_CONTROL, PROJECT_STYLE } from './ProjectEditor';
export function PlacementDialog({ keys, initial, onClose }: { keys: string[]; initial?: TaskPlacement | null; onClose: () => void }) {
  const today = useLocalDate();
  const [placement, setPlacement] = useState<TaskPlacement | null>(initial ?? null);
  const [includeSubtasks, setIncludeSubtasks] = useState(false);
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [error, setError] = useState('');
  const write = usePlacementWrites();
  const { addToast } = useToast();
  const scope = useAuthScopeKey(); const currentScope = useRef(scope); currentScope.current = scope;
  const keysSignature = JSON.stringify(keys);
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setError('');
    void previewPlacement({ keys: JSON.parse(keysSignature) as string[], includeSubtasks }).then((value) => { if (!cancelled) setPreview(value); }, (reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [keysSignature, includeSubtasks, scope]);
  const save = async () => {
    if (!preview || write.isPending) return;
    try {
      const receipt = await write.mutateAsync({ preview, placement });
      if (currentScope.current !== scope) return;
      addToast({ type: 'success', title: `Project updated · ${receipt.count} tasks`, duration: UNDO_WINDOW_MS, action: { label: 'Undo', onClick: () => {
        if (currentScope.current !== scope) return;
        void write.mutateAsync(receipt.undo).then(() => addToast('Project placement restored', 'success'), (reason: Error) => addToast(reason.message, 'error'));
      } } });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not move tasks'); }
  };
  return <Dialog title="Project placement" onClose={onClose} onSubmit={() => void save()} footer={<button className={PROJECT_CONTROL} style={PROJECT_STYLE} disabled={!preview || write.isPending} onClick={() => void save()}>{write.isPending ? 'Moving…' : `Apply to ${preview?.tasks.length ?? 0} tasks`}</button>}>
    <div className="space-y-4"><PlacementPicker today={today} value={placement} onChange={setPlacement} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSubtasks} disabled={write.isPending} onChange={(event) => setIncludeSubtasks(event.target.checked)} />Include subtasks</label>
      <p className="text-sm" role="status">{preview ? `${preview.tasks.length} visible tasks affected` : 'Loading visible tasks…'}</p>
      <ul className="max-h-48 space-y-1 overflow-auto text-xs">{preview?.tasks.map((task) => <li key={task.taskKey}>{task.taskKey} · {task.title}{!preview.keys.includes(task.taskKey) && ' · Subtask'}</li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
