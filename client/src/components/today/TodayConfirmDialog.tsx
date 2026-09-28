import { TodayDialog, TodayDialogError } from './TodayDialog';

interface TodayConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  isSaving: boolean;
  /** docs/53 F9: surfaced inline when the mutation fails. */
  errorMessage?: string;
  onClose: () => void;
  onConfirm: () => void;
}

/** docs/53 F11: only irreversible writes reach this dialog — reversible ones get Undo. */
export function TodayConfirmDialog({ title, description, confirmLabel, isSaving, errorMessage, onClose, onConfirm }: TodayConfirmDialogProps) {
  return (
    <TodayDialog
      role="alertdialog"
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="ui-btn-quiet">Cancel</button>
          <button type="button" data-autofocus onClick={onConfirm} disabled={isSaving} className="ui-btn-solid">
            {isSaving ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      <p className="text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      <TodayDialogError message={errorMessage} />
    </TodayDialog>
  );
}
