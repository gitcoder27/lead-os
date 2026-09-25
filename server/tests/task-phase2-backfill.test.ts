import { TaskCutoverService } from "../src/services/task-cutover.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { MyDayService } from "../src/services/my-day.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDatabase } from "./helpers/db";
import {
  dailyNoteFollowUps,
  dailyNoteTaskRefs,
  dailyNotes,
  dataMigrations,
  dayFocus,
  developerNotes,
  developers,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  taskEvents,
  taskKeyAliases,
  taskKeySequences,
  taskLegacyMap,
  taskLinks,
  tasks,
  teamTrackerDays,
  teamTrackerItems,
  workspaces,
} from "../src/db/schema";
import { TaskPhase2BackfillService, type Phase2Decision, type TaskPhase2Report } from "../src/services/task-phase2-backfill.service";
import { TaskPhase2ExportService } from "../src/services/task-phase2-export.service";
import { TaskService } from "../src/services/task.service";
import { parseTaskNotes } from "../src/services/task-notes-import";

const service = new TaskPhase2BackfillService();
const taskService = new TaskService();
const exporter = new TaskPhase2ExportService();

const P1_AT = "2026-02-01T00:00:00.000Z";
const T = (day: number, time = "T09:00:00.000Z") => `2026-01-${String(day).padStart(2, "0")}${time}`;
const D = (day: number) => `2026-01-${String(day).padStart(2, "0")}`;
let eventSeq = 0;

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev One", isActive: 1 });
  await db.insert(developers).values({ accountId: "dev-2", displayName: "Dev Two", isActive: 1 });
  await db.insert(dataMigrations).values([
    { name: "p1_assign_task_keys", appliedAt: P1_AT },
    { name: "p1_import_task_notes", appliedAt: P1_AT },
  ]);
  // Sequence headroom: fixture keys are T-1..T-99; allocations start at T-100.
  await db.insert(taskKeySequences).values({ workspaceId: "default", nextValue: 100 });
});

// A leftover p2_backfill marker would contract task_events.task_id to NOT NULL
// the next time any file runs migrate() — leave the shared DB clean.
afterAll(async () => {
  await resetDatabase();
});

async function devDay(date: string, dev = "dev-1", ws = "default") {
  const rows = await db.insert(teamTrackerDays).values({
    workspaceId: ws, date, developerAccountId: dev, createdAt: `${date}T07:00:00.000Z`, updatedAt: `${date}T07:00:00.000Z`,
  }).returning();
  return rows[0]!;
}

interface TrackerSeed {
  taskKey: string; title?: string; state?: string; note?: string | null;
  jiraKey?: string; relatedJiraKeys?: string[]; managerDeskItemId?: number;
  position?: number; createdAt: string; updatedAt?: string; completedAt?: string;
  workspaceId?: string;
}
async function trackerRow(dayId: number, o: TrackerSeed) {
  const rows = await db.insert(teamTrackerItems).values({
    workspaceId: o.workspaceId ?? "default", dayId,
    managerDeskItemId: o.managerDeskItemId ?? null,
    taskKey: o.taskKey, itemType: o.jiraKey ? "jira" : "custom",
    jiraKey: o.jiraKey ?? null, relatedJiraKeys: o.relatedJiraKeys ? JSON.stringify(o.relatedJiraKeys) : null,
    title: o.title ?? "Task", state: o.state ?? "planned", position: o.position ?? 0,
    note: o.note ?? null, completedAt: o.completedAt ?? null,
    createdAt: o.createdAt, updatedAt: o.updatedAt ?? o.createdAt,
  }).returning();
  return rows[0]!;
}

async function deskDay(date: string, manager = "mgr-1", ws = "default") {
  const rows = await db.insert(managerDeskDays).values({
    workspaceId: ws, date, managerAccountId: manager, createdAt: `${date}T07:00:00.000Z`, updatedAt: `${date}T07:00:00.000Z`,
  }).returning();
  return rows[0]!;
}

interface DeskSeed {
  taskKey?: string; title?: string; kind?: string; category?: string; status?: string;
  priority?: string; assignee?: string; sourceItemId?: number; followUpAt?: string;
  contextNote?: string; nextAction?: string; outcome?: string;
  createdAt: string; updatedAt?: string; completedAt?: string; workspaceId?: string;
}
async function deskRow(dayId: number, o: DeskSeed) {
  const rows = await db.insert(managerDeskItems).values({
    workspaceId: o.workspaceId ?? "default", dayId,
    sourceItemId: o.sourceItemId ?? null, taskKey: o.taskKey ?? null,
    assigneeDeveloperAccountId: o.assignee ?? null,
    title: o.title ?? "Desk item", kind: o.kind ?? "action", category: o.category ?? "other",
    status: o.status ?? "planned", priority: o.priority ?? "medium",
    contextNote: o.contextNote ?? null, nextAction: o.nextAction ?? null, outcome: o.outcome ?? null,
    followUpAt: o.followUpAt ?? null, completedAt: o.completedAt ?? null,
    createdAt: o.createdAt, updatedAt: o.updatedAt ?? o.createdAt,
  }).returning();
  return rows[0]!;
}

async function hist(itemId: number, snapshot: Record<string, unknown>, recordedAt: string, eventType = "upsert", manager = "mgr-1") {
  await db.insert(managerDeskItemHistory).values({
    workspaceId: "default", itemId, managerAccountId: manager, eventType,
    snapshotJson: JSON.stringify(snapshot), recordedAt,
  });
}

async function ev(taskKey: string, o: { type?: string; body?: string | null; meta?: Record<string, unknown>; occurredAt?: string; authorType?: string; authorId?: string; visibility?: string } = {}) {
  const rows = await db.insert(taskEvents).values({
    workspaceId: "default", taskKey,
    type: o.type ?? "update", body: o.body ?? null,
    visibility: o.visibility ?? "shared",
    authorType: o.authorType ?? "manager", authorId: o.authorId ?? "mgr-1",
    metaJson: o.meta ? JSON.stringify(o.meta) : null,
    occurredAt: o.occurredAt ?? T(10), createdAt: o.occurredAt ?? T(10),
  }).returning();
  eventSeq += 1;
  return rows[0]!;
}

const decisionsFrom = (report: TaskPhase2Report, overrides: Phase2Decision[] = []) => {
  const byId = new Map(overrides.map((d) => [d.proposalId, d]));
  return {
    inputHash: report.inputHash,
    decisions: [
      ...report.decisionsTemplate.decisions.map((d) => byId.get(d.proposalId) ?? d),
      ...overrides.filter((d) => !report.decisionsTemplate.decisions.some((t) => t.proposalId === d.proposalId)),
    ],
  };
};

const allTasks = () => db.select().from(tasks).where(eq(tasks.workspaceId, "default"));

describe("Phase 2 backfill", () => {
  it("F1: tracker-only task → done task, day_focus, synthesized created/status events", async () => {
    const day = await devDay(D(5));
    await trackerRow(day.id, { taskKey: "T-1", title: "Write report", state: "done", createdAt: T(5), completedAt: T(7), updatedAt: T(7) });

    const report = await service.plan("default");
    expect(report.counts.keyGroups).toBe(1);
    await service.apply("default", decisionsFrom(report));

    const [task] = await allTasks();
    expect(task).toMatchObject({ taskKey: "T-1", title: "Write report", status: "done", ownerType: "developer", ownerId: "dev-1", closedAt: T(7) });
    const focus = await db.select().from(dayFocus);
    expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ date: D(5), ownerType: "developer", ownerId: "dev-1", taskId: task.id, source: "backfill" });
    const events = await db.select().from(taskEvents);
    expect(events.map((e) => e.type).sort()).toEqual(["created", "status"]);
    expect(events.every((e) => e.taskId === task.id)).toBe(true);
    const map = await db.select().from(taskLegacyMap);
    expect(map).toEqual([expect.objectContaining({ sourceTable: "team_tracker_items", role: "canonical", taskId: task.id })]);
  });

  it("F2: carry batch — edited copy auto-merges to the lower key", async () => {
    const mon = await devDay(D(5));
    const tue = await devDay(D(6));
    const batch = T(6, "T06:00:00.000Z");
    await trackerRow(mon.id, { taskKey: "T-1", title: "Alpha", note: "nA", createdAt: T(5) });
    await trackerRow(mon.id, { taskKey: "T-2", title: "Beta", note: "nB", createdAt: T(5) });
    await trackerRow(mon.id, { taskKey: "T-3", title: "Gamma", note: "nG", createdAt: T(5) });
    await trackerRow(tue.id, { taskKey: "T-1", title: "Alpha", note: "nA", createdAt: batch });
    await trackerRow(tue.id, { taskKey: "T-2", title: "Beta", note: "nB", createdAt: batch });
    const copy = await trackerRow(tue.id, { taskKey: "T-4", title: "Gamma", note: "edited", createdAt: batch, updatedAt: T(6, "T10:00:00.000Z") });
    await ev("T-4", { type: "update", body: "note", meta: { imported: { field: "tracker_note", sourceId: copy.id } }, occurredAt: P1_AT });

    const report = await service.plan("default");
    expect(report.autoMerges).toHaveLength(1);
    expect(report.autoMerges[0]).toMatchObject({ mergedKey: "T-4", survivorKey: "T-3" });
    expect(report.ambiguous).toHaveLength(0);

    await service.apply("default", decisionsFrom(report));
    const aliases = await db.select().from(taskKeyAliases);
    expect(aliases).toEqual([expect.objectContaining({ aliasKey: "T-4", taskKey: "T-3" })]);
    const rows = await allTasks();
    expect(rows.map((r) => r.taskKey).sort()).toEqual(["T-1", "T-2", "T-3"]);
    const merged = await db.select().from(taskEvents).where(eq(taskEvents.type, "merged"));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.taskKey).toBe("T-3");
  });

  it("F3: B4 ghost pair — A6 proposal with merge default, merged task is active", async () => {
    const mon = await devDay(D(5));
    const wed = await devDay(D(7));
    await trackerRow(mon.id, { taskKey: "T-1", title: "Fix flaky test", note: "old", state: "in_progress", createdAt: T(5), updatedAt: T(6) });
    const ghost = await trackerRow(wed.id, { taskKey: "T-2", title: "Fix flaky test", note: "edited", state: "planned", createdAt: T(7), updatedAt: T(7, "T11:00:00.000Z") });
    await ev("T-2", { type: "update", body: "old", meta: { imported: { field: "tracker_note", sourceId: ghost.id } }, occurredAt: P1_AT });

    const report = await service.plan("default");
    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0]).toMatchObject({ codes: ["A6"], default: "merge", survivorKey: "T-1", mergedKey: "T-2" });

    await service.apply("default", decisionsFrom(report));
    const rows = await allTasks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskKey: "T-1", status: "active" });
  });

  it("F4: recurrence — closed-then-recreated same title produces no proposal", async () => {
    const mon = await devDay(D(5));
    const wed = await devDay(D(7));
    await trackerRow(mon.id, { taskKey: "T-1", title: "Code review", state: "done", createdAt: T(5), completedAt: T(5, "T17:00:00.000Z"), updatedAt: T(5, "T17:00:00.000Z") });
    await trackerRow(wed.id, { taskKey: "T-2", title: "Code review", state: "planned", createdAt: T(7) });

    const report = await service.plan("default");
    expect(report.autoMerges).toHaveLength(0);
    expect(report.ambiguous).toHaveLength(0);
    expect(report.splits).toHaveLength(0);
    await service.apply("default", decisionsFrom(report));
    expect((await allTasks()).map((r) => r.taskKey).sort()).toEqual(["T-1", "T-2"]);
  });

  it("F5: S1 same-day duplicate — split moves a fresh key plus assigned events", async () => {
    const mon = await devDay(D(5));
    const first = await trackerRow(mon.id, { taskKey: "T-1", title: "Review A", position: 0, createdAt: T(5) });
    const dup = await trackerRow(mon.id, { taskKey: "T-1", title: "Review A", position: 1, createdAt: T(5, "T09:30:00.000Z") });
    const e1 = await ev("T-1", { type: "update", body: "progress on first", occurredAt: T(5, "T10:00:00.000Z") });
    const e2 = await ev("T-1", { type: "update", body: "progress on dup", occurredAt: T(5, "T11:00:00.000Z") });

    const report = await service.plan("default");
    expect(report.splits).toHaveLength(1);
    expect(report.splits[0]).toMatchObject({ code: "S1", key: "T-1", moveRowIds: [dup.id], oneKeyPerRow: true });

    const apply = await service.apply("default", decisionsFrom(report, [
      { proposalId: report.splits[0]!.proposalId, action: "split", eventAssignments: { [e2.id]: `row:${dup.id}` } },
    ]));
    expect(apply.applied).toBe(true);
    const rows = await allTasks();
    expect(rows).toHaveLength(2);
    const newKey = rows.find((r) => r.taskKey !== "T-1")!.taskKey;
    expect(Number(newKey.slice(2))).toBeGreaterThanOrEqual(100);
    const movedRow = (await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.id, dup.id)))[0]!;
    expect(movedRow.taskKey).toBe(newKey);
    const kept = (await db.select().from(taskEvents).where(eq(taskEvents.id, e1.id)))[0]!;
    const moved = (await db.select().from(taskEvents).where(eq(taskEvents.id, e2.id)))[0]!;
    expect(kept.taskKey).toBe("T-1");
    expect(moved.taskKey).toBe(newKey);
    const focusRows = await db.select().from(dayFocus);
    expect(focusRows).toHaveLength(2);
    void first;
  });

  it("F6: manual re-add, notes both null — A1 ambiguous; apply refuses without a decision", async () => {
    const mon = await devDay(D(5));
    const wed = await devDay(D(7));
    await trackerRow(mon.id, { taskKey: "T-1", title: "Write docs", state: "planned", note: null, createdAt: T(5) });
    await trackerRow(wed.id, { taskKey: "T-2", title: "Write docs", state: "planned", note: null, createdAt: T(7) });

    const report = await service.plan("default");
    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0]!.codes[0]).toBe("A1");
    expect(report.ambiguous[0]!.default).toBe("keep");

    await expect(service.apply("default", { inputHash: report.inputHash, decisions: [] })).rejects.toThrow(/Undecided/);
    await service.apply("default", decisionsFrom(report));
    expect(await allTasks()).toHaveLength(2); // kept separate
  });

  it("F7: desk lineage + tracker mirror on non-canonical row → one task with canonical/lineage/mirror roles", async () => {
    const day1 = await deskDay(D(5));
    const a = await deskRow(day1.id, { title: "Chain", status: "inbox", createdAt: T(5) });
    const b = await deskRow(day1.id, { title: "Chain", status: "planned", sourceItemId: a.id, createdAt: T(6) });
    const c = await deskRow(day1.id, { title: "Chain", status: "planned", sourceItemId: b.id, taskKey: "T-9", createdAt: T(7) });
    const dd = await devDay(D(7));
    const mirror = await trackerRow(dd.id, { taskKey: "T-9", title: "Chain", managerDeskItemId: b.id, state: "planned", createdAt: T(7) });

    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const rows = await allTasks();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskKey).toBe("T-9");
    const map = await db.select().from(taskLegacyMap);
    const roles = new Map(map.map((m) => [`${m.sourceTable}:${m.sourceId}`, m.role]));
    expect(roles.get(`manager_desk_items:${c.id}`)).toBe("canonical");
    expect(roles.get(`manager_desk_items:${a.id}`)).toBe("lineage");
    expect(roles.get(`manager_desk_items:${b.id}`)).toBe("lineage");
    expect(roles.get(`team_tracker_items:${mirror.id}`)).toBe("mirror");
  });

  it("F8: delegated status matrix M1–M5/M7 and M6 abort", async () => {
    const dd = await devDay(D(5));
    const day = await deskDay(D(5));
    const mk = async (key: string, deskStatus: string, trackerState: string, extra: Partial<DeskSeed> = {}) => {
      const item = await deskRow(day.id, { taskKey: key, status: deskStatus, assignee: "dev-1", createdAt: T(5), ...extra });
      await trackerRow(dd.id, { taskKey: key, title: item.title, managerDeskItemId: item.id, state: trackerState, createdAt: T(5) });
      return item;
    };
    await mk("T-1", "planned", "planned");       // M1 → open
    await mk("T-2", "planned", "in_progress");   // M2 → active
    await mk("T-3", "planned", "done", { completedAt: T(6) }); // M3 → done (desk open + exec done)
    await mk("T-4", "planned", "dropped");       // M4 → dropped
    await mk("T-5", "done", "in_progress", { completedAt: T(6) }); // M5 → done
    await mk("T-7", "cancelled", "dropped");     // M7 → dropped

    const report = await service.plan("default");
    expect(report.findings.deskOpenExecutionDone).toEqual(["T-3"]);
    await service.apply("default", decisionsFrom(report));
    const byKey = new Map((await allTasks()).map((r) => [r.taskKey, r]));
    expect(byKey.get("T-1")!.status).toBe("open");
    expect(byKey.get("T-2")!.status).toBe("active");
    expect(byKey.get("T-3")!.status).toBe("done");
    expect(byKey.get("T-4")!.status).toBe("dropped");
    expect(byKey.get("T-5")!.status).toBe("done");
    expect(byKey.get("T-7")!.status).toBe("dropped");
    for (const task of byKey.values()) {
      expect(task.ownerType).toBe("developer");
      expect(task.ownerId).toBe("dev-1");
      expect(task.trackedByManagerId).toBe("mgr-1");
    }
  });

  it("F8b: M6 backlog-with-mirror aborts apply", async () => {
    const dd = await devDay(D(5));
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", status: "backlog", assignee: "dev-1", createdAt: T(5) });
    await trackerRow(dd.id, { taskKey: "T-1", title: item.title, managerDeskItemId: item.id, state: "planned", createdAt: T(5) });
    const report = await service.plan("default");
    expect(report.findings.m6Violations).toEqual([expect.objectContaining({ key: "T-1" })]);
    await expect(service.apply("default", decisionsFrom(report))).rejects.toThrow(/M6/);
    expect(await allTasks()).toHaveLength(0);
  });

  it("F9: closed delegated desk item with deleted mirror → owner from assignee, done", async () => {
    const day = await deskDay(D(5));
    await deskRow(day.id, { taskKey: "T-1", status: "done", assignee: "dev-1", createdAt: T(3), completedAt: T(5) });
    const report = await service.plan("default");
    expect(report.findings.ownerFromAssigneeOnly).toEqual(["T-1"]);
    await service.apply("default", decisionsFrom(report));
    const [task] = await allTasks();
    expect(task).toMatchObject({ status: "done", ownerType: "developer", ownerId: "dev-1", trackedByManagerId: "mgr-1" });
  });

  it("F10: desk history → synthesized events; deleted item → deleted task", async () => {
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", status: "planned", createdAt: T(5) });
    await db.insert(managerDeskLinks).values({ workspaceId: "default", itemId: item.id, linkType: "issue", issueKey: "ABC-1", createdAt: T(6) });
    const snap0 = { id: item.id, taskKey: "T-1", title: "Desk item", kind: "action", category: "other", status: "inbox", priority: "medium", links: [], createdAt: T(5), updatedAt: T(5) };
    const snap1 = { ...snap0, status: "planned", followUpAt: "2026-01-20", links: [{ linkType: "issue", issueKey: "ABC-1" }], updatedAt: T(6) };
    await hist(item.id, snap0, T(5));
    await hist(item.id, snap1, T(6));

    const deleted = await deskRow(day.id, { title: "Gone", status: "planned", createdAt: T(4) });
    const goneSnap = { id: deleted.id, title: "Gone", kind: "action", category: "other", status: "planned", priority: "medium", links: [], createdAt: T(4), updatedAt: T(4) };
    const goneId = deleted.id;
    await db.delete(managerDeskItems).where(eq(managerDeskItems.id, goneId)); // simulate deletion
    await hist(goneId, goneSnap, T(4));
    await hist(goneId, {}, T(8), "deleted");

    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));

    const histRows = (await db.select().from(managerDeskItemHistory)).filter((r) => r.itemId === item.id);
    const [h1, h2] = histRows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const rows = await db.select().from(taskEvents);
    const t1 = rows.filter((r) => r.taskKey === "T-1");
    expect(t1.map((r) => `${r.type}:${r.dedupeKey}`).sort()).toEqual([
      `created:p2:dh:${h1!.id}:created`,
      `link:p2:dh:${h2!.id}:link:jira:ABC-1`,
      `schedule:p2:dh:${h2!.id}:followUpAt`,
      `status:p2:dh:${h2!.id}:status`,
    ]);
    const followUpEvent = t1.find((r) => r.type === "schedule" && r.metaJson?.includes("follow_up_at"));
    expect(followUpEvent?.visibility).toBe("private");
    const link = await db.select().from(taskLinks);
    expect(link).toEqual([expect.objectContaining({ kind: "jira", ref: "ABC-1" })]);

    const all = await allTasks();
    const tomb = all.find((r) => r.title === "Gone");
    expect(tomb).toBeDefined();
    expect(tomb!.deletedAt).toBe(T(8));
  });

  it("F11: events on a key with no rows → tombstone task, all events repointed", async () => {
    await ev("T-77", { type: "created", body: null, meta: { title: "Lost task" }, occurredAt: T(3) });
    await ev("T-77", { type: "update", body: "progress", occurredAt: T(4) });
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const [task] = await allTasks();
    expect(task).toMatchObject({ taskKey: "T-77", title: "Lost task", status: "dropped" });
    expect(task.deletedAt).not.toBeNull();
    const rows = await db.select().from(taskEvents);
    expect(rows.every((r) => r.taskId === task.id)).toBe(true);
  });

  it("F12: two devs each with two in_progress rows → B4 demotions + events", async () => {
    const d1a = await devDay(D(5), "dev-1");
    const d1b = await devDay(D(6), "dev-1");
    const d2a = await devDay(D(5), "dev-2");
    const d2b = await devDay(D(6), "dev-2");
    await trackerRow(d1a.id, { taskKey: "T-1", title: "A", state: "in_progress", createdAt: T(5) });
    await trackerRow(d1b.id, { taskKey: "T-2", title: "B", state: "in_progress", createdAt: T(6), updatedAt: T(6, "T10:00:00.000Z") });
    await trackerRow(d2a.id, { taskKey: "T-3", title: "C", state: "in_progress", createdAt: T(5) });
    await trackerRow(d2b.id, { taskKey: "T-4", title: "D", state: "in_progress", createdAt: T(6), updatedAt: T(6, "T10:00:00.000Z") });
    await ev("T-2", { type: "focus", meta: { action: "set_current", date: D(6) }, occurredAt: T(6, "T10:00:00.000Z") });

    const report = await service.plan("default");
    expect(report.findings.multiActiveDemotions).toHaveLength(2);
    await service.apply("default", decisionsFrom(report));
    const byKey = new Map((await allTasks()).map((r) => [r.taskKey, r.status]));
    expect(byKey.get("T-2")).toBe("active"); // focus event wins for dev-1
    expect(byKey.get("T-1")).toBe("open");
    expect(byKey.get("T-4")).toBe("active"); // latest updatedAt wins for dev-2
    expect(byKey.get("T-3")).toBe("open");
    const demotions = (await db.select().from(taskEvents)).filter((r) => r.metaJson?.includes("single_current"));
    expect(demotions).toHaveLength(2);
    expect(demotions.every((r) => r.metaJson?.includes('"domain":"task_status"'))).toBe(true);
  });

  it("F13: note refs + follow-ups repointed; note_ref event written once; idempotent", async () => {
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", status: "planned", createdAt: T(5), followUpAt: D(10) });
    const note = (await db.insert(dailyNotes).values({ workspaceId: "default", managerAccountId: "mgr-1", date: D(5), body: "note", createdAt: T(5), updatedAt: T(5) }).returning())[0]!;
    await db.insert(dailyNoteTaskRefs).values({ workspaceId: "default", managerAccountId: "mgr-1", noteId: note.id, taskKey: "T-1", relation: "mentioned", createdAt: T(5) });
    await db.insert(dailyNoteFollowUps).values({ workspaceId: "default", managerAccountId: "mgr-1", noteId: note.id, itemId: item.id, requestId: "r1", payloadHash: "h1", createdAt: T(5) });

    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const task = (await allTasks()).find((r) => r.taskKey === "T-1")!;
    const refs = await db.select().from(dailyNoteTaskRefs);
    expect(refs[0]!.taskId).toBe(task.id);
    const fu = await db.select().from(dailyNoteFollowUps);
    expect(fu[0]!.taskId).toBe(task.id);
    const noteRefs = (await db.select().from(taskEvents)).filter((r) => r.type === "note_ref");
    expect(noteRefs).toHaveLength(1);
    expect(noteRefs[0]!.visibility).toBe("private");

    // idempotent re-run
    await service.apply("default", decisionsFrom(report), { resume: true });
    expect((await db.select().from(taskEvents)).filter((r) => r.type === "note_ref")).toHaveLength(1);
  });

  it("fails structural verification for unresolved references", async () => {
    const note = (await db.insert(dailyNotes).values({ workspaceId: "default", managerAccountId: "mgr-1", date: D(5), body: "Reference", createdAt: T(5), updatedAt: T(5) }).returning())[0]!;
    await db.insert(dailyNoteTaskRefs).values({ workspaceId: "default", managerAccountId: "mgr-1", noteId: note.id, taskKey: "T-999", relation: "mentioned", createdAt: T(5) });
    expect(await service.verifyStructure("default")).toMatchObject({ ok: false, unfilledRefs: { noteTask: 1 } });
  });

  it("rollback excludes deleted tasks and preserves live IDs and note follow-ups", async () => {
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", title: "Live", createdAt: T(5) });
    const deleted = await deskRow(day.id, { taskKey: "T-2", title: "Deleted", createdAt: T(5) });
    const note = (await db.insert(dailyNotes).values({ workspaceId: "default", managerAccountId: "mgr-1", date: D(5), body: "Note", createdAt: T(5), updatedAt: T(5) }).returning())[0]!;
    await db.insert(dailyNoteFollowUps).values({ workspaceId: "default", managerAccountId: "mgr-1", noteId: note.id, itemId: item.id, requestId: "rollback", payloadHash: "hash", createdAt: T(5) });
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    await db.update(tasks).set({ deletedAt: T(6) }).where(eq(tasks.taskKey, "T-2"));
    await exporter.apply("default");
    expect(await db.select().from(managerDeskItems)).toEqual([expect.objectContaining({ id: item.id, taskKey: "T-1" })]);
    expect((await db.select().from(dailyNoteFollowUps))[0]?.itemId).toBe(item.id);
    expect(await db.select().from(managerDeskItems).where(eq(managerDeskItems.id, deleted.id))).toEqual([]);
  });

  it("F14: manager_notes dedupe into developer_notes dated sections", async () => {
    for (const [i, date] of [D(5), D(6), D(7), D(8), D(9)].entries()) {
      const day = await devDay(date);
      const body = i < 2 ? "Good progress" : "Needs help";
      await db.update(teamTrackerDays).set({ managerNotes: body }).where(eq(teamTrackerDays.id, day.id));
    }
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const rows = await db.select().from(developerNotes);
    expect(rows).toHaveLength(1);
    const parsed = parseTaskNotes(rows[0]!.body);
    expect(parsed.datedSections).toEqual([
      { date: D(5), body: "Good progress" },
      { date: D(7), body: "Needs help" },
    ]);
  });

  it("F15: re-apply after success keeps identical counts, no duplicate events", async () => {
    const day = await devDay(D(5));
    await trackerRow(day.id, { taskKey: "T-1", title: "Solo", state: "done", createdAt: T(5), completedAt: T(5), updatedAt: T(5) });
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const counts1 = {
      tasks: (await allTasks()).length,
      events: (await db.select().from(taskEvents)).length,
      links: (await db.select().from(taskLinks)).length,
      focus: (await db.select().from(dayFocus)).length,
    };
    await service.apply("default", decisionsFrom(report), { resume: true });
    const counts2 = {
      tasks: (await allTasks()).length,
      events: (await db.select().from(taskEvents)).length,
      links: (await db.select().from(taskLinks)).length,
      focus: (await db.select().from(dayFocus)).length,
    };
    expect(counts2).toEqual(counts1);
  });

  it("F16: input-hash drift between dry-run and apply → refusal", async () => {
    const day = await devDay(D(5));
    const row = await trackerRow(day.id, { taskKey: "T-1", title: "Drift", createdAt: T(5) });
    const report = await service.plan("default");
    await db.update(teamTrackerItems).set({ title: "Changed", updatedAt: T(5, "T12:00:00.000Z") }).where(eq(teamTrackerItems.id, row.id));
    await expect(service.apply("default", decisionsFrom(report))).rejects.toThrow(/inputHash|fingerprint/i);
    expect(await allTasks()).toHaveLength(0);
  });

  it("F17: multi-workspace isolation — same T-1 key in both workspaces", async () => {
    const now = T(1);
    await db.insert(workspaces).values({ id: "other", name: "Other", createdAt: now, updatedAt: now });
    await db.insert(developers).values({ workspaceId: "other", accountId: "dev-9", displayName: "Nine", isActive: 1 });
    await db.insert(dataMigrations).values([
      { name: "p1_assign_task_keys:other", appliedAt: P1_AT },
      { name: "p1_import_task_notes:other", appliedAt: P1_AT },
    ]);
    await db.insert(taskKeySequences).values({ workspaceId: "other", nextValue: 100 });
    const d1 = await devDay(D(5));
    await trackerRow(d1.id, { taskKey: "T-1", title: "Default task", createdAt: T(5) });
    const d2 = await devDay(D(5), "dev-9", "other");
    await trackerRow(d2.id, { taskKey: "T-1", title: "Other task", createdAt: T(5), workspaceId: "other" });

    const r1 = await service.plan("default");
    await service.apply("default", decisionsFrom(r1));
    const r2 = await service.plan("other");
    await service.apply("other", decisionsFrom(r2));

    const def = await db.select().from(tasks).where(eq(tasks.workspaceId, "default"));
    const oth = await db.select().from(tasks).where(eq(tasks.workspaceId, "other"));
    expect(def.map((r) => r.taskKey)).toEqual(["T-1"]);
    expect(oth.map((r) => r.taskKey)).toEqual(["T-1"]);
    expect(oth[0]!.title).toBe("Other task");
    const defEvents = await db.select().from(taskEvents).where(eq(taskEvents.workspaceId, "default"));
    expect(defEvents.every((e) => e.taskId === def[0]!.id)).toBe(true);
  });

  it("requires clean parity, freezes legacy writes, and rolls back canonical writes", async () => {
    const cutover = new TaskCutoverService();
    await expect(cutover.cutover("default", true)).rejects.toThrow(/verifications/);
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    await cutover.verify("default");
    await cutover.verify("default");
    expect((await cutover.cutover("default")).applied).toBe(false);
    await cutover.cutover("default", true);
    await expect(service.apply("default", decisionsFrom(report), { resume: true })).rejects.toThrow(/after write cutover/);
    const tracker = new TeamTrackerService();
    const item = await tracker.addItem("dev-1", taskService.today(), { title: "Post-cutover", actor: { type: "manager", accountId: "mgr-1" } });
    await tracker.setCurrentItem(item.id, undefined, "default", { type: "manager", accountId: "mgr-1" });
    const myDay = new MyDayService(tracker);
    expect((await myDay.getMyDay("dev-1", taskService.today())).currentItem).toMatchObject({ taskKey: item.taskKey, canonicalTask: true });
    await myDay.addCheckIn("dev-1", taskService.today(), { summary: "Progress", taskKeys: [item.taskKey!] });
    const notes = new DailyNotesService();
    await notes.save("mgr-1", taskService.today(), { body: "Follow up", revision: 0 }, "default");
    const followUpInput = { date: taskService.today(), title: "After cutover", requestId: crypto.randomUUID() };
    const followUp = await notes.createFollowUp("mgr-1", taskService.today(), followUpInput, "default");
    const day = await devDay(D(5));
    await expect(trackerRow(day.id, { taskKey: "T-900", title: "Forbidden", createdAt: T(5) })).rejects.toThrow(/read-only/);
    await exporter.apply("default");
    expect((await db.select().from(teamTrackerItems))[0]).toMatchObject({ taskKey: item.taskKey, state: "in_progress" });
    expect(await notes.createFollowUp("mgr-1", taskService.today(), followUpInput, "default")).toMatchObject({ itemId: followUp.itemId });
    expect((await notes.getSources("mgr-1", [followUp.itemId], "default")).sources).toHaveLength(1);
  });

  it("detects snapshot changes even when counts and timestamps are unchanged", async () => {
    const day = await devDay(D(5));
    const row = await trackerRow(day.id, { taskKey: "T-901", title: "Original", createdAt: T(5) });
    const before = await service.computeInputHash("default");
    await db.update(teamTrackerItems).set({ title: "Edited without timestamp" }).where(eq(teamTrackerItems.id, row.id));
    expect(await service.computeInputHash("default")).not.toBe(before);
  });

  it("F18: export-legacy round-trip preserves title/state/owner/key", async () => {
    const dd = await devDay(D(5));
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", title: "Delegated work", status: "planned", assignee: "dev-1", createdAt: T(5) });
    await trackerRow(dd.id, { taskKey: "T-1", title: "Delegated work", managerDeskItemId: item.id, state: "in_progress", createdAt: T(5) });
    await trackerRow(dd.id, { taskKey: "T-2", title: "Dev task", state: "done", createdAt: T(5), completedAt: T(6), updatedAt: T(6) });
    const original = [
      { key: "T-1", title: "Delegated work", state: "in_progress", owner: "dev-1" },
      { key: "T-2", title: "Dev task", state: "done", owner: "dev-1" },
    ];

    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const result = await exporter.apply("default");
    expect(result.trackerRows).toBe(2);
    expect(result.deskRows).toBe(1);

    const regen = await db.select().from(teamTrackerItems);
    const regenDays = await db.select().from(teamTrackerDays);
    const projected = regen.map((row) => ({
      key: row.taskKey,
      title: row.title,
      state: row.state,
      owner: regenDays.find((d) => d.id === row.dayId)?.developerAccountId,
    })).sort((a, b) => a.key!.localeCompare(b.key!));
    expect(projected).toEqual(original);
    const deskRows = await db.select().from(managerDeskItems);
    expect(deskRows).toHaveLength(1);
    expect(deskRows[0]).toMatchObject({ taskKey: "T-1", title: "Delegated work", status: "in_progress" });
  });

  it("desk-only backlog/waiting map to later/blocked; verify passes after apply", async () => {
    const day = await deskDay(D(5));
    await deskRow(day.id, { taskKey: "T-1", title: "Someday", status: "backlog", createdAt: T(5) });
    await deskRow(day.id, { taskKey: "T-2", title: "Waiting on review", status: "waiting", followUpAt: D(10), createdAt: T(5) });
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));
    const byKey = new Map((await allTasks()).map((r) => [r.taskKey, r]));
    expect(byKey.get("T-1")).toMatchObject({ status: "open", later: 1, ownerType: "manager" });
    expect(byKey.get("T-2")).toMatchObject({ status: "blocked", followUpAt: D(10) });
    const blocker = (await db.select().from(taskEvents)).find((r) => r.type === "blocker");
    expect(blocker).toBeDefined();
    expect(blocker!.visibility).toBe("shared");

    const verify = await service.verify("default");
    expect(verify.ok).toBe(true);
    expect(verify.unrepointedEvents).toBe(0);
    expect(verify.missingLegacyMap).toEqual([]);
  });

  it("plan is a pure dry-run: no writes to canonical tables", async () => {
    const day = await devDay(D(5));
    await trackerRow(day.id, { taskKey: "T-1", title: "X", createdAt: T(5) });
    await service.plan("default");
    expect(await allTasks()).toHaveLength(0);
    expect(await db.select().from(taskLegacyMap)).toHaveLength(0);
    expect(await db.select().from(taskKeyAliases)).toHaveLength(0);
    expect(await db.select().from(taskEvents)).toHaveLength(0);
    expect(await db.select().from(dataMigrations).where(eq(dataMigrations.name, "p2_backfill"))).toHaveLength(0);
  });

  it("preflight refuses when Phase 1 markers or keys are missing", async () => {
    await db.delete(dataMigrations);
    const day = await devDay(D(5));
    await trackerRow(day.id, { taskKey: "T-1", title: "X", createdAt: T(5) });
    const report = await service.plan("default");
    await expect(service.apply("default", decisionsFrom(report))).rejects.toThrow(/Phase 1 migration/);
  });

  it("TaskService shadow projections match after apply", async () => {
    const day = await deskDay(D(5));
    const item = await deskRow(day.id, { taskKey: "T-1", title: "Delegated", status: "planned", assignee: "dev-1", createdAt: T(5) });
    const dd = await devDay(D(5));
    await trackerRow(dd.id, { taskKey: "T-1", title: "Delegated", managerDeskItemId: item.id, state: "in_progress", createdAt: T(5) });
    const report = await service.plan("default");
    await service.apply("default", decisionsFrom(report));

    const task = await taskService.getByKey("T-1", "default");
    expect(task).toMatchObject({ taskKey: "T-1", status: "active", ownerType: "developer", ownerId: "dev-1" });
    const resolvedId = await taskService.resolveLegacyId("team_tracker_items", (await db.select().from(teamTrackerItems))[0]!.id, 1_000_000);
    expect(resolvedId).toBe(task!.id);
    expect(task!.id).toBeGreaterThan(item.id);
  });
});
