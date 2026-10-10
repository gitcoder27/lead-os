import { useState } from 'react';
import { LoaderCircle, LockKeyhole, MailCheck } from 'lucide-react';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import { Dialog } from '@/components/ui/Dialog';
import { useInvite } from '@/hooks/useSignUp';
import { ApiRequestError } from '@/lib/api';
import { SignInForm, type SignInMode } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import './auth.css';

export function JoinDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const invite = useInvite(token);
  const [mode, setMode] = useState<'sign-up' | SignInMode>('sign-up');
  const valid = invite.data?.valid === true;
  const closed = invite.error instanceof ApiRequestError && invite.error.status === 404;
  const unavailable = invite.isError && !closed;
  const signIn = mode !== 'sign-up';
  const title = signIn ? mode === 'change-password' ? 'Change your password' : 'Sign in to LeadOS' : invite.isPending ? 'Your LeadOS invite' : valid ? 'Create your account' : closed ? 'Registration is closed' : unavailable ? 'Let’s try that again' : 'A fresh invite is needed';
  return <Dialog title={title} subtitle={!signIn && valid ? 'A workspace of your own, ready for your day.' : undefined} icon={<LeadOSMark size={18} />} size="sm" onClose={onClose}>
    <div className="auth-join">
      {signIn ? <>
        <SignInForm onModeChange={setMode} />
        {valid ? <p className="auth-switch">New to LeadOS? <button type="button" className="ui-link auth-link" onClick={() => setMode('sign-up')}>Create account</button></p> : null}
      </> : invite.isPending ? <div className="auth-entry-state" role="status"><LoaderCircle size={22} className="auth-spinner" aria-hidden="true" /><p>Checking your invite…</p></div>
        : valid && token ? <SignUpForm inviteToken={token} onSignIn={() => setMode('sign-in')} />
          : <div className="auth-entry-state" role={unavailable ? 'alert' : 'status'}>
            <span className="auth-entry-icon" aria-hidden="true">{closed ? <LockKeyhole size={24} /> : <MailCheck size={24} />}</span>
            <p>{closed ? 'New accounts are paused on this instance. Existing accounts can still sign in.' : unavailable ? invite.error?.message || 'We couldn’t check your invite. Please try again.' : 'This link may have expired or already been used. Ask the person who invited you for a new link.'}</p>
            {unavailable ? <button type="button" className="ui-btn auth-submit" onClick={() => void invite.refetch()}>Try again</button> : null}
            <button type="button" className="ui-btn-solid auth-submit" onClick={() => setMode('sign-in')}>Sign in</button>
          </div>}
    </div>
  </Dialog>;
}
