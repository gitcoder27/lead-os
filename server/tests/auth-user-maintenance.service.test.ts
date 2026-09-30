import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  alertDismissals,
  appSessions,
  appUsers,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  teamTrackerDays,
  teamTrackerItems,
  teamTrackerSavedViews,
  weeklyReviews,
  workspaces,
} from "../src/db/schema";
import { AuthService } from "../src/services/auth.service";
import { AuthUserMaintenanceService } from "../src/services/auth-user-maintenance.service";
import { db, resetDatabase } from "./helpers/db";

describe("auth user maintenance", () => {
  const authService = new AuthService();
  const maintenance = new AuthUserMaintenanceService();

  beforeEach(async () => {
    await resetDatabase();
  });

  it("deletes an extra manager in a shared workspace and invalidates their sessions", async () => {
    const owner = await authService.createUser({
      username: "owner",
      displayName: "Owner Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "shared-manager",
      displayName: "Shared Manager",
      password: "secret123",
      role: "manager",
      workspaceId: owner.workspaceId,
    });
    await authService.authenticate("shared-manager", "secret123");

    const preview = await maintenance.getDeletionPreview({
      username: "shared-manager",
      workspaceId: owner.workspaceId,
      role: "manager",
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.activeManagerCount).toBe(2);
    expect(preview.privateData.sessionCount).toBe(1);

    await maintenance.deleteUser({
      username: "shared-manager",
      workspaceId: owner.workspaceId,
      role: "manager",
    });

    const users = await db.select().from(appUsers).where(eq(appUsers.workspaceId, owner.workspaceId));
    const sessions = await db.select().from(appSessions);
    expect(users.map((user) => user.username)).toEqual(["owner"]);
    expect(sessions).toEqual([]);
  });

  it("rejects deleting the workspace owner manager account", async () => {
    const owner = await authService.createUser({
      username: "owner",
      displayName: "Owner Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "peer-manager",
      displayName: "Peer Manager",
      password: "secret123",
      role: "manager",
      workspaceId: owner.workspaceId,
    });
    await db
      .update(workspaces)
      .set({ ownerAccountId: "owner" })
      .where(eq(workspaces.id, owner.workspaceId));

    await expect(
      maintenance.deleteUser({
        username: "owner",
        workspaceId: owner.workspaceId,
        role: "manager",
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("workspace owner"),
    });
  });

  it("rejects deleting the last active manager in a workspace", async () => {
    const manager = await authService.createUser({
      username: "manager",
      displayName: "Only Manager",
      password: "secret123",
      role: "manager",
    });
    await db
      .update(workspaces)
      .set({ ownerAccountId: "ops-owner" })
      .where(eq(workspaces.id, manager.workspaceId));

    await expect(
      maintenance.deleteUser({
        username: "manager",
        workspaceId: manager.workspaceId,
        role: "manager",
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("last active manager"),
    });
  });

  it("optionally purges manager-owned private data while preserving tracker work", async () => {
    const owner = await authService.createUser({
      username: "owner",
      displayName: "Owner Manager",
      password: "secret123",
      role: "manager",
    });
    await authService.createUser({
      username: "shared-manager",
      displayName: "Shared Manager",
      password: "secret123",
      role: "manager",
      workspaceId: owner.workspaceId,
    });

    await db.insert(alertDismissals).values({
      workspaceId: owner.workspaceId,
      managerAccountId: "shared-manager",
      alertId: "alert-1",
      dismissedAt: "2026-03-08T00:00:00.000Z",
    });
    await db.insert(teamTrackerSavedViews).values({
      workspaceId: owner.workspaceId,
      managerAccountId: "shared-manager",
      name: "Shared manager view",
      searchQuery: "",
      summaryFilter: "all",
      sortBy: "name",
      groupBy: "none",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    });
    const [deskDay] = await db.insert(managerDeskDays).values({
      workspaceId: owner.workspaceId,
      date: "2026-03-08",
      managerAccountId: "shared-manager",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    }).returning();
    const [deskItem] = await db.insert(managerDeskItems).values({
      workspaceId: owner.workspaceId,
      dayId: deskDay!.id,
      title: "Private desk item",
      kind: "action",
      category: "planning",
      status: "inbox",
      priority: "medium",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    }).returning();
    await db.insert(managerDeskLinks).values({
      workspaceId: owner.workspaceId,
      itemId: deskItem!.id,
      linkType: "external",
      externalLabel: "Private link",
      createdAt: "2026-03-08T00:00:00.000Z",
    });
    await db.insert(managerDeskItemHistory).values({
      workspaceId: owner.workspaceId,
      itemId: deskItem!.id,
      managerAccountId: "shared-manager",
      eventType: "upsert",
      snapshotJson: "{}",
      recordedAt: "2026-03-08T00:00:00.000Z",
    });
    const [trackerDay] = await db.insert(teamTrackerDays).values({
      workspaceId: owner.workspaceId,
      date: "2026-03-08",
      developerAccountId: "dev-1",
      status: "on_track",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    }).returning();
    const [trackerItem] = await db.insert(teamTrackerItems).values({
      workspaceId: owner.workspaceId,
      dayId: trackerDay!.id,
      managerDeskItemId: deskItem!.id,
      itemType: "task",
      title: "Delegated tracker work",
      state: "planned",
      position: 0,
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
    }).returning();

    await maintenance.deleteUser({
      username: "shared-manager",
      workspaceId: owner.workspaceId,
      role: "manager",
      purgePrivateData: true,
    });

    expect(await db.select().from(alertDismissals)).toEqual([]);
    expect(await db.select().from(teamTrackerSavedViews)).toEqual([]);
    expect(await db.select().from(managerDeskDays)).toEqual([]);
    expect(await db.select().from(managerDeskItems)).toEqual([]);
    expect(await db.select().from(managerDeskLinks)).toEqual([]);
    expect(await db.select().from(managerDeskItemHistory)).toEqual([]);

    const trackerRows = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.id, trackerItem!.id));
    expect(trackerRows[0]?.title).toBe("Delegated tracker work");
    expect(trackerRows[0]?.managerDeskItemId).toBeNull();
  });

  it("purges a deleted manager's weekly reviews and only theirs", async () => {
    const owner = await authService.createUser({ username: "owner", displayName: "Owner", password: "secret123", role: "manager" });
    await authService.createUser({ username: "shared-manager", displayName: "Shared", password: "secret123", role: "manager", workspaceId: owner.workspaceId });
    const now = "2026-10-02T12:00:00.000Z";
    await db.insert(weeklyReviews).values([
      { workspaceId: owner.workspaceId, managerAccountId: "shared-manager", weekStart: "2026-09-28", reportMarkdown: "private", startedAt: now, updatedAt: now },
      { workspaceId: owner.workspaceId, managerAccountId: "owner", weekStart: "2026-09-28", startedAt: now, updatedAt: now },
    ]);
    await maintenance.deleteUser({ username: "shared-manager", workspaceId: owner.workspaceId, role: "manager", purgePrivateData: true });
    const left = await db.select().from(weeklyReviews);
    expect(left.map((row) => row.managerAccountId)).toEqual(["owner"]);
  });
});
