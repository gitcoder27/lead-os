import { useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { Dialog, DialogActions, DialogError } from '@/components/ui/Dialog';
import { TaskPicker, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TrackerStatusPill } from './TrackerStatusPill';

interface StatusRationaleDialogProps {
  status: TrackerDeveloperStatus;
  developerName: string;
  tasks: TaskPickerTask[];
  isPending: boolean;
  error?: string | null;
  /** Pre-picked task keys (e.g. the task that triggered a status suggestion). */
  initialSelectedKeys?: string[];
  onClose: () => void;
  onSubmit: (params: { rationale: string; taskKey?: string; nextFollowUpAt?: string | null }) => void;
}

const RATIONALE_REQUIRED_STATUSES: TrackerDeveloperStatus[] = ['blocked', 'at_risk'];

export function StatusRationaleDialog({
  status,
  developerName,
  tasks,
  isPending,
  error,
  initialSelectedKeys,
  onClose,
  onSubmit,
}: StatusRationaleDialogProps) {
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const [rationale, setRationale] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialSelectedKeys ?? []);
  const [followUpAt, setFollowUpAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const rationaleRequired = RATIONALE_REQUIRED_STATUSES.includes(status) || (status === 'waiting' && selectedKeys.length > 0);
  const displayError = formError ?? error ?? null;

  const handleSubmit = () => {
    const trimmed = rationale.trim();
    if (rationaleRequired && !trimmed) {
      setFormError(
        status === 'waiting'
          ? 'Add a rationale — it becomes the blocker note on the picked task.'
          : 'Add a rationale for this status.',
      );
      return;
    }
    const taskKeys = taskKeysForSubmit(selectedKeys, rationale, tasks);
    if (taskKeys.length > 1) {
      setFormError('Pick a single task for this update.');
      return;
    }
    if (isPending) {
      return;
    }

    let nextFollowUpAt: string | null | undefined;
    if (followUpAt) {
      const parsed = new Date(followUpAt);
      if (Number.isNaN(parsed.getTime())) {
        setFormError('That follow-up time is not valid.');
        return;
      }
      nextFollowUpAt = parsed.toISOString();
    }

    setFormError(null);
    onSubmit({
      rationale: trimmed || `Status updated.`,
      taskKey: taskKeys[0],
      nextFollowUpAt,
    });
  };

  // docs/54 V1: the app's one dialog shell (focus trap, Esc, ⌘↵ submit).
  return (
    <Dialog
      title={<>{developerName} → <TrackerStatusPill status={status} size="sm" /></>}
      subtitle={
        rationaleRequired
          ? 'A rationale is required and lands on the standup record.'
          : 'Optionally add context or link the task this status is about.'
      }
      icon={<TriangleAlert size={14} />}
      size="sm"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <DialogActions
          saveLabel="Set status"
          isSaving={isPending}
          canSave={!(rationaleRequired && !rationale.trim())}
          onCancel={onClose}
          onSave={handleSubmit}
        />
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="status-rationale" className="ui-field-label">
            Rationale {rationaleRequired ? '' : <span style={{ color: 'var(--text-muted)' }}>(optional)</span>}
          </label>
          <textarea
            id="status-rationale"
            ref={rationaleRef}
            data-autofocus=""
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              status === 'blocked'
                ? 'What is blocking progress?'
                : status === 'at_risk'
                  ? 'What is at risk and why?'
                  : 'Context for this status…'
            }
            className="ui-field"
            style={{ minHeight: '72px' }}
          />
        </div>
        {tasks.length > 0 && (
          <div>
            <span className="ui-field-label">
              Link a task <span style={{ color: 'var(--text-muted)' }}>(optional — raises a blocker event on it)</span>
            </span>
            <TaskPicker
              tasks={tasks}
              text={rationale}
              selected={selectedKeys}
              onChange={(keys) => setSelectedKeys(keys.slice(-1))}
            />
          </div>
        )}
        <div>
          <label htmlFor="status-rationale-follow-up" className="ui-field-label">
            Next follow-up <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <input
            id="status-rationale-follow-up"
            type="datetime-local"
            value={followUpAt}
            onChange={(event) => setFollowUpAt(event.target.value)}
            className="ui-field"
          />
        </div>
        <DialogError message={displayError ?? undefined} />
      </div>
    </Dialog>
  );
}
