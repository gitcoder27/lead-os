import { CircleCheck, PlugZap, RefreshCw } from 'lucide-react';
import type { JiraSyncScopeMode, SyncStatus } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { SYNC_SCOPE_DESCRIPTIONS } from '@/lib/sync-scope';

const shell = 'flex-1 min-w-0 min-h-0 flex items-center justify-center p-4 text-center';
const card = 'max-w-[440px] rounded-2xl px-5 py-4';
const cardStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-strong)' } as const;

/** docs/56 P2-03: no Jira connection, which is a normal state, not a problem. */
export function JiraNotConnectedState({ onConnectJira, onAddTask }: { onConnectJira?: () => void; onAddTask: () => void }) {
  return (
    <div className={shell} data-testid="work-jira-not-connected">
      <div className={card} style={cardStyle}>
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
          <PlugZap size={18} aria-hidden="true" />
        </div>
        <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Connect Jira, or add tasks manually
        </p>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Work shows Jira defects once a connection is saved. Until then, your own tasks and notes live in Today and Tasks.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onConnectJira ? (
            <button type="button" className="ui-btn-solid" onClick={onConnectJira}>Connect Jira</button>
          ) : null}
          <button type="button" className="ui-btn" onClick={onAddTask}>Add a task</button>
        </div>
      </div>
    </div>
  );
}

/** docs/56 P2-03: Jira is connected but nothing has come back yet. Say what was tried, not "clean". */
export function NothingSyncedState({
  syncStatus,
  scopeMode,
  onOpenSyncSettings,
}: {
  syncStatus?: SyncStatus;
  scopeMode?: JiraSyncScopeMode;
  onOpenSyncSettings?: () => void;
}) {
  const lastSynced = syncStatus?.lastSyncedAt;
  const mode = scopeMode ?? syncStatus?.syncScope?.mode;
  const rosterSize = syncStatus?.syncScope?.rosterSize;
  const rosterOnly = mode === 'team_assignees';
  return (
    <div className={shell} data-testid="work-nothing-synced">
      <div className={card} style={cardStyle}>
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
          <RefreshCw size={18} aria-hidden="true" />
        </div>
        <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Jira is connected, but nothing has synced yet
        </p>
        <dl className="mt-3 space-y-1 text-left text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--text-muted)' }}>Last sync</dt>
            <dd>{lastSynced ? formatRelativeTime(lastSynced) : 'Never'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--text-muted)' }}>Issues synced</dt>
            <dd>{syncStatus?.issuesSynced ?? 0}</dd>
          </div>
          {mode ? (
            <div className="flex justify-between gap-4">
              <dt style={{ color: 'var(--text-muted)' }}>Scope</dt>
              <dd className="text-right">{SYNC_SCOPE_DESCRIPTIONS[mode]}</dd>
            </div>
          ) : null}
          {rosterSize !== undefined ? (
            <div className="flex justify-between gap-4">
              <dt style={{ color: 'var(--text-muted)' }}>Roster size</dt>
              <dd>{rosterSize === 1 ? '1 tracked person' : `${rosterSize} tracked people`}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {rosterOnly
            ? rosterSize === 0
              ? 'This scope only pulls issues assigned to people on your team, and your roster is empty, so nothing can match. Add team members, or switch the scope to include unassigned issues or the base query.'
              : 'This scope only pulls issues assigned to people on your team. If defects are unassigned or belong to someone else, switch the scope to include unassigned issues or the base query.'
            : 'Run a sync, and check the base query in Settings if it stays empty.'}
        </p>
        {onOpenSyncSettings ? (
          <button type="button" className="ui-btn mt-3" onClick={onOpenSyncSettings}>Open sync settings</button>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectCleanState() {
  return (
    <div className={shell}>
      <div>
        <CircleCheck size={18} className="mx-auto mb-2" style={{ color: 'var(--success)' }} aria-hidden="true" />
        <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>No open defects. Your project is clean.</p>
      </div>
    </div>
  );
}
