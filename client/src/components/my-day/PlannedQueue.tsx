import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import type { TrackerWorkItem } from '@/types';
import { HAIRLINE } from './MyDayUI';
import { MyDayTaskRow } from './MyDayTaskRow';

interface PlannedQueueProps {
  viewDate?: string;
  items: TrackerWorkItem[];
  onSetCurrent: (id: number) => void;
  onMarkDone: (id: number) => void;
  onDrop: (id: number) => void;
  onReorder: (itemId: number, newPosition: number) => void;
  onUpdateTitle: (id: number, title: string) => void;
  readOnly?: boolean;
  /** Rendered as the list's last row (the add-task affordance). */
  footer?: ReactNode;
}

const listClass = 'flex flex-col [&>*+*]:border-t';

export function PlannedQueue({
  viewDate = '',
  items,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onReorder,
  onUpdateTitle,
  readOnly,
  footer,
}: PlannedQueueProps) {
  const [orderedItems, setOrderedItems] = useState(items);
  const orderedItemsRef = useRef(items);
  const isDraggingRef = useRef(false);
  const dragStartItemsRef = useRef(items);
  const draggedItemIdRef = useRef<number | null>(null);
  const refocusItemIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }

    setOrderedItems(items);
    orderedItemsRef.current = items;
    dragStartItemsRef.current = items;
  }, [items]);

  // Keyboard moves re-parent the focused handle; put focus back on it.
  useEffect(() => {
    const itemId = refocusItemIdRef.current;
    if (itemId === null) return;
    refocusItemIdRef.current = null;
    document.querySelector<HTMLElement>(`[data-reorder-handle="${itemId}"]`)?.focus();
  }, [orderedItems]);

  const handleReorder = useCallback((newOrder: TrackerWorkItem[]) => {
    orderedItemsRef.current = newOrder;
    setOrderedItems(newOrder);
  }, []);

  const handleDragStart = useCallback((itemId: number) => {
    isDraggingRef.current = true;
    draggedItemIdRef.current = itemId;
    dragStartItemsRef.current = orderedItemsRef.current;
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;

    const draggedItemId = draggedItemIdRef.current;
    draggedItemIdRef.current = null;

    if (draggedItemId === null) {
      return;
    }

    const startItems = dragStartItemsRef.current;
    const finalItems = orderedItemsRef.current;
    const startIndex = startItems.findIndex((item) => item.id === draggedItemId);
    const nextIndex = finalItems.findIndex((item) => item.id === draggedItemId);

    if (startIndex === -1 || nextIndex === -1 || startIndex === nextIndex) {
      return;
    }

    const targetPosition = startItems[nextIndex]?.position ?? nextIndex;
    onReorder(draggedItemId, targetPosition);
  }, [onReorder]);

  /** Same contract as a drag: the moved item takes the position of the slot it lands in. */
  const handleMove = useCallback((itemId: number, direction: 'up' | 'down') => {
    const current = orderedItemsRef.current;
    const index = current.findIndex((item) => item.id === itemId);
    const targetIndex = index + (direction === 'up' ? -1 : 1);
    if (index === -1 || targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved!);
    orderedItemsRef.current = next;
    refocusItemIdRef.current = itemId;
    setOrderedItems(next);
    onReorder(itemId, current[targetIndex]?.position ?? targetIndex);
  }, [onReorder]);

  const borderStyle = { borderColor: HAIRLINE };

  if (items.length === 0) {
    return (
      <div className={listClass}>
        <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {readOnly ? 'Nothing was queued.' : 'Your queue is clear. Add what’s next so your lead can see the plan.'}
        </p>
        {footer && <div style={borderStyle}>{footer}</div>}
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className={listClass}>
        {items.map((item, index) => (
          <div key={item.id} style={borderStyle}>
            <MyDayTaskRow item={item} variant="planned" index={index} viewDate={viewDate} readOnly />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={listClass}>
      <Reorder.Group axis="y" values={orderedItems} onReorder={handleReorder} className={listClass}>
        {orderedItems.map((item, index) => (
          <PlannedRow
            key={item.id}
            item={item}
            index={index}
            viewDate={viewDate}
            isLast={index === orderedItems.length - 1}
            onDragStart={() => handleDragStart(item.id)}
            onDragEnd={handleDragEnd}
            onSetCurrent={onSetCurrent}
            onMarkDone={onMarkDone}
            onDrop={onDrop}
            onUpdateTitle={onUpdateTitle}
            onMove={handleMove}
          />
        ))}
      </Reorder.Group>
      {footer && <div style={borderStyle}>{footer}</div>}
    </div>
  );
}

function PlannedRow({
  item,
  index,
  viewDate,
  isLast,
  onDragStart,
  onDragEnd,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onUpdateTitle,
  onMove,
}: {
  item: TrackerWorkItem;
  index: number;
  viewDate: string;
  isLast: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSetCurrent: (id: number) => void;
  onMarkDone: (id: number) => void;
  onDrop: (id: number) => void;
  onUpdateTitle: (id: number, title: string) => void;
  onMove: (id: number, direction: 'up' | 'down') => void;
}) {
  // Only the handle starts a drag, so typing an update or selecting text
  // never picks the row up.
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        scale: 1.015,
        boxShadow: 'var(--panel-shadow)',
        background: 'var(--bg-elevated)',
        borderRadius: '12px',
        zIndex: 50,
      }}
      style={{ position: 'relative', borderColor: HAIRLINE }}
    >
      <MyDayTaskRow
        item={item}
        variant="planned"
        index={index}
        viewDate={viewDate}
        onSetCurrent={onSetCurrent}
        onMarkDone={onMarkDone}
        onDrop={onDrop}
        onUpdateTitle={onUpdateTitle}
        onMove={onMove}
        canMoveUp={index > 0}
        canMoveDown={!isLast}
        onDragHandlePointerDown={(event) => controls.start(event)}
      />
    </Reorder.Item>
  );
}
