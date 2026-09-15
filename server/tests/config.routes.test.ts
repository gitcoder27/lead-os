import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";

vi.mock("../src/config", () => ({
  config: {
    JIRA_BASE_URL: undefined,
    JIRA_EMAIL: undefined,
    JIRA_API_TOKEN: undefined,
    JIRA_PROJECT_KEY: undefined,
    JIRA_SYNC_JQL: undefined,
    JIRA_DEV_DUE_DATE_FIELD: "customfield_10128",
    JIRA_ASPEN_SEVERITY_FIELD: undefined,
  },
}));

const jiraClientMock = vi.hoisted(() => ({
  constructorArgs: [] as Array<[string, string, string]>,
}));

vi.mock("../src/jira/client", () => ({
  JiraClient: class {
    constructor(baseUrl: string, email: string, token: string) {
      jiraClientMock.constructorArgs.push([baseUrl, email, token]);
    }

    async getCurrentUser() {
      return { displayName: "Jira User", accountId: "jira-user-1" };
    }

    async getFields() {
      return [];
    }
  },
}));

import { createConfigRouter } from "../src/routes/config";
import {
  configTable,
  appUsers,
  developers,
  issues,
  componentMap,
  syncLog,
  issueTags,
  localTags,
  developerAvailabilityPeriods,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  teamTrackerCheckIns,
  teamTrackerDays,
  teamTrackerItems,
  teamTrackerSavedViews,
} from "../src/db/schema";
import { db, rawDb } from "../src/db/connection";
import { clearJiraApiToken, getJiraApiToken, setJiraApiToken } from "../src/runtime-credentials";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandler";
import { resetDatabase } from "./helpers/db";
import { migrate } from "../src/db/migrate";
import { BackupService } from "../src/services/backup.service";
import { DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS, SettingsService } from "../src/services/settings.service";
import { getPersistedJiraApiToken, storeJiraApiToken } from "../src/services/jira-credentials.service";
import { isEncryptedSecret } from "../src/services/secret-crypto";

const testBackupDirectory = path.resolve("/tmp", "lead-os-test-config-backups");
const testWorkspaceId = "default";

beforeEach(async () => {
  migrate(rawDb);
  await resetDatabase();
  clearJiraApiToken();
  jiraClientMock.constructorArgs.length = 0;
  fs.rmSync(testBackupDirectory, { recursive: true, force: true });
  await db.insert(configTable).values({ workspaceId: testWorkspaceId, key: "backup_directory", value: testBackupDirectory }).onConflictDoUpdate({
    target: [configTable.workspaceId, configTable.key],
    set: { value: testBackupDirectory },
  });
  await db.insert(configTable).values({ workspaceId: testWorkspaceId, key: "backup_before_reset", value: "true" }).onConflictDoUpdate({
    target: [configTable.workspaceId, configTable.key],
    set: { value: "true" },
  });
});

function createTestApp() {
  const app = express();
  const backupService = new BackupService(new SettingsService(), rawDb);
  app.use((req, _res, next) => {
    req.auth = {
      sessionId: "test-session",
      user: {
        username: "manager",
        accountId: "manager-1",
        displayName: "Manager One",
        role: "manager",
        workspaceId: testWorkspaceId,
      },
    };
    next();
  });
  app.use("/api/config", createConfigRouter(undefined, backupService));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function invoke(
  app: express.Express,
  options: { method: string; url: string; body?: unknown }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

  const req = new Readable({
    read() {
      this.push(null);
    },
  }) as Readable & {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    connection: Record<string, never>;
    socket: Record<string, never>;
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
  };

  req.url = options.url;
  req.method = options.method;
  req.headers = { "content-type": "application/json" };
  req.body = options.body;
  req.connection = {};
  req.socket = {};
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  return await new Promise((resolve, reject) => {
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    }) as Writable & {
      statusCode: number;
      req?: typeof req;
      setHeader: (name: string, value: string | number | readonly string[]) => void;
      getHeader: (name: string) => string | number | readonly string[] | undefined;
      getHeaders: () => Record<string, string>;
      removeHeader: (name: string) => void;
      writeHead: (statusCode: number, responseHeaders?: Record<string, string>) => typeof res;
      end: (chunk?: unknown) => typeof res;
    };

    res.statusCode = 200;
    res.req = req;
    res.setHeader = (name, value) => {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
    };
    res.getHeader = (name) => headers[name.toLowerCase()];
    res.getHeaders = () => headers;
    res.removeHeader = (name) => {
      delete headers[name.toLowerCase()];
    };
    res.writeHead = (statusCode, responseHeaders = {}) => {
      res.statusCode = statusCode;
      for (const [name, value] of Object.entries(responseHeaders)) {
        headers[name.toLowerCase()] = value;
      }
      return res;
    };
    res.end = (chunk) => {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      });
      return res;
    };

    app.handle(req as any, res as any, reject);
  });
}

describe("config routes", () => {
  it("marks setup as configured when Jira connection fields are persisted without manager Jira mapping", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
    ]);

    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config" });
    expect(res.status).toBe(200);
    expect(res.body?.isConfigured).toBe(true);
    expect(res.body?.managerJiraAccountId).toBe("");
    expect(res.body?.jiraApiToken).toBe("****");
    expect(res.body?.backupMaxScheduledSnapshots).toBe(DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS);
  });

  it("marks workspace configured with a manager account even before Jira is connected", async () => {
    await db.insert(appUsers).values({
      username: "manager",
      displayName: "Manager One",
      passwordHash: "hash",
      role: "manager",
      developerAccountId: null,
      isActive: 1,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    });

    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config" });
    expect(res.status).toBe(200);
    expect(res.body?.isConfigured).toBe(true);
    expect(res.body?.jiraApiToken).toBe("");
  });

  it("GET /api/config falls back to the legacy lead config key for manager Jira mapping", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      { key: "jira_lead_account_id", value: "legacy-lead-1" },
    ]);

    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config" });

    expect(res.status).toBe(200);
    expect(res.body?.managerJiraAccountId).toBe("legacy-lead-1");
  });

  it("GET /api/config returns the base JQL without a manually managed assignee clause", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      {
        key: "jira_sync_jql",
        value: `project = AM
AND issuetype = Bug
AND assignee IN ("lead-1", "dev-1")
ORDER BY updated DESC`,
      },
    ]);

    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config" });

    expect(res.status).toBe(200);
    expect(res.body?.jiraSyncScopeMode).toBe("team_assignees");
    expect(res.body?.jiraSyncJql).toBe(`project = AM
AND issuetype = Bug
ORDER BY updated DESC`);
  });

  it("GET /api/config preserves assignee clauses in base-query mode", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      { key: "jira_sync_scope_mode", value: "base_query" },
      {
        key: "jira_sync_jql",
        value: `project = AM
AND issuetype = Bug
AND assignee IN ("external-1", "external-2")
ORDER BY updated DESC`,
      },
    ]);

    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config" });

    expect(res.status).toBe(200);
    expect(res.body?.jiraSyncScopeMode).toBe("base_query");
    expect(res.body?.jiraSyncJql).toBe(`project = AM
AND issuetype = Bug
AND assignee IN ("external-1", "external-2")
ORDER BY updated DESC`);
  });

  it("PUT /api/config/settings stores partial settings and leaves unrelated config intact", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      { key: "jira_sync_jql", value: "project = OLD" },
      { key: "jira_dev_due_date_field", value: "customfield_10020" },
      { key: "jira_aspen_severity_field", value: "customfield_10021" },
    ]);

    const app = createTestApp();
    const updateRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: {
        jiraSyncScopeMode: "team_assignees",
        jiraSyncJql: 'project = AM AND status != Done AND assignee IN ("lead-1", "dev-1")',
        jiraDevDueDateField: "customfield_99999",
        jiraAspenSeverityField: "customfield_11111",
        jiraApiToken: "new-token-from-settings",
      },
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body?.success).toBe(true);

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    expect(map["jira_sync_scope_mode"]).toBe("team_assignees");
    expect(map["jira_sync_jql"]).toBe("project = AM AND status != Done");
    expect(map["jira_dev_due_date_field"]).toBe("customfield_99999");
    expect(map["jira_aspen_severity_field"]).toBe("customfield_11111");
    expect(map["jira_api_token"]).not.toBe("new-token-from-settings");
    expect(isEncryptedSecret(map["jira_api_token"] as string)).toBe(true);
    expect(await getPersistedJiraApiToken()).toBe("new-token-from-settings");
    expect(map["jira_base_url"]).toBe("https://tenant.atlassian.net");
    expect(map["jira_project_key"]).toBe("AM");
    expect(getJiraApiToken()).toBe("new-token-from-settings");
  });

  it("PUT /api/config/settings stores raw JQL in base-query mode", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      { key: "jira_sync_scope_mode", value: "team_assignees" },
      { key: "jira_sync_jql", value: "project = OLD" },
    ]);

    const app = createTestApp();
    const updateRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: {
        jiraSyncScopeMode: "base_query",
        jiraSyncJql: 'project = AM AND status != Done AND assignee IN ("external-1")',
      },
    });

    expect(updateRes.status).toBe(200);

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    expect(map["jira_sync_scope_mode"]).toBe("base_query");
    expect(map["jira_sync_jql"]).toBe('project = AM AND status != Done AND assignee IN ("external-1")');
  });

  it("PUT /api/config/settings stores Jira connection fields without a full config rewrite", async () => {
    await db.insert(configTable).values([
      { key: "jira_sync_jql", value: "project = OLD" },
      { key: "jira_dev_due_date_field", value: "customfield_10020" },
    ]);

    const app = createTestApp();
    const updateRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: {
        jiraBaseUrl: "https://isolated.atlassian.net",
        jiraEmail: "isolated.manager@example.com",
        jiraProjectKey: "ISO",
        jiraSyncJql: "project = ISO AND issuetype = Bug",
      },
    });

    expect(updateRes.status).toBe(200);

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    expect(map["jira_base_url"]).toBe("https://isolated.atlassian.net");
    expect(map["jira_email"]).toBe("isolated.manager@example.com");
    expect(map["jira_project_key"]).toBe("ISO");
    expect(map["jira_sync_jql"]).toBe("project = ISO AND issuetype = Bug");
    expect(map["jira_dev_due_date_field"]).toBe("customfield_10020");
  });

  it("PUT /api/config/settings persists the auto-sync toggle and GET reports it", async () => {
    const app = createTestApp();

    const initialRes = await invoke(app, { method: "GET", url: "/api/config" });
    expect(initialRes.status).toBe(200);
    expect(initialRes.body?.jiraAutoSyncEnabled).toBe(true);

    const disableRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: { jiraAutoSyncEnabled: false },
    });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body?.success).toBe(true);

    const disabledRes = await invoke(app, { method: "GET", url: "/api/config" });
    expect(disabledRes.body?.jiraAutoSyncEnabled).toBe(false);

    const enableRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: { jiraAutoSyncEnabled: true },
    });
    expect(enableRes.status).toBe(200);

    const enabledRes = await invoke(app, { method: "GET", url: "/api/config" });
    expect(enabledRes.body?.jiraAutoSyncEnabled).toBe(true);
  });

  it("POST /api/config/test can use the saved encrypted Jira token", async () => {
    await storeJiraApiToken("saved-token");

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/test",
      body: {
        jiraBaseUrl: "https://tenant.atlassian.net",
        jiraEmail: "ops@example.com",
        jiraProjectKey: "AM",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(jiraClientMock.constructorArgs.at(-1)).toEqual([
      "https://tenant.atlassian.net",
      "ops@example.com",
      "saved-token",
    ]);
  });

  it("GET /api/config/maintenance/reset-preview reports scoped maintenance counts", async () => {
    const managerDay = (
      await db
        .insert(managerDeskDays)
        .values({
          date: "2026-03-07",
          managerAccountId: "manager-1",
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    const otherManagerDay = (
      await db
        .insert(managerDeskDays)
        .values({
          date: "2026-03-07",
          managerAccountId: "manager-2",
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    const managerItem = (
      await db
        .insert(managerDeskItems)
        .values({
          dayId: managerDay.id,
          sourceItemId: null,
          assigneeDeveloperAccountId: "dev-1",
          title: "Manager follow-up",
          kind: "action",
          category: "follow_up",
          status: "planned",
          priority: "medium",
          participants: null,
          contextNote: null,
          nextAction: null,
          outcome: null,
          plannedStartAt: null,
          plannedEndAt: null,
          followUpAt: null,
          completedAt: null,
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    await db.insert(managerDeskItems).values({
      dayId: otherManagerDay.id,
      sourceItemId: null,
      assigneeDeveloperAccountId: null,
      title: "Other manager item",
      kind: "action",
      category: "follow_up",
      status: "planned",
      priority: "medium",
      participants: null,
      contextNote: null,
      nextAction: null,
      outcome: null,
      plannedStartAt: null,
      plannedEndAt: null,
      followUpAt: null,
      completedAt: null,
      createdAt: "2026-03-07T08:00:00.000Z",
      updatedAt: "2026-03-07T08:00:00.000Z",
    });
    await db.insert(managerDeskLinks).values({
      itemId: managerItem.id,
      linkType: "developer",
      developerAccountId: "dev-1",
      issueKey: null,
      externalLabel: null,
      createdAt: "2026-03-07T08:00:00.000Z",
    });
    await db.insert(managerDeskItemHistory).values({
      itemId: managerItem.id,
      managerAccountId: "manager-1",
      eventType: "updated",
      snapshotJson: "{}",
      recordedAt: "2026-03-07T08:30:00.000Z",
    });

    const trackerDay = (
      await db
        .insert(teamTrackerDays)
        .values({
          date: "2026-03-07",
          developerAccountId: "dev-1",
          status: "on_track",
          capacityUnits: null,
          managerNotes: null,
          lastCheckInAt: null,
          nextFollowUpAt: null,
          statusUpdatedAt: "2026-03-07T08:00:00.000Z",
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    await db.insert(teamTrackerItems).values({
      dayId: trackerDay.id,
      managerDeskItemId: managerItem.id,
      itemType: "custom",
      jiraKey: null,
      title: "Linked execution",
      state: "planned",
      position: 0,
      note: null,
      completedAt: null,
      createdAt: "2026-03-07T08:00:00.000Z",
      updatedAt: "2026-03-07T08:00:00.000Z",
    });
    await db.insert(teamTrackerCheckIns).values({
      dayId: trackerDay.id,
      summary: "Daily stand-up update",
      status: null,
      rationale: null,
      nextFollowUpAt: null,
      authorType: "manager",
      authorAccountId: "manager-1",
      createdAt: "2026-03-07T09:00:00.000Z",
    });
    await db.insert(developerAvailabilityPeriods).values({
      developerAccountId: "dev-1",
      startDate: "2026-03-07",
      endDate: null,
      note: "PTO",
      createdAt: "2026-03-07T07:00:00.000Z",
      updatedAt: "2026-03-07T07:00:00.000Z",
    });
    await db.insert(teamTrackerSavedViews).values([
      {
        managerAccountId: "manager-1",
        name: "Morning view",
        searchQuery: "alice",
        summaryFilter: "all",
        sortBy: "name",
        groupBy: "none",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
      {
        managerAccountId: "manager-2",
        name: "Other manager view",
        searchQuery: "bob",
        summaryFilter: "all",
        sortBy: "name",
        groupBy: "none",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
    ]);

    const app = createTestApp();
    const res = await invoke(app, {
      method: "GET",
      url: "/api/config/maintenance/reset-preview",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      backupBeforeReset: true,
      managerDesk: {
        dayCount: 1,
        itemCount: 1,
        linkCount: 1,
        historyCount: 1,
        linkedTrackerItemCount: 1,
      },
      teamTracker: {
        dayCount: 1,
        itemCount: 1,
        checkInCount: 1,
        availabilityPeriodCount: 1,
        savedViewCount: 1,
        linkedManagerDeskItemCount: 1,
      },
    });
  });

  it("POST /api/config/maintenance/reset clears both workspaces after typed confirmation", async () => {
    const managerDay = (
      await db
        .insert(managerDeskDays)
        .values({
          date: "2026-03-07",
          managerAccountId: "manager-1",
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    const managerItem = (
      await db
        .insert(managerDeskItems)
        .values({
          dayId: managerDay.id,
          sourceItemId: null,
          assigneeDeveloperAccountId: "dev-1",
          title: "Manager follow-up",
          kind: "action",
          category: "follow_up",
          status: "planned",
          priority: "medium",
          participants: null,
          contextNote: null,
          nextAction: null,
          outcome: null,
          plannedStartAt: null,
          plannedEndAt: null,
          followUpAt: null,
          completedAt: null,
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    const otherManagerDay = (
      await db
        .insert(managerDeskDays)
        .values({
          date: "2026-03-08",
          managerAccountId: "manager-2",
          createdAt: "2026-03-08T08:00:00.000Z",
          updatedAt: "2026-03-08T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    await db.insert(managerDeskItems).values({
      dayId: otherManagerDay.id,
      sourceItemId: null,
      assigneeDeveloperAccountId: null,
      title: "Other manager item",
      kind: "action",
      category: "follow_up",
      status: "planned",
      priority: "medium",
      participants: null,
      contextNote: null,
      nextAction: null,
      outcome: null,
      plannedStartAt: null,
      plannedEndAt: null,
      followUpAt: null,
      completedAt: null,
      createdAt: "2026-03-08T08:00:00.000Z",
      updatedAt: "2026-03-08T08:00:00.000Z",
    });
    await db.insert(managerDeskLinks).values({
      itemId: managerItem.id,
      linkType: "developer",
      developerAccountId: "dev-1",
      issueKey: null,
      externalLabel: null,
      createdAt: "2026-03-07T08:00:00.000Z",
    });
    await db.insert(managerDeskItemHistory).values({
      itemId: managerItem.id,
      managerAccountId: "manager-1",
      eventType: "updated",
      snapshotJson: "{}",
      recordedAt: "2026-03-07T08:30:00.000Z",
    });

    const trackerDay = (
      await db
        .insert(teamTrackerDays)
        .values({
          date: "2026-03-07",
          developerAccountId: "dev-1",
          status: "on_track",
          capacityUnits: null,
          managerNotes: null,
          lastCheckInAt: null,
          nextFollowUpAt: null,
          statusUpdatedAt: "2026-03-07T08:00:00.000Z",
          createdAt: "2026-03-07T08:00:00.000Z",
          updatedAt: "2026-03-07T08:00:00.000Z",
        })
        .returning()
    )[0]!;
    await db.insert(teamTrackerItems).values([
      {
        dayId: trackerDay.id,
        managerDeskItemId: managerItem.id,
        itemType: "custom",
        jiraKey: null,
        title: "Linked execution",
        state: "planned",
        position: 0,
        note: null,
        completedAt: null,
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
      {
        dayId: trackerDay.id,
        managerDeskItemId: null,
        itemType: "custom",
        jiraKey: null,
        title: "Tracker-only task",
        state: "planned",
        position: 1,
        note: null,
        completedAt: null,
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
    ]);
    await db.insert(teamTrackerCheckIns).values({
      dayId: trackerDay.id,
      summary: "Daily stand-up update",
      status: null,
      rationale: null,
      nextFollowUpAt: null,
      authorType: "manager",
      authorAccountId: "manager-1",
      createdAt: "2026-03-07T09:00:00.000Z",
    });
    await db.insert(developerAvailabilityPeriods).values({
      developerAccountId: "dev-1",
      startDate: "2026-03-07",
      endDate: null,
      note: "PTO",
      createdAt: "2026-03-07T07:00:00.000Z",
      updatedAt: "2026-03-07T07:00:00.000Z",
    });
    await db.insert(teamTrackerSavedViews).values([
      {
        managerAccountId: "manager-1",
        name: "Morning view",
        searchQuery: "alice",
        summaryFilter: "all",
        sortBy: "name",
        groupBy: "none",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
      {
        managerAccountId: "manager-2",
        name: "Other manager view",
        searchQuery: "bob",
        summaryFilter: "all",
        sortBy: "name",
        groupBy: "none",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T08:00:00.000Z",
      },
    ]);

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/maintenance/reset",
      body: {
        target: "workspace",
        confirmationText: "CLEAR EVERYTHING",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.target).toBe("workspace");
    expect(res.body?.backup?.name).toContain("pre-reset");

    expect(await db.select().from(teamTrackerDays)).toHaveLength(0);
    expect(await db.select().from(teamTrackerItems)).toHaveLength(0);
    expect(await db.select().from(teamTrackerCheckIns)).toHaveLength(0);
    expect(await db.select().from(developerAvailabilityPeriods)).toHaveLength(0);
    expect(
      (await db.select().from(teamTrackerSavedViews)).map((row) => row.managerAccountId)
    ).toEqual(["manager-2"]);

    expect(await db.select().from(managerDeskDays)).toEqual([
      expect.objectContaining({ managerAccountId: "manager-2" }),
    ]);
    expect(
      (await db.select().from(managerDeskItems)).map((row) => row.title)
    ).toEqual(["Other manager item"]);
    expect(await db.select().from(managerDeskLinks)).toHaveLength(0);
    expect(await db.select().from(managerDeskItemHistory)).toHaveLength(0);
  });

  it("POST /api/config/maintenance/reset skips the pre-reset backup when disabled", async () => {
    await db.insert(configTable).values({ workspaceId: testWorkspaceId, key: "backup_before_reset", value: "false" }).onConflictDoUpdate({
      target: [configTable.workspaceId, configTable.key],
      set: { value: "false" },
    });

    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/maintenance/reset",
      body: {
        target: "workspace",
        confirmationText: "CLEAR EVERYTHING",
      },
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.backup).toBeUndefined();
  });

  it("PUT /api/config/settings stores and clears an optional manager Jira mapping", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
      { key: "jira_lead_account_id", value: "legacy-lead-1" },
    ]);

    const app = createTestApp();

    const save = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: {
        managerJiraAccountId: "manager-1",
      },
    });

    expect(save.status).toBe(200);

    let rows = await db.select().from(configTable);
    let map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    expect(map["manager_jira_account_id"]).toBe("manager-1");
    expect(map["jira_lead_account_id"]).toBeUndefined();

    const clear = await invoke(app, {
      method: "PUT",
      url: "/api/config/settings",
      body: {
        managerJiraAccountId: "",
      },
    });

    expect(clear.status).toBe(200);

    rows = await db.select().from(configTable);
    map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    expect(map["manager_jira_account_id"]).toBeUndefined();
  });

  it("GET /api/config/fields returns 400 when Jira credentials are not available", async () => {
    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config/fields" });
    expect(res.status).toBe(400);
    expect(res.body?.status).toBe(400);
    expect(res.body?.error).toBe("Jira credentials not configured");
  });

  it("POST /api/config/reset clears all persisted config and Jira auth state", async () => {
    await db.insert(configTable).values([
      { key: "jira_base_url", value: "https://tenant.atlassian.net" },
      { key: "jira_email", value: "ops@example.com" },
      { key: "jira_project_key", value: "AM" },
      { key: "jira_api_token", value: "token-from-db" },
    ]);

    await db.insert(developers).values({ accountId: "lead-1", displayName: "Lead", isActive: 1 });
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev", isActive: 1 });
    await db.insert(issues).values({
      jiraKey: "AM-1",
      summary: "Sample defect",
      description: null,
      priorityName: "High",
      priorityId: "1",
      statusName: "To Do",
      statusCategory: "new",
      assigneeId: null,
      assigneeName: null,
      reporterName: "ops@example.com",
      component: null,
      labels: "[]",
      dueDate: null,
      flagged: 0,
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
      syncedAt: "2026-03-05T00:00:00.000Z",
    });
    const insertedTags = await db.insert(localTags).values({ name: "Backend", color: "#000000" }).returning({ id: localTags.id });
    await db.insert(issueTags).values({ jiraKey: "AM-1", tagId: insertedTags[0]!.id });
    await db.insert(componentMap).values({ componentName: "API", accountId: "dev-1", fixCount: 2 });
    await db.insert(syncLog).values({ startedAt: "2026-03-05T00:00:00.000Z", status: "success", issuesSynced: 1, completedAt: "2026-03-05T00:00:00.000Z" });

    setJiraApiToken("live-token");
    expect(getJiraApiToken()).toBe("live-token");

    const app = createTestApp();
    const res = await invoke(app, { method: "POST", url: "/api/config/reset" });
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);

    const configRows = await db.select().from(configTable);
    const issueRows = await db.select().from(issues);
    const developerRows = await db.select().from(developers);
    const componentRows = await db.select().from(componentMap);
    const syncRows = await db.select().from(syncLog);
    const issueTagRows = await db.select().from(issueTags);
    const localTagRows = await db.select().from(localTags);

    expect(configRows).toHaveLength(0);
    expect(issueRows).toHaveLength(0);
    expect(developerRows).toHaveLength(0);
    expect(componentRows).toHaveLength(0);
    expect(syncRows).toHaveLength(0);
    expect(issueTagRows).toHaveLength(0);
    expect(localTagRows).toHaveLength(0);
    expect(getJiraApiToken()).toBe("");
    expect(typeof res.body?.backup?.path).toBe("string");
    expect(fs.existsSync(res.body?.backup?.path)).toBe(true);
  });

  it("GET /api/config/ai returns public defaults without a key", async () => {
    const app = createTestApp();
    const res = await invoke(app, { method: "GET", url: "/api/config/ai" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      provider: "openai-compatible",
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-5.3-flash",
      maxToolIterations: 6,
      responseStyle: "concise",
      suggestFollowups: true,
      autoConfirm: false,
      showThinkingTrace: true,
      hasApiKey: false,
      providers: [],
      activeProviderId: null,
    });
  });

  it("PUT /api/config/ai stores settings and masks the key as hasApiKey", async () => {
    const app = createTestApp();
    const putRes = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        enabled: true,
        baseUrl: "https://llm.example.com/v1/",
        model: "glm-5.3-flash",
        maxToolIterations: 4,
        responseStyle: "detailed",
        autoConfirm: true,
        apiKey: "secret-ai-key",
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
      model: "glm-5.3-flash",
      maxToolIterations: 4,
      responseStyle: "detailed",
      autoConfirm: true,
      hasApiKey: true,
    });
    expect(JSON.stringify(putRes.body)).not.toContain("secret-ai-key");

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map["ai_assistant_enabled"]).toBe("true");
    expect(map["ai_base_url"]).toBe("https://llm.example.com/v1");
    expect(map["ai_response_style"]).toBe("detailed");
    expect(map["ai_api_key"]).toBeDefined();
    expect(isEncryptedSecret(map["ai_api_key"] as string)).toBe(true);
    expect(map["ai_api_key"]).not.toBe("secret-ai-key");

    const getRes = await invoke(app, { method: "GET", url: "/api/config/ai" });
    expect(getRes.status).toBe(200);
    expect(getRes.body?.hasApiKey).toBe(true);
    expect(JSON.stringify(getRes.body)).not.toContain("secret-ai-key");
  });

  it("PUT /api/config/ai rejects an invalid response style", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { responseStyle: "wordy" },
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/config/ai rejects an invalid base URL", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { baseUrl: "not-a-url" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.status).toBe(400);
  });

  it("POST /api/config/ai/test succeeds against a stubbed provider", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await db.insert(configTable).values({ key: "ai_api_key", value: "unused" });
      const app = createTestApp();
      const res = await invoke(app, {
        method: "POST",
        url: "/api/config/ai/test",
        body: { baseUrl: "https://llm.example.com/v1", model: "glm-5.3-flash", apiKey: "test-key" },
      });
      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(res.body?.model).toBe("glm-5.3-flash");
      expect(typeof res.body?.latencyMs).toBe("number");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://llm.example.com/v1/chat/completions",
        expect.objectContaining({ method: "POST" })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /api/config/ai/test maps a 401 to a 400 error JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    );
    try {
      const app = createTestApp();
      const res = await invoke(app, {
        method: "POST",
        url: "/api/config/ai/test",
        body: { baseUrl: "https://llm.example.com/v1", apiKey: "bad-key" },
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "AI credentials invalid", status: 400 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /api/config/ai/test requires an API key", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/ai/test",
      body: { baseUrl: "https://llm.example.com/v1" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "AI API key is required", status: 400 });
  });

  it("synthesizes a Default provider profile from legacy flat keys", async () => {
    const app = createTestApp();
    await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-5.3-flash", apiKey: "zai-key" },
    });

    const res = await invoke(app, { method: "GET", url: "/api/config/ai" });
    expect(res.status).toBe(200);
    expect(res.body?.providers).toEqual([
      {
        id: "default",
        name: "Default",
        baseUrl: "https://api.z.ai/api/paas/v4",
        model: "glm-5.3-flash",
        hasApiKey: true,
        resolvedContextWindow: 1_048_576,
        resolvedMaxOutputTokens: 131_072,
      },
    ]);
    expect(res.body?.activeProviderId).toBe("default");
    expect(JSON.stringify(res.body)).not.toContain("zai-key");
  });

  it("upserts provider profiles, keeps the first active, and switches on demand", async () => {
    const app = createTestApp();

    const first = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        upsertProvider: { name: "ZAI", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-5.3-flash", apiKey: "zai-key" },
      },
    });
    expect(first.status).toBe(200);
    const zaiId = first.body?.providers?.[0]?.id as string;
    expect(zaiId).toBeTruthy();
    expect(first.body?.activeProviderId).toBe(zaiId);
    expect(first.body?.providers?.[0]?.hasApiKey).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain("zai-key");

    const second = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        upsertProvider: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "ds-key" },
      },
    });
    expect(second.status).toBe(200);
    expect(second.body?.providers).toHaveLength(2);
    expect(second.body?.activeProviderId).toBe(zaiId);
    expect(second.body?.baseUrl).toBe("https://api.z.ai/api/paas/v4");

    const switched = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { activeProviderId: second.body?.providers?.[1]?.id },
    });
    expect(switched.status).toBe(200);
    expect(switched.body?.activeProviderId).toBe(second.body?.providers?.[1]?.id);
    expect(switched.body?.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(switched.body?.model).toBe("deepseek-chat");
  });

  it("stores each provider key under its own encrypted row", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        upsertProvider: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "ds-key" },
      },
    });
    const id = res.body?.providers?.[0]?.id as string;

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map[`ai_api_key:${id}`]).toBeDefined();
    expect(isEncryptedSecret(map[`ai_api_key:${id}`] as string)).toBe(true);
    expect(JSON.parse(map["ai_providers"] as string)).toHaveLength(1);
    expect(map["ai_active_provider"]).toBe(id);
  });

  it("stores per-provider capability overrides and resolves catalog defaults", async () => {
    const app = createTestApp();

    const explicit = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        upsertProvider: {
          name: "Custom",
          baseUrl: "https://llm.example.com/v1",
          model: "mystery-model",
          apiKey: "x",
          contextWindow: 64_000,
          maxOutputTokens: 4_096,
          reasoningEffort: "low",
          temperature: 1.2,
        },
      },
    });
    expect(explicit.status).toBe(200);
    expect(explicit.body?.providers?.[0]).toMatchObject({
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
      reasoningEffort: "low",
      temperature: 1.2,
      resolvedContextWindow: 64_000,
      resolvedMaxOutputTokens: 4_096,
    });
    expect(explicit.body?.contextWindow).toBe(64_000);
    expect(explicit.body?.reasoningEffort).toBe("low");
    expect(explicit.body?.temperature).toBe(1.2);

    const catalog = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: {
        upsertProvider: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "ds-key" },
      },
    });
    expect(catalog.status).toBe(200);
    // Known model with no explicit fields — catalog supplies resolved values.
    expect(catalog.body?.providers?.[1]).toMatchObject({
      resolvedContextWindow: 131_072,
      resolvedMaxOutputTokens: 32_768,
    });
    expect(catalog.body?.providers?.[1]?.reasoningEffort).toBeUndefined();

    const switched = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { activeProviderId: catalog.body?.providers?.[1]?.id },
    });
    expect(switched.body?.contextWindow).toBe(131_072);
    expect(switched.body?.maxOutputTokens).toBe(32_768);
    expect(switched.body?.reasoningEffort).toBeUndefined();
    expect(switched.body?.temperature).toBeUndefined();
  });

  it("removes a provider, clears its key, and reassigns active", async () => {
    const app = createTestApp();
    const first = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { upsertProvider: { baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-5.3-flash", apiKey: "zai-key" } },
    });
    const zaiId = first.body?.providers?.[0]?.id as string;
    const second = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { upsertProvider: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "ds-key" } },
    });
    const dsId = second.body?.providers?.[1]?.id as string;

    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { removeProviderId: zaiId },
    });
    expect(res.status).toBe(200);
    expect(res.body?.providers).toHaveLength(1);
    expect(res.body?.activeProviderId).toBe(dsId);

    const rows = await db.select().from(configTable);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map[`ai_api_key:${zaiId}`]).toBeUndefined();
    expect(map[`ai_api_key:${dsId}`]).toBeDefined();
  });

  it("rejects switching to an unknown provider", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/ai",
      body: { activeProviderId: "nope" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Unknown provider", status: 400 });
  });

  it("POST /api/config/ai/test uses the requested provider's stored key", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const app = createTestApp();
      const put = await invoke(app, {
        method: "PUT",
        url: "/api/config/ai",
        body: {
          upsertProvider: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "ds-key" },
        },
      });
      const providerId = put.body?.providers?.[0]?.id as string;

      const res = await invoke(app, {
        method: "POST",
        url: "/api/config/ai/test",
        body: { providerId },
      });
      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.deepseek.com/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer ds-key" }),
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /api/config/ai/test 404s on an unknown providerId", async () => {
    const app = createTestApp();
    const res = await invoke(app, {
      method: "POST",
      url: "/api/config/ai/test",
      body: { providerId: "missing" },
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Unknown provider", status: 404 });
  });
});
