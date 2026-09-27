import { and, desc, eq, ne, or } from "drizzle-orm";
import type {
  FilterType,
  Issue as SharedIssue,
  IssueUpdate,
  LocalTag,
  OverviewCounts,
  IssueTrackerAssignmentSummary,
  JiraSyncScopeMode,
} from "shared/types";
import { db } from "../db/connection";
import { configTable, developers, issueScopeHistory, issues, issueTags, localTags, syncLog } from "../db/schema";
import { JiraClient } from "../jira/client";
import { endOfWeekIsoDate, todayIsoDate } from "../utils/date";
import { getEffectiveDueDate, isOutOfTeamIssue, isStaleIssue, isVisibleWorkIssue } from "./issue-rules";
import { SettingsService } from "./settings.service";
import { TeamTrackerService } from "./team-tracker.service";
import { normalizeWorkspaceId } from "./workspace.service";

export interface IssueQuery {
  filter?: FilterType;
  assignee?: string;
  priority?: string;
  status?: string;
  trackerDate?: string;
  sort?: "priority" | "dueDate" | "updated" | "created";
  order?: "asc" | "desc";
  tagIds?: number[];
  noTags?: boolean;
  includeTrackerAssignments?: boolean;
}

export type TodayIssue = Pick<
  SharedIssue,
  | "jiraKey"
  | "summary"
  | "priorityName"
  | "statusName"
  | "statusCategory"
  | "assigneeId"
  | "assigneeName"
  | "dueDate"
  | "developmentDueDate"
  | "updatedAt"
>;

export interface TodayIssueSnapshot {
  issues: TodayIssue[];
  activeDefects: number;
  dueToday: number;
  staleThresholdHours: number;
}

type JiraMutationClient = Pick<JiraClient, "updateIssue" | "addComment">;
type JiraClientResolver = JiraMutationClient | (() => Promise<JiraMutationClient>);

export class IssueService {
  constructor(
    private readonly jiraClientResolver?: JiraClientResolver,
    private readonly settings = new SettingsService(),
    private readonly teamTrackerService = new TeamTrackerService(),
  ) {}

  async getAll(query: IssueQuery = {}, workspaceId?: string): Promise<SharedIssue[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows: Array<typeof issues.$inferSelect> = await db
      .select()
      .from(issues)
      .where(eq(issues.workspaceId, normalizedWorkspaceId))
      .orderBy(desc(issues.updatedAt));
    const tagMap = await this.getTagMapForAll(normalizedWorkspaceId);
    const managerJiraAccountId = await this.settings.getManagerJiraAccountId(normalizedWorkspaceId);
    const jiraSyncScopeMode = await this.settings.getJiraSyncScopeMode(normalizedWorkspaceId);
    const staleThresholdHours = await this.settings.getStaleThresholdHours(normalizedWorkspaceId);
    const now = new Date();
    const today = todayIsoDate(now);
    const trackerDate = query.trackerDate ?? today;
    const weekEnd = endOfWeekIsoDate(now);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyAssignedIssueKeys = await this.getRecentlyAssignedIssueKeys(dayAgo, normalizedWorkspaceId);
    const trackerAssignmentSummaryMap = query.includeTrackerAssignments === false
      ? new Map<string, IssueTrackerAssignmentSummary>()
      : await this.teamTrackerService.getIssueAssignmentSummaryMap(trackerDate, normalizedWorkspaceId);

    let result: SharedIssue[] = rows.map((row: typeof issues.$inferSelect) =>
      this.toSharedIssue(
        row,
        tagMap.get(row.jiraKey) ?? [],
        trackerAssignmentSummaryMap.get(row.jiraKey)
      )
    );
    result = this.applyIssueQuery(result, query, {
      managerJiraAccountId,
      jiraSyncScopeMode,
      staleThresholdHours,
      now,
      today,
      weekEnd,
      dayAgo,
      recentlyAssignedIssueKeys,
    });


    return this.sortIssues(result, query.sort ?? "priority", query.order ?? "desc");
  }

  async getTodaySnapshot(date: string, workspaceId?: string): Promise<TodayIssueSnapshot> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const [jiraSyncScopeMode, staleThresholdHours] = await Promise.all([
      this.settings.getJiraSyncScopeMode(normalizedWorkspaceId),
      this.settings.getStaleThresholdHours(normalizedWorkspaceId),
    ]);
    const visibilityConditions = [
      eq(issues.workspaceId, normalizedWorkspaceId),
      ne(issues.statusCategory, "done"),
      eq(issues.excluded, 0),
      eq(issues.syncScopeState, "active"),
    ];

    if (jiraSyncScopeMode !== "base_query") {
      visibilityConditions.push(ne(issues.teamScopeState, "out_of_team"));
    }

    const rows = await db
      .select({
        jiraKey: issues.jiraKey,
        summary: issues.summary,
        priorityName: issues.priorityName,
        statusName: issues.statusName,
        statusCategory: issues.statusCategory,
        assigneeId: issues.assigneeId,
        assigneeName: issues.assigneeName,
        dueDate: issues.dueDate,
        developmentDueDate: issues.developmentDueDate,
        updatedAt: issues.updatedAt,
      })
      .from(issues)
      .where(and(...visibilityConditions));

    const todayIssues: TodayIssue[] = rows.map((row) => ({
      jiraKey: row.jiraKey,
      summary: row.summary,
      priorityName: row.priorityName,
      statusName: row.statusName,
      statusCategory: row.statusCategory,
      assigneeId: row.assigneeId ?? undefined,
      assigneeName: row.assigneeName ?? undefined,
      dueDate: row.dueDate ?? undefined,
      developmentDueDate: row.developmentDueDate ?? undefined,
      updatedAt: row.updatedAt,
    }));

    return {
      issues: todayIssues,
      activeDefects: todayIssues.length,
      dueToday: todayIssues.filter((issue) => getEffectiveDueDate(issue) === date).length,
      staleThresholdHours,
    };
  }

  async getById(jiraKey: string, trackerDate = todayIsoDate(), workspaceId?: string): Promise<SharedIssue | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const row = await db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)))
      .limit(1);
    if (!row[0]) {
      return undefined;
    }
    const tags = await this.getTagsForIssue(jiraKey, normalizedWorkspaceId);
    const trackerAssignmentSummaryMap = await this.teamTrackerService.getIssueAssignmentSummaryMap(trackerDate, normalizedWorkspaceId);
    return this.toSharedIssue(row[0], tags, trackerAssignmentSummaryMap.get(jiraKey));
  }

  async update(jiraKey: string, payload: IssueUpdate, workspaceId?: string): Promise<SharedIssue> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = await db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)))
      .limit(1);
    const existingRow = existing[0];
    if (!existingRow) {
      throw new Error("Issue not found");
    }

    const jiraFields: Record<string, unknown> = {};
    const devDueDateField = await this.settings.getJiraDevDueDateField(normalizedWorkspaceId);
    const updatedAt = new Date().toISOString();

    if (payload.assigneeId !== undefined) {
      jiraFields.assignee = { accountId: payload.assigneeId };
    }
    if (payload.priorityName !== undefined) {
      jiraFields.priority = { name: payload.priorityName };
    }
    if (payload.dueDate !== undefined) {
      jiraFields.duedate = payload.dueDate;
    }
    if (payload.developmentDueDate !== undefined) {
      jiraFields[devDueDateField] = payload.developmentDueDate;
    }
    if (payload.flagged !== undefined) {
      jiraFields.customfield_10021 = payload.flagged ? [{ id: "10019" }] : null;
    }

    // Only call Jira for Jira-synced fields
    const hasJiraFields = payload.assigneeId !== undefined || payload.priorityName !== undefined ||
      payload.dueDate !== undefined || payload.developmentDueDate !== undefined || payload.flagged !== undefined;
    if (hasJiraFields) {
      const jiraClient = await this.getJiraClient(normalizedWorkspaceId);
      await jiraClient.updateIssue(jiraKey, jiraFields);
    }

    const localUpdate: Partial<typeof issues.$inferInsert> = {};
    if (payload.assigneeId !== undefined) {
      localUpdate.assigneeId = payload.assigneeId;
      localUpdate.assigneeName = await this.resolveAssigneeName(payload.assigneeId, normalizedWorkspaceId);
      localUpdate.teamScopeState = await this.resolveTeamScopeState(payload.assigneeId, normalizedWorkspaceId);
      localUpdate.syncScopeState = "active";
      localUpdate.lastReconciledAt = updatedAt;
      localUpdate.scopeChangedAt = updatedAt;
    }
    if (payload.priorityName !== undefined) {
      localUpdate.priorityName = payload.priorityName;
    }
    if (payload.dueDate !== undefined) {
      localUpdate.dueDate = payload.dueDate;
    }
    if (payload.developmentDueDate !== undefined) {
      localUpdate.developmentDueDate = payload.developmentDueDate;
    }
    if (payload.flagged !== undefined) {
      localUpdate.flagged = payload.flagged ? 1 : 0;
    }
    if (payload.analysisNotes !== undefined) {
      localUpdate.analysisNotes = payload.analysisNotes;
    }

    await db
      .update(issues)
      .set({ ...localUpdate, updatedAt })
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)));

    if (
      payload.assigneeId !== undefined &&
      (existingRow.assigneeId !== localUpdate.assigneeId ||
        existingRow.teamScopeState !== localUpdate.teamScopeState ||
        existingRow.syncScopeState !== localUpdate.syncScopeState)
    ) {
      await this.recordScopeHistory(existingRow, {
        ...existingRow,
        ...localUpdate,
        updatedAt,
      }, updatedAt);
    }

    const updated = await this.getById(jiraKey, todayIsoDate(), normalizedWorkspaceId);
    if (!updated) {
      throw new Error("Issue not found after update");
    }
    return updated;
  }

  async addComment(jiraKey: string, text: string, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const issue = await this.getById(jiraKey, todayIsoDate(), normalizedWorkspaceId);
    if (!issue) {
      throw new Error("Issue not found");
    }
    const jiraClient = await this.getJiraClient(normalizedWorkspaceId);
    await jiraClient.addComment(jiraKey, text);
  }

  async excludeIssue(jiraKey: string, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await db
      .update(issues)
      .set({ excluded: 1 })
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)));
  }

  async restoreIssue(jiraKey: string, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await db
      .update(issues)
      .set({ excluded: 0 })
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)));
  }

  async getOverviewCounts(workspaceId?: string): Promise<OverviewCounts> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows: Array<typeof issues.$inferSelect> = await db
      .select()
      .from(issues)
      .where(eq(issues.workspaceId, normalizedWorkspaceId));
    const all = rows.map((row) => this.toSharedIssue(row));
    const managerJiraAccountId = await this.settings.getManagerJiraAccountId(normalizedWorkspaceId);
    const jiraSyncScopeMode = await this.settings.getJiraSyncScopeMode(normalizedWorkspaceId);
    const staleThresholdHours = await this.settings.getStaleThresholdHours(normalizedWorkspaceId);
    const now = new Date();
    const today = todayIsoDate(now);
    const weekEnd = endOfWeekIsoDate(now);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyAssignedIssueKeys = await this.getRecentlyAssignedIssueKeys(dayAgo, normalizedWorkspaceId);

    const latest = await db
      .select()
      .from(syncLog)
      .where(eq(syncLog.workspaceId, normalizedWorkspaceId))
      .orderBy(desc(syncLog.id))
      .limit(1);
    const filterContext = { managerJiraAccountId, jiraSyncScopeMode, staleThresholdHours, now, today, weekEnd, dayAgo, recentlyAssignedIssueKeys };

    return {
      new: this.applyIssueQuery(all, { filter: "new" }, filterContext).length,
      recentlyAssigned: this.applyIssueQuery(all, { filter: "recentlyAssigned" }, filterContext).length,
      unassigned: this.applyIssueQuery(all, { filter: "unassigned" }, filterContext).length,
      dueToday: this.applyIssueQuery(all, { filter: "dueToday" }, filterContext).length,
      dueThisWeek: this.applyIssueQuery(all, { filter: "dueThisWeek" }, filterContext).length,
      noDueDate: this.applyIssueQuery(all, { filter: "noDueDate" }, filterContext).length,
      overdue: this.applyIssueQuery(all, { filter: "overdue" }, filterContext).length,
      blocked: this.applyIssueQuery(all, { filter: "blocked" }, filterContext).length,
      stale: this.applyIssueQuery(all, { filter: "stale" }, filterContext).length,
      highPriority: this.applyIssueQuery(all, { filter: "highPriority" }, filterContext).length,
      inProgress: this.applyIssueQuery(all, { filter: "inProgress" }, filterContext).length,
      reopened: this.applyIssueQuery(all, { filter: "reopened" }, filterContext).length,
      outOfTeam: this.applyIssueQuery(all, { filter: "outOfTeam" }, filterContext).length,
      total: this.applyIssueQuery(all, { filter: "all" }, filterContext).length,
      lastSynced: latest[0]?.completedAt ?? undefined,
    };
  }

  async getTagCounts(query: Pick<IssueQuery, "filter" | "assignee"> = {}, workspaceId?: string): Promise<{ counts: { tagId: number; count: number }[]; untaggedCount: number }> {
    const all = await this.getAll({ filter: query.filter, assignee: query.assignee }, workspaceId);
    const tagCountMap = new Map<number, number>();
    let untaggedCount = 0;

    for (const issue of all) {
      if (issue.localTags.length === 0) {
        untaggedCount++;
      }
      for (const tag of issue.localTags) {
        tagCountMap.set(tag.id, (tagCountMap.get(tag.id) ?? 0) + 1);
      }
    }

    const counts = Array.from(tagCountMap.entries()).map(([tagId, count]) => ({ tagId, count }));
    return { counts, untaggedCount };
  }

  private applyIssueQuery(
    issuesList: SharedIssue[],
    query: Pick<IssueQuery, "filter" | "assignee" | "priority" | "status" | "tagIds" | "noTags">,
    context: {
      managerJiraAccountId: string;
      jiraSyncScopeMode: JiraSyncScopeMode;
      staleThresholdHours: number;
      now: Date;
      today: string;
      weekEnd: string;
      dayAgo: Date;
      recentlyAssignedIssueKeys: Set<string>;
    }
  ): SharedIssue[] {
    let result = [...issuesList];

    if (query.assignee) {
      result = result.filter((issue) => issue.assigneeId === query.assignee);
    }
    if (query.priority) {
      result = result.filter((issue) => issue.priorityName === query.priority);
    }
    if (query.status) {
      result = result.filter((issue) => issue.statusName === query.status);
    }

    if (query.noTags) {
      result = result.filter((issue) => issue.localTags.length === 0);
    } else if (query.tagIds && query.tagIds.length > 0) {
      const requiredIds = new Set(query.tagIds);
      result = result.filter((issue) => {
        const issueTagIds = new Set(issue.localTags.map((t) => t.id));
        for (const id of requiredIds) {
          if (!issueTagIds.has(id)) return false;
        }
        return true;
      });
    }

    const visibleWorkIssues = () => result.filter((issue) => isVisibleWorkIssue(issue, context.jiraSyncScopeMode));

    switch (query.filter) {
      case "new":
        return visibleWorkIssues().filter((issue) => new Date(issue.createdAt).getTime() >= context.dayAgo.getTime());
      case "recentlyAssigned":
        return visibleWorkIssues().filter((issue) => context.recentlyAssignedIssueKeys.has(issue.jiraKey));
      case "inProgress":
        return visibleWorkIssues().filter((issue) => this.hasAnyStatusName(issue, ["In Progress", "Work in Progress"]));
      case "reopened":
        return visibleWorkIssues().filter((issue) => this.hasStatusName(issue, "Reopened"));
      case "unassigned":
        return visibleWorkIssues().filter(
          (issue) => issue.assigneeId === context.managerJiraAccountId || issue.teamScopeState === "unassigned"
        );
      case "dueToday":
        return visibleWorkIssues().filter((issue) => getEffectiveDueDate(issue) === context.today);
      case "dueThisWeek":
        return visibleWorkIssues().filter((issue) => {
          const dueDate = getEffectiveDueDate(issue);
          return Boolean(dueDate && dueDate > context.today && dueDate <= context.weekEnd);
        });
      case "noDueDate":
        return visibleWorkIssues().filter((issue) => !getEffectiveDueDate(issue));
      case "overdue":
        return visibleWorkIssues().filter((issue) => {
          const dueDate = getEffectiveDueDate(issue);
          return Boolean(dueDate && dueDate < context.today);
        });
      case "blocked":
        return visibleWorkIssues().filter((issue) => issue.flagged);
      case "stale":
        return visibleWorkIssues().filter((issue) => isStaleIssue(issue, context.staleThresholdHours, context.now));
      case "highPriority":
        return visibleWorkIssues().filter((issue) => issue.priorityName === "Highest" || issue.priorityName === "High");
      case "outOfTeam":
        return result.filter((issue) => isOutOfTeamIssue(issue));
      case "all":
      case undefined:
        return visibleWorkIssues();
      default:
        return visibleWorkIssues();
    }
  }

  private async resolveTeamScopeState(assigneeId?: string, workspaceId?: string): Promise<"in_team" | "out_of_team" | "unassigned"> {
    if (!assigneeId) {
      return "unassigned";
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.isActive, 1)));
    const activeTeamIds = new Set(
      rows
        .map((row) => row.jiraAccountId ?? (row.source === "manual" ? undefined : row.accountId))
        .filter((accountId): accountId is string => Boolean(accountId?.trim()))
    );
    return activeTeamIds.has(assigneeId) ? "in_team" : "out_of_team";
  }

  private async resolveAssigneeName(assigneeId?: string, workspaceId?: string): Promise<string | null> {
    if (!assigneeId) {
      return null;
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(developers)
      .where(
        and(
          eq(developers.workspaceId, normalizedWorkspaceId),
          or(eq(developers.accountId, assigneeId), eq(developers.jiraAccountId, assigneeId))
        )
      )
      .limit(1);
    return rows[0]?.displayName ?? null;
  }

  private async getRecentlyAssignedIssueKeys(dayAgo: Date, workspaceId?: string): Promise<Set<string>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(issueScopeHistory)
      .where(eq(issueScopeHistory.workspaceId, normalizedWorkspaceId));
    const cutoff = dayAgo.getTime();

    return new Set(
      rows
        .filter((row) => {
          const observedAt = new Date(row.observedAt).getTime();
          return !Number.isNaN(observedAt) && observedAt >= cutoff && this.isRecentlyAssignedScopeEvent(row);
        })
        .map((row) => row.jiraKey)
    );
  }

  private sortIssues(issuesList: SharedIssue[], sort: NonNullable<IssueQuery["sort"]>, order: NonNullable<IssueQuery["order"]>): SharedIssue[] {
    const direction = order === "asc" ? 1 : -1;
    const priorityRank: Record<string, number> = { Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };

    return [...issuesList].sort((a, b) => {
      let delta = 0;
      if (sort === "priority") {
        delta = (priorityRank[a.priorityName] ?? 0) - (priorityRank[b.priorityName] ?? 0);
      }
      if (sort === "dueDate") {
        delta = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
      }
      if (sort === "updated") {
        delta = a.updatedAt.localeCompare(b.updatedAt);
      }
      if (sort === "created") {
        delta = a.createdAt.localeCompare(b.createdAt);
      }
      return delta * direction;
    });
  }

  private toSharedIssue(
    row: typeof issues.$inferSelect,
    tags: LocalTag[] = [],
    trackerAssignmentsToday?: IssueTrackerAssignmentSummary
  ): SharedIssue {
    return {
      jiraKey: row.jiraKey,
      summary: row.summary,
      description: row.description ?? undefined,
      aspenSeverity: row.aspenSeverity ?? undefined,
      priorityName: row.priorityName,
      priorityId: row.priorityId,
      statusName: row.statusName,
      statusCategory: row.statusCategory,
      assigneeId: row.assigneeId ?? undefined,
      assigneeName: row.assigneeName ?? undefined,
      reporterName: row.reporterName ?? undefined,
      component: row.component ?? undefined,
      labels: row.labels ? (JSON.parse(row.labels) as string[]) : [],
      dueDate: row.dueDate ?? undefined,
      developmentDueDate: row.developmentDueDate ?? undefined,
      flagged: row.flagged === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      teamScopeState: row.teamScopeState as SharedIssue["teamScopeState"],
      syncScopeState: row.syncScopeState as SharedIssue["syncScopeState"],
      lastSeenInScopedSyncAt: row.lastSeenInScopedSyncAt ?? undefined,
      lastReconciledAt: row.lastReconciledAt ?? undefined,
      scopeChangedAt: row.scopeChangedAt ?? undefined,
      localTags: tags,
      analysisNotes: row.analysisNotes ?? undefined,
      trackerAssignmentsToday,
      excluded: row.excluded === 1,
    };
  }

  private hasStatusName(issue: SharedIssue, statusName: string): boolean {
    return issue.statusName.trim().toLowerCase() === statusName.trim().toLowerCase();
  }

  private hasAnyStatusName(issue: SharedIssue, statusNames: string[]): boolean {
    const normalizedStatus = issue.statusName.trim().toLowerCase();
    return statusNames.some((statusName) => normalizedStatus === statusName.trim().toLowerCase());
  }

  private isRecentlyAssignedScopeEvent(row: typeof issueScopeHistory.$inferSelect): boolean {
    if (row.changeType === "entered_team_scope" || row.changeType === "returned_to_team_scope" || row.changeType === "reassigned") {
      return true;
    }

    return row.changeType === "team_scope_changed" && row.toTeamScopeState === "unassigned";
  }

  private async recordScopeHistory(
    previous: typeof issues.$inferSelect,
    next: Partial<typeof issues.$inferInsert> & typeof issues.$inferSelect,
    observedAt: string
  ): Promise<void> {
    await db.insert(issueScopeHistory).values({
      workspaceId: previous.workspaceId,
      jiraKey: previous.jiraKey,
      observedAt,
      changeType: this.getScopeChangeType(previous, next),
      fromAssigneeId: previous.assigneeId,
      toAssigneeId: next.assigneeId ?? null,
      fromTeamScopeState: previous.teamScopeState,
      toTeamScopeState: next.teamScopeState ?? previous.teamScopeState,
      fromSyncScopeState: previous.syncScopeState,
      toSyncScopeState: next.syncScopeState ?? previous.syncScopeState,
      fromStatusCategory: previous.statusCategory,
      toStatusCategory: next.statusCategory ?? previous.statusCategory,
    });
  }

  private getScopeChangeType(
    previous: typeof issues.$inferSelect,
    next: Partial<typeof issues.$inferInsert> & typeof issues.$inferSelect
  ): string {
    if (previous.statusCategory !== next.statusCategory && next.statusCategory === "done") {
      return "resolved";
    }
    if (previous.teamScopeState !== next.teamScopeState) {
      if (next.teamScopeState === "out_of_team") {
        return "left_team_scope";
      }
      if (next.teamScopeState === "in_team") {
        return "returned_to_team_scope";
      }
      return "team_scope_changed";
    }
    if (previous.syncScopeState !== next.syncScopeState) {
      if (next.syncScopeState === "inaccessible") {
        return "issue_unreachable";
      }
      if (next.syncScopeState === "out_of_scope") {
        return "left_sync_scope";
      }
      return "sync_scope_restored";
    }
    if (previous.assigneeId !== next.assigneeId) {
      return "reassigned";
    }
    return "issue_updated";
  }

  private async getTagsForIssue(jiraKey: string, workspaceId?: string): Promise<LocalTag[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ id: localTags.id, name: localTags.name, color: localTags.color })
      .from(issueTags)
      .innerJoin(localTags, eq(issueTags.tagId, localTags.id))
      .where(and(eq(issueTags.workspaceId, normalizedWorkspaceId), eq(issueTags.jiraKey, jiraKey)));
    return rows;
  }

  private async getTagMapForAll(workspaceId?: string): Promise<Map<string, LocalTag[]>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        jiraKey: issueTags.jiraKey,
        id: localTags.id,
        name: localTags.name,
        color: localTags.color,
      })
      .from(issueTags)
      .innerJoin(localTags, eq(issueTags.tagId, localTags.id))
      .where(eq(issueTags.workspaceId, normalizedWorkspaceId));
    const map = new Map<string, LocalTag[]>();
    for (const row of rows) {
      const arr = map.get(row.jiraKey) ?? [];
      arr.push({ id: row.id, name: row.name, color: row.color });
      map.set(row.jiraKey, arr);
    }
    return map;
  }

  private async getJiraClient(workspaceId?: string): Promise<JiraMutationClient> {
    if (typeof this.jiraClientResolver === "function") {
      return this.jiraClientResolver();
    }
    if (this.jiraClientResolver) {
      return this.jiraClientResolver;
    }
    return this.settings.createJiraClient(workspaceId);
  }
}
