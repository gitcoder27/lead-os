import { useEffect } from 'react';
import { AlertTriangle, ArrowLeft, ArrowUpRight, Loader2, X } from 'lucide-react';
import { ItemDetailDrawer } from '@/components/manager-desk/ItemDetailDrawer';
import {
  useCancelDelegatedManagerDeskTask,
  useDeleteManagerDeskItem,
  usePromoteTrackerItem,
  useTrackerSharedTaskDetail,
  useUpdateManagerDeskItem,
} from '@/hooks/useManagerDesk';
import { useSetCurrentItem, useUpdateTrackerItem } from '@/hooks/useTeamTrackerMutations';
import { TrackerTaskExecutionPanel } from './TrackerTaskExecutionPanel';
import { useToast } from '@/context/ToastContext';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { RelatedIssueChips } from './RelatedIssueChips';

interface TrackerTaskDetailDrawerProps {
  trackerItemId: number | null;
  initialManagerDeskItemId: number | null;
  backTo?: string;
  onClose: () => void;
}

export function TrackerTaskDetailDrawer({
  trackerItemId,
  initialManagerDeskItemId,
  backTo,
  onClose,
}: TrackerTaskDetailDrawerProps) {
  const { addToast } = useToast();
  const detailQuery = useTrackerSharedTaskDetail({
    trackerItemId,
    managerDeskItemId: initialManagerDeskItemId,
  });
  const detail = detailQuery.data;
  const detailDate = detail?.date ?? '';
  const updateManagerDeskItem = useUpdateManagerDeskItem(detailDate);
  const deleteManagerDeskItem = useDeleteManagerDeskItem(detailDate);
  const cancelDelegated = useCancelDelegatedManagerDeskTask(detailDate);
  const updateTrackerItem = useUpdateTrackerItem(detailDate);
  const setCurrentItem = useSetCurrentItem(detailDate);
  const promoteItem = usePromoteTrackerItem();
  const isOpen = trackerItemId !== null || initialManagerDeskItemId !== null;

  const isLinked = detail?.lifecycle === 'manager_desk_linked';

  if (!isOpen) {
    return null;
  }

  if (detail && !isLinked) {
    return (
      <TrackerOnlyDrawer
        detail={detail}
        isOpen={isOpen}
        backTo={backTo}
        onClose={onClose}
        isPromoting={promoteItem.isPending}
        onPromote={() => {
          promoteItem.mutate(detail.trackerItem.id, {
            onSuccess: () => addToast('Promoted to Manager Follow-Up', 'success'),
            onError: (err) => addToast(err.message, 'error'),
          });
        }}
        updateTrackerItem={updateTrackerItem}
        setCurrentItem={setCurrentItem}
      />
    );
  }

  return (
    <ItemDetailDrawer
      item={detail?.managerDeskItem ?? null}
      open={isOpen}
      date={detailDate}
      onClose={onClose}
      ariaLabel="Team Tracker task detail"
      showLinkedIssueDescription={false}
      stacked
      onUpdate={(managerDeskItemId, updates) =>
        updateManagerDeskItem.mutate({ itemId: managerDeskItemId, ...updates })
      }
      onDelete={(managerDeskItemId) =>
        deleteManagerDeskItem.mutate(managerDeskItemId, { onSuccess: onClose })
      }
      onCancelDelegatedTask={(managerDeskItemId) =>
        cancelDelegated.mutate(managerDeskItemId, {
          onSuccess: () => addToast('Delegated task cancelled', 'success'),
          onError: (err) => addToast(err.message, 'error'),
        })
      }
      isCancelDelegatedPending={cancelDelegated.isPending}
      topSlot={
        <>
          <BackToDeveloperRow label={backTo} onBack={onClose} className="px-4 pt-3 md:px-5" />
          {detail ? (
            <TrackerTaskExecutionPanel
              developer={detail.developer}
              item={detail.trackerItem}
              isPending={updateTrackerItem.isPending || setCurrentItem.isPending}
              onSetCurrent={(id) => setCurrentItem.mutate(id)}
              onUpdateState={(id, state) => updateTrackerItem.mutate({ itemId: id, state })}
              onUpdateNote={(id, note) =>
                updateTrackerItem.mutateAsync({ itemId: id, note }).then(() => undefined)
              }
            />
          ) : null}
        </>
      }
      placeholder={
        <TrackerTaskDetailPlaceholder
          isLoading={detailQuery.isLoading || (!detail && !detailQuery.isError)}
          errorMessage={detailQuery.isError ? (detailQuery.error as Error).message : null}
          onClose={onClose}
          onRetry={() => void detailQuery.refetch()}
        />
      }
    />
  );
}

// ── Tracker-only drawer (no Manager Desk data) ─────────

function TrackerOnlyDrawer({
  detail,
  isOpen,
  backTo,
  onClose,
  isPromoting,
  onPromote,
  updateTrackerItem,
  setCurrentItem,
}: {
  detail: NonNullable<ReturnType<typeof useTrackerSharedTaskDetail>['data']>;
  isOpen: boolean;
  backTo?: string;
  onClose: () => void;
  isPromoting: boolean;
  onPromote: () => void;
  updateTrackerItem: ReturnType<typeof useUpdateTrackerItem>;
  setCurrentItem: ReturnType<typeof useSetCurrentItem>;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const item = detail.trackerItem;
  const dev = detail.developer;

  return (
    <>
      {/* Backdrop */}
      <div
        className="workspace-shell-backdrop fixed inset-x-0 bottom-0 z-[70]"
        style={{ background: 'rgba(4,8,14,0.52)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className="workspace-shell-drawer fixed right-0 z-[71] flex w-full max-w-lg flex-col overflow-hidden"
        style={{
          background: 'var(--bg-primary)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '0 0 60px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Team Tracker task detail"
      >
        {/* Header */}
        <div
          className="shrink-0 border-b px-4 pb-4 pt-3 md:px-5"
          style={{
            borderColor: 'var(--border)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 94%, var(--accent-glow) 6%) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 100%)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Tracker Only
                </span>
              </div>
              <div className="mt-2 text-[18px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                {item.title}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                <span>{dev.displayName}</span>
                {item.jiraKey && (
                  <>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <JiraIssueLink
                      issueKey={item.jiraKey}
                      className="font-mono text-[12px] font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      {item.jiraKey}
                    </JiraIssueLink>
                  </>
                )}
              </div>
              <RelatedIssueChips issueKeys={item.relatedIssueKeys} compact className="mt-2" />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Close item detail"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:px-5 space-y-4">
          <BackToDeveloperRow label={backTo} onBack={onClose} />
          <TrackerTaskExecutionPanel
            developer={dev}
            item={item}
            isPending={updateTrackerItem.isPending || setCurrentItem.isPending}
            onSetCurrent={(id) => setCurrentItem.mutate(id)}
            onUpdateState={(id, state) => updateTrackerItem.mutate({ itemId: id, state })}
            onUpdateNote={(id, note) =>
              updateTrackerItem.mutateAsync({ itemId: id, note }).then(() => undefined)
            }
          />

          {/* Promote CTA */}
          <div
            className="rounded-[20px] border p-4"
            style={{
              borderColor: 'color-mix(in srgb, var(--accent) 18%, var(--border) 82%)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--accent-glow) 20%, transparent) 0%, var(--bg-secondary) 100%)',
            }}
          >
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Promote to Manager Follow-Up
            </div>
            <div className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Create a Manager Desk item linked to this tracker task. This enables priority, status tracking, and linking from Manager Desk.
            </div>
            <button
              type="button"
              onClick={onPromote}
              disabled={isPromoting}
              className="mt-3 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 90%, transparent), color-mix(in srgb, var(--accent) 70%, transparent))',
                color: 'var(--bg-primary)',
                boxShadow: '0 2px 12px color-mix(in srgb, var(--accent) 25%, transparent)',
              }}
            >
              <ArrowUpRight size={13} strokeWidth={2.5} />
              {isPromoting ? 'Promoting…' : 'Promote to Manager Follow-Up'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Back row (stacked over a developer panel) ───────────

function BackToDeveloperRow({
  label,
  onBack,
  className,
}: {
  label?: string;
  onBack: () => void;
  className?: string;
}) {
  if (!label) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors hover:brightness-125"
        style={{ color: 'var(--text-secondary)' }}
        aria-label={`Back to ${label}`}
      >
        <ArrowLeft size={13} />
        <span className="truncate">Back to {label}</span>
      </button>
    </div>
  );
}

// ── Placeholder (loading / error states) ────────────────

function TrackerTaskDetailPlaceholder({
  isLoading,
  errorMessage,
  onClose,
  onRetry,
}: {
  isLoading: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className="shrink-0 border-b px-4 pb-4 pt-3 md:px-5"
        style={{
          borderColor: 'var(--border)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 94%, var(--md-accent-dim) 6%) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 100%)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--md-accent)' }}>
              Item Detail
            </div>
            <div className="mt-2 text-[20px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
              {isLoading ? 'Opening task detail' : 'Could not open task detail'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close item detail"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6 md:p-8">
        <div
          className="w-full max-w-md rounded-[24px] border px-5 py-6"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 72%, transparent) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 100%)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--soft-shadow)',
          }}
        >
          <div className="flex items-start gap-3">
            {isLoading ? (
              <Loader2 size={16} className="mt-0.5 animate-spin" style={{ color: 'var(--accent)' }} />
            ) : (
              <AlertTriangle size={16} className="mt-0.5" style={{ color: 'var(--warning)' }} />
            )}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isLoading ? 'Loading task detail' : 'Task detail is unavailable'}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {isLoading
                  ? 'Loading tracker task detail and execution context.'
                  : errorMessage}
              </div>
            </div>
          </div>
          {!isLoading ? (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-xl px-3 py-1.5 text-[12px] font-semibold"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-[12px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Close
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
