import { and, eq, inArray, or } from "drizzle-orm";
import type {
  ManagerDeskMaintenancePreview,
  TeamTrackerMaintenancePreview,
  WorkspaceMaintenancePreviewResponse,
  WorkspaceMaintenanceResetResponse,
  WorkspaceMaintenanceResetTarget,
} from "shared/types";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import {
  developerAvailabilityPeriods,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  teamTrackerCheckIns,
  teamTrackerDays,
  teamTrackerItems,
  teamTrackerSavedViews,
  tasks,
  developerNotes,
} from "../db/schema";
import { BackupService } from "./backup.service";
import { SettingsService } from "./settings.service";
import { TaskEventsService } from "./task-events.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskKeysService } from "./task-keys.service";
import { TaskService } from "./task.service";

interface ManagerDeskResetScope {
  preview: ManagerDeskMaintenancePreview;
  dayIds: number[];
  itemIds: number[];
  linkedTrackerItemIds: number[];
}

interface TeamTrackerResetScope {
  preview: TeamTrackerMaintenancePreview;
}

export class WorkspaceMaintenanceService {
  constructor(
    private readonly settings = new SettingsService(),
    private readonly backupService?: BackupService
  ) {}
  private readonly eventsService = new TaskEventsService();

  async getResetPreview(
    managerAccountId: string,
    workspaceId?: string
  ): Promise<WorkspaceMaintenancePreviewResponse> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const [backupBeforeReset, managerDesk, teamTracker] = await Promise.all([
      this.settings.getBackupBeforeReset(normalizedWorkspaceId),
      this.buildManagerDeskScope(managerAccountId, normalizedWorkspaceId),
      this.buildTeamTrackerScope(managerAccountId, normalizedWorkspaceId),
    ]);

    return {
      backupBeforeReset,
      managerDesk: managerDesk.preview,
      teamTracker: teamTracker.preview,
    };
  }

  async reset(
    managerAccountId: string,
    target: WorkspaceMaintenanceResetTarget,
    workspaceId?: string
  ): Promise<WorkspaceMaintenanceResetResponse> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const backup = this.backupService
      ? await this.backupService.createPreResetBackup(normalizedWorkspaceId)
      : null;

    await runInTransaction(async () => {
      if (await new TaskKeysService().canonicalEnabled(normalizedWorkspaceId)) {
        const rows = await db.select().from(tasks).where(eq(tasks.workspaceId, normalizedWorkspaceId));
        const selected = rows.filter((row) => target === "workspace" || (target === "team_tracker" ? row.ownerType === "developer" : row.trackedByManagerId === managerAccountId || (row.ownerType === "manager" && row.ownerId === managerAccountId)));
        await new TaskService().purge(selected.map((row) => row.id), normalizedWorkspaceId);
        if (target === "team_tracker" || target === "workspace") {
          await db.delete(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.workspaceId, normalizedWorkspaceId));
          await db.delete(developerNotes).where(eq(developerNotes.workspaceId, normalizedWorkspaceId));
          await db.delete(developerAvailabilityPeriods).where(eq(developerAvailabilityPeriods.workspaceId, normalizedWorkspaceId));
          await db.delete(teamTrackerSavedViews).where(and(eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId), eq(teamTrackerSavedViews.managerAccountId, managerAccountId)));
          await db.update(teamTrackerDays).set({ status: "on_track", managerNotes: null, lastCheckInAt: null, nextFollowUpAt: null }).where(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId));
        }
        return;
      }
      if (target === "team_tracker" || target === "workspace") {
        const teamTrackerScope = await this.buildTeamTrackerScope(managerAccountId, normalizedWorkspaceId);
        await this.clearTeamTracker(managerAccountId, teamTrackerScope, normalizedWorkspaceId);
      }

      if (target === "manager_desk" || target === "workspace") {
        const managerDeskScope = await this.buildManagerDeskScope(managerAccountId, normalizedWorkspaceId);
        await this.clearManagerDesk(managerDeskScope, {
          deleteLinkedTrackerItems: target === "manager_desk",
        });
      }
      await this.eventsService.pruneOrphans(normalizedWorkspaceId, target === "workspace");
    });

    return {
      success: true,
      target,
      ...(backup
        ? {
            backup: {
              name: backup.name,
              createdAt: backup.createdAt,
              reason: backup.reason,
            },
          }
        : {}),
    };
  }

  private async buildManagerDeskScope(
    managerAccountId: string,
    workspaceId?: string
  ): Promise<ManagerDeskResetScope> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (await new TaskKeysService().canonicalEnabled(normalizedWorkspaceId)) {
      const rows = await db.select().from(tasks).where(and(eq(tasks.workspaceId, normalizedWorkspaceId), or(eq(tasks.trackedByManagerId, managerAccountId), and(eq(tasks.ownerType, "manager"), eq(tasks.ownerId, managerAccountId)))));
      const links = await new TaskService().listLinks(rows.map((row) => row.id), normalizedWorkspaceId);
      return { preview: { dayCount: 0, itemCount: rows.length, linkCount: links.length, historyCount: 0, linkedTrackerItemCount: rows.filter((row) => row.ownerType === "developer").length }, dayIds: [], itemIds: rows.map((row) => row.id), linkedTrackerItemIds: [] };
    }
    const dayRows = await db
      .select({ id: managerDeskDays.id })
      .from(managerDeskDays)
      .where(and(eq(managerDeskDays.workspaceId, normalizedWorkspaceId), eq(managerDeskDays.managerAccountId, managerAccountId)));
    const dayIds = dayRows.map((row) => row.id);

    if (dayIds.length === 0) {
      return {
        preview: {
          dayCount: 0,
          itemCount: 0,
          linkCount: 0,
          historyCount: 0,
          linkedTrackerItemCount: 0,
        },
        dayIds: [],
        itemIds: [],
        linkedTrackerItemIds: [],
      };
    }

    const itemRows = await db
      .select({ id: managerDeskItems.id })
      .from(managerDeskItems)
      .where(inArray(managerDeskItems.dayId, dayIds));
    const itemIds = itemRows.map((row) => row.id);

    const [linkRows, historyRows, linkedTrackerRows] = await Promise.all([
      itemIds.length > 0
        ? db
            .select({ id: managerDeskLinks.id })
            .from(managerDeskLinks)
            .where(inArray(managerDeskLinks.itemId, itemIds))
        : Promise.resolve([]),
      itemIds.length > 0
        ? db
            .select({ id: managerDeskItemHistory.id })
            .from(managerDeskItemHistory)
            .where(inArray(managerDeskItemHistory.itemId, itemIds))
        : Promise.resolve([]),
      itemIds.length > 0
        ? db
            .select({ id: teamTrackerItems.id })
            .from(teamTrackerItems)
            .where(inArray(teamTrackerItems.managerDeskItemId, itemIds))
        : Promise.resolve([]),
    ]);

    return {
      preview: {
        dayCount: dayIds.length,
        itemCount: itemIds.length,
        linkCount: linkRows.length,
        historyCount: historyRows.length,
        linkedTrackerItemCount: linkedTrackerRows.length,
      },
      dayIds,
      itemIds,
      linkedTrackerItemIds: linkedTrackerRows.map((row) => row.id),
    };
  }

  private async buildTeamTrackerScope(
    managerAccountId: string,
    workspaceId?: string
  ): Promise<TeamTrackerResetScope> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (await new TaskKeysService().canonicalEnabled(normalizedWorkspaceId)) {
      const rows = await db.select().from(tasks).where(and(eq(tasks.workspaceId, normalizedWorkspaceId), eq(tasks.ownerType, "developer")));
      const checkIns = await db.select().from(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.workspaceId, normalizedWorkspaceId));
      const availability = await db.select().from(developerAvailabilityPeriods).where(eq(developerAvailabilityPeriods.workspaceId, normalizedWorkspaceId));
      const views = await db.select().from(teamTrackerSavedViews).where(and(eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId), eq(teamTrackerSavedViews.managerAccountId, managerAccountId)));
      const days = await db.select().from(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId));
      return { preview: { dayCount: days.length, itemCount: rows.length, checkInCount: checkIns.length, availabilityPeriodCount: availability.length, savedViewCount: views.length, linkedManagerDeskItemCount: rows.filter((row) => row.trackedByManagerId).length } };
    }
    const [
      dayRows,
      itemRows,
      checkInRows,
      availabilityRows,
      savedViewRows,
    ] = await Promise.all([
      db.select({ id: teamTrackerDays.id }).from(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId)),
      db
        .select({
          id: teamTrackerItems.id,
          managerDeskItemId: teamTrackerItems.managerDeskItemId,
        })
        .from(teamTrackerItems)
        .where(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId)),
      db.select({ id: teamTrackerCheckIns.id }).from(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.workspaceId, normalizedWorkspaceId)),
      db
        .select({ id: developerAvailabilityPeriods.id })
        .from(developerAvailabilityPeriods)
        .where(eq(developerAvailabilityPeriods.workspaceId, normalizedWorkspaceId)),
      db
        .select({ id: teamTrackerSavedViews.id })
        .from(teamTrackerSavedViews)
        .where(and(eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId), eq(teamTrackerSavedViews.managerAccountId, managerAccountId))),
    ]);

    return {
      preview: {
        dayCount: dayRows.length,
        itemCount: itemRows.length,
        checkInCount: checkInRows.length,
        availabilityPeriodCount: availabilityRows.length,
        savedViewCount: savedViewRows.length,
        linkedManagerDeskItemCount: itemRows.filter(
          (row) => typeof row.managerDeskItemId === "number"
        ).length,
      },
    };
  }

  private async clearManagerDesk(
    scope: ManagerDeskResetScope,
    options: { deleteLinkedTrackerItems: boolean }
  ): Promise<void> {
    if (options.deleteLinkedTrackerItems && scope.linkedTrackerItemIds.length > 0) {
      await db
        .delete(teamTrackerItems)
        .where(inArray(teamTrackerItems.id, scope.linkedTrackerItemIds));
    }

    if (scope.itemIds.length > 0) {
      await db
        .delete(managerDeskLinks)
        .where(inArray(managerDeskLinks.itemId, scope.itemIds));
      await db
        .delete(managerDeskItemHistory)
        .where(inArray(managerDeskItemHistory.itemId, scope.itemIds));
      await db
        .delete(managerDeskItems)
        .where(inArray(managerDeskItems.id, scope.itemIds));
    }

    if (scope.dayIds.length > 0) {
      await db
        .delete(managerDeskDays)
        .where(inArray(managerDeskDays.id, scope.dayIds));
    }
  }

  private async clearTeamTracker(
    managerAccountId: string,
    scope: TeamTrackerResetScope,
    workspaceId?: string
  ): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (scope.preview.checkInCount > 0) {
      await db.delete(teamTrackerCheckIns).where(eq(teamTrackerCheckIns.workspaceId, normalizedWorkspaceId));
    }
    if (scope.preview.itemCount > 0) {
      await db.delete(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, normalizedWorkspaceId));
    }
    if (scope.preview.dayCount > 0) {
      await db.delete(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId));
    }
    if (scope.preview.availabilityPeriodCount > 0) {
      await db.delete(developerAvailabilityPeriods).where(eq(developerAvailabilityPeriods.workspaceId, normalizedWorkspaceId));
    }
    if (scope.preview.savedViewCount > 0) {
      await db
        .delete(teamTrackerSavedViews)
        .where(and(eq(teamTrackerSavedViews.workspaceId, normalizedWorkspaceId), eq(teamTrackerSavedViews.managerAccountId, managerAccountId)));
    }
  }
}
