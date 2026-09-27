import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { FileText, X } from 'lucide-react';

export type TodayCapturePreset = 'later_today' | 'tomorrow' | 'next_week';

interface TodayTextCaptureDialogProps {
  title: string;
  description: string;
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
  onClose: () => void;
  onSave: (value: string) => void;
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
  onClose,
  onSave,
}: TodayTextCaptureDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const titleId = useId();
  const descriptionId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const canSave = value.trim().length > 0 && !isSaving;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fieldRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (!multiline && event.key === 'Enter' && canSave) {
      event.preventDefault();
      onSave(value);
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const fieldClassName = 'w-full rounded-lg px-3 py-2.5 text-[13px] leading-5 outline-none transition-colors focus:ring-2 focus:ring-[var(--border-active)]';
  const fieldStyle = {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
  };

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(0, 0, 0, 0.48)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[440px] overflow-hidden rounded-xl border"
        style={{
          background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          borderColor: 'var(--border-strong)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.36)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
              }}
            >
              <FileText size={16} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h2>
              <p id={descriptionId} className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-muted)' }}>
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
            aria-label="Close"
          >
            <X size={15} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <div className="px-4 py-4">
          <label htmlFor={fieldId} className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {label}
          </label>
          {multiline ? (
            <textarea
              id={fieldId}
              ref={fieldRef as RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={4}
              className={`${fieldClassName} resize-none`}
              style={fieldStyle}
            />
          ) : (
            <input
              id={fieldId}
              ref={fieldRef as RefObject<HTMLInputElement>}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={fieldClassName}
              style={fieldStyle}
            />
          )}
          {presets && presets.length > 0 ? (
            <div className="mt-3 flex items-center gap-1.5">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>When</span>
              {presets.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onPresetChange?.(option.id)}
                  className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    borderColor: preset === option.id ? 'var(--accent)' : 'var(--border)',
                    background: preset === option.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                    color: preset === option.id ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                  aria-pressed={preset === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {errorMessage ? (
            <p className="mt-3 text-[12px] font-medium" style={{ color: 'var(--danger)' }} role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(value)}
            disabled={!canSave}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-45"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {isSaving ? 'Saving' : saveLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}
