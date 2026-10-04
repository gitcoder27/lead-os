import { useMemo, useState } from 'react';
import { TriangleAlert, Loader2, RefreshCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  useWorkspaceMaintenancePreview,
  useWorkspaceMaintenanceReset,
} from '@/hooks/useWorkspaceMaintenance';
import type {
  WorkspaceMaintenanceResetTarget,
} from '@/types';

const CONFIRMATION_TEXT: Record<WorkspaceMaintenanceResetTarget, string> = {
  manager_desk: 'CLEAR MANAGER DESK',
  team_tracker: 'CLEAR TEAM TRACKER',
  workspace: 'CLEAR EVERYTHING',
};

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

interface SettingsMaintenanceSectionProps {
  active: boolean;
}

export function SettingsMaintenanceSection({
  active,
}: SettingsMaintenanceSectionProps) {
  const { addToast } = useToast();
  const previewQuery = useWorkspaceMaintenancePreview(active);
  const resetMutation = useWorkspaceMaintenanceReset();
  const [armedTarget, setArmedTarget] = useState<WorkspaceMaintenanceResetTarget | null>(null);
  const [confirmationText, setConfirmationText] = useState('');

  const fullResetCounts = useMemo(
    () =>
      previewQuery.data
        ? [
            formatCount(previewQuery.data.managerDesk.itemCount, 'desk task'),
            formatCount(previewQuery.data.teamTracker.itemCount, 'tracker item'),
            formatCount(previewQuery.data.teamTracker.checkInCount, 'check-in'),
          ]
        : [],
    [previewQuery.data]
  );

  const armAction = (target: WorkspaceMaintenanceResetTarget) => {
    setArmedTarget(target);
    setConfirmationText('');
  };

  const closeAction = () => {
    setArmedTarget(null);
    setConfirmationText('');
  };

  const handleRunReset = (target: WorkspaceMaintenanceResetTarget) => {
    resetMutation.mutate(
      {
        target,
        confirmationText,
      },
      {
        onSuccess: (result) => {
          closeAction();
          void previewQuery.refetch();
          addToast({
            type: 'success',
            title: 'Maintenance reset complete',
            message: result.backup
              ? `A pre-reset backup was created: ${result.backup.name}`
              : 'The selected workspace data was cleared successfully.',
          });
        },
        onError: (error) => {
          addToast({
            type: 'error',
            title: 'Reset failed',
            message: error instanceof Error ? error.message : 'Please try again.',
          });
        },
      },
    );
  };

  if (previewQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-4 py-4 text-[13px]" style={{ background: 'var(--settings-inset-bg)', border: 'var(--settings-inset-border)', color: 'var(--text-secondary)' }}>
        <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
        Loading maintenance preview…
      </div>
    );
  }

  if (previewQuery.isError || !previewQuery.data) {
    return (
      <div className="space-y-3 rounded-xl p-4" style={{ background: 'var(--settings-danger-soft-bg)', border: 'var(--settings-danger-soft-border)' }}>
        <div className="flex items-start gap-2">
          <TriangleAlert size={15} style={{ color: 'var(--danger-muted)' }} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--danger-muted)' }}>
              Maintenance preview unavailable
            </p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              We couldn&apos;t load the reset counts right now. Retry before running anything destructive.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void previewQuery.refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
          style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
        >
          <RefreshCcw size={12} />
          Retry Preview
        </button>
      </div>
    );
  }

  const preview = previewQuery.data;

  return (
    <div className="max-w-[860px] space-y-6">
      <div
        className="rounded-2xl p-4"
        style={{
          background: 'var(--settings-warning-soft-bg)',
          border: 'var(--settings-warning-soft-border)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--warning) 18%, var(--bg-primary))', color: 'var(--warning)' }}
            >
              <ShieldAlert size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Use maintenance resets only for duplicate cleanup, test data wipes, or recovery after a bad migration.
              </p>
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                The tasks reset is scoped to your own tasks. The Team board reset clears shared board history, check-ins, availability, and your saved board views.
              </p>
              <p className="mt-2 text-[12px]" style={{ color: preview.backupBeforeReset ? 'var(--success)' : 'var(--warning)' }}>
                {preview.backupBeforeReset
                  ? 'Automatic pre-reset backup is enabled.'
                  : 'Automatic pre-reset backup is currently disabled in backup settings.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void previewQuery.refetch()}
            disabled={previewQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
          >
            {previewQuery.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
            Refresh Counts
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MaintenanceActionCard
          target="manager_desk"
          title="Reset my tasks"
          description="Clear your tasks, their days, links, and history. Team board tasks created from them are removed too."
          counts={[
            formatCount(preview.managerDesk.itemCount, 'task'),
            formatCount(preview.managerDesk.dayCount, 'day'),
            formatCount(preview.managerDesk.historyCount, 'history row'),
            formatCount(preview.managerDesk.linkedTrackerItemCount, 'linked tracker item'),
          ]}
          expectedText={CONFIRMATION_TEXT.manager_desk}
          armed={armedTarget === 'manager_desk'}
          confirmationText={confirmationText}
          running={resetMutation.isPending && resetMutation.variables?.target === 'manager_desk'}
          onArm={() => armAction('manager_desk')}
          onCancel={closeAction}
          onChangeConfirmation={setConfirmationText}
          onRun={() => handleRunReset('manager_desk')}
        />

        <MaintenanceActionCard
          target="team_tracker"
          title="Reset Team board"
          description="Clear all Team board days, items, check-ins, availability periods, and your saved board views. Your own tasks stay intact."
          counts={[
            formatCount(preview.teamTracker.itemCount, 'tracker item'),
            formatCount(preview.teamTracker.dayCount, 'tracker day'),
            formatCount(preview.teamTracker.checkInCount, 'check-in'),
            formatCount(preview.teamTracker.availabilityPeriodCount, 'availability period'),
          ]}
          expectedText={CONFIRMATION_TEXT.team_tracker}
          armed={armedTarget === 'team_tracker'}
          confirmationText={confirmationText}
          running={resetMutation.isPending && resetMutation.variables?.target === 'team_tracker'}
          onArm={() => armAction('team_tracker')}
          onCancel={closeAction}
          onChangeConfirmation={setConfirmationText}
          onRun={() => handleRunReset('team_tracker')}
        />

        <MaintenanceActionCard
          target="workspace"
          title="Reset Both Workspaces"
          description="Start fresh by clearing your tasks and the Team board together. This is the right option when duplicate migration data has polluted both."
          counts={fullResetCounts}
          expectedText={CONFIRMATION_TEXT.workspace}
          armed={armedTarget === 'workspace'}
          confirmationText={confirmationText}
          running={resetMutation.isPending && resetMutation.variables?.target === 'workspace'}
          onArm={() => armAction('workspace')}
          onCancel={closeAction}
          onChangeConfirmation={setConfirmationText}
          onRun={() => handleRunReset('workspace')}
        />
      </div>
    </div>
  );
}

function MaintenanceActionCard({
  target,
  title,
  description,
  counts,
  expectedText,
  armed,
  confirmationText,
  running,
  onArm,
  onCancel,
  onChangeConfirmation,
  onRun,
}: {
  target: WorkspaceMaintenanceResetTarget;
  title: string;
  description: string;
  counts: string[];
  expectedText: string;
  armed: boolean;
  confirmationText: string;
  running: boolean;
  onArm: () => void;
  onCancel: () => void;
  onChangeConfirmation: (value: string) => void;
  onRun: () => void;
}) {
  const canRun = confirmationText.trim().toUpperCase() === expectedText;

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--settings-pane-bg)',
        border: 'var(--settings-danger-soft-border)',
      }}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)' }}
        >
          <Trash2 size={14} />
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {counts.map((count) => (
          <span
            key={`${target}-${count}`}
            className="rounded-full px-2 py-1 text-[12px] font-semibold"
            style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
          >
            {count}
          </span>
        ))}
      </div>

      {!armed ? (
        <button
          type="button"
          onClick={onArm}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
          style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
          aria-label={`Arm ${title}`}
        >
          <TriangleAlert size={12} />
          Arm Reset
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-xl p-3" style={{ background: 'var(--settings-inset-bg)', border: 'var(--settings-inset-border)' }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--danger-muted)' }}>
            Type {expectedText} to confirm
          </p>
          <input
            type="text"
            value={confirmationText}
            onChange={(event) => onChangeConfirmation(event.target.value)}
            placeholder={expectedText}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
            aria-label={`Confirmation text for ${title}`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun || running}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
              aria-label={`Run ${title}`}
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {running ? 'Running…' : 'Run Reset'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
