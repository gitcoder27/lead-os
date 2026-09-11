import { useCallback, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useAddManagerDeskLink,
  useRemoveManagerDeskLink,
} from '@/hooks/useManagerDesk';
import type { ManagerDeskItem, ManagerDeskUpdateItemPayload } from '@/types/manager-desk';
import { DrawerHeader } from './DrawerHeader';
import { DrawerPrimaryFields } from './DrawerPrimaryFields';
import { DrawerProperties } from './DrawerProperties';
import { DrawerNotes } from './DrawerNotes';
import { DrawerLinks } from './DrawerLinks';

interface ItemDetailDrawerProps {
  item: ManagerDeskItem | null;
  open?: boolean;
  date: string;
  readOnly?: boolean;
  onClose: () => void;
  onUpdate: (itemId: number, updates: Record<string, unknown>) => void;
  onDelete: (itemId: number) => void;
  onCancelDelegatedTask?: (itemId: number) => void;
  isCancelDelegatedPending?: boolean;
  onCarryForward?: () => void;
  isCarryForwardPending?: boolean;
  topSlot?: ReactNode;
  ariaLabel?: string;
  showLinkedIssueDescription?: boolean;
  placeholder?: ReactNode;
  stacked?: boolean;
}

export function ItemDetailDrawer({
  item,
  open,
  date,
  readOnly = false,
  onClose,
  onUpdate,
  onDelete,
  onCancelDelegatedTask,
  isCancelDelegatedPending,
  onCarryForward,
  isCarryForwardPending,
  topSlot,
  ariaLabel = 'Manager Desk item detail',
  placeholder,
  stacked = false,
}: ItemDetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`workspace-shell-backdrop fixed inset-x-0 bottom-0 ${stacked ? 'z-[70]' : 'z-40'}`}
          style={{ background: 'rgba(2, 6, 23, 0.46)', backdropFilter: 'blur(3px)' }}
          onClick={onClose}
        />

        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className={`workspace-shell-drawer fixed right-0 ${stacked ? 'z-[71]' : 'z-50'} flex w-full max-w-2xl flex-col overflow-hidden`}
          style={{
            background: 'var(--bg-primary)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-28px 0 72px rgba(15, 23, 42, 0.22)',
          }}
          aria-label={ariaLabel}
          role="dialog"
          aria-modal="true"
        >
          {item ? (
            <DrawerContent
              item={item}
              date={date}
              readOnly={readOnly}
              onClose={onClose}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onCancelDelegatedTask={onCancelDelegatedTask}
              isCancelDelegatedPending={isCancelDelegatedPending}
              onCarryForward={onCarryForward}
              isCarryForwardPending={isCarryForwardPending}
              topSlot={topSlot}
            />
          ) : (
            placeholder ?? null
          )}
        </motion.aside>
      </>
    </AnimatePresence>
  );
}

function DrawerContent({
  item,
  date,
  readOnly,
  onClose,
  onUpdate,
  onDelete,
  onCancelDelegatedTask,
  isCancelDelegatedPending,
  onCarryForward,
  isCarryForwardPending,
  topSlot,
}: {
  item: ManagerDeskItem;
  date: string;
  readOnly: boolean;
  onClose: () => void;
  onUpdate: (itemId: number, updates: Record<string, unknown>) => void;
  onDelete: (itemId: number) => void;
  onCancelDelegatedTask?: (itemId: number) => void;
  isCancelDelegatedPending?: boolean;
  onCarryForward?: () => void;
  isCarryForwardPending?: boolean;
  topSlot?: ReactNode;
}) {
  const addLink = useAddManagerDeskLink(date);
  const removeLink = useRemoveManagerDeskLink(date);

  const handleFieldChange = useCallback(
    (field: keyof ManagerDeskUpdateItemPayload, value: string | null) => {
      onUpdate(item.id, { [field]: value });
    },
    [item.id, onUpdate],
  );

  const handleDeleteLink = useCallback(
    (linkId: number) => {
      removeLink.mutate({ itemId: item.id, linkId });
    },
    [item.id, removeLink],
  );

  return (
    <>
      <DrawerHeader
        item={item}
        readOnly={readOnly}
        onClose={onClose}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onCancelDelegatedTask={onCancelDelegatedTask}
        isCancelDelegatedPending={isCancelDelegatedPending}
        onCarryForward={onCarryForward}
        isCarryForwardPending={isCarryForwardPending}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {topSlot}
        <DrawerPrimaryFields
          item={item}
          date={date}
          readOnly={readOnly}
          onFieldChange={handleFieldChange}
          onAssigneeChange={(accountId) => onUpdate(item.id, { assigneeDeveloperAccountId: accountId })}
        />
        <DrawerNotes key={`notes-${item.id}`} item={item} readOnly={readOnly} onFieldChange={handleFieldChange} />
        <DrawerProperties
          item={item}
          readOnly={readOnly}
          onFieldChange={handleFieldChange}
        />
        <DrawerLinks
          key={`links-${item.id}`}
          item={item}
          date={date}
          readOnly={readOnly}
          addLink={addLink}
          onDeleteLink={handleDeleteLink}
        />
      </div>
    </>
  );
}
