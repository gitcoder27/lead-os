import { useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { Dialog, DialogActions, DialogError } from '@/components/ui/Dialog';
import { useTeamMode } from '@/hooks/useTeamMode';
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
  /** Whether this developer has a login (`Developer.participates`). Defaults to true. */
  developerParticipates?: boolean;
  onClose: () => void;
  /** `visibility: 'private'` (collab only) keeps the rationale and follow-up manager-only. */
  onSubmit: (params: { rationale: string; taskKey?: string; nextFollowUpAt?: string | null; visibility?: 'private' }) => void;
}

const RATIONALE_REQUIRED_STATUSES: TrackerDeveloperStatus[] = ['blocked', 'at_risk'];

export function StatusRationaleDialog({
  status,
  developerName,
  tasks,
  isPending,
  error,
  initialSelectedKeys,
  developerParticipates = true,
  onClose,
  onSubmit,
}: StatusRationaleDialogProps) {
  // docs/56 P0-S6: in solo mode nothing developer-facing exists, so the dialog
  // stays simple. Visibility only matters when the developer can log in.
  const askVisibility = useTeamMode() === 'collab' && developerParticipates;
  const firstName = developerName.split(' ')[0] || developerName;
  const [isPrivate, setIsPrivate] = useState(false);
  const privateUpdate = askVisibility && isPrivate;
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
    const taskKeys = privateUpdate ? [] : taskKeysForSubmit(selectedKeys, rationale, tasks);
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
      ...(privateUpdate ? { visibility: 'private' as const } : {}),
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
        {askVisibility && (
          <fieldset className="space-y-1" data-testid="status-visibility">
            <legend className="ui-field-label">Who sees this</legend>
            <label className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
              <input type="radio" name="status-visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="mt-0.5" />
              <span>
                Visible to {firstName}
                <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {firstName} sees the status and this rationale on My Day. Your follow-up time stays private.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
              <input type="radio" name="status-visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} className="mt-0.5" />
              <span>
                Private — only you
                <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {firstName} still sees the new status, but not the rationale or follow-up. Can&apos;t be linked to a task.
                </span>
              </span>
            </label>
          </fieldset>
        )}
        {tasks.length > 0 && !privateUpdate && (
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
