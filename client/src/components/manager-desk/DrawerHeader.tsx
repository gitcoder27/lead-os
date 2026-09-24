import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Trash2, Users,
  MoreVertical, FolderMinus, Ban, AlertTriangle, ChevronRight,
} from 'lucide-react';
import type { ManagerDeskItem } from '@/types/manager-desk';
import { KIND_LABELS, STATUS_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from '@/types/manager-desk';
import { AssigneePill } from './AssigneePill';
import { DrawerWorkflowActions } from './DrawerWorkflowActions';

interface DrawerHeaderProps {
  item: ManagerDeskItem;
  readOnly?: boolean;
  onClose: () => void;
  onUpdate: (itemId: number, updates: Record<string, unknown>) => void;
  onDelete: (itemId: number) => void;
  onCancelDelegatedTask?: (itemId: number) => void;
  isCancelDelegatedPending?: boolean;
  onCarryForward?: () => void;
  isCarryForwardPending?: boolean;
}

type ActionMenuState = 'closed' | 'choosing' | 'confirm-remove' | 'confirm-cancel';

const tones: Record<string, CSSProperties> = {
  accent: { background: 'var(--md-accent-dim)', color: 'var(--md-accent)', border: '1px solid color-mix(in srgb, var(--md-accent) 24%, transparent)' },
  neutral: { background: 'color-mix(in srgb, var(--bg-secondary) 92%, transparent)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  success: { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.18)' },
  danger: { background: 'rgba(239,68,68,0.10)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.18)' },
  warning: { background: 'rgba(245,158,11,0.10)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.18)' },
};

function chipTone(kind: string, value: string): string {
  if (kind === 'status' && (value === 'done' || value === 'cancelled')) return 'success';
  if (kind === 'priority' && value === 'critical') return 'danger';
  if (kind === 'priority' && value === 'high') return 'warning';
  return 'neutral';
}

function execTone(state: string): CSSProperties {
  if (state === 'done') return { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.22)' };
  if (state === 'in_progress') return { background: 'rgba(6,182,212,0.10)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.22)' };
  if (state === 'dropped') return { background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.16)' };
  return { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
}

function executionLabel(state: string) {
  if (state === 'in_progress') return 'Dev active';
  if (state === 'done') return 'Dev done';
  if (state === 'dropped') return 'Dev dropped';
  return 'Dev planned';
}

export function DrawerHeader({
  item, readOnly = false, onClose, onUpdate, onDelete, onCancelDelegatedTask, isCancelDelegatedPending = false, onCarryForward, isCarryForwardPending = false,
}: DrawerHeaderProps) {
  const [editTitle, setEditTitle] = useState(item.title);
  const [actionMenu, setActionMenu] = useState<ActionMenuState>('closed');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setEditTitle(item.title); }, [item.id, item.title]);
  useEffect(() => { setActionMenu('closed'); }, [item.id]);

  useEffect(() => {
    if (actionMenu === 'closed') return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActionMenu('closed'); };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setActionMenu('closed');
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handleClick); };
  }, [actionMenu]);

  const commitTitle = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) onUpdate(item.id, { title: trimmed });
  }, [editTitle, item.id, item.title, onUpdate]);

  const exec = item.delegatedExecution;
  const hasLinkedWork = !!exec;
  const chipClass = 'rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]';

  return (
    <div
      className="shrink-0 border-b px-5 pb-4 pt-3"
      style={{
        borderColor: 'var(--border)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 96%, var(--md-accent-dim)) 0%, var(--bg-primary) 100%)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold tracking-wide" style={{ color: 'var(--text-muted)' }}>
          #{item.id}
        </span>
        <div className="relative flex items-center gap-0.5" ref={menuRef}>
          {readOnly ? null : hasLinkedWork ? (
            <button
              onClick={() => setActionMenu((s) => s === 'closed' ? 'choosing' : 'closed')}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ color: actionMenu !== 'closed' ? 'var(--danger)' : 'var(--text-secondary)' }}
              title="Remove or cancel actions"
              aria-label="Remove or cancel actions"
              aria-expanded={actionMenu !== 'closed'}
            >
              <MoreVertical size={14} />
            </button>
          ) : (
            <button
              onClick={() => onDelete(item.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'var(--danger)' }}
              title="Remove from desk"
              aria-label="Remove from desk"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70" style={{ color: 'var(--text-secondary)' }} aria-label="Close detail panel">
            <X size={15} />
          </button>

          <AnimatePresence>
            {actionMenu !== 'closed' && (
              <DelegatedActionMenu
                state={actionMenu}
                onChooseRemove={() => setActionMenu('confirm-remove')}
                onChooseCancel={() => setActionMenu('confirm-cancel')}
                onConfirmRemove={() => { onDelete(item.id); setActionMenu('closed'); }}
                onConfirmCancel={() => { onCancelDelegatedTask?.(item.id); setActionMenu('closed'); }}
                onBack={() => setActionMenu('choosing')}
                onDismiss={() => setActionMenu('closed')}
                isCancelPending={isCancelDelegatedPending}
                assigneeName={item.assignee?.displayName}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <input
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
        readOnly={readOnly}
        className="mt-2 w-full bg-transparent text-[17px] font-semibold leading-snug outline-none"
        style={{ color: 'var(--text-primary)', caretColor: 'var(--md-accent)' }}
        maxLength={200}
        aria-label="Item title"
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] mr-0.5" style={{ color: 'var(--text-muted)' }}>
          {exec ? 'My follow-through' : 'Status'}
        </span>
        <span className={chipClass} style={tones.accent}>{KIND_LABELS[item.kind]}</span>
        <span className={chipClass} style={tones[chipTone('status', item.status)]}>{STATUS_LABELS[item.status]}</span>
        <span className={chipClass} style={tones.neutral}>{CATEGORY_LABELS[item.category]}</span>
        <span className={chipClass} style={tones[chipTone('priority', item.priority)]}>{PRIORITY_LABELS[item.priority]}</span>
        {item.assignee && <AssigneePill assignee={item.assignee} />}
      </div>

      {exec && (
        <div
          className="mt-2 rounded-lg px-2.5 py-2 flex flex-wrap items-center gap-2"
          style={{
            background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] mr-0.5" style={{ color: 'var(--text-muted)' }}>
            Execution
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={execTone(exec.state)}
          >
            <Users size={9} />
            {executionLabel(exec.state)}
          </span>
          {exec.note && (
            <span className="text-[11px] truncate max-w-[260px]" style={{ color: 'var(--text-secondary)' }} title={exec.note}>
              {exec.note}
            </span>
          )}
          {exec.state === 'done' && exec.completedAt && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Completed {new Date(exec.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {!readOnly && (
        <DrawerWorkflowActions
          item={item}
          hasLinkedWork={hasLinkedWork}
          onUpdate={onUpdate}
          onCarryForward={onCarryForward}
          isCarryForwardPending={isCarryForwardPending}
        />
      )}
    </div>
  );
}

// ── Delegated action menu (popover) ─────────────────────

function DelegatedActionMenu({
  state,
  onChooseRemove,
  onChooseCancel,
  onConfirmRemove,
  onConfirmCancel,
  onBack,
  onDismiss,
  isCancelPending,
  assigneeName,
}: {
  state: ActionMenuState;
  onChooseRemove: () => void;
  onChooseCancel: () => void;
  onConfirmRemove: () => void;
  onConfirmCancel: () => void;
  onBack: () => void;
  onDismiss: () => void;
  isCancelPending: boolean;
  assigneeName?: string;
}) {
  const devLabel = assigneeName || 'the developer';

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className="absolute right-0 top-full z-[60] mt-1 w-[300px] overflow-hidden rounded-xl"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === 'choosing' && (
          <motion.div
            key="choosing"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.1 }}
            className="p-1.5"
          >
            <div className="px-2.5 pt-1.5 pb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                This item has linked developer work
              </span>
            </div>
            <button
              type="button"
              onClick={onChooseRemove}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:brightness-110"
              style={{ background: 'transparent', color: 'var(--text-primary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <FolderMinus size={13} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">Remove from my desk</div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {devLabel}'s work stays in Team Tracker
                </div>
              </div>
              <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
            </button>
            <button
              type="button"
              onClick={onChooseCancel}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{ background: 'transparent', color: 'var(--text-primary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(239,68,68,0.10)', color: 'var(--danger)' }}>
                <Ban size={13} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--danger)' }}>Cancel delegated task</div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Deletes {devLabel}'s execution work
                </div>
              </div>
              <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
            </button>
          </motion.div>
        )}

        {state === 'confirm-remove' && (
          <motion.div
            key="confirm-remove"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.1 }}
            className="p-3"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <FolderMinus size={12} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Remove from your desk?</div>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  This item will be removed from Manager Desk. {devLabel}'s task will remain active in Team Tracker and My Day.
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={onConfirmRemove}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all hover:brightness-110"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
              >
                Remove from desk
              </button>
            </div>
          </motion.div>
        )}

        {state === 'confirm-cancel' && (
          <motion.div
            key="confirm-cancel"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.1 }}
            className="p-3"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                <AlertTriangle size={12} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--danger)' }}>Cancel delegated task?</div>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  This will <strong style={{ color: 'var(--danger)' }}>permanently delete</strong> {devLabel}'s execution item from Team Tracker and My Day. Notes, state changes, and progress on that task will no longer be accessible as active work.
                </p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  The Manager Desk item will remain as a cancelled record.
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Keep task
              </button>
              <button
                type="button"
                onClick={onConfirmCancel}
                disabled={isCancelPending}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                style={{
                  background: 'rgba(239,68,68,0.14)',
                  color: 'var(--danger)',
                  border: '1px solid rgba(239,68,68,0.24)',
                }}
              >
                {isCancelPending ? 'Cancelling…' : 'Cancel delegated task'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
