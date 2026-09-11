import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';
import { DeskItemCardContent } from './DeskItemCardContent';
import {
  getIsOverdue,
  type DeskItemVariant,
} from './DeskItemCardPrimitives';
import { MANAGER_DESK_CARD_LAYOUT_TRANSITION } from './motion';

interface Props {
  item: ManagerDeskItem;
  onSelect: () => void;
  onStatusChange?: (status: ManagerDeskStatus) => void;
  variant?: DeskItemVariant;
  selected?: boolean;
  readOnly?: boolean;
  viewDate?: string;
}

export function DeskItemCard({
  item,
  onSelect,
  onStatusChange,
  variant = 'default',
  selected = false,
  readOnly = false,
  viewDate,
}: Props) {
  const isDone = item.status === 'done' || item.status === 'cancelled';
  const isOverdue = useMemo(() => getIsOverdue(item), [item]);
  const cardSurface = useMemo(() => getCardSurface(item, isOverdue), [isOverdue, item]);
  const borderAccent = getBorderAccent(item, variant);

  return (
    <motion.div
      layout="position"
      transition={{ layout: MANAGER_DESK_CARD_LAYOUT_TRANSITION }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className="group relative min-h-[70px] cursor-pointer overflow-hidden rounded-lg border px-3 py-3 outline-none transition-[background-color,box-shadow,opacity,transform] duration-150 hover:-translate-y-[1px] focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--md-accent)_48%,transparent)] active:scale-[0.995] sm:px-3.5"
      role="button"
      tabIndex={0}
      aria-label={`Open ${item.title}`}
      style={{
        background: cardSurface.background,
        borderColor: cardSurface.border,
        borderLeftColor: borderAccent,
        borderLeftStyle: 'solid',
        borderLeftWidth: 2,
        opacity: isDone ? 0.68 : 1,
      }}
    >
      {selected && (
        <span
          aria-hidden="true"
          data-testid={`selected-manager-desk-item-${item.id}`}
          className="pointer-events-none absolute inset-0 rounded-lg"
          style={{
            boxShadow: 'inset 0 0 0 1px var(--md-accent), inset 2px 0 0 var(--md-accent), 0 10px 24px rgba(15,23,42,0.10)',
          }}
        />
      )}
      <DeskItemCardContent
        item={item}
        variant={variant}
        isDone={isDone}
        isOverdue={isOverdue}
        readOnly={readOnly}
        viewDate={viewDate}
        onStatusChange={onStatusChange}
      />
    </motion.div>
  );
}

function getCardSurface(item: ManagerDeskItem, isOverdue: boolean) {
  if (item.status === 'in_progress') {
    return {
      background:
        'linear-gradient(135deg, rgba(6,182,212,0.075) 0%, color-mix(in srgb, var(--bg-tertiary) 84%, transparent) 62%)',
      border: 'rgba(6,182,212,0.18)',
    };
  }
  if (isOverdue) {
    return {
      background: 'linear-gradient(135deg, rgba(239,68,68,0.07) 0%, var(--bg-tertiary) 58%)',
      border: 'rgba(239,68,68,0.24)',
    };
  }
  return {
    background: 'color-mix(in srgb, var(--bg-tertiary) 66%, transparent)',
    border: 'color-mix(in srgb, var(--border) 66%, transparent)',
  };
}

function getBorderAccent(item: ManagerDeskItem, variant: DeskItemVariant) {
  if (variant === 'meeting') return 'var(--info)';
  if (variant === 'waiting') return 'var(--warning)';
  if (variant === 'completed') return 'var(--success)';
  if (item.status === 'in_progress') return 'var(--accent)';
  if (item.status === 'inbox') return 'color-mix(in srgb, var(--md-accent) 58%, transparent)';
  if (item.status === 'planned') return 'color-mix(in srgb, var(--border) 80%, transparent)';
  return 'color-mix(in srgb, var(--border) 64%, transparent)';
}
