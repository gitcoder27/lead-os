import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { developers, issues, issueScopeHistory, syncLog, workspaces } from "../db/schema";
import { JiraClient } from "../jira/client";
import { buildScopedJql } from "../jira/jql";
import { JiraIssue } from "../jira/types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { SettingsService } from "../services/settings.service";
import { normalizeWorkspaceId } from "../services/workspace.service";
import type { JiraSyncScopeMode } from "shared/types";

export interface SyncResult {
  status: "success" | "error" | "skipped";
  issuesSynced: number;
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
  reason?: "already_running";
}

type TeamScopeState = "in_team" | "out_of_team" | "unassigned";
type SyncScopeState = "active" | "inaccessible" | "out_of_scope";

export class SyncEngine {
  private task?: NodeJS.Timeout;
  private syncingWorkspaces = new Set<string>();
  private lastStatusByWorkspace = new Map<string, "idle" | "syncing" | "error">();
  private lastErrorByWorkspace = new Map<string, string | undefined>();

  constructor(private readonly settings = new SettingsService()) {}

  async start(): Promise<void> {
    this.stop();
    if (!(await this.isAutoSyncEnabled())) {
      logger.info("Jira auto-sync is disabled; sync scheduler not started");
      return;
    }
    const syncIntervalMs = await this.getSchedulerIntervalMs();
    this.task = setInterval(() => {
      void this.syncAllWorkspaces();
    }, syncIntervalMs);
  }

  stop(): void {
    if (this.task) {
      clearInterval(this.task);
    }
    this.task = undefined;
  }

  async isAutoSyncEnabled(workspaceId?: string): Promise<boolean> {
    return this.settings.getJiraAutoSyncEnabled(workspaceId);
  }

  getRuntimeStatus(workspaceId?: string): { status: "idle" | "syncing" | "error"; errorMessage?: string } {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    return {
      status: this.lastStatusByWorkspace.get(normalizedWorkspaceId) ?? "idle",
      errorMessage: this.lastErrorByWorkspace.get(normalizedWorkspaceId),
    };
  }

  async syncAllWorkspaces(): Promise<SyncResult[]> {
    const workspaceIds = await this.getSyncableWorkspaceIds();
    const results: SyncResult[] = [];

    for (const workspaceId of workspaceIds) {
      if (!(await this.isAutoSyncEnabled(workspaceId))) {
        continue;
      }
      results.push(await this.syncNow(workspaceId));
    }

    return results;
  }

  async getSyncableWorkspaceIds(): Promise<string[]> {
    const rows = await db.select({ id: workspaces.id }).from(workspaces);
    const ids: string[] = [];

    for (const row of rows) {
      const workspaceId = normalizeWorkspaceId(row.id);
      const [baseUrl, email, project, token] = await Promise.all([
        this.settings.getJiraBaseUrl(workspaceId),
        this.settings.getJiraEmail(workspaceId),
        this.settings.getJiraProjectKey(workspaceId),
        this.settings.getJiraToken(workspaceId),
      ]);

      if (baseUrl && email && project && token) {
        ids.push(workspaceId);
      }
    }

    return ids;
  }

  async getLastSyncLog(workspaceId?: string): Promise<typeof syncLog.$inferSelect | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(syncLog)
      .where(eq(syncLog.workspaceId, normalizedWorkspaceId))
      .orderBy(desc(syncLog.id))
      .limit(1);
    return rows[0];
  }

  async syncNow(workspaceId?: string): Promise<SyncResult> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (this.syncingWorkspaces.has(normalizedWorkspaceId)) {
      const now = new Date().toISOString();
      return { status: "skipped", reason: "already_running", issuesSynced: 0, startedAt: now, completedAt: now };
    }

    this.syncingWorkspaces.add(normalizedWorkspaceId);
    this.lastStatusByWorkspace.set(normalizedWorkspaceId, "syncing");
    const startedAt = new Date().toISOString();
    const logInsert = await db.insert(syncLog).values({ workspaceId: normalizedWorkspaceId, startedAt, status: "running", issuesSynced: 0 }).returning({ id: syncLog.id });
    const logId = logInsert[0]?.id;

    try {
      const project = await this.settings.getJiraProjectKey(normalizedWorkspaceId);
      if (!project) {
        throw new Error("Missing jira_project_key in config");
      }

      const dbJql = await this.settings.getJiraSyncJql(normalizedWorkspaceId);
      const syncScopeMode = await this.settings.getJiraSyncScopeMode(normalizedWorkspaceId);
      const teamAccountIds = await this.getScopedTeamAccountIds(normalizedWorkspaceId);
      const jql = buildScopedJql(project, dbJql ?? config.JIRA_SYNC_JQL, teamAccountIds, syncScopeMode);
      const devDueDateField = await this.settings.getJiraDevDueDateField(normalizedWorkspaceId);
      const aspenSeverityField = await this.settings.getJiraAspenSeverityField(normalizedWorkspaceId);
      const jiraClient = await this.settings.createJiraClient(normalizedWorkspaceId);
      await jiraClient.getCurrentUser();
      const locallyTrackedKeys = await this.getLocallyTrackedActiveKeys(normalizedWorkspaceId);
      const fields = [
        "summary",
        "description",
        "priority",
        "status",
        "assignee",
        "reporter",
        "components",
        "labels",
        "duedate",
        "created",
        "updated",
        "customfield_10021",
        devDueDateField,
        aspenSeverityField,
      ].filter((field): field is string => Boolean(field));
      const jiraIssues = await jiraClient.searchIssues(jql, fields);

      const now = new Date().toISOString();
      for (const item of jiraIssues) {
        const row = this.toIssueRow(item, now, devDueDateField, aspenSeverityField, teamAccountIds, true, normalizedWorkspaceId);
        await this.upsertIssue(row);
      }

      const returnedKeys = new Set(jiraIssues.map((it) => it.key));
      const missingKeys = locallyTrackedKeys.filter((key) => !returnedKeys.has(key));
      const reconciledCount = await this.reconcileMissingScopedIssues(
        missingKeys,
        jiraClient,
        teamAccountIds,
        syncScopeMode,
        now,
        devDueDateField,
        aspenSeverityField,
        normalizedWorkspaceId
      );

      const completedAt = new Date().toISOString();
      if (logId !== undefined) {
        await db
          .update(syncLog)
          .set({ status: "success", issuesSynced: jiraIssues.length + reconciledCount, completedAt })
          .where(eq(syncLog.id, logId));
      }

      logger.info(
        { workspaceId: normalizedWorkspaceId, issuesSynced: jiraIssues.length + reconciledCount },
        "Jira sync completed"
      );
      this.lastStatusByWorkspace.set(normalizedWorkspaceId, "idle");
      this.lastErrorByWorkspace.delete(normalizedWorkspaceId);
      return { status: "success", issuesSynced: jiraIssues.length + reconciledCount, startedAt, completedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      if (this.isNonRetryableJiraConfigurationError(message)) {
        logger.warn({ err: error, workspaceId: normalizedWorkspaceId }, "Workspace Jira sync failed due to configuration");
      } else {
        logger.error({ err: error, workspaceId: normalizedWorkspaceId }, "Sync failed");
      }
      const completedAt = new Date().toISOString();
      if (logId !== undefined) {
        await db.update(syncLog).set({ status: "error", errorMessage: message, completedAt }).where(eq(syncLog.id, logId));
      }
      this.lastStatusByWorkspace.set(normalizedWorkspaceId, "error");
      this.lastErrorByWorkspace.set(normalizedWorkspaceId, message);
      return { status: "error", issuesSynced: 0, startedAt, completedAt, errorMessage: message };
    } finally {
      this.syncingWorkspaces.delete(normalizedWorkspaceId);
    }
  }

  private async getSchedulerIntervalMs(): Promise<number> {
    const workspaceIds = await this.getSyncableWorkspaceIds();
    if (workspaceIds.length === 0) {
      return this.settings.getSyncIntervalMs();
    }

    const intervals = await Promise.all(workspaceIds.map((workspaceId) => this.settings.getSyncIntervalMs(workspaceId)));
    return Math.min(...intervals.filter((interval) => Number.isFinite(interval) && interval > 0));
  }

  private isNonRetryableJiraConfigurationError(message: string): boolean {
    return message === "Missing Jira credentials" ||
      message === "Missing jira_project_key in config" ||
      message === "Jira authentication failed (401)" ||
      message === "Jira access denied (403)";
  }

  private toIssueRow(
    item: JiraIssue,
    syncedAt: string,
    devDueDateFieldOverride: string | undefined,
    aspenSeverityFieldOverride: string | undefined,
    teamAccountIds: Set<string>,
    fromScopedSync: boolean,
    workspaceId?: string
  ): typeof issues.$inferInsert {
    const labels = item.fields.labels ?? [];
    const flagged = Array.isArray(item.fields.customfield_10021) && item.fields.customfield_10021.some((it) => it.id === "10019");
    const devDueDateField = devDueDateFieldOverride || config.JIRA_DEV_DUE_DATE_FIELD;
    const aspenSeverityField = aspenSeverityFieldOverride || config.JIRA_ASPEN_SEVERITY_FIELD;
    const developmentDueDate = this.toDateValue(item.fields[devDueDateField]);
    const aspenSeverity = aspenSeverityField ? this.toDbTextValue(item.fields[aspenSeverityField]) : null;
    const dueDate = this.toDateValue(item.fields.duedate);
    const assigneeId = this.toDbTextValue(item.fields.assignee?.accountId);
    const row: typeof issues.$inferInsert = {
      workspaceId: normalizeWorkspaceId(workspaceId),
      jiraKey: item.key,
      summary: this.toDbTextValue(item.fields.summary) ?? "",
      description: JSON.stringify(item.fields.description ?? ""),
      aspenSeverity,
      priorityName: this.toDbTextValue(item.fields.priority?.name) ?? "Medium",
      priorityId: this.toDbTextValue(item.fields.priority?.id) ?? "",
      statusName: this.toDbTextValue(item.fields.status?.name) ?? "",
      statusCategory: item.fields.status?.statusCategory?.key ?? "new",
      assigneeId,
      assigneeName: this.toDbTextValue(item.fields.assignee?.displayName),
      teamScopeState: this.resolveTeamScopeState(assigneeId, teamAccountIds),
      syncScopeState: "active",
      reporterName: this.toDbTextValue(item.fields.reporter?.displayName),
      component: this.toDbTextValue(item.fields.components?.[0]?.name),
      labels: JSON.stringify(labels),
      dueDate,
      developmentDueDate,
      flagged: flagged ? 1 : 0,
      createdAt: item.fields.created ?? syncedAt,
      updatedAt: item.fields.updated ?? syncedAt,
      syncedAt,
      lastReconciledAt: syncedAt,
    };
    if (fromScopedSync) {
      row.lastSeenInScopedSyncAt = syncedAt;
    }
    return row;
  }

  private toDbTextValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return null;
      }
      for (const entry of value) {
        const nested = this.toDbTextValue(entry);
        if (nested !== null) {
          return nested;
        }
      }
      return null;
    }
    if (typeof value === "object") {
      const objectValue = value as { value?: unknown; name?: unknown };
      if (objectValue.value !== undefined && objectValue.value !== null) {
        return this.toDbTextValue(objectValue.value);
      }
      if (objectValue.name !== undefined && objectValue.name !== null) {
        return this.toDbTextValue(objectValue.name);
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  private toDateValue(value: unknown): string | null {
    const normalized = this.toDbTextValue(value);
    if (normalized === null) {
      return null;
    }

    const trimmed = normalized.trim();
    if (!trimmed) {
      return null;
    }

    const parseDate = (raw: string): string | null => {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return null;
    };

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const direct = parseDate(trimmed);
      if (direct) {
        return direct;
      }
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        return this.toDateValue(parsed) ?? null;
      }
      if (parsed && typeof parsed === "object") {
        const valueLike = (parsed as { value?: unknown; date?: unknown; dueDate?: unknown; startDate?: unknown; endDate?: unknown }).value;
        if (valueLike !== undefined) {
          return this.toDateValue(valueLike);
        }
        const dateLike = (parsed as { value?: unknown; date?: unknown; dueDate?: unknown; startDate?: unknown; endDate?: unknown }).date;
        if (dateLike !== undefined) {
          return this.toDateValue(dateLike);
        }
        const dueDateLike = (parsed as { value?: unknown; date?: unknown; dueDate?: unknown; startDate?: unknown; endDate?: unknown }).dueDate;
        if (dueDateLike !== undefined) {
          return this.toDateValue(dueDateLike);
        }
        const startDateLike = (parsed as { value?: unknown; date?: unknown; dueDate?: unknown; startDate?: unknown; endDate?: unknown }).startDate;
        if (startDateLike !== undefined) {
          return this.toDateValue(startDateLike);
        }
        const endDateLike = (parsed as { value?: unknown; date?: unknown; dueDate?: unknown; startDate?: unknown; endDate?: unknown }).endDate;
        if (endDateLike !== undefined) {
          return this.toDateValue(endDateLike);
        }
      }
    } catch {
      // keep normalized string fallback
    }

    return parseDate(trimmed);
  }

  private async upsertIssue(row: typeof issues.$inferInsert): Promise<void> {
    const existing = await db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, row.workspaceId ?? normalizeWorkspaceId()), eq(issues.jiraKey, row.jiraKey)))
      .limit(1);

    if (existing.length === 0) {
      const compactedRow = this.compactRow(row);
      await db.insert(issues).values(compactedRow);
      await this.recordInitialScopeHistory(compactedRow);
      return;
    }

    const existingRow = existing[0];
    if (!existingRow) {
      return;
    }
    const { jiraKey, ...updateRow } = row;
    const compactedUpdate = this.compactRow(updateRow);
    const nextRow = { ...existingRow, ...compactedUpdate } as typeof issues.$inferSelect;
    if (this.shouldRestoreExcluded(existingRow, nextRow)) {
      compactedUpdate.excluded = 0;
      nextRow.excluded = 0;
    }
    const changed = this.hasTrackedChange(existingRow, nextRow);
    if (changed) {
      compactedUpdate.scopeChangedAt = row.lastReconciledAt ?? row.syncedAt ?? new Date().toISOString();
    }

    await db.update(issues).set(compactedUpdate).where(and(eq(issues.workspaceId, row.workspaceId ?? normalizeWorkspaceId()), eq(issues.jiraKey, jiraKey)));

    if (changed) {
      await this.recordScopeHistory(existingRow, nextRow, compactedUpdate.scopeChangedAt as string);
    }
  }

  private async reconcileMissingIssues(
    missingKeys: string[],
    jiraClient: JiraClient,
    teamAccountIds: Set<string>,
    reconciledAt: string,
    devDueDateFieldOverride?: string,
    aspenSeverityFieldOverride?: string,
    workspaceId?: string
  ): Promise<number> {
    if (missingKeys.length === 0) {
      return 0;
    }

    let reconciledCount = 0;
    const batchSize = 50;

    for (let index = 0; index < missingKeys.length; index += batchSize) {
      const batch = missingKeys.slice(index, index + batchSize);
      const batchJql = `issuekey in (${batch.map((key) => `"${key}"`).join(", ")})`;
      const fields = [
        "summary",
        "description",
        "priority",
        "status",
        "assignee",
        "reporter",
        "components",
        "labels",
        "duedate",
        "created",
        "updated",
        "customfield_10021",
        devDueDateFieldOverride || config.JIRA_DEV_DUE_DATE_FIELD,
        aspenSeverityFieldOverride || config.JIRA_ASPEN_SEVERITY_FIELD,
      ].filter((field): field is string => Boolean(field));
      const issuesFromJira = await jiraClient.searchIssues(batchJql, fields);

      const foundKeys = new Set(issuesFromJira.map((item) => item.key));
      for (const item of issuesFromJira) {
        const row = this.toIssueRow(
          item,
          reconciledAt,
          devDueDateFieldOverride,
          aspenSeverityFieldOverride,
          teamAccountIds,
          false,
          workspaceId
        );
        await this.upsertIssue(row);
        reconciledCount += 1;
      }

      const unresolvedKeys = batch.filter((key) => !foundKeys.has(key));
      await this.markIssuesInaccessible(unresolvedKeys, reconciledAt, workspaceId);
    }

    return reconciledCount;
  }

  private async reconcileMissingScopedIssues(
    missingKeys: string[],
    jiraClient: JiraClient,
    teamAccountIds: Set<string>,
    syncScopeMode: JiraSyncScopeMode,
    reconciledAt: string,
    devDueDateFieldOverride?: string,
    aspenSeverityFieldOverride?: string,
    workspaceId?: string
  ): Promise<number> {
    if (missingKeys.length === 0) {
      return 0;
    }

    if (syncScopeMode === "base_query" || teamAccountIds.size === 0) {
      return this.markIssuesOutOfScopedSync(missingKeys, reconciledAt, workspaceId);
    }

    return this.reconcileMissingIssues(
      missingKeys,
      jiraClient,
      teamAccountIds,
      reconciledAt,
      devDueDateFieldOverride,
      aspenSeverityFieldOverride,
      workspaceId
    );
  }

  private async markIssuesOutOfScopedSync(issueKeys: string[], reconciledAt: string, workspaceId?: string): Promise<number> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    let changedCount = 0;

    for (const jiraKey of issueKeys) {
      const rows = await db.select().from(issues).where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey))).limit(1);
      const existing = rows[0];
      if (!existing) {
        continue;
      }

      const changed = existing.syncScopeState !== "out_of_scope";
      const updateRow: Partial<typeof issues.$inferInsert> = {
        syncScopeState: "out_of_scope",
        lastReconciledAt: reconciledAt,
      };

      if (changed) {
        updateRow.scopeChangedAt = reconciledAt;
      }

      await db.update(issues).set(updateRow).where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)));

      if (changed) {
        changedCount += 1;
        await this.recordScopeHistory(existing, { ...existing, ...updateRow }, reconciledAt);
      }
    }

    return changedCount;
  }

  private async markIssuesInaccessible(issueKeys: string[], reconciledAt: string, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    for (const jiraKey of issueKeys) {
      const rows = await db.select().from(issues).where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey))).limit(1);
      const existing = rows[0];
      if (!existing) {
        continue;
      }

      const changed = existing.syncScopeState !== "inaccessible";
      const updateRow: Partial<typeof issues.$inferInsert> = {
        syncScopeState: "inaccessible",
        lastReconciledAt: reconciledAt,
      };

      if (changed) {
        updateRow.scopeChangedAt = reconciledAt;
      }

      await db.update(issues).set(updateRow).where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.jiraKey, jiraKey)));

      if (changed) {
        await this.recordScopeHistory(existing, { ...existing, ...updateRow }, reconciledAt);
      }
    }
  }

  private async getActiveTeamAccountIds(workspaceId?: string): Promise<Set<string>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.isActive, 1)));
    return new Set(
      rows
        .map((row) => row.jiraAccountId ?? (row.source === "manual" ? undefined : row.accountId))
        .filter((accountId): accountId is string => Boolean(accountId?.trim()))
    );
  }

  private async getScopedTeamAccountIds(workspaceId?: string): Promise<Set<string>> {
    const teamAccountIds = await this.getActiveTeamAccountIds(workspaceId);
    const managerJiraAccountId = (await this.settings.getManagerJiraAccountId(workspaceId)).trim();
    if (managerJiraAccountId) {
      teamAccountIds.add(managerJiraAccountId);
    }
    return teamAccountIds;
  }

  private async getLocallyTrackedActiveKeys(workspaceId?: string): Promise<string[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({
        jiraKey: issues.jiraKey,
        statusCategory: issues.statusCategory,
        syncScopeState: issues.syncScopeState,
        excluded: issues.excluded,
      })
      .from(issues)
      .where(eq(issues.workspaceId, normalizedWorkspaceId));

    return rows
      .filter((row) => row.statusCategory !== "done" && row.syncScopeState === "active" && row.excluded !== 1)
      .map((row) => row.jiraKey);
  }

  private resolveTeamScopeState(assigneeId: string | null, teamAccountIds: Set<string>): TeamScopeState {
    if (!assigneeId) {
      return "unassigned";
    }
    return teamAccountIds.has(assigneeId) ? "in_team" : "out_of_team";
  }

  private compactRow<T extends Record<string, unknown>>(row: T): T {
    return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
  }

  private hasTrackedChange(
    previous: typeof issues.$inferSelect,
    next: Partial<typeof issues.$inferInsert> & typeof issues.$inferSelect
  ): boolean {
    return previous.assigneeId !== next.assigneeId ||
      previous.teamScopeState !== next.teamScopeState ||
      previous.syncScopeState !== next.syncScopeState ||
      previous.statusCategory !== next.statusCategory;
  }

  private shouldRestoreExcluded(
    previous: typeof issues.$inferSelect,
    next: Partial<typeof issues.$inferInsert> & typeof issues.$inferSelect
  ): boolean {
    return previous.excluded === 1 &&
      previous.teamScopeState === "out_of_team" &&
      next.teamScopeState !== "out_of_team";
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
      changeType: this.getChangeType(previous, next),
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

  private async recordInitialScopeHistory(row: typeof issues.$inferInsert): Promise<void> {
    await db.insert(issueScopeHistory).values({
      workspaceId: row.workspaceId ?? normalizeWorkspaceId(),
      jiraKey: row.jiraKey,
      observedAt: row.lastReconciledAt ?? row.syncedAt ?? row.createdAt,
      changeType: "entered_team_scope",
      fromAssigneeId: null,
      toAssigneeId: row.assigneeId ?? null,
      fromTeamScopeState: null,
      toTeamScopeState: row.teamScopeState ?? "in_team",
      fromSyncScopeState: null,
      toSyncScopeState: row.syncScopeState ?? "active",
      fromStatusCategory: null,
      toStatusCategory: row.statusCategory,
    });
  }

  private getChangeType(
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
}
