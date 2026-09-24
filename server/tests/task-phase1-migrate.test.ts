import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { developers, managerDeskItems, teamTrackerItems, workspaces } from "../src/db/schema";
import { TaskEventsService } from "../src/services/task-events.service";
import { TaskKeysService } from "../src/services/task-keys.service";
import { TaskPhase1MigrationService } from "../src/services/task-phase1-migration.service";
import { parseTaskNotes } from "../src/services/task-notes-import";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";

const migration = new TaskPhase1MigrationService();

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values({ accountId: "dev-1", displayName: "One", isActive: 1 });
});

describe("Phase 1 migration", () => {
  it("parses dated sections, preserves invalid headers as body", () => {
    expect(parseTaskNotes("Older\n\nJan 2, 2026:\nNew\n\nFeb 31, 2026:\nStill new")).toEqual({ legacyBody: "Older", datedSections: [{ date: "2026-01-02", body: "New\n\nFeb 31, 2026:\nStill new" }] });
  });

  it("assigns independent per-workspace key sequences without leaking imported notes", async () => {
    const now = new Date().toISOString();
    await db.insert(workspaces).values({ id: "other", name: "Other", createdAt: now, updatedAt: now });
    await db.insert(developers).values({ workspaceId: "other", accountId: "dev-1", displayName: "One", isActive: 1 });
    const tracker = new TeamTrackerService();
    await tracker.addItem("dev-1", "2026-09-24", { title: "Default", note: "default only" });
    await tracker.addItem("dev-1", "2026-09-24", { title: "Other", note: "other only" }, "other");
    expect(await migration.workspaceIds()).toContain("other");
    await migration.migrate("default", true);
    expect(await new TaskKeysService().enabled("other")).toBe(false);
    await migration.migrate("other", true);
    const rows = await db.select().from(teamTrackerItems);
    expect(rows.map((row) => row.taskKey)).toEqual(["T-1", "T-1"]);
    expect((await new TaskEventsService().list("T-1", { kind: "manager", accountId: "manager", workspaceId: "other" })).events.some((event) => event.body === "default only")).toBe(false);
  });

  it("dry-runs without writes, assigns mirrored keys, imports private/shared notes, and reruns safely", async () => {
    const tracker = new TeamTrackerService();
    const desk = new ManagerDeskService(tracker);
    const item = await desk.createItem("manager-a", { date: "2026-09-24", title: "Delegated", assigneeDeveloperAccountId: "dev-1", contextNote: "Private\n\nJan 2, 2026:\nFollowed up" });
    const standalone = await tracker.addItem("dev-1", "2026-09-24", { title: "Independent", note: "Shared progress" });
    const preview = await migration.migrate("default");
    expect(preview).toMatchObject({ deskCandidates: 1, trackerCandidates: 1, linkedTrackerRows: 1, deskNoteEvents: 2, trackerNoteEvents: 1 });
    expect((await db.select().from(managerDeskItems))[0]?.taskKey).toBeNull();
    expect(await new TaskKeysService().enabled("default")).toBe(false);
    await migration.migrate("default", true);
    const rows = await db.select().from(teamTrackerItems);
    const deskRow = (await db.select().from(managerDeskItems))[0]!;
    expect(rows.find((row) => row.managerDeskItemId === item.id)?.taskKey).toBe(deskRow.taskKey);
    const standaloneKey = rows.find((row) => row.id === standalone.id)?.taskKey;
    expect(standaloneKey).toMatch(/^T-\d+$/);
    const events = new TaskEventsService();
    expect((await events.list(deskRow.taskKey!, { kind: "manager", accountId: "manager-a" })).events).toHaveLength(2);
    expect((await events.list(deskRow.taskKey!, { kind: "manager", accountId: "manager-b" })).events).toHaveLength(0);
    expect((await events.list(standaloneKey!, { kind: "developer", accountId: "dev-1" })).events).toHaveLength(1);
    await migration.migrate("default", true);
    expect((await events.list(standaloneKey!, { kind: "developer", accountId: "dev-1" })).events).toHaveLength(1);
  });
});
