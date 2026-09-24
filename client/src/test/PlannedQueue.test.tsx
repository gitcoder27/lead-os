import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { PlannedQueue } from '@/components/my-day/PlannedQueue';
import type { TrackerWorkItem } from '@/types';

const activeDragEndCallbacks = new Map<number, () => void>();

vi.mock('@/components/team-tracker/TrackerItemRow', () => ({
  TrackerItemRow: ({ item }: { item: TrackerWorkItem }) => (
    <div data-testid={`planned-row-${item.id}`}>{item.title}</div>
  ),
}));

vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({
      children,
      values,
      onReorder,
      ...props
    }: {
      children: ReactNode;
      values: TrackerWorkItem[];
      onReorder: (items: TrackerWorkItem[]) => void;
    } & HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>
        <button
          type="button"
          data-testid="reorder-first-to-last"
          onClick={() => {
            if (values.length > 1) {
              onReorder([...values.slice(1), values[0]!]);
            }
          }}
        >
          reorder first to last
        </button>
        <button
          type="button"
          data-testid="reorder-last-to-first"
          onClick={() => {
            if (values.length > 1) {
              onReorder([values[values.length - 1]!, ...values.slice(0, -1)]);
            }
          }}
        >
          reorder last to first
        </button>
        {children}
      </div>
    ),
    Item: ({
      children,
      value,
      whileDrag,
      onDragStart,
      onDragEnd,
      ...props
    }: {
      children: ReactNode;
      value: TrackerWorkItem;
      whileDrag?: unknown;
      onDragStart?: () => void;
      onDragEnd?: () => void;
    } & HTMLAttributes<HTMLDivElement>) => {
      void whileDrag;
      return (
        <div
          data-testid={`item-${value.id}`}
          {...props}
          onDragStart={() => {
            if (onDragEnd) {
              activeDragEndCallbacks.set(value.id, onDragEnd);
            }
            onDragStart?.();
          }}
          onDragEnd={() => {
            const callback = activeDragEndCallbacks.get(value.id);
            activeDragEndCallbacks.delete(value.id);
            callback?.();
          }}
        >
          {children}
        </div>
      );
    },
  },
}));

function createItem(id: number, title: string, position: number): TrackerWorkItem {
  return {
    id,
    dayId: 10,
    originDate: '2026-03-10',
    lifecycle: 'tracker_only',
    itemType: 'custom',
    title,
    state: 'planned',
    position,
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:00:00.000Z',
  };
}

function renderQueue(items: TrackerWorkItem[], onReorder = vi.fn()) {
  return render(
    <PlannedQueue
      items={items}
      onSetCurrent={vi.fn()}
      onMarkDone={vi.fn()}
      onDrop={vi.fn()}
      onReorder={onReorder}
      onUpdateTitle={vi.fn()}
    />
  );
}

function getRenderedTitles() {
  return screen.getAllByTestId(/planned-row-/).map((node) => node.textContent);
}

describe('PlannedQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeDragEndCallbacks.clear();
  });

  it('keeps the locally reordered order until server props change', () => {
    const items = [
      createItem(1, 'First', 1),
      createItem(2, 'Second', 3),
      createItem(3, 'Third', 5),
    ];

    const { rerender } = renderQueue(items);

    fireEvent.click(screen.getByTestId('reorder-first-to-last'));
    expect(getRenderedTitles()).toEqual(['Second', 'Third', 'First']);

    rerender(
      <PlannedQueue
        items={items}
        onSetCurrent={vi.fn()}
        onMarkDone={vi.fn()}
        onDrop={vi.fn()}
        onReorder={vi.fn()}
        onUpdateTitle={vi.fn()}
      />
    );

    expect(getRenderedTitles()).toEqual(['Second', 'Third', 'First']);
  });

  it('commits one reorder on drop using the target item position', () => {
    const onReorder = vi.fn();
    const items = [
      createItem(1, 'First', 1),
      createItem(2, 'Second', 3),
      createItem(3, 'Third', 5),
    ];

    renderQueue(items, onReorder);

    fireEvent.dragStart(screen.getByTestId('item-1'));
    fireEvent.click(screen.getByTestId('reorder-first-to-last'));
    fireEvent.dragEnd(screen.getByTestId('item-1'));

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(1, 5);
  });

  it('does not emit a reorder when the dragged item is dropped in place', () => {
    const onReorder = vi.fn();
    const items = [
      createItem(1, 'First', 1),
      createItem(2, 'Second', 3),
    ];

    renderQueue(items, onReorder);

    fireEvent.dragStart(screen.getByTestId('item-2'));
    fireEvent.dragEnd(screen.getByTestId('item-2'));

    expect(onReorder).not.toHaveBeenCalled();
  });
});
