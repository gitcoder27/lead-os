import { useToast } from '@/context/ToastContext';
import {
  useUpdateMyDayStatus,
  useAddMyDayItem,
  useUpdateMyDayItem,
  useSetMyDayCurrent,
  useAddMyDayCheckIn,
} from '@/hooks/useMyDay';
import type { MyDayResponse, TrackerDeveloperStatus, TrackerItemState, TrackerWorkItem } from '@/types';

function findItem(day: MyDayResponse | undefined, itemId: number): TrackerWorkItem | undefined {
  if (!day) return undefined;
  if (day.currentItem?.id === itemId) return day.currentItem;
  return [...day.plannedItems, ...day.completedItems, ...day.droppedItems].find((item) => item.id === itemId);
}

/**
 * My Day mutations. Success is shown in place (the row moves, the status
 * pill slides, the composer confirms), so toasts are reserved for errors,
 * read-only guards, and the undo offer after closing work.
 */
export function useMyDayHandlers(date: string, readOnly = false, day?: MyDayResponse) {
  const { addToast } = useToast();

  const updateStatus = useUpdateMyDayStatus(date);
  const addItem = useAddMyDayItem(date);
  const updateItem = useUpdateMyDayItem(date);
  const setCurrent = useSetMyDayCurrent(date);
  const addCheckIn = useAddMyDayCheckIn(date);

  const guardReadOnly = () => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
    }
    return readOnly;
  };
  const onError = (err: Error) => addToast(err.message, 'error');

  const handleStatusUpdate = (status: TrackerDeveloperStatus) => {
    if (guardReadOnly()) return;
    updateStatus.mutate(status, { onError });
  };

  const restoreState = (itemId: number, state: TrackerItemState) => {
    updateItem.mutate({ itemId, state }, { onError });
  };

  /** Closes an item and offers to put it back exactly where it was. */
  const closeItem = (itemId: number, state: 'done' | 'dropped') => {
    if (guardReadOnly()) return;
    const item = findItem(day, itemId);
    const previousState = item?.state;
    updateItem.mutate(
      { itemId, state },
      {
        onSuccess: () => {
          if (!previousState || previousState === state) return;
          addToast({
            type: state === 'done' ? 'success' : 'info',
            title: state === 'done' ? 'Marked done' : 'Dropped from today',
            message: item?.title,
            action: { label: 'Undo', onClick: () => restoreState(itemId, previousState) },
            duration: 6000,
          });
        },
        onError,
      }
    );
  };

  const handleMarkDone = (itemId: number) => closeItem(itemId, 'done');
  const handleDrop = (itemId: number) => closeItem(itemId, 'dropped');

  /** Moves finished or dropped work back to Up next. */
  const handleReopen = (itemId: number) => {
    if (guardReadOnly()) return;
    restoreState(itemId, 'planned');
  };

  const handleSetCurrent = (itemId: number) => {
    if (guardReadOnly()) return;
    setCurrent.mutate(itemId, { onError });
  };

  const handleReorder = (itemId: number, newPosition: number) => {
    if (guardReadOnly()) return;
    updateItem.mutate({ itemId, position: newPosition }, { onError });
  };

  const handleUpdateItemTitle = (itemId: number, title: string) => {
    if (guardReadOnly()) return;
    updateItem.mutate({ itemId, title }, { onError });
  };

  const handleAddItem = (params: { title: string; jiraKey?: string; note?: string }) => {
    if (guardReadOnly()) return;
    addItem.mutate(params, { onError });
  };

  const handleAddCheckIn = (
    summary: string,
    status?: TrackerDeveloperStatus,
    taskKeys?: string[],
    options?: { onSuccess?: () => void }
  ) => {
    if (guardReadOnly()) return;
    addCheckIn.mutate(
      { summary, status, taskKeys },
      { onSuccess: () => options?.onSuccess?.(), onError }
    );
  };

  return {
    handleStatusUpdate,
    handleMarkDone,
    handleDrop,
    handleReopen,
    handleSetCurrent,
    handleReorder,
    handleUpdateItemTitle,
    handleAddItem,
    handleAddCheckIn,
    updateStatusPending: updateStatus.isPending,
    addItemPending: addItem.isPending,
    addCheckInPending: addCheckIn.isPending,
  };
}
