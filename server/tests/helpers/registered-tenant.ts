import crypto from "node:crypto";
import { expect } from "vitest";
import { rawDb } from "../../src/db/connection";
import type { invoke } from "./http";
import type { TenantSeed } from "./tenant-probes";

type Call = (method: string, url: string, body?: unknown) => Promise<Pick<Awaited<ReturnType<typeof invoke>>, "status" | "body">>;
/** Populate the registered workspace through real APIs; fixture-only inserts cover remote and chat data. */
export async function seedRegisteredTenant(call: Call, workspace: string, day: string): Promise<TenantSeed> {
  const seed = {} as TenantSeed;
  const write = async (method: string, url: string, body?: unknown) => { const r = await call(method, url, body); expect(r.status, `${method} ${url}: ${JSON.stringify(r.body)}`).toBeLessThan(400); return r.body; };
  seed.devId = (await write("POST", "/api/team/developers/manual", { displayName: "FRIENDSECRET Dev" })).developer.accountId;
  const capture = await write("POST", "/api/capture", { text: "FRIENDSECRET task", clientToday: day, tz: "UTC" }); seed.taskKey = JSON.stringify(capture).match(/T-\d+/)![0];
  await write("POST", `/api/tasks/${seed.taskKey}/events`, { type: "update", body: "FRIENDSECRET event", visibility: "private", requestId: crypto.randomUUID() });
  await write("PUT", `/api/notes/${day}`, { body: "FRIENDSECRET note", revision: 0 });
  seed.contactId = (await write("POST", "/api/contacts", { displayName: "FRIENDSECRET Contact", handle: "friend-contact" })).id;
  const project = await write("POST", "/api/projects", { name: "FRIENDSECRET Project" }); seed.projectId = project.id ?? project.project.id;
  const track = await write("POST", `/api/projects/${seed.projectId}/tracks`, { name: "FRIENDSECRET Track" }); seed.trackId = track.id ?? track.track.id;
  await write("POST", "/api/task-labels", { name: "friendsecret-label" });
  const view = await write("POST", "/api/task-views", { name: "FRIENDSECRET View", definition: { filters: { lane: "inbox" }, sort: "created" } }); seed.taskViewId = view.id ?? view.view.id;
  const workView = await write("POST", "/api/work/views", { name: "FRIENDSECRET Work" }); seed.workViewId = workView.id ?? workView.view.id;
  const tag = await write("POST", "/api/tags", { name: "FRIENDSECRET Tag", color: "#112233" }); seed.tagId = tag.id ?? tag.tag.id;
  await write("PUT", "/api/config/settings", { jiraBaseUrl: "https://friend.atlassian.net", jiraEmail: "friend@example.com", jiraProjectKey: "FRIEND", jiraApiToken: "FRIEND-JIRA-KEY", jiraAutoSyncEnabled: false });
  await write("PUT", "/api/config/ai", { enabled: true, baseUrl: "https://api.example.com/v1", model: "friend-model", apiKey: "FRIEND-AI-KEY" });
  rawDb.prepare("INSERT INTO issues (workspace_id,jira_key,summary,priority_name,priority_id,status_name,status_category,created_at,updated_at,synced_at) VALUES (?,'FRIEND-1','FRIENDSECRET issue','High','1','Open','new','2026-01-01','2026-01-01','2026-01-01')").run(workspace);
  seed.seriesId = (rawDb.prepare("INSERT INTO one_on_one_series (workspace_id,developer_account_id,cadence,active,created_at) VALUES (?,?,'weekly',1,'2026-01-01') RETURNING id").get(workspace, seed.devId) as { id: number }).id;
  rawDb.prepare("INSERT INTO one_on_one_sessions (workspace_id,series_id,scheduled_for,status,notes,created_at) VALUES (?,?,?,'scheduled','FRIENDSECRET 1:1','2026-01-01')").run(workspace, seed.seriesId, day);
  seed.conversationId = (rawDb.prepare("INSERT INTO assistant_conversations (workspace_id,manager_account_id,title,created_at,updated_at) VALUES (?,'registered','FRIENDSECRET chat','2026-01-01','2026-01-01') RETURNING id").get(workspace) as { id: number }).id;
  rawDb.prepare("INSERT INTO assistant_messages (conversation_id,role,content,created_at) VALUES (?,'user','FRIENDSECRET message','2026-01-01')").run(seed.conversationId);
  seed.memoryId = (rawDb.prepare("INSERT INTO assistant_memories (workspace_id,manager_account_id,text,created_at,updated_at) VALUES (?,'registered','FRIENDSECRET memory','2026-01-01','2026-01-01') RETURNING id").get(workspace) as { id: number }).id;
  seed.trackerViewId = (rawDb.prepare("INSERT INTO team_tracker_saved_views (workspace_id,manager_account_id,name,summary_filter,sort_by,group_by,created_at,updated_at) VALUES (?,'registered','FRIENDSECRET board','all','name','none','2026-01-01','2026-01-01') RETURNING id").get(workspace) as { id: number }).id;
  return seed;
}
