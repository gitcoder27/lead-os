import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, KeyRound, Moon, Sun, UserRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/lib/api';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import type { UserRole } from '@/types';

type LoginRole = Extract<UserRole, 'manager' | 'developer'>;

interface LoginPageProps {
  role?: LoginRole;
}

const ROLE_COPY = {
  manager: {
    eyebrow: 'Manager Workspace',
    tagline: 'Run the desk.',
    note: 'Create developer accounts and manage your team after signing in.',
    accent: 'var(--warning)',
    glow: 'color-mix(in srgb, var(--warning) 18%, transparent)',
    orbGlow: 'color-mix(in srgb, var(--warning) 6%, transparent)',
    icon: BriefcaseBusiness,
    submitLabel: 'Enter Manager Workspace',
  },
  developer: {
    eyebrow: 'Developer Workspace',
    tagline: 'Start your day.',
    note: 'No account yet? Contact your Lead to get access.',
    accent: 'var(--accent)',
    glow: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    orbGlow: 'color-mix(in srgb, var(--accent) 6%, transparent)',
    icon: UserRound,
    submitLabel: 'Open My Day',
  },
} as const;

type ViewMode = 'login' | 'change-password';

export function LoginPage({ role = 'developer' }: LoginPageProps) {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<ViewMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const copy = ROLE_COPY[role];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await login(username.trim(), password.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password.trim() || !newPassword.trim()) {
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/auth/change-password', {
        username: username.trim(),
        currentPassword: password.trim(),
        newPassword: newPassword.trim(),
      });
      setSuccess('Password changed successfully');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setMode('login');
        setSuccess('');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: ViewMode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
  };

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-8"
      style={{
        background: `radial-gradient(circle at 30% 20%, ${copy.glow}, transparent 40%), radial-gradient(circle at 70% 80%, rgba(15, 23, 42, 0.18), transparent 50%), var(--bg-canvas)`,
      }}
    >
      {/* Ambient floating orbs */}
      <motion.div
        className="pointer-events-none absolute rounded-full blur-3xl"
        style={{
          width: 500,
          height: 500,
          top: '-10%',
          left: '-8%',
          background: `radial-gradient(circle, ${copy.orbGlow}, transparent 70%)`,
        }}
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full blur-3xl"
        style={{
          width: 400,
          height: 400,
          bottom: '-10%',
          right: '-5%',
          background: `radial-gradient(circle, ${copy.orbGlow}, transparent 70%)`,
        }}
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-5 top-5 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[13px] font-semibold transition-colors"
        style={{
          background: 'color-mix(in srgb, var(--bg-primary) 88%, transparent)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border-strong)',
        }}
        aria-label="Toggle theme"
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>

      {/* Centered content */}
      <div className="relative z-10 w-full max-w-[420px]">
        {/* Branding */}
        <motion.div
          className="mb-10 text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-4 inline-flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[14px]"
              style={{
                background: copy.glow,
                color: copy.accent,
                boxShadow: `0 0 24px ${copy.glow}`,
              }}
            >
              <LeadOSMark size={26} />
            </div>
            <div className="text-left">
              <div
                className="text-[12px] font-semibold uppercase tracking-[0.3em]"
                style={{ color: copy.accent }}
              >
                {copy.eyebrow}
              </div>
              <div className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                LeadOS
              </div>
            </div>
          </div>

          <h1
            className="text-[32px] font-semibold leading-tight tracking-tight md:text-[38px]"
            style={{ color: 'var(--text-primary)' }}
          >
            {copy.tagline}
          </h1>
        </motion.div>

        {/* Sign-in card */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[28px] border p-7 md:p-9"
          style={{
            borderColor: 'var(--border-strong)',
            background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)',
            boxShadow: 'var(--panel-shadow)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div
            className="absolute inset-x-8 top-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${copy.accent}, transparent)` }}
          />

          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div
                  className="text-[12px] font-semibold uppercase tracking-[0.24em]"
                  style={{ color: copy.accent }}
                >
                  Sign in
                </div>

                <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                  <Field label="Username">
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      autoFocus
                      placeholder={role === 'manager' ? 'manager username' : 'developer username'}
                      className="w-full rounded-[16px] border px-4 py-3 text-[14px] outline-none transition-colors"
                      style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        borderColor: 'var(--border)',
                      }}
                    />
                  </Field>

                  <Field label="Password">
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      show={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      autoComplete="current-password"
                      placeholder="your password"
                    />
                  </Field>

                  {error && <ErrorBanner message={error} />}

                  <button
                    type="submit"
                    disabled={!username.trim() || !password.trim() || submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-3.5 text-[14px] font-semibold transition-all disabled:opacity-40"
                    style={{
                      background: `linear-gradient(135deg, ${copy.accent}, color-mix(in srgb, ${copy.accent} 60%, white))`,
                      color: '#111827',
                      boxShadow: `0 4px 20px ${copy.glow}`,
                    }}
                  >
                    {submitting ? 'Signing in…' : copy.submitLabel}
                    {!submitting && <ArrowRight size={15} />}
                  </button>
                </form>

                <div className="mt-6 flex items-center justify-between">
                  <p className="text-[13px] leading-5" style={{ color: 'var(--text-muted)' }}>
                    {copy.note}
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('change-password')}
                    className="ml-3 shrink-0 text-[13px] font-medium transition-colors hover:underline"
                    style={{ color: copy.accent }}
                  >
                    Change password
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="change-password"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2">
                  <KeyRound size={14} style={{ color: copy.accent }} />
                  <div
                    className="text-[12px] font-semibold uppercase tracking-[0.24em]"
                    style={{ color: copy.accent }}
                  >
                    Change password
                  </div>
                </div>

                <form className="mt-7 space-y-5" onSubmit={handleChangePassword}>
                  <Field label="Username">
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      autoFocus
                      placeholder={role === 'manager' ? 'manager username' : 'developer username'}
                      className="w-full rounded-[16px] border px-4 py-3 text-[14px] outline-none transition-colors"
                      style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        borderColor: 'var(--border)',
                      }}
                    />
                  </Field>

                  <Field label="Current password">
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      show={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      autoComplete="current-password"
                      placeholder="current password"
                    />
                  </Field>

                  <Field label="New password">
                    <PasswordInput
                      value={newPassword}
                      onChange={setNewPassword}
                      show={showNewPassword}
                      onToggle={() => setShowNewPassword((v) => !v)}
                      autoComplete="new-password"
                      placeholder="new password (min 6 chars)"
                    />
                  </Field>

                  <Field label="Confirm new password">
                    <PasswordInput
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      show={showNewPassword}
                      onToggle={() => setShowNewPassword((v) => !v)}
                      autoComplete="new-password"
                      placeholder="confirm new password"
                    />
                  </Field>

                  {error && <ErrorBanner message={error} />}
                  {success && <SuccessBanner message={success} />}

                  <button
                    type="submit"
                    disabled={
                      !username.trim() ||
                      !password.trim() ||
                      !newPassword.trim() ||
                      !confirmPassword.trim() ||
                      submitting
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-3.5 text-[14px] font-semibold transition-all disabled:opacity-40"
                    style={{
                      background: `linear-gradient(135deg, ${copy.accent}, color-mix(in srgb, ${copy.accent} 60%, white))`,
                      color: '#111827',
                      boxShadow: `0 4px 20px ${copy.glow}`,
                    }}
                  >
                    {submitting ? 'Updating…' : 'Update password'}
                    {!submitting && <ArrowRight size={15} />}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-[13px] font-medium transition-colors hover:underline"
                    style={{ color: copy.accent }}
                  >
                    ← Back to sign in
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-[16px] border px-4 py-3 pr-12 text-[14px] outline-none transition-colors"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border)',
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2"
        style={{ color: 'var(--text-muted)' }}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[14px] border px-4 py-3 text-[13px]"
      style={{
        borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
        color: '#fca5a5',
      }}
    >
      {message}
    </motion.div>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 rounded-[14px] border px-4 py-3 text-[13px]"
      style={{
        borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)',
        background: 'color-mix(in srgb, var(--success) 8%, transparent)',
        color: '#6ee7b7',
      }}
    >
      <Check size={14} />
      {message}
    </motion.div>
  );
}
