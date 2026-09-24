import { and, eq, inArray } from "drizzle-orm";
import type { UserRole } from "shared/types";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import {
  alertDismissals,
  appSessions,
  appUsers,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  teamTrackerItems,
  teamTrackerSavedViews,
  workspaces,
} from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskEventsService } from "./task-events.service";

export type DeletableAuthUserRole = Extract<UserRole, "manager" | "developer">;

interface DeleteUserParams {
  username: string;
  workspaceId: string;
  role: DeletableAuthUserRole;
  purgePrivateData?: boolean;
}

export interface AuthUserDeletionPrivateDataPreview {
  sessionCount: number;
  alertDismissalCount: number;
  teamTrackerSavedViewCount: number;
  managerDeskDayCount: number;
  managerDeskItemCount: number;
  managerDeskLinkCount: number;
  managerDeskHistoryCount: number;
  linkedTrackerItemCount: number;
  privateTaskEventCount: number;
}

export interface AuthUserDeletionPreview {
  username: string;
  displayName: string;
  role: DeletableAuthUserRole;
  workspaceId: string;
  isWorkspaceOwner: boolean;
  activeManagerCount: number;
  blockers: string[];
  privateData: AuthUserDeletionPrivateDataPreview;
}

interface PersistedAuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  workspaceId: string;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function emptyPrivateDataPreview(): AuthUserDeletionPrivateDataPreview {
  return {
    sessionCount: 0,
    alertDismissalCount: 0,
    teamTrackerSavedViewCount: 0,
    managerDeskDayCount: 0,
    managerDeskItemCount: 0,
    managerDeskLinkCount: 0,
    managerDeskHistoryCount: 0,
    linkedTrackerItemCount: 0,
    privateTaskEventCount: 0,
  };
}

export class AuthUserMaintenanceService {
  private readonly eventsService = new TaskEventsService();

  async getDeletionPreview(params: DeleteUserParams): Promise<AuthUserDeletionPreview> {
    const user = await this.getActiveUser(params.username, params.workspaceId);
    if (user.role !== params.role) {
      throw new HttpError(400, `User "${user.username}" is a ${user.role}, not a ${params.role}`);
    }
    if (user.role !== "manager" && user.role !== "developer") {
      throw new HttpError(400, "Only manager and developer users can be deleted with this command");
    }

    const [ownerRows, managerRows, privateData] = await Promise.all([
      db
        .select({ ownerAccountId: workspaces.ownerAccountId })
        .from(workspaces)
        .where(eq(workspaces.id, user.workspaceId))
        .limit(1),
      db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(and(eq(appUsers.workspaceId, user.workspaceId), eq(appUsers.role, "manager"), eq(appUsers.isActive, 1))),
      this.getPrivateDataPreview(user),
    ]);

    const preview: Omit<AuthUserDeletionPreview, "blockers"> = {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      workspaceId: user.workspaceId,
      isWorkspaceOwner: ownerRows[0]?.ownerAccountId === user.username,
      activeManagerCount: managerRows.length,
      privateData,
    };

    return {
      ...preview,
      blockers: this.getDeletionBlockers(preview),
    };
  }

  async deleteUser(params: DeleteUserParams): Promise<AuthUserDeletionPreview> {
    const preview = await this.getDeletionPreview(params);
    if (preview.blockers.length > 0) {
      throw new HttpError(400, preview.blockers.join("; "));
    }

    const user = await this.getActiveUser(params.username, preview.workspaceId);
    await runInTransaction(async () => {
      if (params.purgePrivateData) {
        await this.purgePrivateData(user);
      }

      await db.delete(appSessions).where(eq(appSessions.userId, user.id));
      await db.delete(appUsers).where(eq(appUsers.id, user.id));
    });

    return preview;
  }

  private getDeletionBlockers(
    preview: Omit<AuthUserDeletionPreview, "blockers">
  ): string[] {
    if (preview.role !== "manager") {
      return [];
    }

    const blockers: string[] = [];
    if (preview.isWorkspaceOwner) {
      blockers.push("Cannot delete the workspace owner manager account");
    }
    if (preview.activeManagerCount <= 1) {
      blockers.push("Cannot delete the last active manager in a workspace");
    }
    return blockers;
  }

  private async getActiveUser(username: string, workspaceId: string): Promise<PersistedAuthUser> {
    const normalizedUsername = normalizeUsername(username);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!normalizedUsername) {
      throw new HttpError(400, "username is required");
    }

    const rows = await db
      .select({
        id: appUsers.id,
        username: appUsers.username,
        displayName: appUsers.displayName,
        role: appUsers.role,
        workspaceId: appUsers.workspaceId,
      })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.workspaceId, normalizedWorkspaceId),
          eq(appUsers.username, normalizedUsername),
          eq(appUsers.isActive, 1)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "User not found");
    }

    return {
      ...row,
      role: row.role as UserRole,
    };
  }

  private async getPrivateDataPreview(user: PersistedAuthUser): Promise<AuthUserDeletionPrivateDataPreview> {
    const [sessionRows, alertRows, savedViewRows] = await Promise.all([
      db.select({ id: appSessions.id }).from(appSessions).where(eq(appSessions.userId, user.id)),
      db
        .select({ alertId: alertDismissals.alertId })
        .from(alertDismissals)
        .where(and(eq(alertDismissals.workspaceId, user.workspaceId), eq(alertDismissals.managerAccountId, user.username))),
      db
        .select({ id: teamTrackerSavedViews.id })
        .from(teamTrackerSavedViews)
        .where(and(eq(teamTrackerSavedViews.workspaceId, user.workspaceId), eq(teamTrackerSavedViews.managerAccountId, user.username))),
    ]);

    if (user.role !== "manager") {
      return {
        ...emptyPrivateDataPreview(),
        sessionCount: sessionRows.length,
      };
    }

    const managerDesk = await this.getManagerDeskPrivateDataPreview(user);
    return {
      sessionCount: sessionRows.length,
      alertDismissalCount: alertRows.length,
      teamTrackerSavedViewCount: savedViewRows.length,
      ...managerDesk,
      privateTaskEventCount: await this.eventsService.countPrivateForAuthor(user.workspaceId, user.username),
    };
  }

  private async getManagerDeskPrivateDataPreview(
    user: PersistedAuthUser
  ): Promise<Omit<AuthUserDeletionPrivateDataPreview, "sessionCount" | "alertDismissalCount" | "teamTrackerSavedViewCount" | "privateTaskEventCount">> {
    const dayRows = await db
      .select({ id: managerDeskDays.id })
      .from(managerDeskDays)
      .where(and(eq(managerDeskDays.workspaceId, user.workspaceId), eq(managerDeskDays.managerAccountId, user.username)));
    const dayIds = dayRows.map((row) => row.id);

    if (dayIds.length === 0) {
      return {
        managerDeskDayCount: 0,
        managerDeskItemCount: 0,
        managerDeskLinkCount: 0,
        managerDeskHistoryCount: 0,
        linkedTrackerItemCount: 0,
      };
    }

    const itemRows = await db
      .select({ id: managerDeskItems.id })
      .from(managerDeskItems)
      .where(inArray(managerDeskItems.dayId, dayIds));
    const itemIds = itemRows.map((row) => row.id);

    const [linkRows, historyRows, linkedTrackerRows] = await Promise.all([
      itemIds.length > 0
        ? db.select({ id: managerDeskLinks.id }).from(managerDeskLinks).where(inArray(managerDeskLinks.itemId, itemIds))
        : Promise.resolve([]),
      db
        .select({ id: managerDeskItemHistory.id })
        .from(managerDeskItemHistory)
        .where(and(eq(managerDeskItemHistory.workspaceId, user.workspaceId), eq(managerDeskItemHistory.managerAccountId, user.username))),
      itemIds.length > 0
        ? db
            .select({ id: teamTrackerItems.id })
            .from(teamTrackerItems)
            .where(inArray(teamTrackerItems.managerDeskItemId, itemIds))
        : Promise.resolve([]),
    ]);

    return {
      managerDeskDayCount: dayRows.length,
      managerDeskItemCount: itemRows.length,
      managerDeskLinkCount: linkRows.length,
      managerDeskHistoryCount: historyRows.length,
      linkedTrackerItemCount: linkedTrackerRows.length,
    };
  }

  private async purgePrivateData(user: PersistedAuthUser): Promise<void> {
    await db
      .delete(alertDismissals)
      .where(and(eq(alertDismissals.workspaceId, user.workspaceId), eq(alertDismissals.managerAccountId, user.username)));
    await db
      .delete(teamTrackerSavedViews)
      .where(and(eq(teamTrackerSavedViews.workspaceId, user.workspaceId), eq(teamTrackerSavedViews.managerAccountId, user.username)));

    if (user.role !== "manager") {
      return;
    }
    await this.eventsService.deletePrivateForAuthor(user.workspaceId, user.username);

    const dayRows = await db
      .select({ id: managerDeskDays.id })
      .from(managerDeskDays)
      .where(and(eq(managerDeskDays.workspaceId, user.workspaceId), eq(managerDeskDays.managerAccountId, user.username)));
    const dayIds = dayRows.map((row) => row.id);
    if (dayIds.length === 0) {
      return;
    }

    const itemRows = await db
      .select({ id: managerDeskItems.id })
      .from(managerDeskItems)
      .where(inArray(managerDeskItems.dayId, dayIds));
    const itemIds = itemRows.map((row) => row.id);

    if (itemIds.length > 0) {
      await db
        .update(teamTrackerItems)
        .set({ managerDeskItemId: null })
        .where(inArray(teamTrackerItems.managerDeskItemId, itemIds));
      await db.delete(managerDeskLinks).where(inArray(managerDeskLinks.itemId, itemIds));
      await db.delete(managerDeskItems).where(inArray(managerDeskItems.id, itemIds));
    }

    await db
      .delete(managerDeskItemHistory)
      .where(and(eq(managerDeskItemHistory.workspaceId, user.workspaceId), eq(managerDeskItemHistory.managerAccountId, user.username)));
    await db.delete(managerDeskDays).where(inArray(managerDeskDays.id, dayIds));
    await this.eventsService.pruneOrphans(user.workspaceId);
  }
}
