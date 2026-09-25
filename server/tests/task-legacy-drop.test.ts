import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { configTable, dataMigrations, tasks } from "../src/db/schema";
import {
  LEGACY_DROP_TABLES,
  TaskLegacyDropService,
} from "../src/services/task-legacy-drop.service";

const DAYS_AGO = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const tableExists = (name: string) =>
  Boolean(rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

async function markContracted(contractedDaysAgo = 45, workspaceId = "default") {
  const now = new Date().toISOString();
  await db.insert(configTable).values([
    { workspaceId, key: "tasks_phase2_stage", value: "2d" },
    { workspaceId, key: "tasks_phase2_contracted_at", value: DAYS_AGO(contractedDaysAgo) },
  ]);
  await db.insert(dataMigrations).values({ name: "p2_contract", appliedAt: DAYS_AGO(contractedDaysAgo) ?? now }).onConflictDoNothing();
}

/**
 * Simulate the post-`tasks:contract` state: the original task tables were
 * renamed to `legacy_*` archives (so the originals are absent) and the
 * `p2_contract` marker plus stage config are in place.
 */
function archiveLegacyTables() {
  for (const name of LEGACY_DROP_TABLES) {
    const original = name.replace(/^legacy_/, "");
    rawDb.exec(`ALTER TABLE ${original} RENAME TO ${name}`);
  }
}

const check = (plan: { checks: { name: string; ok: boolean }[] }, name: string) =>
  plan.checks.find((entry) => entry.name === name);

describe("TaskLegacyDropService (§8.2)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("dry-run reports gates and refuses before stage 2d", async () => {
    const service = new TaskLegacyDropService();
    const plan = await service.plan("default");
    expect(plan.ok).toBe(false);
    expect(plan.workspaceId).toBe("default");
    expect(check(plan, "stage")?.ok).toBe(false);
    expect(check(plan, "contract_marker")?.ok).toBe(false);
    await expect(service.apply("default")).rejects.toThrow(/prerequisites failed/);
    expect(tableExists("legacy_team_tracker_items")).toBe(false);
  });

  it("refuses when p2_contract marker is missing despite stage 2d", async () => {
    await db.insert(configTable).values([
      { workspaceId: "default", key: "tasks_phase2_stage", value: "2d" },
      { workspaceId: "default", key: "tasks_phase2_contracted_at", value: DAYS_AGO(60) },
    ]);
    archiveLegacyTables();
    const plan = await new TaskLegacyDropService().plan("default");
    expect(plan.ok).toBe(false);
    expect(check(plan, "contract_marker")?.ok).toBe(false);
  });

  it("refuses while the 30-day contract soak has not elapsed", async () => {
    await markContracted(10);
    archiveLegacyTables();
    const plan = await new TaskLegacyDropService().plan("default");
    expect(plan.ok).toBe(false);
    expect(check(plan, "contract_soak")?.ok).toBe(false);
    expect(check(plan, "contract_soak")?.ok).toBe(false);
  });

  it("fails when archive tables are missing or partially present", async () => {
    await markContracted();
    // No legacy tables and no p3_legacy_drop marker → inconsistent.
    let plan = await new TaskLegacyDropService().plan("default");
    expect(plan.ok).toBe(false);
    expect(check(plan, "legacy_tables")?.ok).toBe(false);

    // Only one table present → partially inconsistent.
    rawDb.exec("CREATE TABLE legacy_team_tracker_items (id INTEGER PRIMARY KEY)");
    plan = await new TaskLegacyDropService().plan("default");
    expect(plan.ok).toBe(false);
    expect(check(plan, "legacy_tables")?.detail).toMatch(/missing/);
    rawDb.exec("DROP TABLE legacy_team_tracker_items");
  });

  it("applies: backs up, drops the tables, and records p3_legacy_drop", async () => {
    await markContracted();
    archiveLegacyTables();
    const createManualBackup = vi.fn(async () => ({ name: "b.db", path: "/tmp/pre-legacy-drop.db", sizeBytes: 1, createdAt: "", reason: "pre-legacy-drop" }));
    const service = new TaskLegacyDropService({ createManualBackup });

    const result = await service.apply("default");
    expect(result.applied).toBe(true);
    expect(createManualBackup).toHaveBeenCalledWith("pre-legacy-drop");
    expect(result.backup).toBe("/tmp/pre-legacy-drop.db");
    for (const name of LEGACY_DROP_TABLES) expect(tableExists(name)).toBe(false);
    expect(rawDb.prepare("SELECT 1 FROM data_migrations WHERE name='p3_legacy_drop'").get()).toBeTruthy();
    // Canonical tables untouched.
    expect(tableExists("tasks")).toBe(true);
    expect(tableExists("task_events")).toBe(true);
  });

  it("is idempotent — repeat apply reports alreadyApplied", async () => {
    await markContracted();
    archiveLegacyTables();
    const service = new TaskLegacyDropService({ createManualBackup: vi.fn(async () => ({ name: "b", path: "/tmp/b.db", sizeBytes: 1, createdAt: "", reason: "pre-legacy-drop" })) });
    await service.apply("default");
    const second = await service.apply("default");
    expect(second.applied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
  });

  it("startup migrations stay safe after the drop", async () => {
    await markContracted();
    archiveLegacyTables();
    const service = new TaskLegacyDropService({ createManualBackup: vi.fn(async () => ({ name: "b", path: "/tmp/b.db", sizeBytes: 1, createdAt: "", reason: "pre-legacy-drop" })) });
    await service.apply("default");

    expect(() => migrate(rawDb)).not.toThrow();
    for (const name of LEGACY_DROP_TABLES) expect(tableExists(name)).toBe(false);
    // The contract marker still suppresses legacy table re-creation.
    expect(tableExists("team_tracker_items")).toBe(false);
    expect(tableExists("manager_desk_items")).toBe(false);
    expect(tableExists("manager_desk_links")).toBe(false);
    // Canonical task tables still work.
    await expect(db.select().from(tasks).limit(1)).resolves.toBeDefined();
  });

  it("scopes the stage/config gates to the workspace", async () => {
    // workspace_other contracted, default not → default must not pass gates
    // on the strength of another workspace's config rows.
    await markContracted(45, "workspace_other");
    archiveLegacyTables();
    const plan = await new TaskLegacyDropService().plan("default");
    expect(plan.ok).toBe(false);
    expect(check(plan, "stage")?.ok).toBe(false);
    const other = await new TaskLegacyDropService().plan("workspace_other");
    expect(other.ok).toBe(true);
  });
});
