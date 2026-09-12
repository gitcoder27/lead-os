import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NAV_PREFERENCES, NAV_PAGE_IDS } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { userNavPreferences } from "../src/db/schema";
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
    expect(prefs.topNav).toEqual(["work", "team", "desk"]);
    expect(prefs.moreNav).toEqual(["follow-ups", "notes", "meetings"]);
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
      moreNav: JSON.stringify(["meetings"]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["notes", "work"]);
    // Unseen pages are appended to More; stored zone order is preserved.
    expect(prefs.moreNav).toEqual(["meetings", "team", "desk", "follow-ups"]);
    expect([...prefs.topNav, ...prefs.moreNav].sort()).toEqual([...NAV_PAGE_IDS].sort());
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

  it("scopes preferences per manager and workspace", async () => {
    await service.save(MANAGER, { topNav: ["notes"], moreNav: ["work", "team", "desk", "follow-ups", "meetings"] });
    await service.save(
      OTHER_MANAGER,
      { topNav: ["meetings"], moreNav: ["work", "team", "desk", "follow-ups", "notes"] },
      "other-workspace"
    );

    expect((await service.get(MANAGER)).topNav).toEqual(["notes"]);
    expect((await service.get(OTHER_MANAGER)).topNav).toEqual(DEFAULT_NAV_PREFERENCES.topNav);
    expect((await service.get(OTHER_MANAGER, "other-workspace")).topNav).toEqual(["meetings"]);
  });
});

describe("NavPreferencesService.save", () => {
  it("persists a complete layout and reads it back", async () => {
    const saved = await service.save(MANAGER, {
      topNav: ["notes", "desk", "work"],
      moreNav: ["team", "follow-ups", "meetings"],
    });

    expect(saved.topNav).toEqual(["notes", "desk", "work"]);
    const reloaded = await service.get(MANAGER);
    expect(reloaded).toEqual(saved);
  });

  it("overwrites the previous layout on repeat saves", async () => {
    await service.save(MANAGER, { topNav: ["notes"], moreNav: ["work", "team", "desk", "follow-ups", "meetings"] });
    await service.save(MANAGER, { topNav: ["meetings"], moreNav: ["work", "team", "desk", "follow-ups", "notes"] });

    const prefs = await service.get(MANAGER);
    expect(prefs.topNav).toEqual(["meetings"]);
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
        moreNav: ["follow-ups", "notes", "meetings"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a layout missing a page", async () => {
    await expect(
      service.save(MANAGER, { topNav: ["work", "team"], moreNav: ["follow-ups", "notes", "meetings"] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects unknown page ids", async () => {
    await expect(
      service.save(MANAGER, {
        topNav: ["work", "team", "desk", "settings" as never],
        moreNav: ["follow-ups", "notes"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
