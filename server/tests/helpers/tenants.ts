import type { SyncEngine as SyncEngineType } from "../../src/sync/engine";
import { expect } from "vitest";
import crypto from "node:crypto";
import { foreignTenantProbes, type TenantSeed } from "./tenant-probes";
import { rawDb } from "../../src/db/connection";

export function workspaceSnapshot(workspaceId: string) {
  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    const columns = rawDb.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
    let where = columns.some((column) => column.name === "workspace_id") ? "workspace_id = ?" : undefined;
    if (name === "assistant_messages") where = "conversation_id IN (SELECT id FROM assistant_conversations WHERE workspace_id = ?)";
    if (name === "workspaces") where = "id = ?";
    if (!where) continue;
    const rows = rawDb.prepare(`SELECT * FROM "${name}" WHERE ${where} ORDER BY rowid`).all(workspaceId);
    result[name] = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  return result;
}

const MARK = "OWNERSECRET";

/** Real services and API fixtures; only outbound sync and backups are stubbed. */
export async function seedTenants() {
  const { createApp } = await import(`../../src/app`);
  const { rawDb } = await import(`../../src/db/connection`);
  const { invoke } = await import(`../helpers/http`);
  const { startCanonicalTasksIfEmpty } = await import(`../../src/db/canonical-start`);
  const { AuthService, serializeSessionCookie } = await import(`../../src/services/auth.service`);
  const { SettingsService } = await import(`../../src/services/settings.service`);
  const { WorkloadService } = await import(`../../src/services/workload.service`);
  const { IssueService } = await import(`../../src/services/issue.service`);
  const { AlertService } = await import(`../../src/services/alert.service`);
  const { AutomationService } = await import(`../../src/services/automation.service`);
  const { TagService } = await import(`../../src/services/tag.service`);
  const { TeamTrackerService } = await import(`../../src/services/team-tracker.service`);
  const { MyDayService } = await import(`../../src/services/my-day.service`);
  const { ManagerDeskService } = await import(`../../src/services/manager-desk.service`);
  const { TodayService } = await import(`../../src/services/today.service`);
  const { SearchService } = await import(`../../src/services/search.service`);
  const { WorkSavedViewsService } = await import(`../../src/services/work-saved-views.service`);
  const { DailyNotesService } = await import(`../../src/services/daily-notes.service`);
  const { OneOnOneService } = await import(`../../src/services/one-on-one.service`);
  const { BackupService } = await import(`../../src/services/backup.service`);
  const { SyncEngine } = await import(`../../src/sync/engine`);
  const { AssistantService } = await import(`../../src/assistant/service`);
  const { AssistantMemoryService } = await import(`../../src/services/assistant-memory.service`);


  const settings = new SettingsService();
  const workload = new WorkloadService();
  const tracker = new TeamTrackerService();
  const issueService = new IssueService(undefined, settings, tracker);
  const desk = new ManagerDeskService(tracker);
  const alertService = new AlertService(workload, settings);
  const automation = new AutomationService(workload);
  const dailyNotes = new DailyNotesService(desk);
  const oneOnOnes = new OneOnOneService();
  const syncStub = {
    getLastSyncLog: async () => undefined, getLastSuccessfulSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" }), start: async () => undefined,
    syncNow: async () => { return { status: "skipped", issuesSynced: 0, startedAt: "", completedAt: "" }; },
    isAutoSyncEnabled: async () => true,
    isJiraConfigured: (ws: string) => new SyncEngine(settings).isJiraConfigured(ws),
    getSyncScope: (ws: string) => new SyncEngine(settings).getSyncScope(ws),
    syncAllWorkspaces: async () => [],
  } as unknown as SyncEngineType;
  const backupService = { start: async () => undefined, createPreResetBackup: async () => null } as unknown as BackupService;
  const today = new TodayService(issueService, tracker, desk, syncStub, { oneOnOneService: oneOnOnes });
  const search = new SearchService(settings, dailyNotes);
  const workViews = new WorkSavedViewsService();
  const tagService = new TagService();
  const authService = new AuthService();
  const assistant = new AssistantService({
    todayService: today, teamTrackerService: tracker, managerDeskService: desk, issueService, dailyNotesService: dailyNotes,
    workloadService: workload, alertService, searchService: search, syncEngine: syncStub, tagService, workSavedViewsService: workViews,
    automationService: automation, settingsService: settings, memoryService: new AssistantMemoryService(),
  });
  const app = createApp({
    issueService, workloadService: workload, alertService, automationService: automation, syncEngine: syncStub, backupService,
    tagService, teamTrackerService: tracker, authService, myDayService: new MyDayService(tracker), managerDeskService: desk,
    todayService: today, searchService: search, workSavedViewsService: workViews, dailyNotesService: dailyNotes,
    assistantService: assistant, oneOnOneService: oneOnOnes,
  });

  // ── Owner: first account → workspace "default" (bootstrap path through the real route).
  const boot = await invoke(app, { method: "POST", url: "/api/auth/register", body: { username: "owner", password: "secret123", displayName: "Owner", role: "manager" } });
  expect(boot.status).toBe(201);
  startCanonicalTasksIfEmpty(rawDb, "default");
  const ownerCookie = (boot.headers["set-cookie"] ?? "").split(";")[0]!;
  rawDb.prepare("INSERT INTO config (workspace_id,key,value) VALUES ('default','one_on_one_enabled','true')").run();

  const O = (method: string, url: string, body?: unknown) => invoke(app, { method, url, body, headers: { cookie: ownerCookie } });
  const seed = {} as TenantSeed;
  const seedCall = async (method: string, url: string, body?: unknown) => {
    const response = await O(method, url, body);
    expect(response.status, `${method} ${url}: ${JSON.stringify(response.body)}`).toBeLessThan(400);
    return response;
  };

  const day = new Date().toISOString().slice(0, 10);
  const dev = await seedCall("POST", "/api/team/developers/manual", { displayName: `${MARK} Dev` });
  seed.devId = dev.body?.accountId ?? dev.body?.developer?.accountId ?? JSON.stringify(dev.body).match(/"accountId":"([^"]+)"/)?.[1];
  const c1 = await seedCall("POST", "/api/capture", { text: `${MARK} task alpha`, clientToday: day, tz: "UTC" });
  seed.taskKey = JSON.stringify(c1.body).match(/T-\d+/)?.[0] ?? "T-1";
  await seedCall("POST", "/api/capture", { text: `${MARK} task beta`, clientToday: day, tz: "UTC", defaults: { ownerAccountId: seed.devId } });
  await seedCall("POST", `/api/tasks/${seed.taskKey}/events`, { type: "update", body: `${MARK} private update`, visibility: "private", requestId: crypto.randomUUID() });
  await seedCall("PUT", `/api/notes/${day}`, { body: `${MARK} private note`, revision: 0 });
  const ct = await seedCall("POST", "/api/contacts", { displayName: `${MARK} Contact`, handle: "ownersecretcontact" });
  seed.contactId = ct.body?.id;
  const pj = await seedCall("POST", "/api/projects", { name: `${MARK} Project` });
  seed.projectId = pj.body?.id ?? pj.body?.project?.id;
  const tr = await seedCall("POST", `/api/projects/${seed.projectId}/tracks`, { name: `${MARK} Track` });
  seed.trackId = tr.body?.id ?? tr.body?.track?.id;
  await seedCall("POST", "/api/task-labels", { name: "ownersecret-label" });
  const tv = await seedCall("POST", "/api/task-views", { name: `${MARK} View`, definition: { filters: { lane: "inbox" }, sort: "created" } });
  seed.taskViewId = tv.body?.id ?? tv.body?.view?.id;
  const wv = await seedCall("POST", "/api/work/views", { name: `${MARK} work view` });
  seed.workViewId = wv.body?.id ?? wv.body?.view?.id;
  const tg = await seedCall("POST", "/api/tags", { name: `${MARK} tag`, color: "#112233" });
  seed.tagId = tg.body?.id ?? tg.body?.tag?.id;
  await seedCall("PUT", "/api/config/ai", { enabled: true, baseUrl: "https://api.example.com/v1", model: "m", apiKey: "OWNER-AI-KEY" });
  await seedCall("POST", "/api/auth/register", { username: "ownerdev", password: "secret123", displayName: "Owner Dev", role: "developer", developerAccountId: seed.devId });
  // Rows without a convenient API in a probe: issue, 1:1 series/session, Copilot conversation + memory, tracker saved view.
  rawDb.prepare(`INSERT INTO issues (workspace_id,jira_key,summary,priority_name,priority_id,status_name,status_category,created_at,updated_at,synced_at) VALUES ('default','OWN-1','${MARK} issue','High','1','Open','new','2026-01-01','2026-01-01','2026-01-01')`).run();
  const series = rawDb.prepare("INSERT INTO one_on_one_series (workspace_id,developer_account_id,cadence,active,created_at) VALUES ('default',?,'weekly',1,'2026-01-01') RETURNING id").get(seed.devId) as { id: number };
  seed.seriesId = series.id;
  rawDb.prepare(`INSERT INTO one_on_one_sessions (workspace_id,series_id,scheduled_for,status,notes,created_at) VALUES ('default',?,?,'scheduled','${MARK} 1:1 notes','2026-01-01')`).run(series.id, day);
  const conv = rawDb.prepare(`INSERT INTO assistant_conversations (workspace_id,manager_account_id,title,created_at,updated_at) VALUES ('default','owner','${MARK} conversation','2026-01-01','2026-01-01') RETURNING id`).get() as { id: number };
  seed.conversationId = conv.id;
  rawDb.prepare(`INSERT INTO assistant_messages (conversation_id,role,content,created_at) VALUES (?, 'user', '${MARK} message', '2026-01-01')`).run(conv.id);
  const mem = rawDb.prepare(`INSERT INTO assistant_memories (workspace_id,manager_account_id,text,created_at,updated_at) VALUES ('default','owner','${MARK} memory','2026-01-01','2026-01-01') RETURNING id`).get() as { id: number };
  seed.memoryId = mem.id;
  const tvw = rawDb.prepare(`INSERT INTO team_tracker_saved_views (workspace_id,manager_account_id,name,summary_filter,sort_by,group_by,created_at,updated_at) VALUES ('default','owner','${MARK} board','all','name','none','2026-01-01','2026-01-01') RETURNING id`).get() as { id: number };
  seed.trackerViewId = tvw.id;

  // ── Friend: second manager. Same service call the CLI makes today (no workspace given → new workspace).
  const friend = await authService.createUser({ username: "friend", password: "secret123", displayName: "Friend", role: "manager" });
  const fs1 = await authService.authenticate("friend", "secret123");
  const friendCookie = serializeSessionCookie(fs1.sessionId, 60).split(";")[0]!;
  const F = (method: string, url: string, body?: unknown) => invoke(app, { method, url, body, headers: { cookie: friendCookie } });
  const snapshot = () => workspaceSnapshot("default");
  const before = snapshot();
  rawDb.prepare("INSERT INTO config (workspace_id,key,value) VALUES (?,'one_on_one_enabled','true') ON CONFLICT DO NOTHING").run(friend.workspaceId);
  const probes = foreignTenantProbes(seed, day);
  return { app, authService, settings, tracker, search, syncStub, friend, friendCookie, ownerCookie, seed, day, O, F, before, snapshot, probes };
}
