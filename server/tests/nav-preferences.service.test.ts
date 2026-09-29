import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NAV_PREFERENCES, NAV_PAGE_IDS } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import { configTable, userNavPreferences } from "../src/db/schema";
import { NavPreferencesService } from "../src/services/nav-preferences.service";

const service = new NavPreferencesService();
const MANAGER = "manager-account";
const OTHER_MANAGER = "other-manager";

beforeEach(async () => {
  await resetDatabase();
});

describe("NavPreferencesService.get", () => {
  it("returns the default layout when no preference is stored", async () => {
    const prefs = await service.get(MANAGER);
    expect(prefs).toEqual(DEFAULT_NAV_PREFERENCES);
    // docs/56 P2-04: Today | Tasks | Team | Work | Notes, nothing hidden.
    expect(prefs.topNav).toEqual(["desk", "team", "work", "notes"]);
    expect(prefs.moreNav).toEqual([]);
    expect(prefs.hidden).toEqual([]);
  });

  it("returns a defensive copy so callers cannot mutate the shared default", async () => {
    const prefs = await service.get(MANAGER);
    prefs.topNav.push("notes");
    const next = await service.get(MANAGER);
    expect(next.topNav).toEqual(DEFAULT_NAV_PREFERENCES.topNav);
  });

  it("sanitizes stored rows with unknown or duplicated page ids", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["notes", "unknown-page", "notes", "work"]),
      moreNav: JSON.stringify(["team"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["notes", "work"]);
    // Unseen pages are appended to More; stored zone order is preserved.
    expect(prefs.moreNav).toEqual(["team", "desk"]);
    expect([...prefs.topNav, ...prefs.moreNav].sort()).toEqual([...NAV_PAGE_IDS].sort());
  });

  it("drops the retired Follow-ups and Meetings pages from stored rows (docs/57 P3-06)", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["follow-ups", "work", "meetings", "desk"]),
      moreNav: JSON.stringify(["team", "notes"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const prefs = await service.get(MANAGER);
    expect(prefs).toEqual({ topNav: ["work", "desk"], moreNav: ["team", "notes"], hidden: [] });
    expect([...prefs.topNav, ...prefs.moreNav].sort()).toEqual([...NAV_PAGE_IDS].sort());
  });

  it("reads a row saved before P2-04 (hidden defaults to []) exactly as it was (docs/56 P2-04)", async () => {
    // Insert without a `hidden` value, as the old code did: the column default fills it.
    rawDb.prepare("INSERT INTO user_nav_preferences (workspace_id, manager_account_id, top_nav, more_nav, created_at, updated_at) VALUES ('default', ?, ?, ?, ?, ?)")
      .run(MANAGER, JSON.stringify(["work", "team", "desk"]), JSON.stringify(["notes"]), new Date().toISOString(), new Date().toISOString());
    expect(await service.get(MANAGER)).toEqual({ topNav: ["work", "team", "desk"], moreNav: ["notes"], hidden: [] });
  });

  it("returns hidden pages in their own zone, and every page still appears exactly once", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["desk", "notes"]),
      moreNav: JSON.stringify(["work"]),
      hidden: JSON.stringify(["team"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const prefs = await service.get(MANAGER);
    expect(prefs).toEqual({ topNav: ["desk", "notes"], moreNav: ["work"], hidden: ["team"] });
    expect([...prefs.topNav, ...prefs.moreNav, ...prefs.hidden].sort()).toEqual([...NAV_PAGE_IDS].sort());
  });

  it("a page stored in both a zone and Hidden keeps its earlier zone; unknown hidden ids are dropped", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["desk"]),
      moreNav: JSON.stringify(["team"]),
      hidden: JSON.stringify(["desk", "follow-ups", "bogus", "work"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(await service.get(MANAGER)).toEqual({ topNav: ["desk"], moreNav: ["team", "notes"], hidden: ["work"] });
  });

  it("survives corrupt JSON in a stored hidden list", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["desk"]),
      moreNav: JSON.stringify(["team"]),
      hidden: "{oops",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect((await service.get(MANAGER)).hidden).toEqual([]);
  });

  it("survives corrupt JSON in stored rows", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: "{not json",
      moreNav: "42",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual([]);
    expect(prefs.moreNav).toEqual([...NAV_PAGE_IDS]);
  });

  it("rewrites desk↔tasks ids to the live Phase 3 flag (P3-D1)", async () => {
    await db.insert(userNavPreferences).values({
      workspaceId: "default",
      managerAccountId: MANAGER,
      topNav: JSON.stringify(["tasks", "work"]),
      moreNav: JSON.stringify(["notes"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // Flag off: the stored Phase 3 id falls back to the desk.
    let prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["desk", "work"]);

    await db.insert(configTable).values([
      { workspaceId: "default", key: "tasks_phase2_stage", value: "2c" },
      { workspaceId: "default", key: "tasks_phase3_enabled", value: "true" },
    ]);
    // Flag on: stored `desk` entries surface as `tasks` without a rewrite.
    prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["tasks", "work"]);
    expect(prefs.moreNav).toContain("notes");
    expect(prefs.topNav.concat(prefs.moreNav)).not.toContain("desk");
  });

  it("scopes preferences per manager and workspace", async () => {
    await service.save(MANAGER, { topNav: ["notes"], moreNav: ["work", "team", "desk"] });
    await service.save(
      OTHER_MANAGER,
      { topNav: ["desk"], moreNav: ["work", "team", "notes"] },
      "other-workspace"
    );

    expect((await service.get(MANAGER)).topNav).toEqual(["notes"]);
    expect((await service.get(OTHER_MANAGER)).topNav).toEqual(DEFAULT_NAV_PREFERENCES.topNav);
    expect((await service.get(OTHER_MANAGER, "other-workspace")).topNav).toEqual(["desk"]);
  });
});

describe("NavPreferencesService.save", () => {
  it("ignores the retired pages a stale client still sends, instead of failing the save", async () => {
    const saved = await service.save(MANAGER, {
      topNav: ["work", "follow-ups", "desk"],
      moreNav: ["team", "notes", "meetings"],
    });
    expect(saved).toEqual({ topNav: ["work", "desk"], moreNav: ["team", "notes"], hidden: [] });
    expect(await service.get(MANAGER)).toEqual(saved);
    // A layout that is only complete once the retired ids are ignored is still rejected.
    await expect(
      service.save(MANAGER, { topNav: ["work", "follow-ups"], moreNav: ["meetings", "desk", "notes"] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("persists hidden pages and reads them back (docs/56 P2-04)", async () => {
    const saved = await service.save(MANAGER, { topNav: ["desk", "notes"], moreNav: [], hidden: ["work", "team"] });
    expect(saved).toEqual({ topNav: ["desk", "notes"], moreNav: [], hidden: ["work", "team"] });
    expect(await service.get(MANAGER)).toEqual(saved);
    // Restoring them is just another save.
    expect(await service.save(MANAGER, { topNav: ["desk", "notes", "work", "team"], moreNav: [], hidden: [] })).toMatchObject({ hidden: [] });
  });

  it("accepts hiding every page", async () => {
    const saved = await service.save(MANAGER, { topNav: [], moreNav: [], hidden: [...NAV_PAGE_IDS] });
    expect(saved.hidden).toEqual([...NAV_PAGE_IDS]);
  });

  it("rejects a page that is both in a zone and hidden, or missing from all three", async () => {
    await expect(service.save(MANAGER, { topNav: ["desk", "team", "work", "notes"], moreNav: [], hidden: ["work"] })).rejects.toMatchObject({ status: 400 });
    await expect(service.save(MANAGER, { topNav: ["desk"], moreNav: ["notes"], hidden: ["work"] })).rejects.toMatchObject({ status: 400 });
  });

  it("a client from before P2-04 (no hidden field) can save without un-hiding pages", async () => {
    await service.save(MANAGER, { topNav: ["desk", "notes"], moreNav: [], hidden: ["work", "team"] });
    // It only knows the two pages it was shown.
    const saved = await service.save(MANAGER, { topNav: ["notes", "desk"], moreNav: [] });
    expect(saved).toEqual({ topNav: ["notes", "desk"], moreNav: [], hidden: ["work", "team"] });
    // And it still needs a complete layout when nothing is hidden.
    await expect(service.save(OTHER_MANAGER, { topNav: ["desk"], moreNav: [] })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps hidden pages per manager and workspace", async () => {
    await service.save(MANAGER, { topNav: ["desk", "notes"], moreNav: [], hidden: ["work", "team"] });
    expect((await service.get(OTHER_MANAGER)).hidden).toEqual([]);
    expect((await service.get(MANAGER, "other-workspace")).hidden).toEqual([]);
  });

  it("persists a complete layout and reads it back", async () => {
    const saved = await service.save(MANAGER, {
      topNav: ["notes", "desk", "work"],
      moreNav: ["team"],
    });

    expect(saved.topNav).toEqual(["notes", "desk", "work"]);
    const reloaded = await service.get(MANAGER);
    expect(reloaded).toEqual(saved);
  });

  it("overwrites the previous layout on repeat saves", async () => {
    await service.save(MANAGER, { topNav: ["notes"], moreNav: ["work", "team", "desk"] });
    await service.save(MANAGER, { topNav: ["desk"], moreNav: ["work", "team", "notes"] });

    const prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["desk"]);
  });

  it("accepts moving every page into the More menu", async () => {
    const saved = await service.save(MANAGER, { topNav: [], moreNav: [...NAV_PAGE_IDS] });
    expect(saved.topNav).toEqual([]);
    expect((await service.get(MANAGER)).moreNav).toEqual([...NAV_PAGE_IDS]);
  });

  it("rejects a page assigned to both zones", async () => {
    await expect(
      service.save(MANAGER, {
        topNav: ["work", "team", "desk", "notes"],
        moreNav: ["notes"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a layout missing a page", async () => {
    await expect(
      service.save(MANAGER, { topNav: ["work", "team"], moreNav: ["notes"] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts the live tasks id under Phase 3 and persists it canonically", async () => {
    await db.insert(configTable).values([
      { workspaceId: "default", key: "tasks_phase2_stage", value: "2c" },
      { workspaceId: "default", key: "tasks_phase3_enabled", value: "true" },
    ]);
    const saved = await service.save(MANAGER, {
      topNav: ["tasks", "work"],
      moreNav: ["team", "notes"],
    });
    expect(saved.topNav).toEqual(["tasks", "work"]);
    // Under Phase 3, submitting the legacy id normalizes to `tasks`.
    const aliased = await service.save(MANAGER, {
      topNav: ["desk", "work"],
      moreNav: ["team", "notes"],
    });
    expect(aliased.topNav).toEqual(["tasks", "work"]);
  });

  it("rejects unknown page ids", async () => {
    await expect(
      service.save(MANAGER, {
        topNav: ["work", "team", "desk", "settings" as never],
        moreNav: ["notes"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
