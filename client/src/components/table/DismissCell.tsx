import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CircleX, Check, X } from 'lucide-react';

interface DismissCellProps {
  issueKey: string;
  onConfirm: (issueKey: string, e: React.MouseEvent) => void;
}

const AUTO_REVERT_MS = 3000;

export function DismissCell({ issueKey, onConfirm }: DismissCellProps) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const startConfirm = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirming(true);
    },
    []
  );

  const cancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirming(false);
    },
    []
  );

  const confirm = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirming(false);
      onConfirm(issueKey, e);
    },
    [issueKey, onConfirm]
  );

  // Auto-revert after timeout
  useEffect(() => {
    if (!confirming) return;
    timerRef.current = setTimeout(() => setConfirming(false), AUTO_REVERT_MS);
    return () => clearTimeout(timerRef.current);
  }, [confirming]);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 28, height: 28 }}
      data-dismiss-cell
    >
      <AnimatePresence mode="wait" initial={false}>
        {!confirming ? (
          <motion.button
            key="dismiss"
            type="button"
            onClick={startConfirm}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 rounded-md flex items-center justify-center transition-colors opacity-0 group-hover/row:opacity-50 hover:!opacity-100 hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-muted)' }}
            title="Dismiss — stop tracking this defect"
            aria-label={`Dismiss ${issueKey}`}
          >
            <CircleX size={15} />
          </motion.button>
        ) : (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center gap-0.5"
          >
            <button
              type="button"
              onClick={confirm}
              className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:scale-110 shrink-0"
              style={{
                color: 'var(--on-success)',
                background: 'var(--success)',
                boxShadow: '0 0 0 1px rgba(16,185,129,0.3), 0 1px 3px rgba(0,0,0,0.15)',
              }}
              title="Confirm dismiss"
              aria-label={`Confirm dismiss ${issueKey}`}
            >
              <Check size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={cancel}
              className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:scale-110 shrink-0"
              style={{
                color: 'var(--text-muted)',
                background: 'var(--bg-tertiary)',
                boxShadow: '0 0 0 1px var(--border)',
              }}
              title="Cancel"
              aria-label="Cancel dismiss"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
