import { useId, type ReactNode } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';

export function AuthField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId(); const hintId = useId();
  return <div>
    <label htmlFor={id} className="ui-field-label auth-label">{label}</label>
    {children(id, hint || error ? hintId : undefined)}
    {hint || error ? <p id={hintId} className="auth-hint" data-error={error ? 'true' : undefined} aria-live="polite">{error || hint}</p> : null}
  </div>;
}
export function PasswordInput({ id, value, onChange, show, onToggle, autoComplete, describedBy, onBlur, invalid, disabled, controlLabel = 'password' }: {
  id: string; value: string; onChange: (value: string) => void; show: boolean; onToggle: () => void; autoComplete: string; describedBy?: string; onBlur?: () => void; invalid?: boolean; disabled?: boolean; controlLabel?: string;
}) {
  return <div className="relative">
    <input id={id} type={show ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} autoComplete={autoComplete} aria-describedby={describedBy} aria-invalid={invalid || undefined} disabled={disabled} className="ui-field auth-field auth-field-password" />
    <button type="button" onClick={onToggle} className="ui-icon-btn auth-password-toggle" aria-label={`${show ? 'Hide' : 'Show'} ${controlLabel}`} aria-pressed={show} disabled={disabled}>
      {show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
    </button>
  </div>;
}
export function AuthMessage({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return <div className="auth-message" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
    {tone === 'success' ? <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> : null}<span>{children}</span>
  </div>;
}
