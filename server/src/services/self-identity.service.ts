import { and, eq } from "drizzle-orm";
import type { TeamSelfLink } from "shared/types";
import { db } from "../db/connection";
import { developers, managerSelfLinks } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { SettingsService } from "./settings.service";
import { normalizeWorkspaceId } from "./workspace.service";

export type SelfLink = TeamSelfLink;

/**
 * One person can be two ids: a manager login (owner of private tasks) and a roster developer
 * (owner of board tasks). The manager's own roster record is stored once, per manager, and read
 * wherever "me" is decided — Tasks, Today and the Team board. Nothing is rewritten; unlinking
 * puts every screen back to its old answer.
 */
export class SelfIdentityService {
  constructor(private readonly settings = new SettingsService()) {}

  /** The viewer's own roster record, or `undefined` when not linked or no longer active. */
  async linkedDeveloperId(managerAccountId: string, workspaceId?: string): Promise<string | undefined> {
    if (!managerAccountId) return undefined;
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ developerAccountId: managerSelfLinks.developerAccountId })
      .from(managerSelfLinks)
      .innerJoin(developers, and(eq(developers.workspaceId, managerSelfLinks.workspaceId), eq(developers.accountId, managerSelfLinks.developerAccountId)))
      .where(and(eq(managerSelfLinks.workspaceId, scope), eq(managerSelfLinks.managerAccountId, managerAccountId), eq(developers.isActive, 1)))
      .limit(1);
    const linked = rows[0]?.developerAccountId;
    // A legacy manager whose session id already IS the roster id needs no link.
    return linked && linked !== managerAccountId ? linked : undefined;
  }

  async get(managerAccountId: string, workspaceId?: string): Promise<SelfLink> {
    const scope = normalizeWorkspaceId(workspaceId);
    const developerAccountId = (await this.linkedDeveloperId(managerAccountId, scope)) ?? null;
    if (developerAccountId) return { developerAccountId, suggestedDeveloperAccountId: null };
    const jiraId = (await this.settings.getManagerJiraAccountId(scope)).trim();
    if (!jiraId) return { developerAccountId: null, suggestedDeveloperAccountId: null };
    const roster = await db.select({ accountId: developers.accountId, jiraAccountId: developers.jiraAccountId })
      .from(developers)
      .where(and(eq(developers.workspaceId, scope), eq(developers.isActive, 1)));
    const match = roster.find((row) => row.accountId === jiraId || row.jiraAccountId === jiraId);
    return { developerAccountId: null, suggestedDeveloperAccountId: match?.accountId ?? null };
  }

  /** `null` unlinks. Only an active roster member can be "me". */
  async set(managerAccountId: string, developerAccountId: string | null, workspaceId?: string): Promise<SelfLink> {
    const scope = normalizeWorkspaceId(workspaceId);
    if (developerAccountId === null) {
      await db.delete(managerSelfLinks).where(and(eq(managerSelfLinks.workspaceId, scope), eq(managerSelfLinks.managerAccountId, managerAccountId)));
      return this.get(managerAccountId, scope);
    }
    const member = (await db.select({ accountId: developers.accountId }).from(developers)
      .where(and(eq(developers.workspaceId, scope), eq(developers.accountId, developerAccountId), eq(developers.isActive, 1))).limit(1))[0];
    if (!member) throw new HttpError(400, "Choose an active team member");
    if (developerAccountId === managerAccountId) throw new HttpError(400, "That is already your account");
    const updatedAt = new Date().toISOString();
    await db.insert(managerSelfLinks)
      .values({ workspaceId: scope, managerAccountId, developerAccountId, updatedAt })
      .onConflictDoUpdate({ target: [managerSelfLinks.workspaceId, managerSelfLinks.managerAccountId], set: { developerAccountId, updatedAt } });
    return this.get(managerAccountId, scope);
  }
}
