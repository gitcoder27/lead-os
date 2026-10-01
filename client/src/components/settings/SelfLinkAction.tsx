import { Check, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useSelfLink, useSetSelfLink } from '@/hooks/useSelfLink';
import type { Developer } from '@/types';

/**
 * Settings → Team Members: marks which roster record is the logged-in manager. If you are on the roster
 * you are one person, and "You" then covers your login and this record on Tasks, Today and Team.
 */
export function SelfLinkAction({ member, disabled }: { member: Pick<Developer, 'accountId' | 'displayName'>; disabled?: boolean }) {
  const { data: link } = useSelfLink();
  const setLink = useSetSelfLink();
  const { addToast } = useToast();
  if (!link) return null;

  const isMe = link.developerAccountId === member.accountId;
  // Someone else is already marked: offering a second "me" would silently move the link.
  if (link.developerAccountId && !isMe) return null;
  const suggested = !isMe && link.suggestedDeveloperAccountId === member.accountId;

  const toggle = async () => {
    try {
      await setLink.mutateAsync(isMe ? null : member.accountId);
      addToast(isMe
        ? { type: 'success', title: 'Unlinked', message: `${member.displayName} is a regular team member again.` }
        : { type: 'success', title: 'Linked to you', message: 'Your own tasks now show on your Team row, and Tasks and Today count this record as yours.' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not save', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled || setLink.isPending}
      aria-pressed={isMe}
      aria-label={`This is me: ${member.displayName}`}
      title={isMe ? 'Click to unlink. This record is you.' : suggested ? 'Matches the Jira account saved as yours' : 'Mark this team member as you'}
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
      style={isMe
        ? { background: 'var(--settings-accent-soft-bg)', color: 'var(--accent-text, var(--accent))', border: 'var(--settings-accent-soft-border)' }
        : { background: 'transparent', color: suggested ? 'var(--accent-text, var(--accent))' : 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
    >
      {setLink.isPending ? <Loader2 size={10} className="animate-spin" /> : isMe ? <Check size={10} /> : null}
      {isMe ? 'You' : suggested ? 'This is me?' : 'This is me'}
    </button>
  );
}
