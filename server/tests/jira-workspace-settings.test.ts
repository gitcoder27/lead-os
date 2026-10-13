import express from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "../src/config";
import { createTeamRouter } from "../src/routes/team";
import { errorHandler } from "../src/middleware/errorHandler";
import { JiraClient } from "../src/jira/client";
import { SyncEngine } from "../src/sync/engine";
import { SettingsService } from "../src/services/settings.service";
import { WorkloadService } from "../src/services/workload.service";
import { configTable, issues, developers } from "../src/db/schema";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
const original = { ...config };
beforeEach(async () => {
  await resetDatabase();
  Object.assign(config, { JIRA_BASE_URL: "https://owner.atlassian.net", JIRA_EMAIL: "owner@example.com", JIRA_PROJECT_KEY: "OWNER", JIRA_SYNC_JQL: "project = OWNERFIXTURE", JIRA_DEV_DUE_DATE_FIELD: "customfield_owner_date", JIRA_ASPEN_SEVERITY_FIELD: "customfield_owner_severity" });
});
afterEach(() => { Object.assign(config, original); vi.restoreAllMocks(); });
async function configure(workspaceId: string, values: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ jira_base_url: "https://friend.atlassian.net", jira_email: "friend@example.com", jira_project_key: "FRIEND", jira_api_token: "fixture", ...values })) {
    await db.insert(configTable).values({ workspaceId, key, value }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
  }
}
it.each([undefined, "", "project = FRIENDCUSTOM"])("sync uses scoped query and fields when query is %s", async (query) => {
  await configure("friend", query === undefined ? {} : { jira_sync_jql: query });
  await db.insert(developers).values({ workspaceId: "friend", accountId: "friend-dev", displayName: "Friend dev", isActive: 1 });
  vi.spyOn(JiraClient.prototype, "getCurrentUser").mockResolvedValue({ accountId: "fixture", displayName: "Fixture" });
  const item = { id: "1", key: "FRIEND-1", fields: { summary: "Friend work", status: { name: "Open", statusCategory: { key: "new" } }, created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z", customfield_owner_date: "2026-10-30", customfield_owner_severity: "Owner severity" } };
  // Second run reconciles the missing issue: both searches must use only scoped fields.
  const search = vi.spyOn(JiraClient.prototype, "searchIssues").mockResolvedValueOnce([item] as never).mockResolvedValueOnce([]).mockResolvedValueOnce([item] as never);
  const engine = new SyncEngine(new SettingsService());
  expect((await engine.syncNow("friend")).status).toBe("success");
  expect((await engine.syncNow("friend")).status).toBe("success");
  expect(search.mock.calls[0]![0]).toContain(query || 'project = FRIEND AND issuetype = Bug AND statusCategory != Done');
  expect(search.mock.calls[0]![0]).not.toContain('OWNER');
  expect(search.mock.calls[2]![0]).toContain('issuekey in');
  for (const [, fields] of search.mock.calls) {
    expect(fields).not.toContain("customfield_owner_date");
    expect(fields).not.toContain("customfield_owner_severity");
  }
  const row = (await db.select().from(issues).where(eq(issues.workspaceId, "friend")))[0]!;
  expect(row.developmentDueDate).toBeNull(); expect(row.aspenSeverity).toBeNull();
  expect(await new SettingsService().getJiraSyncJql("default")).toBe("project = OWNERFIXTURE");
});
it("discovery requires the friend's connection and sends only their destination, email, project and token", async () => {
  const app = express();
  app.use((req, _res, next) => { req.auth = { sessionId: "fixture", user: { username: "friend", accountId: "friend", displayName: "Friend", role: "manager", workspaceId: "friend" } }; next(); });
  app.use("/api/team", createTeamRouter(new WorkloadService())); app.use(errorHandler);
  const discover = vi.spyOn(JiraClient.prototype, "getAssignableUsers").mockResolvedValue([]);
  const send = () => invoke(app, { method: "POST", url: "/api/team/discover", body: { jiraApiToken: "supplied-friend-token" } });
  expect((await send()).status).toBe(400); expect(discover).not.toHaveBeenCalled();
  await configure("friend");
  expect((await send()).status).toBe(200);
  expect(discover).toHaveBeenCalledWith("FRIEND", expect.anything());
  expect(discover.mock.instances[0]).toMatchObject({ normalizedBaseUrl: "https://friend.atlassian.net", email: "friend@example.com", apiToken: "supplied-friend-token" });
});
