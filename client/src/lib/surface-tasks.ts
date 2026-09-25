import type {
  ManagerDeskItem,
  ManagerDeskItemKind,
  ManagerDeskCategory,
  ManagerDeskLink,
  ManagerDeskLinkType,
  ManagerDeskPriority,
  ManagerDeskStatus,
  ManagerSurfaceTask,
  SurfaceTask,
  TaskActorRef,
  TrackerItemState,
  TrackerWorkItem,
} from '@/types';

/**
 * Client mirror of server/src/services/task-view-models.ts (Phase 2c). When a
 * surface transports canonical tasks (`taskModel: 'canonical'`), the legacy
 * item arrays are empty; these mappers rebuild the presentation view models
 * components already consume. Identity is the task's `taskKey`; the legacy
 * numeric `id` is the mapped tracker/desk source id.
 */

type SurfaceKind = 'tracker' | 'desk';

// itemId -> taskKey, populated by the response normalizers below so mutation
// hooks can address canonical tasks by `T-<n>` (§2.3.3 dual-identity window:
// the routes also accept the numeric surface id for legacy rows).
const surfaceIdToTaskKey = new Map<string, string>();

export function registerSurfaceTaskIds(surface: SurfaceKind, items: Array<{ id: number; taskKey?: string | null }>): void {
  for (const item of items) {
    if (item.taskKey) surfaceIdToTaskKey.set(`${surface}:${item.id}`, item.taskKey);
  }
}

/** Prefer the stable task key when the item is a canonical task, else the legacy numeric id. */
export function taskRefFor(surface: SurfaceKind, itemId: number, taskKey?: string | null): string | number {
  return taskKey ?? surfaceIdToTaskKey.get(`${surface}:${itemId}`) ?? itemId;
}

function taskStatusToTrackerState(status: string): TrackerItemState {
  switch (status) {
    case 'active':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'dropped':
      return 'dropped';
    default:
      return 'planned'; // open + blocked surface as planned work
  }
}

function taskStatusToDeskStatus(status: string, later: boolean): ManagerDeskStatus {
  if (later && status === 'open') return 'backlog';
  switch (status) {
    case 'active':
      return 'in_progress';
    case 'blocked':
      return 'waiting';
    case 'done':
      return 'done';
    case 'dropped':
      return 'cancelled';
    default:
      return 'planned';
  }
}

export function surfaceTaskToWorkItem(task: SurfaceTask, developerAccountId?: string): TrackerWorkItem {
  return {
    canonicalTask: true,
    canRename: task.createdByType === 'developer' && (!developerAccountId || task.createdById === developerAccountId),
    id: task.trackerItemId ?? task.id,
    dayId: 0,
    originDate: task.originDate,
    taskKey: task.taskKey,
    createdBy: task.createdByType
      ? { type: task.createdByType as TaskActorRef['type'], id: task.createdById ?? undefined }
      : undefined,
    latestEvent: task.latestEvent,
    ageDays: task.ageDays,
    managerDeskItemId: task.deskItemId,
    lifecycle: task.lifecycle,
    itemType: task.itemType,
    jiraKey: task.jiraKey,
    relatedIssueKeys: task.relatedIssueKeys.length ? task.relatedIssueKeys : undefined,
    jiraSummary: task.jiraSummary,
    jiraPriorityName: task.jiraPriorityName,
    jiraDueDate: task.jiraDueDate,
    title: task.title,
    state: taskStatusToTrackerState(task.status),
    position: task.position,
    completedAt: task.closedAt ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function surfaceTaskToDeskItem(task: ManagerSurfaceTask): ManagerDeskItem {
  const labels = task.labels ?? [];
  const kind: ManagerDeskItemKind =
    task.kind === 'meeting' ? 'meeting' : labels.includes('kind:decision') ? 'decision' : labels.includes('kind:waiting') ? 'waiting' : 'action';
  const category = (labels.find((label) => label.startsWith('category:'))?.slice(9) ?? 'other') as ManagerDeskCategory;
  return {
    canonicalTask: true,
    id: task.deskItemId ?? task.id,
    dayId: 0,
    originDate: task.originDate ?? task.scheduledOn ?? task.createdAt.slice(0, 10),
    taskKey: task.taskKey,
    createdBy: task.createdByType ? { type: task.createdByType as TaskActorRef['type'], id: task.createdById ?? undefined } : undefined,
    title: task.title,
    kind,
    category,
    status: taskStatusToDeskStatus(task.status, task.later),
    priority: (task.priority === 'high' ? 'high' : 'medium') as ManagerDeskPriority,
    assigneeDeveloperAccountId: task.ownerType === 'developer' ? task.ownerId ?? undefined : undefined,
    participants: task.participants ?? undefined,
    nextAction: task.nextAction ?? undefined,
    outcome: task.outcome ?? undefined,
    plannedStartAt: task.startsAt ?? undefined,
    plannedEndAt: task.endsAt ?? undefined,
    followUpAt: task.followUpAt ?? undefined,
    completedAt: task.closedAt ?? undefined,
    assignee: task.assignee,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    links: task.links.map((link): ManagerDeskLink => ({
      id: link.id,
      itemId: task.deskItemId ?? task.id,
      linkType: (link.kind === 'jira' ? 'issue' : link.kind === 'person' ? 'developer' : 'external_group') as ManagerDeskLinkType,
      issueKey: link.kind === 'jira' ? link.ref : undefined,
      developerAccountId: link.kind === 'person' ? link.ref : undefined,
      externalLabel: link.kind === 'external' || link.kind === 'task' ? link.ref : undefined,
      displayLabel: link.ref,
      createdAt: task.createdAt,
    })),
  };
}
