import { useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { USERNAME_PATTERN, RESERVED_USERNAMES, signUpPasswordError } from '@/types';
import { useSignUp } from '@/hooks/useSignUp';
import { AuthField, AuthMessage, PasswordInput } from './AuthFields';
import './auth.css';

type Field = 'displayName' | 'username' | 'password' | 'confirmation';
export function SignUpForm({ inviteToken, onSignIn }: { inviteToken: string; onSignIn: () => void }) {
  const [values, setValues] = useState({ displayName: '', username: '', password: '', confirmation: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [show, setShow] = useState(false); const [showConfirmation, setShowConfirmation] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const form = useRef<HTMLFormElement>(null); const mutation = useSignUp();
  const validation = (field: Field) => {
    if (field === 'displayName') return !values.displayName.trim() ? 'Enter the name you’d like to use.' : values.displayName.trim().length > 200 ? 'Use up to 200 characters.' : undefined;
    if (field === 'confirmation') return values.confirmation !== values.password || !values.confirmation ? 'Enter the same password again.' : undefined;
    if (field === 'password') return signUpPasswordError(values.password, values.username);
    const username = values.username.trim().toLowerCase();
    return !USERNAME_PATTERN.test(username) ? 'Use 3–40 characters, starting with a letter or number.' : (RESERVED_USERNAMES as readonly string[]).includes(username) ? 'Choose a different username.' : undefined;
  };
  const update = (field: Field, value: string) => { setValues(previous => ({ ...previous, [field]: value })); };
  const blur = (field: Field) => setErrors(previous => ({ ...previous, [field]: validation(field) }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (lock.current) return;
    const next = Object.fromEntries((['displayName', 'username', 'password', 'confirmation'] as const).map(field => [field, validation(field)])); setErrors(next);
    if (Object.values(next).some(Boolean)) { requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return; }
    lock.current = true; setError('');
    try { await mutation.mutateAsync({ inviteToken, username: values.username.trim().toLowerCase(), displayName: values.displayName.trim(), password: values.password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Account creation failed. Please try again.'); }
    finally { lock.current = false; }
  };
  return <form ref={form} className="auth-signup" onSubmit={submit} noValidate>
    <AuthField label="Your name" hint="The name you’ll use in your workspace." error={errors.displayName}>
      {(id, hintId) => <input id={id} aria-describedby={hintId} name="name" className="ui-field auth-field" value={values.displayName} onChange={event => update('displayName', event.target.value)} onBlur={() => blur('displayName')} autoComplete="name" autoFocus data-autofocus maxLength={200} aria-invalid={Boolean(errors.displayName) || undefined} disabled={mutation.isPending} />}
    </AuthField>
    <AuthField label="Username" hint="3–40 characters. Letters, numbers, . _ -" error={errors.username}>
      {(id, hintId) => <input id={id} name="username" className="ui-field auth-field" value={values.username} onChange={event => update('username', event.target.value)} onBlur={() => blur('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={40} aria-describedby={hintId} aria-invalid={Boolean(errors.username) || undefined} disabled={mutation.isPending} />}
    </AuthField>
    <AuthField label="Password" hint="8–200 characters. Avoid common passwords and your username." error={errors.password}>
      {(id, hintId) => <PasswordInput id={id} value={values.password} onChange={value => update('password', value)} onBlur={() => blur('password')} show={show} onToggle={() => setShow(value => !value)} autoComplete="new-password" describedBy={hintId} invalid={Boolean(errors.password)} disabled={mutation.isPending} />}
    </AuthField>
    <AuthField label="Confirm password" hint="Re-enter your password." error={errors.confirmation}>
      {(id, hintId) => <PasswordInput id={id} value={values.confirmation} onChange={value => update('confirmation', value)} onBlur={() => blur('confirmation')} show={showConfirmation} onToggle={() => setShowConfirmation(value => !value)} autoComplete="new-password" describedBy={hintId} invalid={Boolean(errors.confirmation)} disabled={mutation.isPending} controlLabel="password confirmation" />}
    </AuthField>
    <div className="auth-error-space">{error ? <AuthMessage tone="error">{error}</AuthMessage> : null}</div>
    <button type="submit" className="ui-btn-solid auth-submit" disabled={mutation.isPending || !values.displayName.trim() || !values.username.trim() || !values.password || !values.confirmation} aria-busy={mutation.isPending}>
      {mutation.isPending ? <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Creating account…</> : 'Create account'}
    </button>
    <p className="auth-switch">Already have an account? <button type="button" className="ui-link auth-link" onClick={onSignIn} disabled={mutation.isPending}>Sign in</button></p>
    <p className="auth-disclosure">Your workspace starts empty. Bring your own AI key for Copilot. The operator can access hosted data and backups; deleted data stays in backups until they expire.</p>
  </form>;
}
