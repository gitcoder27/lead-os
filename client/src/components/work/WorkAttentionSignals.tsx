import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { TriangleAlert } from 'lucide-react';
import { useAlerts, useDismissAlerts } from '@/hooks/useAlerts';
import { useToast } from '@/context/ToastContext';
import { SignalRow, signalTarget } from '@/components/actions/ManagerActionInbox';
import type { ManagerActionTarget } from '@/types';

/**
 * docs/56 UX-30: Jira attention signals (overdue, stale, blocked, high priority not started) live on
 * Work, where defects are triaged — not in the header inbox, which carries task updates only.
 */
export function WorkAttentionSignals({ onOpenTarget }: { onOpenTarget?: (target: ManagerActionTarget) => void }) {
  const [open, setOpen] = useState(false);
  const alerts = useAlerts();
  const dismiss = useDismissAlerts();
  const { addToast } = useToast();
  const signals = alerts.data ?? [];
  if (signals.length === 0) return null;

  const runDismiss = (alertIds: string[]) => {
    dismiss.mutate({ alertIds }, {
      onError: () => addToast({ type: 'error', title: 'Failed to update alerts', message: 'The alert list could not be updated. Please try again.' }),
    });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="ui-btn-ghost inline-flex h-8 items-center gap-1.5" aria-label={`Attention signals, ${signals.length}`}>
          <TriangleAlert size={14} aria-hidden="true" style={{ color: 'var(--warning)' }} />
          <span>Signals</span>
          <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{signals.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-popover w-[360px] max-w-[calc(100vw-24px)] rounded-xl border py-1.5"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', boxShadow: 'var(--overlay-shadow)' }}
          aria-label="Attention signals"
        >
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>Attention signals</span>
            <button
              type="button"
              onClick={() => runDismiss(signals.map((alert) => alert.id))}
              disabled={dismiss.isPending}
              className="rounded px-1.5 py-0.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-45"
              style={{ color: 'var(--text-muted)' }}
            >
              Clear all
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {signals.map((alert) => (
              <SignalRow
                key={alert.id}
                alert={alert}
                onOpen={() => {
                  setOpen(false);
                  onOpenTarget?.(signalTarget(alert));
                }}
                onDismiss={() => runDismiss([alert.id])}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
