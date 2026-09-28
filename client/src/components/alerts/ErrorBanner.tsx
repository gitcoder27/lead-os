import { TriangleAlert } from 'lucide-react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useOverview } from '@/hooks/useOverview';
import { AnimatePresence, motion } from 'framer-motion';

export function ErrorBanner() {
  const { error: overviewError } = useOverview();
  const { data: syncStatus } = useSyncStatus();

  const isApiDown = !!overviewError;
  const isSyncError = syncStatus?.status === 'error';
  const isRateLimited = syncStatus?.errorMessage?.toLowerCase().includes('rate limit');

  const message = isRateLimited
    ? 'Jira rate limit hit. Auto-retrying shortly.'
    : isApiDown
    ? 'Cannot reach server. Showing last known data.'
    : isSyncError
    ? `Sync error: ${syncStatus.errorMessage}`
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
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
