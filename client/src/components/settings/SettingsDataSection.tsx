import { useState } from 'react';
import { Database, Download, Loader2, Terminal } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { backupDownloadUrl, useBackups, useRunBackup } from '@/hooks/useBackups';
import { useConfig } from '@/hooks/useConfig';
import { useSaveSettingsConfig } from '@/hooks/useSettingsActions';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

const INTERVAL_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Once a day' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const cardStyle = { background: 'var(--settings-pane-bg)', border: 'var(--settings-pane-border)' } as const;

/**
 * docs/56 P6-01: Settings → Data. Backup schedule, "Back up now", the snapshot list with
 * download. Restore is deliberately CLI-only: it replaces the live database.
 */
export function SettingsDataSection({ active }: { active: boolean }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const backups = useBackups(active);
  const config = useConfig();
  const runBackup = useRunBackup();
  const saveSettings = useSaveSettingsConfig();
  const [error, setError] = useState<string | null>(null);

  const runtime = backups.data?.runtime;
  const list = backups.data?.backups ?? [];
  const enabled = config.data?.backupEnabled ?? runtime?.enabled ?? false;
  const intervalMinutes = config.data?.backupIntervalMinutes;
  const retentionDays = config.data?.backupRetentionDays;
  const directory = runtime?.directory ?? config.data?.backupDirectory ?? '';
  const latest = list[0];

  const saveSchedule = async (payload: { backupEnabled?: boolean; backupIntervalMinutes?: number; backupRetentionDays?: number }) => {
    setError(null);
    try {
      await saveSettings.mutateAsync(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['config'] }),
        queryClient.invalidateQueries({ queryKey: ['backups'] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The backup schedule could not be saved.');
    }
  };

  const handleBackupNow = async () => {
    setError(null);
    try {
      const result = await runBackup.mutateAsync();
      addToast({ type: 'success', title: 'Backup created', message: `${result.backup.name} (${formatSize(result.backup.sizeBytes)})` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The backup could not be created.');
    }
  };

  const intervalOptions = intervalMinutes && !INTERVAL_OPTIONS.some((option) => option.minutes === intervalMinutes)
    ? [...INTERVAL_OPTIONS, { minutes: intervalMinutes, label: `Every ${intervalMinutes} minutes` }].sort((a, b) => a.minutes - b.minutes)
    : INTERVAL_OPTIONS;

  return (
    <div className="max-w-[720px] space-y-6" data-testid="settings-data">
      <div className="rounded-xl px-4 py-3.5" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              <Database size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Backups</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Snapshots of the whole LeadOS database, taken on a schedule and before resets.
                {latest ? ` Last backup ${formatRelativeTime(latest.createdAt)}.` : ' No backup yet.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ui-btn-solid shrink-0"
            onClick={() => void handleBackupNow()}
            disabled={runBackup.isPending || runtime?.running}
          >
            {runBackup.isPending ? <Loader2 size={12} className="mr-1.5 inline animate-spin" aria-hidden="true" /> : null}
            {runBackup.isPending ? 'Backing up…' : 'Back up now'}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>
        ) : null}
        {runtime?.lastError && !error ? (
          <p role="alert" className="mt-3 text-[12px]" style={{ color: 'var(--danger)' }}>Last backup failed: {runtime.lastError}</p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 sm:col-span-3" style={{ background: 'var(--settings-input-bg)', border: 'var(--settings-inset-border)' }}>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Scheduled backups</span>
              <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {enabled
                  ? runtime?.nextRunAt ? `On. Next backup ${formatRelativeTime(runtime.nextRunAt)}.` : 'On.'
                  : 'Off. Only manual and pre-reset backups are taken.'}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Scheduled backups"
              checked={enabled}
              disabled={saveSettings.isPending || !config.data}
              onChange={(event) => void saveSchedule({ backupEnabled: event.target.checked })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Frequency
            <select
              className="ui-input"
              aria-label="Backup frequency"
              value={intervalMinutes ?? ''}
              disabled={saveSettings.isPending || !config.data}
              onChange={(event) => void saveSchedule({ backupIntervalMinutes: Number(event.target.value) })}
            >
              {intervalMinutes === undefined ? <option value="">…</option> : null}
              {intervalOptions.map((option) => (
                <option key={option.minutes} value={option.minutes}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Keep for (days)
            <input
              className="ui-input"
              type="number"
              min={1}
              aria-label="Backup retention days"
              key={retentionDays ?? 'loading'}
              defaultValue={retentionDays}
              disabled={saveSettings.isPending || !config.data}
              onBlur={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 1 && next !== retentionDays) {
                  void saveSchedule({ backupRetentionDays: next });
                }
              }}
            />
          </label>
          <div className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Stored in
            <code className="truncate rounded-md px-2 py-1.5 text-[11.5px]" title={directory} style={{ background: 'var(--settings-code-bg)', color: 'var(--text-secondary)' }}>
              {directory || '—'}
            </code>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Snapshots</h3>
        {backups.isLoading ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>Loading backups…</p>
        ) : backups.isError ? (
          <p role="alert" className="mt-2 text-[12px]" style={{ color: 'var(--danger)' }}>Backups could not be loaded.</p>
        ) : list.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>No snapshots yet. Use “Back up now” to take the first one.</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-xl" style={{ border: 'var(--settings-pane-border)' }} aria-label="Backup snapshots">
            {list.map((backup, index) => (
              <li
                key={backup.name}
                className="flex items-center gap-3 px-3.5 py-2"
                style={{ borderTop: index > 0 ? 'var(--settings-row-divider)' : 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }} title={backup.name}>{backup.name}</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="capitalize">{backup.reason}</span> · {formatAbsoluteDateTime(backup.createdAt)} ({formatRelativeTime(backup.createdAt)}) · {formatSize(backup.sizeBytes)}
                  </p>
                </div>
                <a
                  className="ui-btn inline-flex shrink-0 items-center gap-1.5"
                  href={backupDownloadUrl(backup.name)}
                  download={backup.name}
                  aria-label={`Download ${backup.name}`}
                >
                  <Download size={12} aria-hidden="true" /> Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl px-4 py-3.5" style={cardStyle}>
        <div className="flex items-center gap-2">
          <Terminal size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Restoring a backup</h3>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Restore is not available in the app, because it replaces the live database. Stop the server and run this on the machine that hosts LeadOS:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--settings-code-bg)', color: 'var(--text-primary)' }}>
          <code>npm run backup:restore -- &lt;path-to-backup-db&gt;</code>
        </pre>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Backups live on the same machine as the database. Download one now and then, or copy the folder off the machine (rsync or object storage). See docs/23 for a scheduled copy.
        </p>
      </div>
    </div>
  );
}
