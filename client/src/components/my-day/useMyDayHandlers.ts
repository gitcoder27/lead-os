import { useToast } from '@/context/ToastContext';
import {
  useUpdateMyDayStatus,
  useAddMyDayItem,
  useUpdateMyDayItem,
  useSetMyDayCurrent,
  useAddMyDayCheckIn,
} from '@/hooks/useMyDay';
import type { TrackerDeveloperStatus } from '@/types';

export function useMyDayHandlers(date: string, readOnly = false) {
  const { addToast } = useToast();
  
  const updateStatus = useUpdateMyDayStatus(date);
  const addItem = useAddMyDayItem(date);
  const updateItem = useUpdateMyDayItem(date);
  const setCurrent = useSetMyDayCurrent(date);
  const addCheckIn = useAddMyDayCheckIn(date);

  const handleStatusUpdate = (status: TrackerDeveloperStatus) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    updateStatus.mutate(status, {
      onSuccess: () => addToast('Status updated', 'success'),
      onError: (err) => addToast(err.message, 'error'),
    });
  };

  const handleMarkDone = (itemId: number) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    updateItem.mutate(
      { itemId, state: 'done' },
      { onSuccess: () => addToast('Task completed!', 'success'), onError: (err) => addToast(err.message, 'error') }
    );
  };

  const handleDrop = (itemId: number) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    updateItem.mutate({ itemId, state: 'dropped' }, { onError: (err) => addToast(err.message, 'error') });
  };

  const handleSetCurrent = (itemId: number) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    setCurrent.mutate(itemId, { onError: (err) => addToast(err.message, 'error') });
  };

  const handleReorder = (itemId: number, newPosition: number) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    updateItem.mutate({ itemId, position: newPosition }, { onError: (err) => addToast(err.message, 'error') });
  };

  const handleUpdateItemTitle = (itemId: number, title: string) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    updateItem.mutate(
      { itemId, title },
      { onSuccess: () => addToast('Task updated', 'success'), onError: (err) => addToast(err.message, 'error') }
    );
  };

  const handleAddItem = (params: { title: string; jiraKey?: string; note?: string }) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    addItem.mutate(params, { onSuccess: () => addToast('Task added', 'success'), onError: (err) => addToast(err.message, 'error') });
  };

  const handleAddCheckIn = (summary: string, status?: TrackerDeveloperStatus, taskKeys?: string[]) => {
    if (readOnly) {
      addToast('This day is read-only', 'warning');
      return;
    }
    addCheckIn.mutate(
      { summary, status, taskKeys },
      { onSuccess: () => addToast('Update posted', 'success'), onError: (err) => addToast(err.message, 'error') }
    );
  };

  return {
    handleStatusUpdate,
    handleMarkDone,
    handleDrop,
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
