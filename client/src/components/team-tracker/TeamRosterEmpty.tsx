import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/context/ToastContext';
import { useAddManualDeveloper } from '@/hooks/useSettingsActions';
import { useSyncStatus } from '@/hooks/useSyncStatus';

function openTeamSettings() {
  window.history.pushState(null, '', '/settings?section=team');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * docs/56 UX-13: the Team page with nobody on the roster. It says what to do and lets the manager
 * add someone in place (a manual member, the same write as Settings → Team Members), with
 * "Import from Jira" only when Jira is connected.
 */
export function TeamRosterEmpty({ readOnly = false }: { readOnly?: boolean }) {
  const inputId = useId();
  const [name, setName] = useState('');
  const addMember = useAddManualDeveloper();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const sync = useSyncStatus();
  const jiraConnected = sync.data?.jiraConfigured === true;

  const submit = async () => {
    const displayName = name.trim();
    if (!displayName || addMember.isPending) return;
    try {
      await addMember.mutateAsync({ displayName, email: '' });
      setName('');
      addToast({ type: 'success', title: `Added ${displayName}` });
      for (const key of ['developers', 'team-tracker', 'today', 'workload']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (error) {
      addToast({ type: 'error', title: 'Could not add this person', message: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <EmptyState
      icon={<Users size={22} />}
      title="Add the people you manage"
      body="Each person gets a row here for their work, status and 1:1s. You can add more any time in Settings → Team Members."
      action={readOnly ? undefined : (
        <div className="flex flex-col items-center gap-2">
          <form
            className="flex flex-wrap items-center justify-center gap-2"
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
          >
            <label htmlFor={inputId} className="sr-only">Name</label>
            <input
              id={inputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name, e.g. Priya Raman"
              className="h-9 w-56 rounded-lg px-3 text-[13px] outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
            <button type="submit" className="ui-btn-solid inline-flex h-9 items-center gap-1.5" disabled={!name.trim() || addMember.isPending}>
              <UserPlus size={13} aria-hidden="true" />
              {addMember.isPending ? 'Adding…' : 'Add person'}
            </button>
          </form>
          {jiraConnected && (
            <button type="button" className="text-[12px] font-semibold underline" style={{ color: 'var(--accent)' }} onClick={openTeamSettings}>
              Import from Jira
            </button>
          )}
        </div>
      )}
    />
  );
}
