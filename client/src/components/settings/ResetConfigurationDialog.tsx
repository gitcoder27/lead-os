import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Dialog, DialogError } from '@/components/ui/Dialog';

/** Must match `RESET_CONFIGURATION_CONFIRMATION` in `server/src/routes/config.ts`. */
export const RESET_CONFIGURATION_TEXT = 'RESET CONFIGURATION';

/** What `POST /api/config/reset` deletes for the workspace. Keep in step with the route. */
const LOST_ITEMS = [
  'The Jira connection and saved API token',
  'The Copilot provider, model and API key',
  'Backup schedule, day rhythm, attention rules, team mode and every other saved setting',
  'All synced Jira issues, their history and the sync log',
  'Defect tags and their assignments',
  'Tracked team members (the roster) and component mapping',
];

interface ResetConfigurationDialogProps {
  /** Whether the server takes a backup before wiping (the `backupBeforeReset` setting). */
  backupBeforeReset: boolean;
  isResetting: boolean;
  error?: string;
  onConfirm: (confirmationText: string) => void;
  onClose: () => void;
}

/**
 * docs/56 P6-06: replaces `window.confirm`. Lists what is lost and asks for the phrase,
 * the same typed-confirmation pattern as the maintenance resets.
 */
export function ResetConfigurationDialog({ backupBeforeReset, isResetting, error, onConfirm, onClose }: ResetConfigurationDialogProps) {
  const [text, setText] = useState('');
  const matches = text.trim().toUpperCase() === RESET_CONFIGURATION_TEXT;

  const submit = () => {
    if (matches && !isResetting) {
      onConfirm(text);
    }
  };

  return (
    <Dialog
      title="Reset configuration"
      subtitle="Clears the workspace setup and returns you to onboarding."
      icon={<TriangleAlert size={16} />}
      role="alertdialog"
      size="md"
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <button type="button" className="ui-btn-quiet" onClick={onClose} disabled={isResetting}>Cancel</button>
          <button type="button" className="ui-btn-danger-solid" onClick={submit} disabled={!matches || isResetting}>
            {isResetting ? 'Resetting…' : 'Reset configuration'}
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        <div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>You will lose</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5" aria-label="What is lost">
            {LOST_ITEMS.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <p>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Kept:</span>{' '}
          your tasks, notes, Desk items, team tracker history and app accounts.
        </p>
        <p style={{ color: backupBeforeReset ? 'var(--success)' : 'var(--warning)' }}>
          {backupBeforeReset
            ? 'A backup is taken first. You can find it under Settings → Data & Backups.'
            : 'Automatic backup before reset is off, so this cannot be undone. Take a backup in Settings → Data & Backups first.'}
        </p>
        <label className="block">
          <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Type <strong style={{ color: 'var(--text-primary)' }}>{RESET_CONFIGURATION_TEXT}</strong> to confirm
          </span>
          <input
            data-autofocus
            className="ui-input mt-1 w-full"
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Confirmation text"
            disabled={isResetting}
          />
        </label>
        <DialogError message={error} />
      </div>
    </Dialog>
  );
}
