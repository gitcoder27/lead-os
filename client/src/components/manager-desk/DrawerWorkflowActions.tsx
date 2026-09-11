import { Archive, ArrowRight, CheckCircle2, MoreHorizontal, RotateCcw, XCircle } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';
import { STATUS_LABELS } from '@/types/manager-desk';

interface DrawerWorkflowActionsProps {
  item: ManagerDeskItem;
  hasLinkedWork: boolean;
  onUpdate: (itemId: number, updates: Record<string, unknown>) => void;
  onCarryForward?: () => void;
  isCarryForwardPending?: boolean;
}

interface WorkflowAction {
  label: string;
  icon: ReactNode;
  tone: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

const toneStyles: Record<WorkflowAction['tone'], CSSProperties> = {
  primary: {
    background: 'rgba(217,169,78,0.16)',
    color: 'var(--md-accent)',
    border: '1px solid rgba(217,169,78,0.30)',
  },
  neutral: {
    background: 'color-mix(in srgb, var(--bg-secondary) 82%, transparent)',
    color: 'var(--text-secondary)',
    border: '1px solid color-mix(in srgb, var(--border) 86%, transparent)',
  },
  success: {
    background: 'rgba(16,185,129,0.12)',
    color: 'var(--success)',
    border: '1px solid rgba(16,185,129,0.24)',
  },
  warning: {
    background: 'rgba(245,158,11,0.10)',
    color: 'var(--warning)',
    border: '1px solid rgba(245,158,11,0.22)',
  },
  danger: {
    background: 'rgba(239,68,68,0.08)',
    color: 'var(--danger)',
    border: '1px solid rgba(239,68,68,0.16)',
  },
};

export function DrawerWorkflowActions({
  item,
  hasLinkedWork,
  onUpdate,
  onCarryForward,
  isCarryForwardPending = false,
}: DrawerWorkflowActionsProps) {
  const isClosed = item.status === 'done' || item.status === 'cancelled';
  const primaryAction = getPrimaryAction(item, onUpdate);
  const correctionAction = getCorrectionAction(item, onUpdate);
  const moreActions = getMoreActions(item, hasLinkedWork, onUpdate, onCarryForward, isCarryForwardPending);

  return (
    <section
      className="mt-3 rounded-xl border p-2.5"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 76%, transparent), color-mix(in srgb, var(--bg-primary) 88%, transparent))',
        borderColor: 'color-mix(in srgb, var(--border) 86%, transparent)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-[136px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            Workflow
          </div>
          <div className="mt-0.5 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {STATUS_LABELS[item.status]}
          </div>
        </div>

        {correctionAction && <WorkflowButton action={correctionAction} variant="quiet" />}
        {primaryAction && <WorkflowButton action={primaryAction} variant="primary" />}

        {moreActions.length > 0 && (
          <details className="relative" onClick={(event) => event.stopPropagation()}>
            <summary
              className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] [&::-webkit-details-marker]:hidden"
              style={toneStyles.neutral}
              aria-label={`More workflow actions for ${item.title}`}
              title="More actions"
            >
              <MoreHorizontal size={13} />
              More
            </summary>
            <div
              className="absolute right-0 top-9 z-30 min-w-[168px] rounded-xl border p-1.5"
              style={{
                background: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
                boxShadow: '0 18px 42px rgba(2,6,23,0.28)',
              }}
            >
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    action.onClick();
                  }}
                  disabled={action.disabled}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ color: action.tone === 'danger' ? 'var(--danger)' : action.tone === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}
                  aria-label={action.ariaLabel ?? action.label}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function getPrimaryAction(
  item: ManagerDeskItem,
  onUpdate: DrawerWorkflowActionsProps['onUpdate'],
): WorkflowAction | null {
  if (item.status === 'done' || item.status === 'cancelled') {
    return statusAction(item, 'planned', 'Reopen', <RotateCcw size={11} />, 'neutral', onUpdate);
  }

  if (item.status === 'backlog') {
    return statusAction(item, 'inbox', 'Bring back', <ArrowRight size={11} />, 'primary', onUpdate);
  }

  if (item.status === 'in_progress') {
    return statusAction(item, 'done', 'Done', <CheckCircle2 size={11} />, 'success', onUpdate);
  }

  if (item.status === 'inbox') {
    return statusAction(item, 'planned', 'Plan', <ArrowRight size={11} />, 'primary', onUpdate);
  }

  return statusAction(item, 'in_progress', 'Start', <ArrowRight size={11} />, 'primary', onUpdate);
}

function getCorrectionAction(
  item: ManagerDeskItem,
  onUpdate: DrawerWorkflowActionsProps['onUpdate'],
): WorkflowAction | null {
  if (item.status === 'planned') {
    return statusAction(item, 'inbox', 'Move to inbox', <RotateCcw size={11} />, 'neutral', onUpdate);
  }

  if (item.status === 'in_progress' || item.status === 'waiting') {
    return statusAction(item, 'planned', 'Back to planned', <RotateCcw size={11} />, 'neutral', onUpdate);
  }

  return null;
}

function getMoreActions(
  item: ManagerDeskItem,
  hasLinkedWork: boolean,
  onUpdate: DrawerWorkflowActionsProps['onUpdate'],
  onCarryForward: DrawerWorkflowActionsProps['onCarryForward'],
  isCarryForwardPending: boolean,
): WorkflowAction[] {
  if (item.status === 'done' || item.status === 'cancelled') return [];

  const actions: WorkflowAction[] = [];

  if (item.status !== 'backlog' && item.status !== 'in_progress') {
    actions.push(statusAction(item, 'done', 'Mark done', <CheckCircle2 size={11} />, 'success', onUpdate));
  }

  if (item.status !== 'backlog' && !hasLinkedWork) {
    actions.push(statusAction(item, 'backlog', 'Move to later', <Archive size={11} />, 'neutral', onUpdate));
  }

  if (onCarryForward && item.status !== 'backlog') {
    actions.push({
      label: isCarryForwardPending ? 'Carrying...' : 'Carry forward',
      icon: <ArrowRight size={11} />,
      tone: 'primary',
      disabled: isCarryForwardPending,
      ariaLabel: `Carry forward ${item.title}`,
      onClick: onCarryForward,
    });
  }

  if (!hasLinkedWork) {
    actions.push(statusAction(item, 'cancelled', 'Drop', <XCircle size={11} />, 'danger', onUpdate));
  }

  return actions;
}

function statusAction(
  item: ManagerDeskItem,
  status: ManagerDeskStatus,
  label: string,
  icon: ReactNode,
  tone: WorkflowAction['tone'],
  onUpdate: DrawerWorkflowActionsProps['onUpdate'],
): WorkflowAction {
  return {
    label,
    icon,
    tone,
    onClick: () => onUpdate(item.id, { status }),
  };
}

function WorkflowButton({ action, variant }: { action: WorkflowAction; variant: 'primary' | 'quiet' }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={[
        'inline-flex h-8 items-center gap-1.5 rounded-lg border text-[11px] font-semibold uppercase tracking-[0.08em]',
        'transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' ? 'px-3' : 'px-2.5',
      ].join(' ')}
      style={toneStyles[action.tone]}
      aria-label={action.ariaLabel ?? action.label}
    >
      {action.icon}
      <span>{action.label}</span>
    </button>
  );
}
