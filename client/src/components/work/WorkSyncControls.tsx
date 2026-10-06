import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { formatRelativeTime } from '@/lib/utils';
import { describeSyncError } from '@/lib/sync-error';

/**
 * docs/56 UX-18: Jira sync state and the manual sync button live in the Work toolbar, so the global
 * header keeps one shape on every page. Hidden without a Jira connection (docs/56 P2-03).
 */
export function WorkSyncControls() {
  const { data: sync } = useSyncStatus();
  const triggerSync = useTriggerSync();
  const [, setTimeTick] = useState(0);

  useEffect(() => {
    // Relative sync timestamps only change on re-render; tick even when sync data is unchanged.
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (sync?.jiraConfigured === false) return null;

  const isSyncing = sync?.status === 'syncing' || triggerSync.isPending;
  const hasError = sync?.status === 'error';
  const autoSyncOff = sync?.autoSyncEnabled === false;
  const syncLabel = isSyncing
    ? 'Syncing…'
    : hasError
      ? `Sync issue · ${sync?.lastSuccessAt ? `last good ${formatRelativeTime(sync.lastSuccessAt)}` : 'never synced'}`
      : autoSyncOff
        ? 'Sync off'
        : sync?.lastSyncedAt
          ? `Synced ${formatRelativeTime(sync.lastSyncedAt)}`
          : 'Not synced';
  const syncTitle = hasError
    ? `${describeSyncError(sync?.errorMessage)}${autoSyncOff ? ' Jira auto-sync is off; manual sync is still available.' : ''}`
    : autoSyncOff
      ? 'Jira auto-sync is off. Manual sync is still available; turn it back on in Settings → Sync Scope.'
      : syncLabel;
  const dot = hasError ? 'var(--danger)' : isSyncing ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="flex items-center gap-1" data-testid="work-sync-controls">
      <span className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px]" style={{ color: 'var(--text-secondary)' }} title={syncTitle}>
        {autoSyncOff && !isSyncing && !hasError
          ? <CloudOff size={13} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          : <span className="h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden="true" />}
        <span className="whitespace-nowrap">{syncLabel}</span>
      </span>
      <button
        type="button"
        onClick={() => triggerSync.mutate()}
        disabled={isSyncing}
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
        title="Manual sync (r)"
        aria-label="Manual sync"
      >
        <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} style={{ color: 'var(--text-secondary)' }} />
      </button>
    </div>
  );
}
