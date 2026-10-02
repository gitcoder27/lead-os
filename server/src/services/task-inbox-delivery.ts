import { and, eq, isNull } from "drizzle-orm";
import type { TaskInboxKind } from "shared/types";
import { db } from "../db/connection";
import { appUsers, developers, managerSelfLinks, oneOnOneAgendaItems, taskInbox, tasks } from "../db/schema";
import { SettingsService } from "./settings.service";
import { TaskKeysService } from "./task-keys.service";
import type { EventRow } from "./task-events.service";

type Origin = "manager" | "developer" | "copilot" | "system";
/** Called inside append's transaction: failure rolls back the event and its task write. */
export async function deliverTaskEvent(
  event: EventRow,
  origin: Origin,
  hasPrivateOrigin: () => Promise<boolean>,
): Promise<void> {
  if (
    !event.taskId ||
    event.visibility !== "shared" ||
    event.redactedAt ||
    !["created", "assign", "instruction", "update", "blocker", "status"].includes(event.type)
  )
    return;
  const meta = JSON.parse(event.metaJson ?? "null") as Record<string, unknown> | null;
  if (
    meta?.approximateTime ||
    meta?.imported ||
    meta?.source === "import" ||
    meta?.source === "one_on_one" ||
    /^(imp:|p2:)/.test(event.dedupeKey ?? "")
  )
    return;
  if (event.type === "status" && (meta?.to !== "blocked" || meta?.from === "blocked" || meta?.reason !== "user"))
    return;
  if ((await new SettingsService().getTeamMode(event.workspaceId)) !== "collab") return;
  if (!(await new TaskKeysService().canonicalEnabled(event.workspaceId))) return;
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspaceId, event.workspaceId), eq(tasks.id, event.taskId), isNull(tasks.deletedAt)));
  if (!task) return;
  // Agenda data remains manager-private, including legacy developer-owned topics.
  if (
    (
      await db
        .select({ id: oneOnOneAgendaItems.id })
        .from(oneOnOneAgendaItems)
        .where(and(eq(oneOnOneAgendaItems.workspaceId, task.workspaceId), eq(oneOnOneAgendaItems.taskId, task.id)))
        .limit(1)
    ).length
  )
    return;
  if (await hasPrivateOrigin()) return;
  const users = await db
    .select()
    .from(appUsers)
    .where(and(eq(appUsers.workspaceId, task.workspaceId), eq(appUsers.isActive, 1)));
  const roster = await db
    .select({ accountId: developers.accountId })
    .from(developers)
    .where(and(eq(developers.workspaceId, task.workspaceId), eq(developers.isActive, 1)));
  const rosterIds = new Set(roster.map((person) => person.accountId));
  const selfLinks = await db.select().from(managerSelfLinks).where(eq(managerSelfLinks.workspaceId, task.workspaceId));
  const actorRole = origin ?? event.authorType;
  const author = users.find((user) =>
    actorRole === "developer"
      ? user.role === "developer" && user.developerAccountId === event.authorId
      : actorRole === "manager" || actorRole === "copilot"
        ? user.role === "manager" && user.username === event.authorId
        : user.role === "developer"
          ? user.developerAccountId === event.authorId
          : user.username === event.authorId,
  );
  const developerAuthor = actorRole === "developer" || (actorRole === "system" && author?.role === "developer");
  if (developerAuthor && (!author?.developerAccountId || !rosterIds.has(author.developerAccountId))) return;
  const ownerUsers = users.filter((user) =>
    task.ownerType === "manager"
      ? user.role === "manager" && user.username === task.ownerId
      : task.ownerType === "developer" &&
        rosterIds.has(task.ownerId ?? "") &&
        ((user.role === "developer" && user.developerAccountId === task.ownerId) ||
          (user.role === "manager" &&
            selfLinks.some(
              (link) => link.managerAccountId === user.username && link.developerAccountId === task.ownerId,
            ))),
  );
  const managers = users.filter(
    (user) =>
      user.role === "manager" &&
      (task.trackedByManagerId
        ? user.username === task.trackedByManagerId
        : task.ownerType === "manager"
          ? user.username === task.ownerId
          : task.ownerType === "developer"),
  );
  const kind: TaskInboxKind =
    event.type === "created" || event.type === "assign"
      ? "assignment"
      : event.type === "instruction"
        ? "instruction"
        : event.type === "blocker"
          ? meta?.action === "cleared"
            ? "blocker_cleared"
            : "blocker"
          : event.type === "status"
            ? "blocker"
            : "reply";
  const recipients =
    kind === "assignment" ? [...ownerUsers, ...managers] : developerAuthor ? managers : [...ownerUsers, ...managers];
  const actorPersonId =
    author?.role === "developer"
      ? author.developerAccountId
      : selfLinks.find((link) => link.managerAccountId === author?.username)?.developerAccountId;
  for (const recipient of new Map(recipients.map((user) => [user.id, user])).values()) {
    if (recipient.id === author?.id) continue;
    // A manager's linked roster record is the same person, even with a second developer login.
    if (
      actorPersonId &&
      (recipient.developerAccountId === actorPersonId ||
        selfLinks.some(
          (link) => link.managerAccountId === recipient.username && link.developerAccountId === actorPersonId,
        ))
    )
      continue;
    await db
      .insert(taskInbox)
      .values({
        workspaceId: task.workspaceId,
        recipientUserId: recipient.id,
        eventId: event.id,
        actorUserId: author?.id ?? null,
        kind,
        createdAt: event.createdAt,
      })
      .onConflictDoNothing();
  }
}
