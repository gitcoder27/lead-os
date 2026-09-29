import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { getDefaultBackupDirectory, resolveWorkspacePath, workspaceRoot } from "../db/paths";
import { db } from "../db/connection";
import { configTable } from "../db/schema";
import { JiraClient } from "../jira/client";
import { getJiraApiToken } from "../runtime-credentials";
import { getPersistedJiraApiToken } from "./jira-credentials.service";
import path from "node:path";
import { HttpError } from "../middleware/errorHandler";
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from "./workspace.service";
import { DEFAULT_TEAM_MODE, TASK_STALE_DAYS, type JiraSyncScopeMode, type TeamMode } from "shared/types";

export const DEFAULT_SYNC_INTERVAL_MS = 300_000;
export const DEFAULT_JIRA_AUTO_SYNC_ENABLED = true;
export const DEFAULT_STALE_THRESHOLD_HOURS = 48;
export const DEFAULT_TEAM_TRACKER_STALE_THRESHOLD_HOURS = 4;
export const DEFAULT_TEAM_TRACKER_NO_CURRENT_THRESHOLD_HOURS = 2;
export const DEFAULT_TEAM_TRACKER_STATUS_FOLLOW_UP_THRESHOLD_HOURS = 2;
/** docs/56 P1-02: manager-touch clock flags after this many working days. */
export const DEFAULT_TEAM_TRACKER_TOUCH_STALE_WORKING_DAYS = TASK_STALE_DAYS;
/** docs/56 P1-02: the no-current-work signal is opt-in in solo mode. */
export const DEFAULT_TEAM_TRACKER_SOLO_NO_CURRENT_ENABLED = false;
export const DEFAULT_JIRA_SYNC_SCOPE_MODE: JiraSyncScopeMode = "team_assignees";
export const DEFAULT_BACKUP_ENABLED = true;
export const DEFAULT_BACKUP_INTERVAL_MINUTES = 30;
export const DEFAULT_BACKUP_RETENTION_DAYS = 14;
export const DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS = 96;
export const DEFAULT_BACKUP_ON_STARTUP = true;
export const DEFAULT_BACKUP_STARTUP_MAX_AGE_HOURS = 12;
export const DEFAULT_BACKUP_BEFORE_RESET = true;
/** docs/56 P1-01: workspace `team_mode` config key (`solo` | `collab`). */
export const TEAM_MODE_KEY = "team_mode";

export function normalizeJiraSyncScopeMode(value: string | null | undefined): JiraSyncScopeMode {
  return value === "base_query" ? "base_query" : DEFAULT_JIRA_SYNC_SCOPE_MODE;
}

export function normalizeTeamMode(value: string | null | undefined): TeamMode {
  return value?.trim().toLowerCase() === "collab" ? "collab" : DEFAULT_TEAM_MODE;
}

export class SettingsService {
  private envFallback<T>(workspaceId: string | undefined, value: T): T | undefined {
    return normalizeWorkspaceId(workspaceId) === DEFAULT_WORKSPACE_ID ? value : undefined;
  }

  async getConfigValue(key: string, workspaceId?: string): Promise<string | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(configTable)
      .where(and(eq(configTable.workspaceId, normalizedWorkspaceId), eq(configTable.key, key)))
      .limit(1);
    return rows[0]?.value;
  }

  /** docs/56 P1-01: missing or unrecognised values read as `solo`. */
  async getTeamMode(workspaceId?: string): Promise<TeamMode> {
    return normalizeTeamMode(await this.getConfigValue(TEAM_MODE_KEY, workspaceId));
  }

  async setTeamMode(workspaceId: string | undefined, teamMode: TeamMode): Promise<TeamMode> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await db
      .insert(configTable)
      .values({ workspaceId: normalizedWorkspaceId, key: TEAM_MODE_KEY, value: teamMode })
      .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: teamMode } });
    return teamMode;
  }

  async getJiraBaseUrl(workspaceId?: string): Promise<string | undefined> {
    return (await this.getConfigValue("jira_base_url", workspaceId)) ?? this.envFallback(workspaceId, config.JIRA_BASE_URL);
  }

  async getJiraEmail(workspaceId?: string): Promise<string | undefined> {
    return (await this.getConfigValue("jira_email", workspaceId)) ?? this.envFallback(workspaceId, config.JIRA_EMAIL);
  }

  async getJiraProjectKey(workspaceId?: string): Promise<string | undefined> {
    return (await this.getConfigValue("jira_project_key", workspaceId)) ?? this.envFallback(workspaceId, config.JIRA_PROJECT_KEY);
  }

  async getManagerJiraAccountId(workspaceId?: string): Promise<string> {
    return (await this.getConfigValue("manager_jira_account_id", workspaceId)) ??
      (await this.getConfigValue("jira_lead_account_id", workspaceId)) ??
      "";
  }

  async getJiraLeadAccountId(workspaceId?: string): Promise<string> {
    return this.getManagerJiraAccountId(workspaceId);
  }

  async getJiraToken(workspaceId?: string): Promise<string | undefined> {
    return (await getPersistedJiraApiToken(workspaceId)) ||
      getJiraApiToken(workspaceId) ||
      this.envFallback(workspaceId, config.JIRA_API_TOKEN);
  }

  async getJiraSyncJql(workspaceId?: string): Promise<string | undefined> {
    return (await this.getConfigValue("jira_sync_jql", workspaceId)) ?? this.envFallback(workspaceId, config.JIRA_SYNC_JQL);
  }

  async getJiraSyncScopeMode(workspaceId?: string): Promise<JiraSyncScopeMode> {
    return normalizeJiraSyncScopeMode(await this.getConfigValue("jira_sync_scope_mode", workspaceId));
  }

  async getJiraDevDueDateField(workspaceId?: string): Promise<string> {
    return (await this.getConfigValue("jira_dev_due_date_field", workspaceId)) ||
      this.envFallback(workspaceId, config.JIRA_DEV_DUE_DATE_FIELD) ||
      config.JIRA_DEV_DUE_DATE_FIELD;
  }

  async getJiraAspenSeverityField(workspaceId?: string): Promise<string | undefined> {
    return (await this.getConfigValue("jira_aspen_severity_field", workspaceId)) ||
      this.envFallback(workspaceId, config.JIRA_ASPEN_SEVERITY_FIELD);
  }

  async getSyncIntervalMs(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("sync_interval_ms", DEFAULT_SYNC_INTERVAL_MS, workspaceId);
  }

  async getJiraAutoSyncEnabled(workspaceId?: string): Promise<boolean> {
    return this.getBooleanConfig("jira_auto_sync_enabled", DEFAULT_JIRA_AUTO_SYNC_ENABLED, workspaceId);
  }

  async getStaleThresholdHours(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("stale_threshold_hours", DEFAULT_STALE_THRESHOLD_HOURS, workspaceId);
  }

  async getTeamTrackerStaleThresholdHours(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig(
      "team_tracker_stale_threshold_hours",
      DEFAULT_TEAM_TRACKER_STALE_THRESHOLD_HOURS,
      workspaceId
    );
  }

  async getTeamTrackerNoCurrentThresholdHours(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig(
      "team_tracker_no_current_threshold_hours",
      DEFAULT_TEAM_TRACKER_NO_CURRENT_THRESHOLD_HOURS,
      workspaceId
    );
  }

  async getTeamTrackerStatusFollowUpThresholdHours(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig(
      "team_tracker_status_follow_up_threshold_hours",
      DEFAULT_TEAM_TRACKER_STATUS_FOLLOW_UP_THRESHOLD_HOURS,
      workspaceId
    );
  }

  async getTeamTrackerTouchStaleWorkingDays(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig(
      "team_tracker_touch_stale_working_days",
      DEFAULT_TEAM_TRACKER_TOUCH_STALE_WORKING_DAYS,
      workspaceId
    );
  }

  async getTeamTrackerSoloNoCurrentEnabled(workspaceId?: string): Promise<boolean> {
    return this.getBooleanConfig(
      "team_tracker_solo_no_current_enabled",
      DEFAULT_TEAM_TRACKER_SOLO_NO_CURRENT_ENABLED,
      workspaceId
    );
  }

  async getBackupEnabled(workspaceId?: string): Promise<boolean> {
    return this.getBooleanConfig("backup_enabled", DEFAULT_BACKUP_ENABLED, workspaceId);
  }

  async getBackupIntervalMinutes(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("backup_interval_minutes", DEFAULT_BACKUP_INTERVAL_MINUTES, workspaceId);
  }

  async getBackupRetentionDays(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("backup_retention_days", DEFAULT_BACKUP_RETENTION_DAYS, workspaceId);
  }

  async getBackupMaxScheduledSnapshots(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("backup_max_scheduled_snapshots", DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS, workspaceId);
  }

  async getBackupOnStartup(workspaceId?: string): Promise<boolean> {
    return this.getBooleanConfig("backup_on_startup", DEFAULT_BACKUP_ON_STARTUP, workspaceId);
  }

  async getBackupStartupMaxAgeHours(workspaceId?: string): Promise<number> {
    return this.getPositiveIntegerConfig("backup_startup_max_age_hours", DEFAULT_BACKUP_STARTUP_MAX_AGE_HOURS, workspaceId);
  }

  async getBackupBeforeReset(workspaceId?: string): Promise<boolean> {
    return this.getBooleanConfig("backup_before_reset", DEFAULT_BACKUP_BEFORE_RESET, workspaceId);
  }

  async getBackupDirectory(workspaceId?: string): Promise<string> {
    const configured = await this.getConfigValue("backup_directory", workspaceId);
    if (configured) {
      await this.validateBackupDirectory(configured);
      return configured;
    }
    return getDefaultBackupDirectory();
  }

  async validateBackupDirectory(targetPath: string): Promise<void> {
    if (config.NODE_ENV !== "production") {
      return;
    }

    const resolved = resolveWorkspacePath(targetPath);
    const allowedRoot = path.resolve(workspaceRoot, "data", "backups");
    const relative = path.relative(allowedRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new HttpError(400, "Backup directory must be inside the app-owned data/backups directory");
    }
  }

  async createJiraClient(workspaceId?: string): Promise<JiraClient> {
    const baseUrl = await this.getJiraBaseUrl(workspaceId);
    const email = await this.getJiraEmail(workspaceId);
    const apiToken = await this.getJiraToken(workspaceId);

    if (!baseUrl || !email || !apiToken) {
      throw new Error("Missing Jira credentials");
    }

    return new JiraClient(baseUrl, email, apiToken);
  }

  private async getPositiveIntegerConfig(key: string, fallback: number, workspaceId?: string): Promise<number> {
    const rawValue = (await this.getConfigValue(key, workspaceId))?.trim();
    if (!rawValue) {
      return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async getBooleanConfig(key: string, fallback: boolean, workspaceId?: string): Promise<boolean> {
    const rawValue = (await this.getConfigValue(key, workspaceId))?.trim().toLowerCase();
    if (!rawValue) {
      return fallback;
    }

    if (["1", "true", "yes", "on"].includes(rawValue)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(rawValue)) {
      return false;
    }
    return fallback;
  }
}
