import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection";
import { appUsers, configTable, developers as developersTable, issues, syncLog, componentMap, issueScopeHistory, issueTags, localTags } from "../db/schema";
import { validate } from "../middleware/validate";
import { JiraClient } from "../jira/client";
import { normalizeConfiguredJqlForMode } from "../jira/jql";
import { config } from "../config";
import { clearJiraApiToken, getJiraApiToken } from "../runtime-credentials";
import { BackupService } from "../services/backup.service";
import { AssistantConfigService } from "../services/assistant-config.service";
import { OpenAiCompatibleClient } from "../assistant/llm-client";
import { getPersistedJiraApiToken, storeJiraApiToken } from "../services/jira-credentials.service";
import { normalizeJiraSyncScopeMode, SettingsService } from "../services/settings.service";
import { WorkspaceMaintenanceService } from "../services/workspace-maintenance.service";
import { SyncEngine } from "../sync/engine";
import { logger } from "../utils/logger";
import { HttpError } from "../middleware/errorHandler";
import { runInTransaction } from "../db/transaction";
import { DEFAULT_WORKSPACE_ID } from "../services/workspace.service";

const configSchema = z.object({
  body: z.object({
    jiraBaseUrl: z.string().url(),
    jiraEmail: z.string().email(),
    jiraProjectKey: z.string().min(1),
    managerJiraAccountId: z.string().trim().optional(),
    jiraApiToken: z.string().trim().min(1).optional(),
    syncIntervalMs: z.number().int().positive().default(300000),
    staleThresholdHours: z.number().int().positive().default(48),
    jiraAutoSyncEnabled: z.boolean().optional(),
    backupEnabled: z.boolean().optional(),
    backupIntervalMinutes: z.number().int().positive().optional(),
    backupRetentionDays: z.number().int().positive().optional(),
    backupMaxScheduledSnapshots: z.number().int().positive().optional(),
    backupDirectory: z.string().min(1).optional(),
    backupOnStartup: z.boolean().optional(),
    backupStartupMaxAgeHours: z.number().int().positive().optional(),
    backupBeforeReset: z.boolean().optional(),
    jiraSyncScopeMode: z.enum(["team_assignees", "base_query"]).optional(),
    jiraSyncJql: z.string().optional(),
    jiraDevDueDateField: z.string().optional(),
    jiraAspenSeverityField: z.string().optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const testSchema = z.object({
  body: z.object({
    jiraBaseUrl: z.string().url(),
    jiraEmail: z.string().email(),
    jiraApiToken: z.string().trim().min(1).optional(),
    jiraProjectKey: z.string().min(1).optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

async function upsertConfig(workspaceId: string, key: string, value: string): Promise<void> {
  await db
    .insert(configTable)
    .values({ workspaceId, key, value })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
}

async function deleteConfigValue(workspaceId: string, key: string): Promise<void> {
  await db.delete(configTable).where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key)));
}

async function getConfigValue(workspaceId: string, key: string): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(configTable)
    .where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key)))
    .limit(1);
  return rows[0]?.value;
}

async function getStoredManagerJiraAccountId(workspaceId: string): Promise<string> {
  return (await getConfigValue(workspaceId, "manager_jira_account_id")) ??
    (await getConfigValue(workspaceId, "jira_lead_account_id")) ??
    "";
}

function defaultWorkspaceFallback<T>(workspaceId: string, value: T): T | undefined {
  return workspaceId === DEFAULT_WORKSPACE_ID ? value : undefined;
}

async function getConfiguredJiraToken(workspaceId: string): Promise<string> {
  return (await getPersistedJiraApiToken(workspaceId)) ||
    getJiraApiToken(workspaceId) ||
    defaultWorkspaceFallback(workspaceId, config.JIRA_API_TOKEN) ||
    "";
}

function normalizeManagerJiraAccountId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^[A-Za-z0-9:-]+$/.test(trimmed)) {
    throw new Error("managerJiraAccountId must use a valid Jira account id");
  }
  return trimmed;
}

function validateJiraBaseUrl(value: string): void {
  const parsed = new URL(value);
  const allowedHosts = process.env.JIRA_ALLOWED_HOSTS
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const hostname = parsed.hostname.toLowerCase();

  if (parsed.protocol !== "https:" && !(config.NODE_ENV !== "production" && ["http:", "https:"].includes(parsed.protocol))) {
    throw new HttpError(400, "Jira base URL must use https");
  }

  if (config.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new HttpError(400, "Jira base URL must use https in production");
  }

  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new HttpError(400, "Jira base URL host is not in JIRA_ALLOWED_HOSTS");
  }
}

async function testJiraConnection(baseUrl: string, email: string, token: string): Promise<{ displayName?: string; accountId?: string }> {
  const client = new JiraClient(baseUrl, email, token);
  const user = await client.getCurrentUser();
  return { displayName: user.displayName, accountId: user.accountId };
}

const aiConfigUpdateSchema = z.object({
  body: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(["openai-compatible"]).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().trim().min(1).optional(),
    maxToolIterations: z.number().int().min(1).max(10).optional(),
    responseStyle: z.enum(["concise", "detailed"]).optional(),
    suggestFollowups: z.boolean().optional(),
    showThinkingTrace: z.boolean().optional(),
    customInstructions: z.string().max(2000).optional(),
    autoConfirm: z.boolean().optional(),
    apiKey: z.string().trim().optional(),
    activeProviderId: z.string().trim().min(1).optional(),
    upsertProvider: z
      .object({
        id: z.string().trim().min(1).optional(),
        name: z.string().trim().max(80).optional(),
        baseUrl: z.string().url(),
        model: z.string().trim().min(1),
        apiKey: z.string().trim().optional(),
        maxOutputTokens: z.number().int().min(1).max(1_000_000).nullable().optional(),
        contextWindow: z.number().int().min(1024).max(10_000_000).nullable().optional(),
        reasoningEffort: z.enum(["off", "low", "high", "max"]).nullable().optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
      })
      .optional(),
    removeProviderId: z.string().trim().min(1).optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const aiConfigTestSchema = z.object({
  body: z.object({
    providerId: z.string().trim().min(1).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().trim().min(1).optional(),
    apiKey: z.string().trim().optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

export function createConfigRouter(syncEngine?: SyncEngine, backupService?: BackupService): Router {
  const settings = new SettingsService();
  const maintenance = new WorkspaceMaintenanceService(settings, backupService);
  const assistantConfig = new AssistantConfigService();
  const router = Router();

  const maintenanceResetSchema = z.object({
    body: z.object({
      target: z.enum(["manager_desk", "team_tracker", "workspace"]),
      confirmationText: z.string().trim().min(1),
    }),
    params: z.any().optional(),
    query: z.any().optional(),
  });

  const expectedConfirmationText: Record<
    "manager_desk" | "team_tracker" | "workspace",
    string
  > = {
    manager_desk: "CLEAR MANAGER DESK",
    team_tracker: "CLEAR TEAM TRACKER",
    workspace: "CLEAR EVERYTHING",
  };

  router.get("/", async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const jiraBaseUrl = (await getConfigValue(workspaceId, "jira_base_url")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_BASE_URL) ?? "";
      const jiraEmail = (await getConfigValue(workspaceId, "jira_email")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_EMAIL) ?? "";
      const jiraProjectKey = (await getConfigValue(workspaceId, "jira_project_key")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_PROJECT_KEY) ?? "";
      const managerJiraAccountId = await getStoredManagerJiraAccountId(workspaceId);
      const jiraApiToken = await getConfiguredJiraToken(workspaceId);
      const syncIntervalMs = Number((await getConfigValue(workspaceId, "sync_interval_ms")) ?? "300000");
      const staleThresholdHours = Number((await getConfigValue(workspaceId, "stale_threshold_hours")) ?? "48");
      const jiraAutoSyncEnabled = await settings.getJiraAutoSyncEnabled(workspaceId);
      const backupEnabled = await settings.getBackupEnabled(workspaceId);
      const backupIntervalMinutes = await settings.getBackupIntervalMinutes(workspaceId);
      const backupRetentionDays = await settings.getBackupRetentionDays(workspaceId);
      const backupMaxScheduledSnapshots = await settings.getBackupMaxScheduledSnapshots(workspaceId);
      const backupDirectory = await settings.getBackupDirectory(workspaceId);
      const backupOnStartup = await settings.getBackupOnStartup(workspaceId);
      const backupStartupMaxAgeHours = await settings.getBackupStartupMaxAgeHours(workspaceId);
      const backupBeforeReset = await settings.getBackupBeforeReset(workspaceId);
      const jiraSyncScopeMode = await settings.getJiraSyncScopeMode(workspaceId);
      const jiraSyncJql = normalizeConfiguredJqlForMode(
        (await getConfigValue(workspaceId, "jira_sync_jql")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_SYNC_JQL) ?? "",
        jiraSyncScopeMode
      );
      const jiraDevDueDateField = (await getConfigValue(workspaceId, "jira_dev_due_date_field")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_DEV_DUE_DATE_FIELD) ?? "customfield_10128";
      const jiraAspenSeverityField = (await getConfigValue(workspaceId, "jira_aspen_severity_field")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_ASPEN_SEVERITY_FIELD) ?? "";
      const managerRows = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(and(eq(appUsers.workspaceId, workspaceId), eq(appUsers.role, "manager")))
        .limit(1);
      const hasManagerWorkspace = Boolean(managerRows[0]);
      const hasJiraConnection = Boolean(jiraBaseUrl && jiraEmail && jiraProjectKey && jiraApiToken);

      res.json({
        jiraBaseUrl,
        jiraEmail,
        jiraProjectKey,
        managerJiraAccountId,
        jiraApiToken: jiraApiToken ? "****" : "",
        syncIntervalMs,
        staleThresholdHours,
        jiraAutoSyncEnabled,
        backupEnabled,
        backupIntervalMinutes,
        backupRetentionDays,
        backupMaxScheduledSnapshots,
        backupDirectory,
        backupOnStartup,
        backupStartupMaxAgeHours,
        backupBeforeReset,
        jiraSyncScopeMode,
        jiraSyncJql,
        jiraDevDueDateField,
        jiraAspenSeverityField,
        isConfigured: hasManagerWorkspace || hasJiraConnection,
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", validate(configSchema), async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const syncIntervalMs = req.body.syncIntervalMs ?? 300000;
      const staleThresholdHours = req.body.staleThresholdHours ?? 48;
      validateJiraBaseUrl(req.body.jiraBaseUrl);
      const tokenForLookup = req.body.jiraApiToken ?? await getConfiguredJiraToken(workspaceId);
      const managerJiraAccountId = normalizeManagerJiraAccountId(req.body.managerJiraAccountId);
      const jiraSyncScopeMode = normalizeJiraSyncScopeMode(req.body.jiraSyncScopeMode ?? await getConfigValue(workspaceId, "jira_sync_scope_mode"));

      if (req.body.jiraApiToken) {
        await storeJiraApiToken(req.body.jiraApiToken, workspaceId);
      }

      await upsertConfig(workspaceId, "jira_base_url", req.body.jiraBaseUrl);
      await upsertConfig(workspaceId, "jira_email", req.body.jiraEmail);
      await upsertConfig(workspaceId, "jira_project_key", req.body.jiraProjectKey);
      if ("managerJiraAccountId" in req.body) {
        if (managerJiraAccountId) {
          await upsertConfig(workspaceId, "manager_jira_account_id", managerJiraAccountId);
        } else {
          await deleteConfigValue(workspaceId, "manager_jira_account_id");
        }
        await deleteConfigValue(workspaceId, "jira_lead_account_id");
      }
      await upsertConfig(workspaceId, "sync_interval_ms", String(syncIntervalMs));
      await upsertConfig(workspaceId, "stale_threshold_hours", String(staleThresholdHours));
      if (req.body.jiraAutoSyncEnabled !== undefined) {
        await upsertConfig(workspaceId, "jira_auto_sync_enabled", String(req.body.jiraAutoSyncEnabled));
      }
      if (req.body.jiraSyncScopeMode !== undefined) {
        await upsertConfig(workspaceId, "jira_sync_scope_mode", jiraSyncScopeMode);
      }
      if (req.body.jiraSyncJql !== undefined) {
        await upsertConfig(workspaceId, "jira_sync_jql", normalizeConfiguredJqlForMode(req.body.jiraSyncJql, jiraSyncScopeMode));
      }
      if (req.body.jiraDevDueDateField !== undefined) {
        await upsertConfig(workspaceId, "jira_dev_due_date_field", req.body.jiraDevDueDateField);
      }
      if (req.body.jiraAspenSeverityField !== undefined) {
        await upsertConfig(workspaceId, "jira_aspen_severity_field", req.body.jiraAspenSeverityField);
      }
      if (req.body.backupEnabled !== undefined) {
        await upsertConfig(workspaceId, "backup_enabled", String(req.body.backupEnabled));
      }
      if (req.body.backupIntervalMinutes !== undefined) {
        await upsertConfig(workspaceId, "backup_interval_minutes", String(req.body.backupIntervalMinutes));
      }
      if (req.body.backupRetentionDays !== undefined) {
        await upsertConfig(workspaceId, "backup_retention_days", String(req.body.backupRetentionDays));
      }
      if (req.body.backupMaxScheduledSnapshots !== undefined) {
        await upsertConfig(workspaceId, "backup_max_scheduled_snapshots", String(req.body.backupMaxScheduledSnapshots));
      }
      if (req.body.backupDirectory !== undefined) {
        await settings.validateBackupDirectory(req.body.backupDirectory);
        await upsertConfig(workspaceId, "backup_directory", req.body.backupDirectory);
      }
      if (req.body.backupOnStartup !== undefined) {
        await upsertConfig(workspaceId, "backup_on_startup", String(req.body.backupOnStartup));
      }
      if (req.body.backupStartupMaxAgeHours !== undefined) {
        await upsertConfig(workspaceId, "backup_startup_max_age_hours", String(req.body.backupStartupMaxAgeHours));
      }
      if (req.body.backupBeforeReset !== undefined) {
        await upsertConfig(workspaceId, "backup_before_reset", String(req.body.backupBeforeReset));
      }

      const token = req.body.jiraApiToken ?? tokenForLookup;
      const hasJiraConnection = Boolean(req.body.jiraBaseUrl && req.body.jiraEmail && req.body.jiraProjectKey && token);
      if (syncEngine && (hasJiraConnection || req.body.jiraAutoSyncEnabled !== undefined)) {
        await syncEngine.start();
        if (hasJiraConnection && (await settings.getJiraAutoSyncEnabled(workspaceId))) {
          void syncEngine.syncNow(workspaceId);
        }
      }
      if (backupService) {
        await backupService.start();
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/test", validate(testSchema), async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      validateJiraBaseUrl(req.body.jiraBaseUrl);
      const token = req.body.jiraApiToken ?? await getConfiguredJiraToken(workspaceId);
      if (!token) {
        throw new HttpError(400, "Jira API token is required");
      }
      const user = await testJiraConnection(req.body.jiraBaseUrl, req.body.jiraEmail, token);
      res.json({ success: true, checkedAt: new Date().toISOString(), user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to Jira";
      res.status(400).json({ error: message, status: 400 });
    }
  });

  router.get("/connection-health", async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const baseUrl = (await getConfigValue(workspaceId, "jira_base_url")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_BASE_URL);
      const email = (await getConfigValue(workspaceId, "jira_email")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_EMAIL);
      const token = await getConfiguredJiraToken(workspaceId);
      if (!baseUrl || !email || !token) {
        res.status(400).json({ error: "Jira credentials not configured", status: 400 });
        return;
      }

      const user = await testJiraConnection(baseUrl, email, token);
      res.json({ success: true, checkedAt: new Date().toISOString(), user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to Jira";
      res.status(400).json({ error: message, status: 400 });
    }
  });

  // Discover custom fields from Jira (for settings page)
  router.get("/fields", async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const baseUrl = (await getConfigValue(workspaceId, "jira_base_url")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_BASE_URL);
      const email = (await getConfigValue(workspaceId, "jira_email")) ?? defaultWorkspaceFallback(workspaceId, config.JIRA_EMAIL);
      const token = await getConfiguredJiraToken(workspaceId);
      if (!baseUrl || !email || !token) {
        res.status(400).json({ error: "Jira credentials not configured", status: 400 });
        return;
      }
      const client = new JiraClient(baseUrl, email, token);
      const fields = await client.getFields();
      res.json({ fields });
    } catch (error) {
      next(error);
    }
  });

  // Lightweight settings update for editable Settings sections, without requiring a full config rewrite.
  const settingsSchema = z.object({
    body: z.object({
      jiraBaseUrl: z.string().trim().optional(),
      jiraEmail: z.string().trim().optional(),
      jiraProjectKey: z.string().trim().optional(),
      jiraSyncScopeMode: z.enum(["team_assignees", "base_query"]).optional(),
      jiraSyncJql: z.string().optional(),
      jiraDevDueDateField: z.string().optional(),
      jiraAspenSeverityField: z.string().optional(),
      managerJiraAccountId: z.string().trim().optional(),
      jiraApiToken: z.string().trim().optional(),
      jiraAutoSyncEnabled: z.boolean().optional(),
    }),
    params: z.any().optional(),
    query: z.any().optional(),
  });

  router.put("/settings", validate(settingsSchema), async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      let shouldResync = false;
      let shouldRestartScheduler = false;
      const jiraBaseUrl = req.body.jiraBaseUrl?.trim();
      const jiraEmail = req.body.jiraEmail?.trim();
      const jiraProjectKey = req.body.jiraProjectKey?.trim();
      const jiraSyncScopeMode = normalizeJiraSyncScopeMode(req.body.jiraSyncScopeMode ?? await getConfigValue(workspaceId, "jira_sync_scope_mode"));

      if (jiraBaseUrl) {
        validateJiraBaseUrl(jiraBaseUrl);
        await upsertConfig(workspaceId, "jira_base_url", jiraBaseUrl);
        shouldResync = true;
      }
      if (jiraEmail) {
        if (!z.string().email().safeParse(jiraEmail).success) {
          throw new HttpError(400, "Jira email must be valid");
        }
        await upsertConfig(workspaceId, "jira_email", jiraEmail);
        shouldResync = true;
      }
      if (jiraProjectKey) {
        await upsertConfig(workspaceId, "jira_project_key", jiraProjectKey);
        shouldResync = true;
      }
      if (req.body.jiraSyncScopeMode !== undefined) {
        await upsertConfig(workspaceId, "jira_sync_scope_mode", jiraSyncScopeMode);
      }
      if (req.body.jiraSyncJql !== undefined) {
        await upsertConfig(workspaceId, "jira_sync_jql", normalizeConfiguredJqlForMode(req.body.jiraSyncJql, jiraSyncScopeMode));
      }
      if (req.body.jiraDevDueDateField !== undefined) {
        await upsertConfig(workspaceId, "jira_dev_due_date_field", req.body.jiraDevDueDateField);
      }
      if (req.body.jiraAspenSeverityField !== undefined) {
        await upsertConfig(workspaceId, "jira_aspen_severity_field", req.body.jiraAspenSeverityField);
      }
      if (req.body.jiraApiToken !== undefined) {
        const trimmedToken = req.body.jiraApiToken.trim();
        if (trimmedToken) {
          await storeJiraApiToken(trimmedToken, workspaceId);
          shouldResync = true;
        }
      }
      if ("managerJiraAccountId" in req.body) {
        const managerJiraAccountId = normalizeManagerJiraAccountId(req.body.managerJiraAccountId);
        if (managerJiraAccountId) {
          await upsertConfig(workspaceId, "manager_jira_account_id", managerJiraAccountId);
        } else {
          await deleteConfigValue(workspaceId, "manager_jira_account_id");
        }
        await deleteConfigValue(workspaceId, "jira_lead_account_id");
      }
      if (req.body.jiraAutoSyncEnabled !== undefined) {
        await upsertConfig(workspaceId, "jira_auto_sync_enabled", String(req.body.jiraAutoSyncEnabled));
        shouldRestartScheduler = true;
      }
      if (syncEngine && (shouldResync || shouldRestartScheduler)) {
        await syncEngine.start();
        if (shouldResync && (await settings.getJiraAutoSyncEnabled(workspaceId))) {
          const [baseUrl, email, project, token] = await Promise.all([
            settings.getJiraBaseUrl(workspaceId),
            settings.getJiraEmail(workspaceId),
            settings.getJiraProjectKey(workspaceId),
            settings.getJiraToken(workspaceId),
          ]);
          if (baseUrl && email && project && token) {
            void syncEngine.syncNow(workspaceId);
          }
        }
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/ai", async (req, res, next) => {
    try {
      res.json(await assistantConfig.getPublicConfig(req.auth!.user.workspaceId));
    } catch (error) {
      next(error);
    }
  });

  router.put("/ai", validate(aiConfigUpdateSchema), async (req, res, next) => {
    try {
      res.json(await assistantConfig.update(req.auth!.user.workspaceId, req.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ai/test", validate(aiConfigTestSchema), async (req, res) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      let base = await assistantConfig.getResolvedConfig(workspaceId);
      if (req.body.providerId) {
        const profile = await assistantConfig.getResolvedProvider(workspaceId, req.body.providerId);
        if (!profile) {
          res.status(404).json({ error: "Unknown provider", status: 404 });
          return;
        }
        base = { ...base, ...profile };
      }
      const baseUrl = req.body.baseUrl || base.baseUrl;
      const model = req.body.model || base.model;
      const apiKey = req.body.apiKey || base.apiKey;
      if (!apiKey) {
        res.status(400).json({ error: "AI API key is required", status: 400 });
        return;
      }
      // One retry at most — the Test button should fail fast, not wait out backoff.
      const client = new OpenAiCompatibleClient({ baseUrl, apiKey, model, maxRetries: 1 });
      const startedAt = Date.now();
      // Exercise the profile's real params so Test catches incompatible
      // reasoning/max_tokens settings before the switch, not after.
      await client.chat({
        messages: [{ role: "user", content: "Reply with OK." }],
        maxTokens: 5,
        reasoningEffort: base.reasoningEffort,
        temperature: base.temperature,
      });
      res.json({
        success: true,
        checkedAt: new Date().toISOString(),
        model,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to AI provider";
      res.status(400).json({ error: message, status: 400 });
    }
  });

  router.get("/maintenance/reset-preview", async (req, res, next) => {
    try {
      const preview = await maintenance.getResetPreview(req.auth!.user.accountId, req.auth!.user.workspaceId);
      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/maintenance/reset",
    validate(maintenanceResetSchema),
    async (req, res, next) => {
      try {
        const target = req.body.target as keyof typeof expectedConfirmationText;
        const expectedText = expectedConfirmationText[target];
        if (req.body.confirmationText.trim().toUpperCase() !== expectedText) {
          throw new HttpError(400, `Type "${expectedText}" to confirm this reset`);
        }

        const result = await maintenance.reset(
          req.auth!.user.accountId,
          target,
          req.auth!.user.workspaceId
        );
        logger.info(
          {
            managerAccountId: req.auth!.user.accountId,
            target,
          },
          "Workspace maintenance reset completed"
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/reset", async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const backup = backupService ? await backupService.createPreResetBackup(workspaceId) : null;
      await runInTransaction(async () => {
        const tagRows = await db.select({ id: localTags.id }).from(localTags).where(eq(localTags.workspaceId, workspaceId));
        const tagIds = tagRows.map((row) => row.id);
        await db.delete(issueScopeHistory).where(eq(issueScopeHistory.workspaceId, workspaceId));
        await db.delete(issueTags).where(eq(issueTags.workspaceId, workspaceId));
        if (tagIds.length > 0) {
          await db.delete(localTags).where(inArray(localTags.id, tagIds));
        }
        await db.delete(componentMap).where(eq(componentMap.workspaceId, workspaceId));
        await db.delete(issues).where(eq(issues.workspaceId, workspaceId));
        await db.delete(developersTable).where(eq(developersTable.workspaceId, workspaceId));
        await db.delete(syncLog).where(eq(syncLog.workspaceId, workspaceId));
        await db.delete(configTable).where(eq(configTable.workspaceId, workspaceId));
      });

      clearJiraApiToken(workspaceId);
      logger.info({ workspaceId }, "Workspace Jira configuration reset via API");
      res.json({
        success: true,
        message: "Configuration reset successfully",
        ...(backup ? { backup } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
