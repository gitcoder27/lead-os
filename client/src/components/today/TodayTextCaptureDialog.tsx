import { useId, useState } from 'react';
import { TodayDialog, TodayDialogActions, TodayDialogError } from './TodayDialog';

export type TodayCapturePreset = 'later_today' | 'tomorrow' | 'next_week';

export interface TodayCaptureExtras {
  nextAction?: string;
  nextActionOwnerAccountId?: string;
}

interface TodayTextCaptureDialogProps {
  title: string;
  /** One short line of context (whose meeting, which person). */
  description?: string;
  label: string;
  defaultValue?: string;
  saveLabel: string;
  multiline?: boolean;
  isSaving: boolean;
  /** docs/53 F3: optional "when" chips (e.g. follow-up due-time presets). */
  presets?: Array<{ id: TodayCapturePreset; label: string }>;
  preset?: TodayCapturePreset;
  onPresetChange?: (preset: TodayCapturePreset) => void;
  /** docs/53 F9: surfaced inline when the save mutation fails. */
  errorMessage?: string;
  /**
   * docs/53 F14: when set, the dialog also offers an optional "Next action"
   * with an owner; a filled next action becomes a linked follow-up.
   */
  nextActionOwners?: Array<{ accountId: string; displayName: string }>;
  defaultNextActionOwnerId?: string;
  onClose: () => void;
  onSave: (value: string, extras?: TodayCaptureExtras) => void;
}

export function TodayTextCaptureDialog({
  title,
  description,
  label,
  defaultValue = '',
  saveLabel,
  multiline = false,
  isSaving,
  presets,
  preset,
  onPresetChange,
  errorMessage,
  nextActionOwners,
  defaultNextActionOwnerId,
  onClose,
  onSave,
}: TodayTextCaptureDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [nextAction, setNextAction] = useState('');
  const [ownerId, setOwnerId] = useState(defaultNextActionOwnerId ?? '');
  const fieldId = useId();
  const nextActionId = useId();
  const ownerFieldId = useId();
  const withNextAction = nextActionOwners !== undefined;
  const canSave = value.trim().length > 0 && !isSaving;
  const save = () => {
    if (!canSave) return;
    onSave(
      value,
      withNextAction && nextAction.trim()
        ? { nextAction: nextAction.trim(), nextActionOwnerAccountId: ownerId || undefined }
        : undefined,
    );
  };

  return (
    <TodayDialog
      title={title}
      subtitle={description}
      onClose={onClose}
      onSubmit={save}
      footer={<TodayDialogActions saveLabel={saveLabel} isSaving={isSaving} canSave={canSave} onCancel={onClose} onSave={save} />}
    >
      <label htmlFor={fieldId} className="today-field-label">{label}</label>
      {multiline ? (
        <textarea
          id={fieldId}
          data-autofocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          className="today-field"
        />
      ) : (
        <input
          id={fieldId}
          data-autofocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              save();
            }
          }}
          className="today-field"
        />
      )}
      {withNextAction ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_148px]">
          <div className="min-w-0">
            <label htmlFor={nextActionId} className="today-field-label">Next action (optional)</label>
            <input
              id={nextActionId}
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              className="today-field"
              placeholder="Becomes a follow-up for tomorrow"
            />
          </div>
          <div>
            <label htmlFor={ownerFieldId} className="today-field-label">Owner</label>
            <select
              id={ownerFieldId}
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              disabled={!nextAction.trim()}
              className="today-field"
            >
              <option value="">Me</option>
              {nextActionOwners.map((owner) => (
                <option key={owner.accountId} value={owner.accountId}>{owner.displayName}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      {presets && presets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-muted)' }}>Due</span>
          <div className="today-segment" role="group" aria-label="Due">
            {presets.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onPresetChange?.(option.id)}
                aria-pressed={preset === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <TodayDialogError message={errorMessage} />
    </TodayDialog>
  );
}
