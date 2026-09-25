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
} from "shared/types";
import { taskStatusToDeskStatus, taskStatusToTrackerState } from "./task.service";
import { isoDatePart, todayIsoDate } from "../utils/date";

/**
 * Phase 2c pure view-model mappers. They shape a canonical surface task into
 * the legacy TrackerWorkItem / ManagerDeskItem view models for internal
 * consumers (summaries, signals, Today) and for the client, which treats the
 * mapped arrays as presentation data. Unlike the retired
 * TaskCompatibilityService, they never touch the database.
 */
export function surfaceTaskToWorkItem(task: SurfaceTask): TrackerWorkItem {
  return {
    canonicalTask: true,
    canRename: true,
    id: task.trackerItemId ?? task.id,
    dayId: 0,
    originDate: task.originDate,
    taskKey: task.taskKey,
    createdBy: task.createdByType
      ? { type: task.createdByType as TaskActorRef["type"], id: task.createdById ?? undefined }
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
    state: taskStatusToTrackerState(task.status) as TrackerItemState,
    position: task.position,
    completedAt: task.closedAt ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.status === "dropped" ? task.closedAt ?? task.updatedAt : task.updatedAt,
  };
}

export function surfaceTaskToDeskLinks(task: SurfaceTask, developerNames?: Map<string, string>): ManagerDeskLink[] {
  const itemId = task.deskItemId ?? task.id;
  return task.links.map((link) => {
    const linkType: ManagerDeskLinkType = link.kind === "jira" ? "issue" : link.kind === "person" ? "developer" : "external_group";
    const displayLabel = linkType === "developer"
      ? developerNames?.get(link.ref) ?? link.ref
      : linkType === "issue"
        ? link.ref
        : link.ref;
    return {
      id: link.id,
      itemId,
      linkType,
      issueKey: link.kind === "jira" ? link.ref : undefined,
      developerAccountId: link.kind === "person" ? link.ref : undefined,
      externalLabel: link.kind === "external" || link.kind === "task" ? link.ref : undefined,
      displayLabel,
      createdAt: task.createdAt,
    };
  });
}

export function surfaceTaskToDeskItem(task: ManagerSurfaceTask, developerNames?: Map<string, string>): ManagerDeskItem {
  const labels = task.labels ?? [];
  const kind: ManagerDeskItemKind = task.kind === "meeting" ? "meeting" : labels.includes("kind:decision") ? "decision" : labels.includes("kind:waiting") ? "waiting" : "action";
  const category = (labels.find((label) => label.startsWith("category:"))?.slice(9) ?? "other") as ManagerDeskCategory;
  const status: ManagerDeskStatus = !task.ownerType && task.status === "open" ? "inbox" : taskStatusToDeskStatus(task.status, task.later ? 1 : 0) as ManagerDeskStatus;
  return {
    canonicalTask: true,
    id: task.deskItemId ?? task.id,
    dayId: 0,
    originDate: task.originDate ?? task.scheduledOn ?? isoDatePart(task.createdAt) ?? todayIsoDate(),
    taskKey: task.taskKey,
    createdBy: task.createdByType
      ? { type: task.createdByType as TaskActorRef["type"], id: task.createdById ?? undefined }
      : undefined,
    title: task.title,
    kind,
    category,
    status,
    priority: (task.priority === "high" ? "high" : "medium") as ManagerDeskPriority,
    assigneeDeveloperAccountId: task.ownerType === "developer" ? task.ownerId ?? undefined : undefined,
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
    links: surfaceTaskToDeskLinks(task, developerNames),
  };
}
