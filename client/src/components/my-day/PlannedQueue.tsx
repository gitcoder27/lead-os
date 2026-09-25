import { useCallback, useEffect, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import type { TrackerWorkItem } from '@/types';
import { TrackerItemRow } from '@/components/team-tracker/TrackerItemRow';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { TaskTimelineDisclosure } from '@/components/tasks/TaskTimeline';

interface PlannedQueueProps {
  viewDate?: string;
  items: TrackerWorkItem[];
  onSetCurrent: (id: number) => void;
  onMarkDone: (id: number) => void;
  onDrop: (id: number) => void;
  onReorder: (itemId: number, newPosition: number) => void;
  onUpdateTitle: (id: number, title: string) => void;
  readOnly?: boolean;
}

export function PlannedQueue({
  viewDate,
  items,
  onSetCurrent,
  onMarkDone,
  onDrop,
  onReorder,
  onUpdateTitle,
  readOnly,
}: PlannedQueueProps) {
  const [orderedItems, setOrderedItems] = useState(items);
  const orderedItemsRef = useRef(items);
  const isDraggingRef = useRef(false);
  const dragStartItemsRef = useRef(items);
  const draggedItemIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }

    setOrderedItems(items);
    orderedItemsRef.current = items;
    dragStartItemsRef.current = items;
  }, [items]);

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

  if (items.length === 0) {
    return (
      <div
        className="rounded-xl p-4 text-center"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px dashed var(--border)',
        }}
      >
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No planned tasks — add one below
        </p>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl px-1"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <TrackerItemRow item={item} viewDate={viewDate} readOnly />
            {item.taskKey && <TaskTimelineDisclosure taskKey={item.taskKey} mode="developer" />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Reorder.Group axis="y" values={orderedItems} onReorder={handleReorder} className="space-y-1">
      {orderedItems.map((item) => (
        <Reorder.Item
          key={item.id}
          value={item}
          onDragStart={() => handleDragStart(item.id)}
          onDragEnd={handleDragEnd}
          className="rounded-xl px-1"
          whileDrag={{
            scale: 1.02,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            zIndex: 50,
          }}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          <TrackerItemRow
            item={item}
            viewDate={viewDate}
            draggable
            onSetCurrent={onSetCurrent}
            onMarkDone={onMarkDone}
            onDrop={onDrop}
            onUpdateTitle={onUpdateTitle}
            readOnly={readOnly}
            composer={
              !readOnly && item.taskKey && viewDate ? (
                <TaskUpdateComposer taskKey={item.taskKey} mode="developer" date={viewDate} collapsed />
              ) : undefined
            }
          />
          {item.taskKey && <TaskTimelineDisclosure taskKey={item.taskKey} mode="developer" />}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
