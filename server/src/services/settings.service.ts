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
import {
  DEFAULT_ATTENTION_RULES,
  DEFAULT_TEAM_MODE,
  type AttentionRules,
  type JiraSyncScopeMode,
  type TeamMode,
} from "shared/types";
import { isValidTimeZone, parseClockTime, serverTimeZone } from "./today-clock";

export const DEFAULT_SYNC_INTERVAL_MS = 300_000;
export const DEFAULT_JIRA_AUTO_SYNC_ENABLED = true;
/** docs/56 P1-02: the no-current-work signal is opt-in in solo mode. */
export const DEFAULT_TEAM_TRACKER_SOLO_NO_CURRENT_ENABLED = false;
/** docs/56 P5-01: unassigned defects sync by default. Workspaces that predate this are pinned by `pinLegacyJiraSyncScope`. */
export const DEFAULT_JIRA_SYNC_SCOPE_MODE: JiraSyncScopeMode = "team_and_unassigned";
export const DEFAULT_BACKUP_ENABLED = true;
export const DEFAULT_BACKUP_INTERVAL_MINUTES = 30;
export const DEFAULT_BACKUP_RETENTION_DAYS = 14;
export const DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS = 96;
export const DEFAULT_BACKUP_ON_STARTUP = true;
export const DEFAULT_BACKUP_STARTUP_MAX_AGE_HOURS = 12;
export const DEFAULT_BACKUP_BEFORE_RESET = true;
/** docs/56 P1-01: workspace `team_mode` config key (`solo` | `collab`). */
export const TEAM_MODE_KEY = "team_mode";

/**
 * docs/56 P1-05: config keys behind the "Attention rules" block. The older
 * keys are kept so saved values carry over; defaults live only in
 * `DEFAULT_ATTENTION_RULES` (shared/types).
 */
export const ATTENTION_RULE_KEYS = {
  staleHours: "team_tracker_stale_threshold_hours",
  noCurrentHours: "team_tracker_no_current_threshold_hours",
  statusFollowUpHours: "team_tracker_status_follow_up_threshold_hours",
  managerTouchDays: "team_tracker_touch_stale_working_days",
  jiraStaleHours: "stale_threshold_hours",
  dayStart: "attention_day_start",
  dayEnd: "attention_day_end",
  timeZone: "attention_time_zone",
} as const satisfies Record<keyof AttentionRules, string>;

/** Defaults with the zone filled in (the server's until a manager sets one). */
export function defaultAttentionRules(): AttentionRules {
  return { ...DEFAULT_ATTENTION_RULES, timeZone: serverTimeZone() };
}

export function normalizeJiraSyncScopeMode(value: string | null | undefined): JiraSyncScopeMode {
  return value === "base_query" || value === "team_assignees" || value === "team_and_unassigned"
    ? value
    : DEFAULT_JIRA_SYNC_SCOPE_MODE;
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

  /**
   * docs/56 P2-03: a complete connection (URL, email, project key and a token)
   * is saved or set in the environment. Reads config only; never calls Jira.
   */
  async isJiraConfigured(workspaceId?: string): Promise<boolean> {
    const [baseUrl, email, projectKey, token] = await Promise.all([
      this.getJiraBaseUrl(workspaceId),
      this.getJiraEmail(workspaceId),
      this.getJiraProjectKey(workspaceId),
      this.getJiraToken(workspaceId),
    ]);
    return Boolean(baseUrl && email && projectKey && token);
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

  /** docs/56 P1-05: the effective Attention rules; bad stored values fall back per field. */
  async getAttentionRules(workspaceId?: string): Promise<AttentionRules> {
    const defaults = defaultAttentionRules();
    const [staleHours, noCurrentHours, statusFollowUpHours, managerTouchDays, jiraStaleHours, dayStart, dayEnd, timeZone] =
      await Promise.all([
        this.getPositiveIntegerConfig(ATTENTION_RULE_KEYS.staleHours, defaults.staleHours, workspaceId),
        this.getPositiveIntegerConfig(ATTENTION_RULE_KEYS.noCurrentHours, defaults.noCurrentHours, workspaceId),
        this.getPositiveIntegerConfig(ATTENTION_RULE_KEYS.statusFollowUpHours, defaults.statusFollowUpHours, workspaceId),
        this.getPositiveIntegerConfig(ATTENTION_RULE_KEYS.managerTouchDays, defaults.managerTouchDays, workspaceId),
        this.getPositiveIntegerConfig(ATTENTION_RULE_KEYS.jiraStaleHours, defaults.jiraStaleHours, workspaceId),
        this.getConfigValue(ATTENTION_RULE_KEYS.dayStart, workspaceId),
        this.getConfigValue(ATTENTION_RULE_KEYS.dayEnd, workspaceId),
        this.getConfigValue(ATTENTION_RULE_KEYS.timeZone, workspaceId),
      ]);
    const start = dayStart && parseClockTime(dayStart) ? dayStart : defaults.dayStart;
    const end = dayEnd && parseClockTime(dayEnd) ? dayEnd : defaults.dayEnd;
    const validDay = start < end;
    return {
      staleHours,
      noCurrentHours,
      statusFollowUpHours,
      managerTouchDays,
      jiraStaleHours,
      dayStart: validDay ? start : defaults.dayStart,
      dayEnd: validDay ? end : defaults.dayEnd,
      timeZone: isValidTimeZone(timeZone?.trim()) ? timeZone!.trim() : defaults.timeZone,
    };
  }

  /** Writes only the given fields; callers validate the merged result first. */
  async setAttentionRules(workspaceId: string | undefined, update: Partial<AttentionRules>): Promise<AttentionRules> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const entries = (Object.keys(ATTENTION_RULE_KEYS) as Array<keyof AttentionRules>)
      .filter((field) => update[field] !== undefined)
      .map((field) => ({ workspaceId: normalizedWorkspaceId, key: ATTENTION_RULE_KEYS[field], value: String(update[field]) }));
    for (const entry of entries) {
      await db
        .insert(configTable)
        .values(entry)
        .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: entry.value } });
    }
    return this.getAttentionRules(normalizedWorkspaceId);
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
