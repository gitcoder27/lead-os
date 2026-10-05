import type { ManagerTask, TaskEventType, UpdateTaskRequest } from '@/types';

export type ChangedTask = Pick<ManagerTask, 'taskKey' | 'title' | 'ownerType' | 'ownerId' | 'status'>;
export interface TaskChangeNotification {
  id: string;
  scope: string;
  startedAt: string;
  at: string;
  task: ChangedTask;
  before?: ChangedTask;
  fields?: Array<keyof UpdateTaskRequest>;
  eventType?: TaskEventType;
  private?: boolean;
}

const EVENT = 'leados-task-change';

/** Only acknowledged facts; task details and event/note bodies never enter this notification. */
export const taskChangeFacts = (task: ChangedTask): ChangedTask => ({
  taskKey: task.taskKey, title: task.title, ownerType: task.ownerType, ownerId: task.ownerId, status: task.status,
});

export const notifyTaskChange = (change: Omit<TaskChangeNotification, 'id' | 'at'> & { id?: string }) => {
  window.dispatchEvent(new CustomEvent<TaskChangeNotification>(EVENT, {
    detail: { ...change, id: change.id ?? crypto.randomUUID(), at: new Date().toISOString() },
  }));
};

export const subscribeTaskChanges = (listener: (change: TaskChangeNotification) => void) => {
  const handle = (event: Event) => listener((event as CustomEvent<TaskChangeNotification>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
};
