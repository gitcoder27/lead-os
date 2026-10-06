import { TriangleAlert } from 'lucide-react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useOverview } from '@/hooks/useOverview';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { describeSyncError } from '@/lib/sync-error';
import { formatRelativeTime } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

export function ErrorBanner() {
  const { error: overviewError } = useOverview();
  const { data: syncStatus } = useSyncStatus();
  const triggerSync = useTriggerSync();

  const isApiDown = !!overviewError;
  // docs/56 P2-03: a workspace without Jira has nothing to fail; no red banner for it.
  const isSyncError = syncStatus?.status === 'error' && syncStatus.jiraConfigured !== false;
  const isRateLimited = syncStatus?.jiraConfigured !== false && syncStatus?.errorMessage?.toLowerCase().includes('rate limit');

  const message = isRateLimited
    ? 'Jira rate limit hit. Auto-retrying shortly.'
    : isApiDown
    ? 'Cannot reach server. Showing last known data.'
    : isSyncError
    ? describeSyncError(syncStatus.errorMessage)
    : null;

  if (!message) return null;

  const isWarning = isRateLimited || isApiDown;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="mx-2 mt-1.5 rounded-[14px] px-2.5 py-2 flex items-start gap-2 text-[13px] font-medium md:mx-2.5 md:mt-2"
        style={{
          background: isWarning
            ? 'linear-gradient(180deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.06) 100%)'
            : 'linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.06) 100%)',
          border: `1px solid ${isWarning ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`,
          color: isWarning ? 'var(--warning)' : 'var(--danger)',
          boxShadow: 'var(--soft-shadow)',
        }}
      >
        <span className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: isWarning ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.14)' }}>
          <TriangleAlert size={13} />
        </span>
        <div>
          <div className="text-[13px]" style={{ color: isWarning ? 'var(--warning)' : 'var(--danger)' }}>
            {message}
          </div>
          {!isWarning && (
            <>
              {syncStatus?.lastSuccessAt && (
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Data last updated {formatRelativeTime(syncStatus.lastSuccessAt)}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => triggerSync.mutate()}
                  disabled={syncStatus?.status === 'syncing' || triggerSync.isPending}
                  className="rounded-md border border-current px-2 py-1 disabled:opacity-50"
                >
                  Retry
                </button>
                <a
                  href="/settings?section=connection"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    window.history.pushState({}, '', '/settings?section=connection');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="underline underline-offset-2"
                >
                  Open Settings
                </a>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
