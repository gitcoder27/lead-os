import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useSelfLink, useSetSelfLink } from '@/hooks/useSelfLink';
import type { Developer } from '@/types';

/**
 * Settings → Team Members: which roster record is the logged-in manager. If you are on the roster
 * you are one person, and "You" then covers your login and this record on Tasks, Today and Team.
 * docs/56 UX-15: one question above the list instead of a "This is me" chip on every row.
 */
export function SelfLinkSelect({ members, disabled }: { members: Pick<Developer, 'accountId' | 'displayName'>[]; disabled?: boolean }) {
  const selectId = useId();
  const { data: link } = useSelfLink();
  const setLink = useSetSelfLink();
  const { addToast } = useToast();
  if (!link || members.length === 0) return null;

  const choose = async (accountId: string) => {
    const next = accountId || null;
    if (next === link.developerAccountId) return;
    const member = members.find((candidate) => candidate.accountId === next);
    try {
      await setLink.mutateAsync(next);
      addToast(member
        ? { type: 'success', title: 'Linked to you', message: `${member.displayName} is you: your own tasks show on that Team row, and Tasks and Today count it as yours.` }
        : { type: 'success', title: 'Unlinked', message: 'Nobody on the roster is marked as you.' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not save', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        Which one is you?
      </label>
      <select
        id={selectId}
        value={link.developerAccountId ?? ''}
        disabled={disabled || setLink.isPending}
        onChange={(event) => void choose(event.target.value)}
        className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12.5px] outline-none disabled:opacity-50"
        style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
      >
        <option value="">I'm not on this list</option>
        {members.map((member) => (
          <option key={member.accountId} value={member.accountId}>
            {member.displayName}
            {!link.developerAccountId && link.suggestedDeveloperAccountId === member.accountId ? ' (matches your Jira account)' : ''}
          </option>
        ))}
      </select>
      {setLink.isPending ? <Loader2 size={12} className="animate-spin" aria-label="Saving" /> : null}
    </div>
  );
}
