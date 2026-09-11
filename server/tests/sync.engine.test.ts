import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { SyncEngine } from "../src/sync/engine";
import { resetDatabase } from "./helpers/db";

describe("SyncEngine", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T09:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules syncs using the persisted interval", async () => {
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 120_000),
      getJiraAutoSyncEnabled: vi.fn(async () => true),
      getJiraBaseUrl: vi.fn(async () => undefined),
      getJiraEmail: vi.fn(async () => undefined),
      getJiraProjectKey: vi.fn(async () => undefined),
      getJiraToken: vi.fn(async () => undefined),
    };
    const engine = new SyncEngine(settings as any);
    const syncSpy = vi.spyOn(engine, "syncAllWorkspaces").mockResolvedValue([]);

    await engine.start();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(syncSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    engine.stop();
  });

  it("does not schedule syncs when auto-sync is disabled", async () => {
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 120_000),
      getJiraAutoSyncEnabled: vi.fn(async () => false),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
    };
    const engine = new SyncEngine(settings as any);
    const syncSpy = vi.spyOn(engine, "syncAllWorkspaces").mockResolvedValue([]);

    await engine.start();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(syncSpy).not.toHaveBeenCalled();

    engine.stop();
  });

  it("skips auto-sync for workspaces that disabled it while still syncing the rest", async () => {
    const engine = new SyncEngine({
      getJiraAutoSyncEnabled: vi.fn(async (workspaceId?: string) => workspaceId !== "workspace-b"),
    } as any);
    const syncableSpy = vi.spyOn(engine, "getSyncableWorkspaceIds").mockResolvedValue(["workspace-a", "workspace-b"]);
    const syncNowSpy = vi.spyOn(engine, "syncNow").mockResolvedValue({
      status: "success",
      issuesSynced: 0,
      startedAt: "2026-03-12T09:30:00.000Z",
      completedAt: "2026-03-12T09:30:00.000Z",
    });

    const results = await engine.syncAllWorkspaces();

    expect(syncableSpy).toHaveBeenCalled();
    expect(syncNowSpy).toHaveBeenCalledTimes(1);
    expect(syncNowSpy).toHaveBeenCalledWith("workspace-a");
    expect(results).toHaveLength(1);
  });

  it("still allows manual syncNow when auto-sync is disabled", async () => {
    const jiraClient = {
      getCurrentUser: vi.fn(async () => ({ accountId: "sync-user", displayName: "Sync User" })),
      searchIssues: vi.fn(async () => []),
    };
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraAutoSyncEnabled: vi.fn(async () => false),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
      getJiraSyncJql: vi.fn(async () => "project = AM"),
      getJiraSyncScopeMode: vi.fn(async () => "team_assignees"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async () => jiraClient),
    };
    const engine = new SyncEngine(settings as any);

    const result = await engine.syncNow();

    expect(result.status).toBe("success");
    expect(jiraClient.searchIssues).toHaveBeenCalledTimes(1);
  });

  it("restores dismissed out-of-team issues when they return to team scope", async () => {
    rawDb.exec(`
      INSERT INTO developers (account_id, display_name, is_active)
      VALUES ('dev-1', 'Dev 1', 1);

      INSERT INTO issues (
        jira_key,
        summary,
        description,
        priority_name,
        priority_id,
        status_name,
        status_category,
        assignee_id,
        assignee_name,
        team_scope_state,
        sync_scope_state,
        created_at,
        updated_at,
        synced_at,
        last_reconciled_at,
        excluded
      ) VALUES (
        'AM-1',
        'Returned defect',
        '',
        'High',
        '1',
        'In Progress',
        'indeterminate',
        'external-1',
        'External User',
        'out_of_team',
        'active',
        '2026-03-10T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        1
      );
    `);

    const jiraClient = {
      getCurrentUser: vi.fn(async () => ({ accountId: "sync-user", displayName: "Sync User" })),
      searchIssues: vi.fn(async () => [
        {
          id: "1",
          key: "AM-1",
          fields: {
            summary: "Returned defect",
            description: "",
            priority: { id: "1", name: "High" },
            status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
            assignee: { accountId: "dev-1", displayName: "Dev 1" },
            reporter: { displayName: "Reporter" },
            components: [],
            labels: [],
            duedate: null,
            created: "2026-03-10T00:00:00.000Z",
            updated: "2026-03-12T09:00:00.000Z",
            customfield_10021: null,
          },
        },
      ]),
    };
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
      getJiraSyncJql: vi.fn(async () => "project = AM"),
      getJiraSyncScopeMode: vi.fn(async () => "team_assignees"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async () => jiraClient),
    };
    const engine = new SyncEngine(settings as any);

    const result = await engine.syncNow();
    const issue = rawDb
      .prepare("SELECT assignee_id, team_scope_state, excluded FROM issues WHERE jira_key = ?")
      .get("AM-1") as { assignee_id: string; team_scope_state: string; excluded: number };

    expect(result.status).toBe("success");
    expect(issue.assignee_id).toBe("dev-1");
    expect(issue.team_scope_state).toBe("in_team");
    expect(issue.excluded).toBe(0);
  });

  it("uses base-query mode without appending team assignees and retires issues missing from the base query", async () => {
    rawDb.exec(`
      INSERT INTO issues (
        jira_key,
        summary,
        description,
        priority_name,
        priority_id,
        status_name,
        status_category,
        assignee_id,
        assignee_name,
        team_scope_state,
        sync_scope_state,
        created_at,
        updated_at,
        synced_at,
        last_reconciled_at,
        excluded
      ) VALUES (
        'AM-OLD',
        'Previous defect',
        '',
        'Medium',
        '3',
        'In Progress',
        'indeterminate',
        'external-old',
        'External Old',
        'out_of_team',
        'active',
        '2026-03-10T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        0
      );
    `);

    const jiraClient = {
      getCurrentUser: vi.fn(async () => ({ accountId: "sync-user", displayName: "Sync User" })),
      searchIssues: vi.fn(async () => [
        {
          id: "2",
          key: "AM-2",
          fields: {
            summary: "External defect",
            description: "",
            priority: { id: "2", name: "High" },
            status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
            assignee: { accountId: "external-1", displayName: "External One" },
            reporter: { displayName: "Reporter" },
            components: [],
            labels: [],
            duedate: null,
            created: "2026-03-12T08:00:00.000Z",
            updated: "2026-03-12T09:00:00.000Z",
            customfield_10021: null,
          },
        },
      ]),
    };
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
      getJiraSyncJql: vi.fn(async () => 'project = {PROJECT_KEY} AND assignee IN ("external-1")'),
      getJiraSyncScopeMode: vi.fn(async () => "base_query"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async () => jiraClient),
    };
    const engine = new SyncEngine(settings as any);

    const result = await engine.syncNow();
    const rows = rawDb
      .prepare("SELECT jira_key, team_scope_state, sync_scope_state FROM issues ORDER BY jira_key")
      .all() as Array<{ jira_key: string; team_scope_state: string; sync_scope_state: string }>;

    expect(result.status).toBe("success");
    expect(jiraClient.searchIssues).toHaveBeenCalledTimes(1);
    expect(jiraClient.searchIssues).toHaveBeenCalledWith(
      'project = AM AND assignee IN ("external-1")',
      expect.any(Array),
    );
    expect(rows).toEqual([
      { jira_key: "AM-2", team_scope_state: "out_of_team", sync_scope_state: "active" },
      { jira_key: "AM-OLD", team_scope_state: "out_of_team", sync_scope_state: "out_of_scope" },
    ]);
  });

  it("retires previously tracked issues when team-assignee mode has no scoped accounts", async () => {
    rawDb.exec(`
      INSERT INTO issues (
        jira_key,
        summary,
        description,
        priority_name,
        priority_id,
        status_name,
        status_category,
        assignee_id,
        assignee_name,
        team_scope_state,
        sync_scope_state,
        created_at,
        updated_at,
        synced_at,
        last_reconciled_at,
        excluded
      ) VALUES (
        'AM-1',
        'Unassigned old defect',
        '',
        'High',
        '1',
        'In Progress',
        'indeterminate',
        NULL,
        NULL,
        'unassigned',
        'active',
        '2026-03-10T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        '2026-03-11T00:00:00.000Z',
        0
      );
    `);

    const jiraClient = {
      getCurrentUser: vi.fn(async () => ({ accountId: "sync-user", displayName: "Sync User" })),
      searchIssues: vi.fn(async () => []),
    };
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
      getJiraSyncJql: vi.fn(async () => "project = AM"),
      getJiraSyncScopeMode: vi.fn(async () => "team_assignees"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async () => jiraClient),
    };
    const engine = new SyncEngine(settings as any);

    const result = await engine.syncNow();
    const issue = rawDb
      .prepare("SELECT sync_scope_state FROM issues WHERE jira_key = ?")
      .get("AM-1") as { sync_scope_state: string };

    expect(result.status).toBe("success");
    expect(jiraClient.searchIssues).toHaveBeenCalledTimes(1);
    expect(jiraClient.searchIssues).toHaveBeenCalledWith(
      "project = AM AND assignee IS EMPTY AND assignee IS NOT EMPTY",
      expect.any(Array),
    );
    expect(issue.sync_scope_state).toBe("out_of_scope");
  });

  it("records a sync error when Jira authentication cannot be verified", async () => {
    const jiraClient = {
      getCurrentUser: vi.fn(async () => {
        throw new Error("Jira authentication failed (401)");
      }),
      searchIssues: vi.fn(async () => []),
    };
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraAutoSyncEnabled: vi.fn(async () => true),
      getJiraBaseUrl: vi.fn(async () => "https://example.atlassian.net"),
      getJiraEmail: vi.fn(async () => "lead@example.com"),
      getJiraProjectKey: vi.fn(async () => "AM"),
      getJiraToken: vi.fn(async () => "token"),
      getJiraSyncJql: vi.fn(async () => "project = AM"),
      getJiraSyncScopeMode: vi.fn(async () => "team_assignees"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async () => jiraClient),
    };
    const engine = new SyncEngine(settings as any);

    await engine.start();
    const result = await engine.syncNow();
    await vi.advanceTimersByTimeAsync(60_000);
    const log = rawDb.prepare("SELECT status, issues_synced, error_message FROM sync_log ORDER BY id DESC LIMIT 1").get() as {
      status: string;
      issues_synced: number;
      error_message: string;
    };

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Jira authentication failed (401)");
    expect(jiraClient.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
    expect(log).toEqual({
      status: "error",
      issues_synced: 0,
      error_message: "Jira authentication failed (401)",
    });
  });

  it("syncs every workspace that has its own Jira connection", async () => {
    rawDb.exec(`
      INSERT INTO workspaces (id, name, owner_account_id, created_at, updated_at)
      VALUES
        ('workspace-a', 'Workspace A', 'manager-a', '2026-03-12T00:00:00.000Z', '2026-03-12T00:00:00.000Z'),
        ('workspace-b', 'Workspace B', 'manager-b', '2026-03-12T00:00:00.000Z', '2026-03-12T00:00:00.000Z');
    `);

    const jiraIssue = {
      id: "1",
      key: "AM-1",
      fields: {
        summary: "Shared Jira key",
        description: "",
        priority: { id: "1", name: "High" },
        status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
        assignee: null,
        reporter: { displayName: "Reporter" },
        components: [],
        labels: [],
        duedate: null,
        created: "2026-03-10T00:00:00.000Z",
        updated: "2026-03-12T09:00:00.000Z",
        customfield_10021: null,
      },
    };
    const createClient = (workspaceId: string) => ({
      getCurrentUser: vi.fn(async () => ({ accountId: `sync-${workspaceId}`, displayName: `Sync ${workspaceId}` })),
      searchIssues: vi.fn(async () => [jiraIssue]),
    });
    const clients = new Map<string, ReturnType<typeof createClient>>();
    const configured = new Set(["workspace-a", "workspace-b"]);
    const settings = {
      getSyncIntervalMs: vi.fn(async () => 60_000),
      getJiraAutoSyncEnabled: vi.fn(async () => true),
      getJiraBaseUrl: vi.fn(async (workspaceId: string) => configured.has(workspaceId) ? "https://example.atlassian.net" : undefined),
      getJiraEmail: vi.fn(async (workspaceId: string) => configured.has(workspaceId) ? `${workspaceId}@example.com` : undefined),
      getJiraProjectKey: vi.fn(async (workspaceId: string) => configured.has(workspaceId) ? "AM" : undefined),
      getJiraToken: vi.fn(async (workspaceId: string) => configured.has(workspaceId) ? `token-${workspaceId}` : undefined),
      getJiraSyncJql: vi.fn(async () => "project = AM"),
      getJiraSyncScopeMode: vi.fn(async () => "team_assignees"),
      getManagerJiraAccountId: vi.fn(async () => ""),
      getJiraDevDueDateField: vi.fn(async () => undefined),
      getJiraAspenSeverityField: vi.fn(async () => undefined),
      createJiraClient: vi.fn(async (workspaceId: string) => {
        const client = createClient(workspaceId);
        clients.set(workspaceId, client);
        return client;
      }),
    };
    const engine = new SyncEngine(settings as any);

    const results = await engine.syncAllWorkspaces();
    const rows = rawDb
      .prepare("SELECT workspace_id, jira_key FROM issues WHERE jira_key = ? ORDER BY workspace_id")
      .all("AM-1") as Array<{ workspace_id: string; jira_key: string }>;

    expect(results.map((result) => result.status)).toEqual(["success", "success"]);
    expect(settings.createJiraClient).toHaveBeenCalledWith("workspace-a");
    expect(settings.createJiraClient).toHaveBeenCalledWith("workspace-b");
    expect(rows).toEqual([
      { workspace_id: "workspace-a", jira_key: "AM-1" },
      { workspace_id: "workspace-b", jira_key: "AM-1" },
    ]);
  });
});
