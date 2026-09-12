import { and, desc, eq, like, or } from "drizzle-orm";
import type {
  DailyNoteSummary,
  GlobalSearchCheckInItem,
  GlobalSearchDeveloperItem,
  GlobalSearchDeskItem,
  GlobalSearchIssueItem,
  GlobalSearchResponse,
} from "shared/types";
import { db } from "../db/connection";
import {
  developers,
  issues,
  managerDeskDays,
  managerDeskItems,
  teamTrackerCheckIns,
  teamTrackerDays,
} from "../db/schema";
import { isVisibleWorkIssue } from "./issue-rules";
import { DailyNotesService } from "./daily-notes.service";
import { SettingsService } from "./settings.service";
import { normalizeWorkspaceId } from "./workspace.service";

const MIN_QUERY_LENGTH = 2;
const ISSUE_LIMIT = 6;
const DESK_ITEM_LIMIT = 6;
const CHECK_IN_LIMIT = 6;
const DEVELOPER_LIMIT = 4;
const NOTE_LIMIT = 6;

// Wildcard characters are treated as separators so user input can never turn
// into a broad "%" scan; the wrapped pattern stays a literal substring match.
function sanitizeQuery(rawQuery: string): string {
  return rawQuery.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

function containsPattern(query: string): string {
  return `%${query}%`;
}

export class SearchService {
  constructor(
    private readonly settings = new SettingsService(),
    private readonly dailyNotes = new DailyNotesService()
  ) {}

  async search(rawQuery: string, workspaceId?: string, managerAccountId?: string): Promise<GlobalSearchResponse> {
    const query = sanitizeQuery(rawQuery);
    const emptyResponse: GlobalSearchResponse = {
      query,
      issues: [],
      deskItems: [],
      checkIns: [],
      developers: [],
      notes: [],
    };

    if (query.length < MIN_QUERY_LENGTH) {
      return emptyResponse;
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const pattern = containsPattern(query);

    const [issueItems, deskItems, checkIns, developerItems, noteItems] = await Promise.all([
      this.searchIssues(normalizedWorkspaceId, pattern),
      this.searchDeskItems(normalizedWorkspaceId, managerAccountId, pattern),
      this.searchCheckIns(normalizedWorkspaceId, pattern),
      this.searchDevelopers(normalizedWorkspaceId, pattern),
      this.searchNotes(normalizedWorkspaceId, managerAccountId, query),
    ]);

    return {
      query,
      issues: issueItems,
      deskItems,
      checkIns,
      developers: developerItems,
      notes: noteItems,
    };
  }

  private async searchNotes(
    workspaceId: string,
    managerAccountId: string | undefined,
    query: string
  ): Promise<DailyNoteSummary[]> {
    if (!managerAccountId) {
      return [];
    }
    const result = await this.dailyNotes.list(managerAccountId, { q: query, limit: NOTE_LIMIT }, workspaceId);
    return result.notes;
  }

  private async searchIssues(workspaceId: string, pattern: string): Promise<GlobalSearchIssueItem[]> {
    // Search follows the Work board's visibility rules (open, active, in-scope
    // issues only) so the palette never surfaces closed defects the dashboard
    // hides. Filtering happens after the LIKE match, so no SQL limit here.
    const [rows, jiraSyncScopeMode] = await Promise.all([
      db
        .select({
          jiraKey: issues.jiraKey,
          summary: issues.summary,
          statusName: issues.statusName,
          statusCategory: issues.statusCategory,
          priorityName: issues.priorityName,
          assigneeName: issues.assigneeName,
          dueDate: issues.dueDate,
          updatedAt: issues.updatedAt,
          excluded: issues.excluded,
          teamScopeState: issues.teamScopeState,
          syncScopeState: issues.syncScopeState,
        })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            or(
              like(issues.jiraKey, pattern),
              like(issues.summary, pattern),
              like(issues.assigneeName, pattern)
            )
          )
        )
        .orderBy(desc(issues.updatedAt)),
      this.settings.getJiraSyncScopeMode(workspaceId),
    ]);

    return rows
      .filter((row) => isVisibleWorkIssue(row, jiraSyncScopeMode))
      .slice(0, ISSUE_LIMIT)
      .map((row) => ({
        jiraKey: row.jiraKey,
        summary: row.summary,
        statusName: row.statusName,
        statusCategory: row.statusCategory,
        priorityName: row.priorityName,
        assigneeName: row.assigneeName ?? undefined,
        dueDate: row.dueDate ?? undefined,
        updatedAt: row.updatedAt,
      }));
  }

  private async searchDeskItems(
    workspaceId: string,
    managerAccountId: string | undefined,
    pattern: string
  ): Promise<GlobalSearchDeskItem[]> {
    // Desk items are personal to the manager whose day they belong to, so the
    // search is scoped to the requesting account when it is known.
    const rows = await db
      .select({
        itemId: managerDeskItems.id,
        date: managerDeskDays.date,
        title: managerDeskItems.title,
        kind: managerDeskItems.kind,
        category: managerDeskItems.category,
        status: managerDeskItems.status,
        followUpAt: managerDeskItems.followUpAt,
        completedAt: managerDeskItems.completedAt,
        updatedAt: managerDeskItems.updatedAt,
      })
      .from(managerDeskItems)
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(managerDeskItems.workspaceId, workspaceId),
          ...(managerAccountId ? [eq(managerDeskDays.managerAccountId, managerAccountId)] : []),
          or(
            like(managerDeskItems.title, pattern),
            like(managerDeskItems.contextNote, pattern),
            like(managerDeskItems.nextAction, pattern),
            like(managerDeskItems.outcome, pattern),
            like(managerDeskItems.participants, pattern)
          )
        )
      )
      .orderBy(desc(managerDeskItems.updatedAt))
      .limit(DESK_ITEM_LIMIT);

    return rows.map((row) => ({
      itemId: row.itemId,
      date: row.date,
      title: row.title,
      kind: row.kind as GlobalSearchDeskItem["kind"],
      category: row.category as GlobalSearchDeskItem["category"],
      status: row.status as GlobalSearchDeskItem["status"],
      followUpAt: row.followUpAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      updatedAt: row.updatedAt,
    }));
  }

  private async searchCheckIns(workspaceId: string, pattern: string): Promise<GlobalSearchCheckInItem[]> {
    const rows = await db
      .select({
        checkInId: teamTrackerCheckIns.id,
        date: teamTrackerDays.date,
        developerAccountId: teamTrackerDays.developerAccountId,
        developerName: developers.displayName,
        summary: teamTrackerCheckIns.summary,
        status: teamTrackerCheckIns.status,
        createdAt: teamTrackerCheckIns.createdAt,
      })
      .from(teamTrackerCheckIns)
      .innerJoin(teamTrackerDays, eq(teamTrackerCheckIns.dayId, teamTrackerDays.id))
      .leftJoin(
        developers,
        and(
          eq(developers.workspaceId, teamTrackerDays.workspaceId),
          eq(developers.accountId, teamTrackerDays.developerAccountId)
        )
      )
      .where(
        and(
          eq(teamTrackerCheckIns.workspaceId, workspaceId),
          or(
            like(teamTrackerCheckIns.summary, pattern),
            like(teamTrackerCheckIns.rationale, pattern),
            like(developers.displayName, pattern)
          )
        )
      )
      .orderBy(desc(teamTrackerCheckIns.createdAt))
      .limit(CHECK_IN_LIMIT);

    return rows.map((row) => ({
      checkInId: row.checkInId,
      date: row.date,
      developerAccountId: row.developerAccountId,
      developerName: row.developerName ?? row.developerAccountId,
      summary: row.summary,
      status: row.status ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  private async searchDevelopers(workspaceId: string, pattern: string): Promise<GlobalSearchDeveloperItem[]> {
    const rows = await db
      .select({
        accountId: developers.accountId,
        displayName: developers.displayName,
        email: developers.email,
        avatarUrl: developers.avatarUrl,
      })
      .from(developers)
      .where(
        and(
          eq(developers.workspaceId, workspaceId),
          eq(developers.isActive, 1),
          or(
            like(developers.accountId, pattern),
            like(developers.displayName, pattern),
            like(developers.email, pattern)
          )
        )
      )
      .orderBy(developers.displayName)
      .limit(DEVELOPER_LIMIT);

    return rows.map((row) => ({
      accountId: row.accountId,
      displayName: row.displayName,
      email: row.email ?? undefined,
      avatarUrl: row.avatarUrl ?? undefined,
    }));
  }
}
