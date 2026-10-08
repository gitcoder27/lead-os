import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import { SignInForm, type SignInMode } from '@/components/auth/SignInForm';
import type { UserRole } from '@/types';
import '@/components/landing/landing.css';

type LoginRole = Extract<UserRole, 'manager' | 'developer'>;

interface LoginPageProps {
  role?: LoginRole;
}

const ROLE_COPY = {
  manager: {
    title: 'Sign in to LeadOS',
    lede: 'Sign in to continue. You’ll land on the page you opened.',
    footnote: <a className="lp-text-btn" href="/">What is LeadOS?</a>,
  },
  developer: {
    title: 'Sign in to My Day',
    lede: 'Your current task, your plan for today and check-ins with your lead.',
    footnote: 'No account yet? Ask your lead for access.',
  },
} as const;

/**
 * The focused sign-in screen: deep links opened without a session (managers)
 * and `/my-day` (engineers). The public front door at `/` is the landing page,
 * which signs in through the same form.
 */
export function LoginPage({ role = 'developer' }: LoginPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<SignInMode>('sign-in');
  const copy = ROLE_COPY[role];
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <div className="lp lp-signin" data-landing-scroll>
      <div className="lp-hero-glow" aria-hidden="true" />
      <header className="lp-wrap lp-header-row lp-signin-bar">
        <a href="/" className="lp-brand" aria-label="LeadOS home">
          <span className="lp-brand-mark"><LeadOSMark size={22} /></span>
          <span className="lp-brand-name">LeadOS</span>
        </a>
        <div className="lp-header-actions">
          <button type="button" className="lp-icon-btn" onClick={toggleTheme} aria-label={`Switch to ${nextTheme} theme`} title={`Switch to ${nextTheme} theme`}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="lp-signin-main">
        <div className="lp-signin-panel">
          <h1 className="lp-signin-title">{mode === 'sign-in' ? copy.title : 'Change your password'}</h1>
          {mode === 'sign-in' ? <p className="lp-signin-lede">{copy.lede}</p> : null}
          <div className="lp-signin-form">
            <SignInForm onModeChange={setMode} footnote={copy.footnote} />
          </div>
        </div>
      </main>
    </div>
  );
}
