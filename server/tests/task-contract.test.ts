import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import {
  configTable,
  dataMigrations,
  developers,
  managerDeskDays,
  managerDeskItems,
  taskEvents,
  taskKeySequences,
  taskLegacyMap,
  tasks,
  teamTrackerDays,
  teamTrackerItems,
} from "../src/db/schema";
import { TaskContractService, LEGACY_ARCHIVE_TABLES, LEGACY_GUARD_TRIGGERS } from "../src/services/task-contract.service";
import { TaskCutoverService } from "../src/services/task-cutover.service";
import { TaskPhase2ExportService } from "../src/services/task-phase2-export.service";

const contract = new TaskContractService();
const cutover = new TaskCutoverService();
const exporter = new TaskPhase2ExportService();

const NOW = Date.now();
const DAYS_AGO = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const tableExists = (name: string) =>
  Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const triggerExists = (name: string) =>
  Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name));
const configGet = (key: string) =>
  rawDb.prepare("SELECT value FROM config WHERE workspace_id='default' AND key=?").get(key) as { value: string } | undefined;

async function setStage(value: string) {
  await db.insert(configTable).values({ workspaceId: "default", key: "tasks_phase2_stage", value })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev One", isActive: 1 });
  await db.insert(dataMigrations).values([
    { name: "p1_assign_task_keys", appliedAt: DAYS_AGO(60) },
    { name: "p1_import_task_notes", appliedAt: DAYS_AGO(60) },
    { name: "p2_backfill", appliedAt: DAYS_AGO(30) },
  ]);
  await db.insert(taskKeySequences).values({ workspaceId: "default", nextValue: 100 });
});

afterAll(async () => {
  await resetDatabase();
});

/** Minimal canonical fixture: one task, its legacy map row, one repointed event. */
async function seedCanonical() {
  const day = await db.insert(teamTrackerDays).values({
    workspaceId: "default", date: "2026-01-10", developerAccountId: "dev-1",
    createdAt: "2026-01-10T07:00:00.000Z", updatedAt: "2026-01-10T07:00:00.000Z",
  }).returning();
  const item = await db.insert(teamTrackerItems).values({
    workspaceId: "default", dayId: day[0]!.id, taskKey: "T-1", itemType: "custom",
    title: "Task one", state: "in_progress", position: 0,
    createdAt: "2026-01-10T08:00:00.000Z", updatedAt: "2026-01-10T08:00:00.000Z",
  }).returning();
  const task = await db.insert(tasks).values({
    workspaceId: "default", taskKey: "T-1", title: "Task one", kind: "task",
    status: "active", ownerType: "developer", ownerId: "dev-1",
    createdAt: "2026-01-10T08:00:00.000Z", updatedAt: "2026-01-10T08:00:00.000Z",
  }).returning();
  await db.insert(taskLegacyMap).values({
    workspaceId: "default", taskId: task[0]!.id,
    sourceTable: "team_tracker_items", sourceId: item[0]!.id, role: "canonical",
  });
  await db.insert(taskEvents).values({
    workspaceId: "default", taskKey: "T-1", taskId: task[0]!.id, type: "created",
    visibility: "shared", authorType: "system", occurredAt: "2026-01-10T08:00:00.000Z", createdAt: "2026-01-10T08:00:00.000Z",
  });
  return { task: task[0]!, item: item[0]! };
}

async function seedStage2c(soakDays = 15) {
  await setStage("2c");
  await db.insert(configTable).values([
    { workspaceId: "default", key: "tasks_phase1_enabled", value: "true" },
    { workspaceId: "default", key: "tasks_phase2_cutover_at", value: DAYS_AGO(22) },
    { workspaceId: "default", key: "tasks_phase2c_started_at", value: DAYS_AGO(21) },
    { workspaceId: "default", key: "tasks_phase2c_completed_at", value: DAYS_AGO(soakDays) },
  ]).onConflictDoNothing();
}

describe("Phase 2d contract gates", () => {
  it("plan refuses when the workspace is not at stage 2c", async () => {
    await seedCanonical();
    const plan = await contract.plan("default");
    expect(plan.ok).toBe(false);
    expect(plan.checks.find((c) => c.name === "stage")?.ok).toBe(false);
  });

  it("plan refuses while 2c completion is unmarked", async () => {
    await seedCanonical();
    await setStage("2c");
    const plan = await contract.plan("default");
    expect(plan.ok).toBe(false);
    expect(plan.checks.find((c) => c.name === "2c_completion")?.ok).toBe(false);
  });

  it("plan refuses inside the two-week post-2c soak", async () => {
    await seedCanonical();
    await seedStage2c(5);
    const plan = await contract.plan("default");
    expect(plan.ok).toBe(false);
    const soak = plan.checks.find((c) => c.name === "2c_soak");
    expect(soak?.ok).toBe(false);
    expect(soak?.detail).toContain("5d");
  });

  it("plan refuses when compatibility-adapter callers remain in the source tree", async () => {
    await seedCanonical();
    await seedStage2c();
    const dir = path.join(tmpdir(), `contract-scan-${process.pid}`);
    try {
      mkdirSync(path.join(dir, "services"), { recursive: true });
      mkdirSync(path.join(dir, "routes"), { recursive: true });
      writeFileSync(path.join(dir, "services", "stale.ts"), 'import { X } from "./task-compatibility.service";\n');
      const plan = await contract.plan("default", { serverSrcDir: dir });
      expect(plan.checks.find((c) => c.name === "adapter_callers")?.ok).toBe(false);
      expect(plan.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plan refuses when a route still reads legacy task tables directly", async () => {
    await seedCanonical();
    await seedStage2c();
    const dir = path.join(tmpdir(), `contract-scan-${process.pid}`);
    try {
      mkdirSync(path.join(dir, "routes"), { recursive: true });
      writeFileSync(path.join(dir, "routes", "stale.ts"), 'import { managerDeskItems } from "../db/schema";\n');
      const plan = await contract.plan("default", { serverSrcDir: dir });
      expect(plan.checks.find((c) => c.name === "legacy_consumers")?.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plan refuses on structural violations (unmapped legacy row)", async () => {
    await seedCanonical();
    await seedStage2c();
    // A desk row with no task_legacy_map entry violates the structure gate.
    const day = await db.insert(managerDeskDays).values({
      workspaceId: "default", date: "2026-01-11", managerAccountId: "mgr-1",
      createdAt: "2026-01-11T07:00:00.000Z", updatedAt: "2026-01-11T07:00:00.000Z",
    }).returning();
    await db.insert(managerDeskItems).values({
      workspaceId: "default", dayId: day[0]!.id, taskKey: "T-2", title: "Unmapped",
      kind: "action", category: "other", status: "planned", priority: "medium",
      createdAt: "2026-01-11T08:00:00.000Z", updatedAt: "2026-01-11T08:00:00.000Z",
    });
    const plan = await contract.plan("default");
    expect(plan.checks.find((c) => c.name === "structure")?.ok).toBe(false);
    expect(plan.ok).toBe(false);
  });

  it("apply refuses with the failing checks listed", async () => {
    await seedCanonical();
    await expect(contract.apply("default")).rejects.toThrow(/prerequisites failed/);
  });
});

describe("Phase 2d contract apply", () => {
  it("renames legacy tables, drops guards, marks 2d and p2_contract", async () => {
    await seedCanonical();
    await seedStage2c();
    rawDb.exec(`CREATE TRIGGER legacy_ro_team_tracker_items_insert BEFORE INSERT ON team_tracker_items
      BEGIN SELECT RAISE(ABORT, 'frozen'); END`);

    const result = await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    expect(result.applied).toBe(true);
    for (const [from, to] of LEGACY_ARCHIVE_TABLES) {
      expect(tableExists(from)).toBe(false);
      expect(tableExists(to)).toBe(true);
    }
    for (const name of LEGACY_GUARD_TRIGGERS) {
      expect(triggerExists(name)).toBe(false);
    }
    expect(rawDb.prepare("SELECT 1 FROM data_migrations WHERE name='p2_contract'").get()).toBeTruthy();
    expect(configGet("tasks_phase2_stage")?.value).toBe("2d");
    expect(configGet("tasks_phase2_contracted_at")?.value).toBeTruthy();
    // Archived rows survive.
    expect((rawDb.prepare("SELECT COUNT(*) AS c FROM legacy_team_tracker_items").get() as { c: number }).c).toBe(1);
  });

  it("contracts task_events.task_id to NOT NULL after apply", async () => {
    await seedCanonical();
    await seedStage2c();
    const result = await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    expect(result.taskEventsContracted).toBe(true);
    const cols = rawDb.prepare("PRAGMA table_info(task_events)").all() as { name: string; notnull: number }[];
    expect(cols.find((c) => c.name === "task_id")?.notnull).toBe(1);
  });

  it("is idempotent: a second apply reports already applied", async () => {
    await seedCanonical();
    await seedStage2c();
    await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    const second = await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    expect(second.applied).toBe(false);
  });

  it("migrate() stays safe with archived tables and does not recreate them", async () => {
    await seedCanonical();
    await seedStage2c();
    await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    migrate(rawDb);
    migrate(rawDb);
    expect(tableExists("team_tracker_items")).toBe(false);
    expect(tableExists("legacy_team_tracker_items")).toBe(true);
    expect((rawDb.prepare("SELECT COUNT(*) AS c FROM legacy_team_tracker_items").get() as { c: number }).c).toBe(1);
  });

  it("rollback is refused at stage 2d", async () => {
    await seedCanonical();
    await seedStage2c();
    await contract.apply("default", { serverSrcDir: path.resolve(__dirname, "../src") });
    await expect(exporter.apply("default")).rejects.toThrow(/forward fix/i);
  });
});

describe("stage transitions", () => {
  it("advanceTo2c requires the one-week post-2b soak", async () => {
    await setStage("2b");
    await db.insert(configTable).values({ workspaceId: "default", key: "tasks_phase2_cutover_at", value: DAYS_AGO(3) }).onConflictDoNothing();
    await expect(cutover.advanceTo2c("default", true)).rejects.toThrow(/soak/i);
    await db.insert(configTable).values({ workspaceId: "default", key: "tasks_phase2_cutover_at", value: DAYS_AGO(8) })
      .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: DAYS_AGO(8) } });
    const result = await cutover.advanceTo2c("default", true);
    expect(result.applied).toBe(true);
    expect(configGet("tasks_phase2_stage")?.value).toBe("2c");
  });

  it("complete2c records the completion timestamp once", async () => {
    await setStage("2c");
    const first = await cutover.complete2c("default", true);
    expect(first.applied).toBe(true);
    expect(configGet("tasks_phase2c_completed_at")?.value).toBeTruthy();
    const second = await cutover.complete2c("default", true);
    expect(second.applied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
  });

  it("unconditional cutover guards block writes and rollback drops them", async () => {
    const { item } = await seedCanonical();
    await setStage("2b");
    // Reproduce the §2.1.3 unconditional trigger the cutover creates.
    rawDb.exec(`CREATE TRIGGER legacy_ro_team_tracker_items_insert BEFORE INSERT ON team_tracker_items
      BEGIN SELECT RAISE(ABORT, 'Legacy task tables are read-only after task cutover'); END`);
    expect(() =>
      rawDb.prepare("INSERT INTO team_tracker_items (workspace_id, day_id, item_type, title, state, position, created_at, updated_at) VALUES ('default', ?, 'custom', 'x', 'planned', 0, '2026-01-12', '2026-01-12')").run(item.dayId)
    ).toThrow(/read-only/);
    await exporter.apply("default");
    expect(triggerExists("legacy_ro_team_tracker_items_insert")).toBe(false);
    expect(configGet("tasks_phase2_stage")?.value).toBe("rolled_back");
    // Legacy writes work again after the guard is dropped.
    expect(() =>
      rawDb.prepare("INSERT INTO team_tracker_items (workspace_id, day_id, item_type, title, state, position, created_at, updated_at) VALUES ('default', ?, 'custom', 'x', 'planned', 0, '2026-01-12', '2026-01-12')").run(item.dayId)
    ).not.toThrow();
  });
});
