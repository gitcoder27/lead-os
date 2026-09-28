import { useEffect, useState } from 'react';
import { CalendarX } from 'lucide-react';
import { Dialog, DialogActions } from '@/components/ui/Dialog';

interface AvailabilityDialogProps {
  open: boolean;
  developerName?: string;
  date: string;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: (note?: string) => void;
}

/** docs/54 V1: marking someone inactive uses the app's one dialog shell. */
export function AvailabilityDialog({
  open,
  developerName,
  date,
  isPending,
  onClose,
  onConfirm,
}: AvailabilityDialogProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  if (!open || !developerName) return null;
  const confirm = () => onConfirm(note.trim() || undefined);

  return (
    <Dialog
      title={`Mark ${developerName} inactive`}
      subtitle={`Hidden from ${date} onward until reactivated.`}
      icon={<CalendarX size={14} />}
      size="sm"
      closeLabel="Close inactive dialog"
      onClose={onClose}
      onSubmit={confirm}
      footer={
        <DialogActions
          saveLabel="Mark inactive"
          isSaving={Boolean(isPending)}
          canSave
          onCancel={onClose}
          onSave={confirm}
        />
      }
    >
      <label htmlFor="availability-note" className="ui-field-label">
        Note <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
      </label>
      <textarea
        id="availability-note"
        data-autofocus=""
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="PTO today, holiday, training, or another note…"
        rows={3}
        className="ui-field"
      />
    </Dialog>
  );
}
