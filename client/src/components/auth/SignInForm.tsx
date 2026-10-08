import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import './auth.css';

/** Mirrors the server's PASSWORD_MIN_LENGTH (auth.service.ts). */
const PASSWORD_MIN_LENGTH = 8;

export type SignInMode = 'sign-in' | 'change-password';

interface SignInFormProps {
  /** The submit button's label in sign-in mode. */
  submitLabel?: string;
  /** Lets a dialog or page retitle itself when the form switches mode. */
  onModeChange?: (mode: SignInMode) => void;
  /** Called once the session exists; the app shell routes by role from there. */
  onSignedIn?: () => void;
  /** A line under the form in sign-in mode (who to ask for an account). */
  footnote?: ReactNode;
}

/**
 * The one sign-in form: the landing page's dialog, the standalone sign-in page
 * and the developer My Day sign-in all use it. Managers and developers sign in
 * the same way; the shell routes each role to its own home afterwards.
 */
export function SignInForm({ submitLabel = 'Sign in', onModeChange, onSignedIn, footnote }: SignInFormProps) {
  const { login } = useAuth();
  const [mode, setModeState] = useState<SignInMode>('sign-in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const setMode = (next: SignInMode) => {
    setModeState(next);
    setError('');
    setNotice('');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    onModeChange?.(next);
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await login(username.trim(), password.trim());
      onSignedIn?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Check your username and password.');
      setSubmitting(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password.trim() || !newPassword.trim() || submitting) return;
    if (newPassword.trim().length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords don’t match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/auth/change-password', {
        username: username.trim(),
        currentPassword: password.trim(),
        newPassword: newPassword.trim(),
      });
      setMode('sign-in');
      setNotice('Password changed. Sign in with your new password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'change-password') {
    return (
      <form className="space-y-4" onSubmit={handleChangePassword} noValidate>
        <AuthField label="Username">
          {(id) => (
            <input
              id={id}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              className="ui-field auth-field"
            />
          )}
        </AuthField>
        <AuthField label="Current password">
          {(id) => (
            <PasswordInput id={id} value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((v) => !v)} autoComplete="current-password" />
          )}
        </AuthField>
        <AuthField label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
          {(id, hintId) => (
            <PasswordInput id={id} describedBy={hintId} value={newPassword} onChange={setNewPassword} show={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} autoComplete="new-password" />
          )}
        </AuthField>
        <AuthField label="Confirm new password">
          {(id) => (
            <PasswordInput id={id} value={confirmPassword} onChange={setConfirmPassword} show={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} autoComplete="new-password" />
          )}
        </AuthField>

        {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

        <button
          type="submit"
          className="ui-btn-solid auth-submit"
          disabled={!username.trim() || !password.trim() || !newPassword.trim() || !confirmPassword.trim() || submitting}
        >
          {submitting ? 'Changing password…' : 'Change password'}
        </button>
        <div className="flex justify-center">
          <button type="button" className="ui-link auth-link" onClick={() => setMode('sign-in')}>
            Back to sign in
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSignIn} noValidate>
      {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      <AuthField label="Username">
        {(id) => (
          <input
            id={id}
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            data-autofocus
            className="ui-field auth-field"
          />
        )}
      </AuthField>
      <AuthField label="Password">
        {(id) => (
          <PasswordInput id={id} value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((v) => !v)} autoComplete="current-password" />
        )}
      </AuthField>

      {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

      <button type="submit" className="ui-btn-solid auth-submit" disabled={!username.trim() || !password.trim() || submitting}>
        {submitting ? 'Signing in…' : submitLabel}
      </button>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        {footnote ? <p className="auth-footnote">{footnote}</p> : <span />}
        <button type="button" className="ui-link auth-link" onClick={() => setMode('change-password')}>
          Change password
        </button>
      </div>
    </form>
  );
}

function AuthField({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <label htmlFor={id} className="ui-field-label auth-label">{label}</label>
      {children(id, hint ? hintId : undefined)}
      {hint ? <p id={hintId} className="auth-hint">{hint}</p> : null}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  describedBy?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        className="ui-field auth-field auth-field-password"
      />
      <button
        type="button"
        onClick={onToggle}
        className="ui-icon-btn absolute right-1.5 top-1/2 -translate-y-1/2"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function AuthMessage({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <div className="auth-message" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> : null}
      <span>{children}</span>
    </div>
  );
}
