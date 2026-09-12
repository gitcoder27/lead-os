import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import { rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import {
  dailyNoteCaptures,
  dailyNoteFollowUps,
  dailyNotes,
  managerDeskDays,
  managerDeskItems,
} from "../src/db/schema";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";

const managerDesk = new ManagerDeskService();
const service = new DailyNotesService(managerDesk);

const MANAGER = "manager-a";
const OTHER_MANAGER = "manager-b";
const WS = "default";
const OTHER_WS = "other";
const DATE = "2026-03-08";

async function noteRows() {
  return db.select().from(dailyNotes);
}

async function saveNote(
  body: string,
  overrides: { manager?: string; workspace?: string; date?: string; revision?: number } = {}
) {
  return service.save(overrides.manager ?? MANAGER, overrides.date ?? DATE, {
    body,
    revision: overrides.revision ?? 0,
  }, overrides.workspace ?? WS);
}

beforeEach(async () => {
  await resetDatabase();
});

describe("DailyNotesService.getDay/save", () => {
  it("returns null for a blank day without inserting a row", async () => {
    const result = await service.getDay(MANAGER, DATE, WS);

    expect(result).toEqual({ note: null, followUps: [] });
    expect(await noteRows()).toHaveLength(0);
  });

  it("does not persist a whitespace-only first save", async () => {
    const result = await service.save(MANAGER, DATE, { body: "   \n\t  ", revision: 0 }, WS);

    expect(result.note).toBeNull();
    expect(result.followUps).toEqual([]);
    expect(await noteRows()).toHaveLength(0);
  });

  it("saves one note per workspace, manager, and date with whitespace preserved", async () => {
    const body = "  First line\n\n    indented block  ";
    const saved = await saveNote(body);

    expect(saved.note).toMatchObject({
      date: DATE,
      body,
      revision: 1,
      title: "First line",
    });
    expect(saved.note?.createdAt).toBeTruthy();
    expect(saved.note?.updatedAt).toBeTruthy();

    const reread = await service.getDay(MANAGER, DATE, WS);
    expect(reread.note?.body).toBe(body);
    expect(reread.note?.revision).toBe(1);
  });

  it("editing a historical note creates no Desk or Today work", async () => {
    await saveNote("retro note", { date: "2026-03-01" });
    await service.save(MANAGER, "2026-03-01", { body: "retro note edited", revision: 1 }, WS);

    expect(await db.select().from(managerDeskDays)).toHaveLength(0);
    expect(await db.select().from(managerDeskItems)).toHaveLength(0);
  });

  it("updates and clears an existing note with the expected revision", async () => {
    await saveNote("v1");
    const updated = await service.save(MANAGER, DATE, { body: "v2", revision: 1 }, WS);
    expect(updated.note?.body).toBe("v2");
    expect(updated.note?.revision).toBe(2);

    const cleared = await service.save(MANAGER, DATE, { body: "", revision: 2 }, WS);
    expect(cleared.note?.body).toBe("");
    expect(cleared.note?.revision).toBe(3);

    const list = await service.list(MANAGER, {}, WS);
    expect(list.notes.map((note) => note.date)).toEqual([DATE]);
    expect(list.notes[0]?.title).toBe("Daily note");
  });

  it("rejects a stale update without overwriting newer content", async () => {
    await saveNote("v1");
    await service.save(MANAGER, DATE, { body: "v2", revision: 1 }, WS);

    await expect(
      service.save(MANAGER, DATE, { body: "stale write", revision: 1 }, WS)
    ).rejects.toMatchObject({ status: 409 });

    const current = await service.getDay(MANAGER, DATE, WS);
    expect(current.note?.body).toBe("v2");
    expect(current.note?.revision).toBe(2);
  });

  it("treats a same-body save as an idempotent retry with no revision churn", async () => {
    await saveNote("v1");
    await service.save(MANAGER, DATE, { body: "v2", revision: 1 }, WS);

    const retry = await service.save(MANAGER, DATE, { body: "v2", revision: 1 }, WS);
    expect(retry.note?.revision).toBe(2);
    expect(retry.note?.body).toBe("v2");
  });

  it("rejects a second create with revision 0 instead of overwriting", async () => {
    await saveNote("first");

    await expect(
      service.save(MANAGER, DATE, { body: "second", revision: 0 }, WS)
    ).rejects.toMatchObject({ status: 409 });

    const current = await service.getDay(MANAGER, DATE, WS);
    expect(current.note?.body).toBe("first");
  });

  it("rejects an update revision for a note that does not exist", async () => {
    await expect(
      service.save(MANAGER, DATE, { body: "ghost", revision: 3 }, WS)
    ).rejects.toMatchObject({ status: 409 });
    expect(await noteRows()).toHaveLength(0);
  });

  it("keeps notes independent across managers and workspaces for the same date", async () => {
    await saveNote("manager a note");
    await saveNote("manager b note", { manager: OTHER_MANAGER });
    await saveNote("other workspace note", { workspace: OTHER_WS });

    expect((await service.getDay(MANAGER, DATE, WS)).note?.body).toBe("manager a note");
    expect((await service.getDay(OTHER_MANAGER, DATE, WS)).note?.body).toBe("manager b note");
    expect((await service.getDay(MANAGER, DATE, OTHER_WS)).note?.body).toBe("other workspace note");
    expect(await noteRows()).toHaveLength(3);
  });

  it("fails closed when manager or workspace scope is empty", async () => {
    await expect(service.getDay("", DATE, WS)).rejects.toMatchObject({ status: 403 });
    await expect(service.getDay(MANAGER, DATE, "")).rejects.toMatchObject({ status: 403 });
    await expect(service.list("", {}, WS)).rejects.toMatchObject({ status: 403 });
    await expect(
      service.save(MANAGER, DATE, { body: "x", revision: 0 }, "")
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.append("", DATE, { text: "x", requestId: randomUUID() }, WS)
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.getSources(MANAGER, [1], "")).rejects.toMatchObject({ status: 403 });
  });
});

describe("DailyNotesService.list", () => {
  it("lists notes in descending date order with derived title and excerpt", async () => {
    await saveNote("older body", { date: "2026-03-01" });
    await saveNote("newest body", { date: "2026-03-05" });
    await saveNote("middle body", { date: "2026-03-03" });

    const result = await service.list(MANAGER, {}, WS);

    expect(result.nextCursor).toBeNull();
    expect(result.notes.map((note) => note.date)).toEqual(["2026-03-05", "2026-03-03", "2026-03-01"]);
    expect(result.notes[0]).toMatchObject({ title: "newest body", excerpt: "newest body" });
    expect(result.notes[0]).not.toHaveProperty("body");
  });

  it("paginates with a keyset cursor and skips nothing", async () => {
    const dates = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];
    for (const date of dates) {
      await saveNote(`note ${date}`, { date });
    }

    const page1 = await service.list(MANAGER, { limit: 2 }, WS);
    expect(page1.notes.map((note) => note.date)).toEqual(["2026-03-05", "2026-03-04"]);
    expect(page1.nextCursor).toBe("2026-03-04");

    const page2 = await service.list(MANAGER, { limit: 2, before: page1.nextCursor! }, WS);
    expect(page2.notes.map((note) => note.date)).toEqual(["2026-03-03", "2026-03-02"]);
    expect(page2.nextCursor).toBe("2026-03-02");

    const page3 = await service.list(MANAGER, { limit: 2, before: page2.nextCursor! }, WS);
    expect(page3.notes.map((note) => note.date)).toEqual(["2026-03-01"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("matches body text as a literal substring including % and _ characters", async () => {
    await saveNote("deployment hit 100% of the rollout_plan checklist", { date: "2026-03-01" });
    await saveNote("unrelated note", { date: "2026-03-02" });

    const literal = await service.list(MANAGER, { q: "100% of" }, WS);
    expect(literal.notes.map((note) => note.date)).toEqual(["2026-03-01"]);

    const underscore = await service.list(MANAGER, { q: "rollout_plan" }, WS);
    expect(underscore.notes.map((note) => note.date)).toEqual(["2026-03-01"]);

    const wildcardOnly = await service.list(MANAGER, { q: "%_" }, WS);
    expect(wildcardOnly.notes).toHaveLength(0);
  });

  it("matches a date substring and centers the excerpt near the query match", async () => {
    const padding = "Walked through the rollout plan with the team and noted open questions. ".repeat(20);
    await saveNote(`${padding}NEEDLE marker${padding}`, { date: "2026-03-02" });
    await saveNote("nothing here", { date: "2026-03-03" });

    const byDate = await service.list(MANAGER, { q: "2026-03-02" }, WS);
    expect(byDate.notes.map((note) => note.date)).toEqual(["2026-03-02"]);

    const byBody = await service.list(MANAGER, { q: "NEEDLE" }, WS);
    expect(byBody.notes).toHaveLength(1);
    expect(byBody.notes[0]?.excerpt).toContain("NEEDLE marker");
    expect(byBody.notes[0]?.excerpt.length).toBeLessThanOrEqual(180);
  });

  it("scopes list results to the owning manager and workspace", async () => {
    await saveNote("shared keyword from a", { date: "2026-03-01" });
    await saveNote("shared keyword from b", { manager: OTHER_MANAGER, date: "2026-03-02" });
    await saveNote("shared keyword other ws", { workspace: OTHER_WS, date: "2026-03-03" });

    const result = await service.list(MANAGER, { q: "shared keyword" }, WS);
    expect(result.notes.map((note) => note.date)).toEqual(["2026-03-01"]);
  });
});

describe("DailyNotesService.append", () => {
  it("creates a note on first append and appends with a blank-line separator", async () => {
    const created = await service.append(MANAGER, DATE, { text: "  first capture  ", requestId: randomUUID() }, WS);
    expect(created.note).toMatchObject({ body: "first capture", revision: 1 });

    const appended = await service.append(MANAGER, DATE, { text: "second capture", requestId: randomUUID() }, WS);
    expect(appended.note?.body).toBe("first capture\n\nsecond capture");
    expect(appended.note?.revision).toBe(2);
  });

  it("does not trim existing content when appending", async () => {
    await saveNote("  padded body  ");
    const result = await service.append(MANAGER, DATE, { text: "tail", requestId: randomUUID() }, WS);
    expect(result.note?.body).toBe("  padded body  \n\ntail");
  });

  it("invalidates stale editor revisions after an append", async () => {
    await saveNote("v1");
    await service.append(MANAGER, DATE, { text: "capture", requestId: randomUUID() }, WS);

    await expect(
      service.save(MANAGER, DATE, { body: "editor overwrite", revision: 1 }, WS)
    ).rejects.toMatchObject({ status: 409 });
  });

  it("applies a retried requestId only once", async () => {
    const requestId = randomUUID();
    await service.append(MANAGER, DATE, { text: "once", requestId }, WS);
    const replay = await service.append(MANAGER, DATE, { text: "once", requestId }, WS);

    expect(replay.note?.body).toBe("once");
    expect(replay.note?.revision).toBe(1);
    expect(await db.select().from(dailyNoteCaptures)).toHaveLength(1);
  });

  it("keeps distinct appends from distinct requestIds", async () => {
    await service.append(MANAGER, DATE, { text: "alpha", requestId: randomUUID() }, WS);
    const result = await service.append(MANAGER, DATE, { text: "beta", requestId: randomUUID() }, WS);
    expect(result.note?.body).toBe("alpha\n\nbeta");
  });

  it("rejects a reused requestId with a different payload", async () => {
    const requestId = randomUUID();
    await service.append(MANAGER, DATE, { text: "original", requestId }, WS);

    await expect(
      service.append(MANAGER, DATE, { text: "different", requestId }, WS)
    ).rejects.toMatchObject({ status: 409 });

    const current = await service.getDay(MANAGER, DATE, WS);
    expect(current.note?.body).toBe("original");
  });

  it("rejects an over-length append without partial state", async () => {
    const body = "x".repeat(49990);
    await saveNote(body);
    const before = await service.getDay(MANAGER, DATE, WS);

    await expect(
      service.append(MANAGER, DATE, { text: "this pushes the note beyond the limit", requestId: randomUUID() }, WS)
    ).rejects.toMatchObject({ status: 400 });

    const after = await service.getDay(MANAGER, DATE, WS);
    expect(after.note?.body).toBe(before.note?.body);
    expect(after.note?.revision).toBe(before.note?.revision);
    expect(await db.select().from(dailyNoteCaptures)).toHaveLength(0);
  });
});

describe("DailyNotesService.createFollowUp/getSources", () => {
  const NOTE_DATE = "2026-03-01";
  const CREATE_DATE = "2026-03-08";
  const FOLLOW_UP_AT = "2026-03-10T09:00:00.000Z";

  async function seedNote(body = "source note body") {
    await service.save(MANAGER, NOTE_DATE, { body, revision: 0 }, WS);
  }

  function payload(overrides: Partial<{ title: string; requestId: string; date: string }> = {}) {
    return {
      date: overrides.date ?? CREATE_DATE,
      title: overrides.title ?? "Follow up on the note",
      followUpAt: FOLLOW_UP_AT,
      requestId: overrides.requestId ?? randomUUID(),
    };
  }

  it("creates a Desk follow-up on the current day linked to the historical note", async () => {
    await seedNote("confidential body text");

    const followUp = await service.createFollowUp(MANAGER, NOTE_DATE, payload(), WS);

    expect(followUp).toMatchObject({
      date: CREATE_DATE,
      title: "Follow up on the note",
      status: "planned",
      followUpAt: FOLLOW_UP_AT,
    });

    const itemRows = await db.select().from(managerDeskItems);
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]).toMatchObject({
      title: "Follow up on the note",
      kind: "action",
      category: "follow_up",
      status: "planned",
      priority: "medium",
      followUpAt: FOLLOW_UP_AT,
      assigneeDeveloperAccountId: null,
      contextNote: null,
    });
    expect(itemRows[0]?.contextNote ?? "").not.toContain("confidential");

    const dayRows = await db.select().from(managerDeskDays);
    expect(dayRows).toHaveLength(1);
    expect(dayRows[0]).toMatchObject({ date: CREATE_DATE, managerAccountId: MANAGER });

    const day = await service.getDay(MANAGER, NOTE_DATE, WS);
    expect(day.followUps).toEqual([
      { itemId: followUp.itemId, date: CREATE_DATE, title: "Follow up on the note", status: "planned", followUpAt: FOLLOW_UP_AT },
    ]);

    const sources = await service.getSources(MANAGER, [followUp.itemId], WS);
    expect(sources.sources).toEqual([
      { itemId: followUp.itemId, noteId: day.note!.id, date: NOTE_DATE },
    ]);
  });

  it("replays the same requestId idempotently, including simultaneous calls", async () => {
    await seedNote();
    const requestId = randomUUID();
    const input = payload({ requestId });

    const [first, second] = await Promise.all([
      service.createFollowUp(MANAGER, NOTE_DATE, input, WS),
      service.createFollowUp(MANAGER, NOTE_DATE, input, WS),
    ]);
    const third = await service.createFollowUp(MANAGER, NOTE_DATE, input, WS);

    expect(first.itemId).toBe(second.itemId);
    expect(third.itemId).toBe(first.itemId);
    expect(await db.select().from(managerDeskItems)).toHaveLength(1);
    expect(await db.select().from(dailyNoteFollowUps)).toHaveLength(1);
  });

  it("rejects a reused requestId with a different payload", async () => {
    await seedNote();
    const requestId = randomUUID();
    await service.createFollowUp(MANAGER, NOTE_DATE, payload({ requestId }), WS);

    await expect(
      service.createFollowUp(MANAGER, NOTE_DATE, payload({ requestId, title: "Different title" }), WS)
    ).rejects.toMatchObject({ status: 409 });

    expect(await db.select().from(managerDeskItems)).toHaveLength(1);
  });

  it("reflects the current Desk status on the note day view, including closed actions", async () => {
    await seedNote();
    const followUp = await service.createFollowUp(MANAGER, NOTE_DATE, payload(), WS);

    await managerDesk.updateItem(MANAGER, followUp.itemId, { status: "done" }, WS);

    const day = await service.getDay(MANAGER, NOTE_DATE, WS);
    expect(day.followUps).toHaveLength(1);
    expect(day.followUps[0]?.status).toBe("done");
  });

  it("requires an existing owned note before creating a follow-up", async () => {
    await expect(
      service.createFollowUp(MANAGER, NOTE_DATE, payload(), WS)
    ).rejects.toMatchObject({ status: 404 });

    await seedNote();
    await expect(
      service.createFollowUp(OTHER_MANAGER, NOTE_DATE, payload(), WS)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.createFollowUp(MANAGER, NOTE_DATE, payload(), OTHER_WS)
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(managerDeskItems)).toHaveLength(0);
  });

  it("returns only owned sources and omits inaccessible ids", async () => {
    await seedNote();
    const followUp = await service.createFollowUp(MANAGER, NOTE_DATE, payload(), WS);

    expect((await service.getSources(OTHER_MANAGER, [followUp.itemId], WS)).sources).toEqual([]);
    expect((await service.getSources(MANAGER, [followUp.itemId], OTHER_WS)).sources).toEqual([]);
    expect((await service.getSources(MANAGER, [followUp.itemId, 999999], WS)).sources).toHaveLength(1);
    expect((await service.getSources(MANAGER, [], WS)).sources).toEqual([]);
  });

  it("keeps the note and does not block when the Desk follow-up is deleted", async () => {
    await seedNote("keep me");
    const followUp = await service.createFollowUp(MANAGER, NOTE_DATE, payload(), WS);

    await managerDesk.deleteItem(MANAGER, followUp.itemId, WS);

    const day = await service.getDay(MANAGER, NOTE_DATE, WS);
    expect(day.note?.body).toBe("keep me");
    expect(day.followUps).toEqual([]);
    expect((await service.getSources(MANAGER, [followUp.itemId], WS)).sources).toEqual([]);
  });
});

describe("daily notes migration", () => {
  it("preserves notes when the migration reruns", async () => {
    await saveNote("survives migration");
    const followUpInput = {
      date: "2026-03-08",
      title: "persisted follow-up",
      followUpAt: "2026-03-10T09:00:00.000Z",
      requestId: randomUUID(),
    };
    await service.save(MANAGER, "2026-03-01", { body: "source", revision: 0 }, WS);
    const followUp = await service.createFollowUp(MANAGER, "2026-03-01", followUpInput, WS);

    migrate(rawDb);

    const day = await service.getDay(MANAGER, DATE, WS);
    expect(day.note?.body).toBe("survives migration");
    const sources = await service.getSources(MANAGER, [followUp.itemId], WS);
    expect(sources.sources).toHaveLength(1);
  });
});
