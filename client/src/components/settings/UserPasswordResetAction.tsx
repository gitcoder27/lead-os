import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import type { AuthUser } from '@/types';

/** Mirrors the server rule (`PASSWORD_MIN_LENGTH`); the server stays the source of truth. */
const MIN_PASSWORD_LENGTH = 6;

interface UserPasswordResetActionProps {
  user: AuthUser;
  /** Resolves when the password was changed; rejects with the server's message otherwise. */
  onReset: (newPassword: string) => Promise<void>;
}

const CHIP_BUTTON = 'rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50';

export function UserPasswordResetAction({ user, onReset }: UserPasswordResetActionProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setPassword('');
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onReset(password);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 ${CHIP_BUTTON}`}
        style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
        aria-label={`Reset password for ${user.displayName}`}
      >
        <KeyRound size={12} />
        Reset password
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !submitting) close();
      }}
      className="flex flex-col gap-1.5"
    >
      <p className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        Set a new password for {user.displayName}? They will be signed out on every device.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          aria-label={`New password for ${user.displayName}`}
          placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
          className="h-8 w-48 rounded-lg px-2.5 text-[13px] outline-none"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
        />
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className={CHIP_BUTTON}
          style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: '1px solid var(--border-active)' }}
        >
          {submitting ? (
            <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Saving…</span>
          ) : (
            'Set password'
          )}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={submitting}
          className={CHIP_BUTTON}
          style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[12px]" style={{ color: 'var(--danger-muted)' }}>{error}</p>
      ) : null}
    </form>
  );
}
