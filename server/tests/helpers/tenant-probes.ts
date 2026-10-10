import crypto from "node:crypto";

export interface TenantSeed {
  devId: string;
  taskKey: string;
  contactId: number;
  projectId: number;
  trackId: number;
  taskViewId: number;
  workViewId: number;
  tagId: number;
  seriesId: number;
  conversationId: number;
  memoryId: number;
  trackerViewId: number;
}

const MARK = "OWNERSECRET";

export function foreignTenantProbes(seed: TenantSeed, day: string) {
  const probes: Array<[string, string, unknown?]> = [];
  const k = seed.taskKey;

  // Reads with the owner's ids and keys (friend has no tasks yet, so T-1 cannot be the friend's own).
  const reads = [
    "/api/auth/me", "/api/today", `/api/today?date=${day}`, "/api/tasks/view-counts", `/api/tasks/${k}`, `/api/tasks/${k}/detail`, `/api/tasks/${k}/events`,
    `/api/tasks/person/${seed.devId}`, `/api/tasks/person/owner`, "/api/notes", `/api/notes/${day}`, `/api/notes/${day}/context`, "/api/notes/sources",
    "/api/contacts", "/api/projects", `/api/projects/${seed.projectId}`, "/api/task-views", "/api/task-labels", "/api/team/developers", "/api/team/workload",
    "/api/team/self", `/api/team/${seed.devId}/issues`, `/api/team-tracker?date=${day}`, "/api/team-tracker/views", "/api/team-tracker/standup/session/latest",
    "/api/work/views", "/api/tags", "/api/tags/counts", `/api/tags/${seed.tagId}/usage`, "/api/issues", "/api/issues/OWN-1", "/api/overview", "/api/alerts",
    `/api/search?q=${MARK}`, `/api/search?q=ownersecret`, "/api/config", "/api/config/ai", "/api/config/team-mode", "/api/config/attention-rules",
    "/api/config/maintenance/reset-preview", "/api/sync/status", "/api/preferences/navigation", "/api/manager-actions", "/api/one-on-ones",
    `/api/one-on-ones/${seed.seriesId}`, `/api/one-on-ones/${seed.seriesId}/agenda`, "/api/assistant/conversations", `/api/assistant/conversations/${seed.conversationId}`,
    "/api/assistant/memory", "/api/review/week", "/api/review/weeks", "/api/task-inbox", "/api/auth/users", "/api/backups",
    `/api/manager-desk?date=${day}`, "/api/manager-desk/lookups/developers", `/api/manager-desk/lookups/issues?q=OWN`, "/api/suggestions/assignee/OWN-1",
    `/api/tasks?view=inbox`, `/api/tasks?view=my-tasks`, `/api/tasks?view=high-priority`, `/api/tasks?view=waiting`, `/api/tasks?view=projects&project=${seed.projectId}`,
    `/api/my-day?date=${day}`, `/api/backups/x.backup-1.db/download`, "/api/config/fields", "/api/config/connection-health",
  ];
  for (const url of reads) probes.push(["GET", url]);

  // Writes against the owner's ids and keys.
  const writes: Array<[string, string, unknown?]> = [
    ["PATCH", `/api/tasks/${k}`, { title: "pwned" }], ["POST", `/api/tasks/${k}/events`, { type: "update", body: "pwned", requestId: crypto.randomUUID() }],
    ["POST", `/api/tasks/${k}/links`, { kind: "url", ref: "https://x.example" }], ["DELETE", `/api/tasks/${k}`],
    ["POST", "/api/tasks/bulk", { keys: [k], action: "close" }], ["PUT", "/api/today/top3", { date: day, taskKeys: [k] }],
    ["POST", "/api/capture", { text: "child of owner task", clientToday: day, tz: "UTC", defaults: { parentKey: k } }],
    ["POST", "/api/capture", { text: "placed in owner project", clientToday: day, tz: "UTC", defaults: { placement: { projectId: seed.projectId, trackId: null } } }],
    ["POST", "/api/capture", { text: "waiting on owner contact", clientToday: day, tz: "UTC", defaults: { waitingOn: { type: "contact", ref: String(seed.contactId) } } }],
    ["POST", "/api/capture", { text: "owned by owner dev", clientToday: day, tz: "UTC", defaults: { owner: { type: "developer", id: seed.devId } } }],
    ["DELETE", `/api/contacts/${seed.contactId}`], ["PATCH", `/api/projects/${seed.projectId}`, { name: "pwned" }],
    ["POST", `/api/projects/${seed.projectId}/tracks`, { name: "pwned" }], ["PATCH", `/api/project-tracks/${seed.trackId}`, { name: "pwned" }],
    ["POST", "/api/task-placements/preview", { keys: [k] }],
    ["PATCH", `/api/task-views/${seed.taskViewId}`, { name: "pwned" }], ["DELETE", `/api/task-views/${seed.taskViewId}`],
    ["PATCH", "/api/task-labels/ownersecret-label", { color: "red" }], ["DELETE", "/api/task-labels/ownersecret-label"],
    ["DELETE", `/api/tags/${seed.tagId}`], ["PUT", "/api/tags/issue/OWN-1", { tagIds: [seed.tagId] }],
    ["PATCH", `/api/issues/OWN-1`, { analysisNotes: "pwned" }], ["POST", "/api/issues/OWN-1/exclude", {}],
    ["PATCH", `/api/team/developers/${seed.devId}`, { displayName: "pwned" }], ["DELETE", `/api/team/developers/${seed.devId}`],
    ["PUT", "/api/team/self", { developerAccountId: seed.devId }],
    ["PATCH", `/api/work/views/${seed.workViewId}`, { name: "pwned" }], ["DELETE", `/api/work/views/${seed.workViewId}`],
    ["PATCH", `/api/team-tracker/views/${seed.trackerViewId}`, { name: "pwned" }], ["DELETE", `/api/team-tracker/views/${seed.trackerViewId}`],
    ["DELETE", `/api/assistant/memory/${seed.memoryId}`], ["DELETE", `/api/assistant/conversations/${seed.conversationId}`],
    ["PATCH", `/api/one-on-ones/${seed.seriesId}`, { cadence: "monthly" }], ["POST", `/api/one-on-ones/${seed.seriesId}/sessions`, { scheduledFor: day }],
    ["POST", "/api/auth/register", { username: "friend-dev", password: "secret123", displayName: "x", role: "developer", developerAccountId: seed.devId }],
    ["DELETE", "/api/auth/users/ownerdev"], ["POST", "/api/auth/users/ownerdev/reset-password", { newPassword: "pwned1234" }],
    ["POST", "/api/alerts/dismiss", { alertId: "x" }], ["POST", "/api/backups/run", {}],
    ["PUT", "/api/config/settings", { backupEnabled: false }],
    ["POST", "/api/config/maintenance/reset", { target: "workspace", confirmationText: "CLEAR EVERYTHING" }],
  ];
  probes.push(...writes);

  // Round 2: corrected params, 1:1 flag on for the friend too.
  const b64 = (d: unknown) => Buffer.from(JSON.stringify(d)).toString("base64url");
  const reads2 = [
    `/api/today?date=${day}&tz=UTC`, `/api/manager-actions?date=${day}`, `/api/manager-actions?date=${day}&surface=header`, `/api/notes/sources?itemIds=1,2,3`,
    `/api/manager-desk/lookups/developers?q=own&date=${day}`, `/api/manager-desk/lookups/developers?q=own&includeUnavailable=true`,
    `/api/tasks?viewDef=${b64({ filters: { lane: "inbox" }, sort: "created" })}&today=${day}`,
    `/api/tasks?viewDef=${b64({ filters: {}, sort: "created" })}&today=${day}`,
    `/api/tasks?viewDef=${b64({ filters: { project: seed.projectId }, sort: "created" })}&today=${day}`,
    `/api/tasks?view=all`, `/api/tasks?view=developer&ownerId=${seed.devId}`,
    "/api/one-on-ones", `/api/one-on-ones/${seed.seriesId}`, `/api/one-on-ones/${seed.seriesId}/agenda`, `/api/one-on-ones/${seed.seriesId}/suggestions`,
    `/api/manager-desk/items/1/detail`, `/api/task-inbox?unreadOnly=true`,
  ];
  for (const url of reads2) probes.push(["GET", url]);
  const writes2: Array<[string, string, unknown?]> = [
    ["PATCH", `/api/one-on-ones/${seed.seriesId}`, { cadence: "monthly" }], ["POST", `/api/one-on-ones/${seed.seriesId}/sessions`, { scheduledFor: day }],
    ["POST", `/api/one-on-ones/${seed.seriesId}/agenda`, { taskKey: k }], ["POST", "/api/one-on-ones/agenda", { developerAccountId: seed.devId, title: "x" }],
    ["POST", `/api/tasks/${k}/links`, { kind: "external", ref: "https://x.example" }],
    ["POST", "/api/capture", { text: "owned by owner dev", clientToday: day, tz: "UTC", defaults: { ownerAccountId: seed.devId } }],
    ["POST", "/api/capture", { text: "linked to owner dev", clientToday: day, tz: "UTC", defaults: { links: { developerAccountIds: [seed.devId], jiraKeys: ["OWN-1"] } } }],
    ["POST", `/api/notes/${day}/follow-ups`, { title: "x", requestId: crypto.randomUUID() }],
    ["POST", "/api/manager-desk/items/1/links", { linkType: "issue", issueKey: "OWN-1" }],
    ["PATCH", "/api/manager-desk/items/1", { title: "pwned" }],
    ["POST", "/api/team-tracker/items/1/reassign", { toDeveloperAccountId: seed.devId }],
    ["POST", "/api/task-inbox/read", { ids: [1, 2, 3] }],
  ];
  probes.push(...writes2);
  return probes;
}
