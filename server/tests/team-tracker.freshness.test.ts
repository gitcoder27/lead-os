import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { MyDayService } from "../src/services/my-day.service";
import { resetDatabase, db } from "./helpers/db";
import { enableCollabParticipation } from "./helpers/team-mode";
import { pinAttentionTimeZone } from "./helpers/attention";
import {
  appUsers,
  configTable,
  developers,
  oneOnOneSeries,
  oneOnOneSessions,
  standupSessions,
  taskEvents,
  taskLinks,
  tasks,
  teamTrackerDays,
} from "../src/db/schema";

// docs/56 P1-02. 2026-03-02 is a Monday; 2026-03-07/08 are a weekend.
const service = new TeamTrackerService();
const MONDAY = "2026-03-02";
const NEXT_MONDAY = "2026-03-09";

function at(date: string, time = "12:00:00.000Z"): Date {
  return new Date(`${date}T${time}`);
}

async function boardDay(date: string, accountId: string) {
  const board = await service.getBoard(date);
  return board.developers.find((day) => day.developer.accountId === accountId)!;
}

/** Creates the first tracker day row, which is the "tracking since" baseline. */
async function startTracking(accountId: string, date = MONDAY) {
  vi.setSystemTime(at(date));
  await service.ensureDay(date, accountId);
}

async function seedTask(taskKey: string, ownerId: string | null, ownerType: "developer" | "manager" = "developer") {
  const [row] = await db.insert(tasks).values({
    taskKey,
    title: taskKey,
    ownerType,
    ownerId,
    createdAt: at(MONDAY).toISOString(),
    updatedAt: at(MONDAY).toISOString(),
  }).returning();
  return row!;
}

async function seedEvent(task: { id: number; taskKey: string }, occurredAt: string, authorType: "manager" | "developer" | "system" = "manager", authorId?: string) {
  await db.insert(taskEvents).values({
    taskKey: task.taskKey,
    taskId: task.id,
    type: "update",
    body: "note",
    visibility: "shared",
    authorType,
    authorId: authorId ?? (authorType === "manager" ? "manager-1" : "dev-1"),
    occurredAt,
    createdAt: occurredAt,
  });
}

describe("TeamTrackerService freshness by mode (P1-02)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(MONDAY));
    await resetDatabase();
    await pinAttentionTimeZone();
    await db.insert(developers).values([
      { accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-2", displayName: "Bob Jones", email: null, avatarUrl: null, isActive: 1 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("collab, participating developer", () => {
    beforeEach(async () => {
      await enableCollabParticipation(["dev-1"]);
    });

    it("does not let a manager check-in reset developer staleness", async () => {
      await service.addCheckIn("dev-1", MONDAY, { summary: "Pinged Alice" }, { type: "manager", accountId: "manager-1" });
      vi.setSystemTime(at(MONDAY, "13:00:00.000Z"));

      const day = await boardDay(MONDAY, "dev-1");
      expect(day.participates).toBe(true);
      expect(day.signals.freshness.clock).toBe("check_in");
      expect(day.lastCheckInAt).toBe(at(MONDAY).toISOString());
      expect(day.signals.freshness.hoursSinceCheckIn).toBeUndefined();
      expect(day.signals.freshness.staleByTime).toBe(true);
      expect(day.isStale).toBe(true);
    });

    it("resets on the developer's own check-in, on the effective day row only", async () => {
      vi.setSystemTime(at("2026-03-03", "09:00:00.000Z"));
      await service.addCheckIn("dev-1", "2026-03-03", { summary: "Yesterday" }, { type: "developer", accountId: "dev-1" });
      vi.setSystemTime(at("2026-03-04", "09:00:00.000Z"));
      await service.ensureDay("2026-03-04", "dev-1");
      vi.setSystemTime(at("2026-03-04", "10:00:00.000Z"));
      // P1-05: a new day row without a check-in is quiet until the working
      // day has run past the threshold (09:00 start, 4h).
      expect((await boardDay("2026-03-04", "dev-1")).signals.freshness.staleByTime).toBe(false);
      vi.setSystemTime(at("2026-03-04", "14:00:00.000Z"));
      // A new day row starts without a check-in, exactly as before P1-02.
      expect((await boardDay("2026-03-04", "dev-1")).signals.freshness.staleByTime).toBe(true);

      await service.addCheckIn("dev-1", "2026-03-04", { summary: "On it" }, { type: "developer", accountId: "dev-1" });
      vi.setSystemTime(at("2026-03-04", "15:00:00.000Z"));
      const day = await boardDay("2026-03-04", "dev-1");
      expect(day.signals.freshness.hoursSinceCheckIn).toBe(1);
      expect(day.signals.freshness.staleByTime).toBe(false);
    });

    it("still counts a manager check-in as the follow-up to a status change", async () => {
      await service.updateDay("dev-1", MONDAY, { status: "blocked" }, undefined, { type: "manager" });
      vi.setSystemTime(at(MONDAY, "15:00:00.000Z"));
      expect((await boardDay(MONDAY, "dev-1")).signals.freshness.statusChangeWithoutFollowUp).toBe(true);

      await service.addCheckIn("dev-1", MONDAY, { summary: "Talked to platform" }, { type: "manager", accountId: "manager-1" });
      const day = await boardDay(MONDAY, "dev-1");
      expect(day.signals.freshness.statusChangeWithoutFollowUp).toBe(false);
      expect(day.signals.freshness.staleByTime).toBe(true);
    });
  });

  describe("collab, non-participating developer", () => {
    beforeEach(async () => {
      await enableCollabParticipation(["dev-1"]);
      await startTracking("dev-2");
    });

    it("uses the manager-touch clock and skips the manager's own status change", async () => {
      await service.updateDay("dev-2", MONDAY, { status: "waiting" }, undefined, { type: "manager" });
      vi.setSystemTime(at(MONDAY, "18:00:00.000Z"));
      const day = await boardDay(MONDAY, "dev-2");
      expect(day.participates).toBe(false);
      expect(day.signals.freshness).toMatchObject({
        clock: "manager_touch",
        staleByTime: false,
        staleWithOpenRisk: false,
        statusChangeWithoutFollowUp: false,
        untouched: false,
        workingDaysSinceTouch: 0,
      });
      expect(day.signals.freshness.lastManagerTouchAt).toBe(at(MONDAY).toISOString());
      expect(day.isStale).toBe(false);
    });

    it("flags after five working days untouched", async () => {
      vi.setSystemTime(at(NEXT_MONDAY));
      const day = await boardDay(NEXT_MONDAY, "dev-2");
      expect(day.signals.freshness.workingDaysSinceTouch).toBe(5);
      expect(day.signals.freshness.untouched).toBe(true);
      expect(day.signals.freshness.lastManagerTouchAt).toBeUndefined();
    });
  });

  describe("solo", () => {
    beforeEach(async () => {
      await startTracking("dev-1");
    });

    it("never flags check-in staleness or no_current by default", async () => {
      // Midday UTC keeps MONDAY "live" in any server TZ within ±11h.
      vi.setSystemTime(at(MONDAY, "12:00:00.000Z"));
      const board = await service.getBoard(MONDAY);
      const day = board.developers.find((entry) => entry.developer.accountId === "dev-1")!;
      expect(day.signals.freshness.clock).toBe("manager_touch");
      expect(day.signals.freshness.staleByTime).toBe(false);
      expect(day.signals.freshness.staleWithoutCurrentWork).toBe(false);
      expect(board.viewMode).toBe("live");
      expect(board.summary.stale).toBe(0);
      expect(board.summary.noCurrent).toBe(0);
      expect(board.attentionQueue.find((item) => item.developer.accountId === "dev-1")).toBeUndefined();
    });

    it("honours the solo no_current opt-in", async () => {
      await db.insert(configTable).values({ key: "team_tracker_solo_no_current_enabled", value: "true" });
      vi.setSystemTime(at(MONDAY, "12:00:00.000Z"));
      expect((await boardDay(MONDAY, "dev-1")).signals.freshness.staleWithoutCurrentWork).toBe(true);
    });

    it("counts working days from tracking start, skipping the weekend", async () => {
      vi.setSystemTime(at("2026-03-08"));
      const sunday = await boardDay("2026-03-08", "dev-1");
      expect(sunday.signals.freshness.workingDaysSinceTouch).toBe(4);
      expect(sunday.signals.freshness.untouched).toBe(false);

      vi.setSystemTime(at(NEXT_MONDAY));
      const monday = await boardDay(NEXT_MONDAY, "dev-1");
      expect(monday.signals.freshness.workingDaysSinceTouch).toBe(5);
      expect(monday.signals.freshness.untouched).toBe(true);
    });

    it("honours a custom working-day threshold", async () => {
      await db.insert(configTable).values({ key: "team_tracker_touch_stale_working_days", value: "2" });
      vi.setSystemTime(at("2026-03-04"));
      const day = await boardDay("2026-03-04", "dev-1");
      expect(day.signals.freshness.touchStaleWorkingDays).toBe(2);
      expect(day.signals.freshness.untouched).toBe(true);
    });

    it("treats a manager note (check-in) as a touch", async () => {
      vi.setSystemTime(at("2026-03-04"));
      await service.addCheckIn("dev-1", "2026-03-04", { summary: "Reviewed PR queue" });
      vi.setSystemTime(at(NEXT_MONDAY));
      const day = await boardDay(NEXT_MONDAY, "dev-1");
      expect(day.signals.freshness.lastManagerTouchAt).toBe(at("2026-03-04").toISOString());
      expect(day.signals.freshness.workingDaysSinceTouch).toBe(3);
      expect(day.signals.freshness.untouched).toBe(false);
    });

    it("treats a manager status change as a touch, but not a developer's or a reseed", async () => {
      vi.setSystemTime(at("2026-03-03"));
      await service.updateDay("dev-1", "2026-03-03", { status: "at_risk" }, undefined, { type: "developer" });
      vi.setSystemTime(at("2026-03-04"));
      await service.updateDay("dev-1", "2026-03-04", { status: "at_risk" });
      vi.setSystemTime(at(NEXT_MONDAY));
      expect((await boardDay(NEXT_MONDAY, "dev-1")).signals.freshness.lastManagerTouchAt).toBeUndefined();

      vi.setSystemTime(at("2026-03-10"));
      await service.updateDay("dev-1", "2026-03-10", { status: "blocked" }, undefined, { type: "manager" });
      const day = await boardDay("2026-03-10", "dev-1");
      expect(day.signals.freshness.lastManagerTouchAt).toBe(at("2026-03-10").toISOString());
      expect(day.signals.freshness.untouched).toBe(false);
    });

    it("flags a developer-authored status change until the manager follows up", async () => {
      await db.insert(configTable).values({ key: "team_tracker_solo_no_current_enabled", value: "false" });
      await service.updateDay("dev-1", MONDAY, { status: "blocked" }, undefined, { type: "developer" });
      vi.setSystemTime(at(MONDAY, "15:00:00.000Z"));
      expect((await boardDay(MONDAY, "dev-1")).signals.freshness.statusChangeWithoutFollowUp).toBe(true);

      await service.addCheckIn("dev-1", MONDAY, { summary: "Unblocking", visibility: "private" });
      expect((await boardDay(MONDAY, "dev-1")).signals.freshness.statusChangeWithoutFollowUp).toBe(false);
    });

    it("carries the status author onto the next day's seeded row", async () => {
      await service.updateDay("dev-1", MONDAY, { status: "blocked" }, undefined, { type: "developer" });
      vi.setSystemTime(at("2026-03-03"));
      const seeded = await service.ensureDay("2026-03-03", "dev-1");
      expect(seeded.status).toBe("blocked");
      expect(seeded.statusUpdatedBy).toBe("developer");
      expect((await boardDay("2026-03-03", "dev-1")).signals.freshness.statusChangeWithoutFollowUp).toBe(true);
    });

    it("counts task events, standup reviews and 1:1s as touches", async () => {
      const owned = await seedTask("T-1", "dev-1");
      const linked = await seedTask("T-2", "manager-1", "manager");
      await db.insert(taskLinks).values({ taskId: linked.id, kind: "person", ref: "dev-1", createdAt: at(MONDAY).toISOString() });
      const [series] = await db.insert(oneOnOneSeries).values({ developerAccountId: "dev-1", cadence: "weekly", createdAt: at(MONDAY).toISOString() }).returning();
      vi.setSystemTime(at(NEXT_MONDAY));

      const touchedAt = async () => (await boardDay(NEXT_MONDAY, "dev-1")).signals.freshness.lastManagerTouchAt;

      // Developer- and system-authored events are not manager touches.
      await seedEvent(owned, at("2026-03-03").toISOString(), "developer");
      await seedEvent(owned, at("2026-03-03").toISOString(), "system");
      expect(await touchedAt()).toBeUndefined();

      await seedEvent(owned, at("2026-03-03").toISOString());
      expect(await touchedAt()).toBe(at("2026-03-03").toISOString());

      // Structural events are `system` with the acting login as author: a
      // manager login counts, anyone else doesn't.
      await db.insert(appUsers).values({ username: "boss", displayName: "Boss", passwordHash: "x", role: "manager", createdAt: at(MONDAY).toISOString(), updatedAt: at(MONDAY).toISOString() });
      await seedEvent(owned, at("2026-03-03", "15:00:00.000Z").toISOString(), "system", "not-a-manager");
      expect(await touchedAt()).toBe(at("2026-03-03").toISOString());
      await seedEvent(owned, at("2026-03-03", "16:00:00.000Z").toISOString(), "system", "boss");
      expect(await touchedAt()).toBe(at("2026-03-03", "16:00:00.000Z").toISOString());

      await seedEvent(linked, at("2026-03-04").toISOString());
      expect(await touchedAt()).toBe(at("2026-03-04").toISOString());

      await db.insert(standupSessions).values({
        managerAccountId: "manager-1",
        date: "2026-03-05",
        startedAt: at("2026-03-05", "09:00:00.000Z").toISOString(),
        endedAt: at("2026-03-05").toISOString(),
        reviewedJson: JSON.stringify(["dev-1"]),
        createdAt: at("2026-03-05").toISOString(),
      });
      expect(await touchedAt()).toBe(at("2026-03-05").toISOString());

      // A skipped 1:1 is not a touch; a completed one is.
      await db.insert(oneOnOneSessions).values({ seriesId: series!.id, scheduledFor: "2026-03-06", status: "skipped", completedAt: at("2026-03-06", "18:00:00.000Z").toISOString(), createdAt: at(MONDAY).toISOString() });
      expect(await touchedAt()).toBe(at("2026-03-05").toISOString());
      await db.insert(oneOnOneSessions).values({ seriesId: series!.id, scheduledFor: "2026-03-06", status: "done", startedAt: at("2026-03-06", "10:00:00.000Z").toISOString(), completedAt: at("2026-03-06").toISOString(), createdAt: at(MONDAY).toISOString() });
      const day = await boardDay(NEXT_MONDAY, "dev-1");
      expect(day.signals.freshness.lastManagerTouchAt).toBe(at("2026-03-06").toISOString());
      expect(day.signals.freshness.workingDaysSinceTouch).toBe(1);
    });

    it("caps touches at the end of a history date", async () => {
      vi.setSystemTime(at("2026-03-06"));
      await service.addCheckIn("dev-1", "2026-03-06", { summary: "Late-week review" });
      vi.setSystemTime(at("2026-03-10"));

      const history = await service.getDeveloperDayView("2026-03-05", "dev-1", { viewer: { kind: "manager", accountId: "manager-1" } });
      expect(history.viewMode).toBe("history");
      expect(history.day.signals.freshness.lastManagerTouchAt).toBeUndefined();
      expect(history.day.signals.freshness.workingDaysSinceTouch).toBe(3);
    });

    it("keeps the manager-touch clock out of developer views", async () => {
      vi.setSystemTime(at(NEXT_MONDAY));
      const managerView = await service.getDeveloperDayView(NEXT_MONDAY, "dev-2", { viewer: { kind: "manager", accountId: "manager-1" } });
      expect(managerView.day.signals.freshness.clock).toBe("manager_touch");
      await startTracking("dev-1", NEXT_MONDAY);

      const developerView = await service.getDeveloperDayView(NEXT_MONDAY, "dev-1", { viewer: { kind: "developer", accountId: "dev-1" } });
      expect(developerView.day.signals.freshness).not.toHaveProperty("lastManagerTouchAt");
      expect(developerView.day.signals.freshness).not.toHaveProperty("untouched");
      expect(developerView.day.signals.freshness).not.toHaveProperty("workingDaysSinceTouch");
      expect(developerView.day.isStale).toBe(false);
      expect((await new MyDayService(service).getMyDay("dev-1", NEXT_MONDAY)).isStale).toBe(false);
    });
  });

  describe("canonical tasks", () => {
    beforeEach(async () => {
      await db.insert(configTable).values([
        { key: "tasks_phase1_enabled", value: "true" },
        { key: "tasks_phase2_stage", value: "2c" },
      ]);
    });

    it("applies each mode on the canonical board", async () => {
      await enableCollabParticipation(["dev-1"]);
      await startTracking("dev-2");
      await service.addCheckIn("dev-1", MONDAY, { summary: "Manager ping" });
      vi.setSystemTime(at(NEXT_MONDAY, "14:00:00.000Z"));

      const board = await service.getBoard(NEXT_MONDAY);
      const byId = new Map(board.developers.map((day) => [day.developer.accountId, day]));
      expect(byId.get("dev-1")!.tasks).toBeDefined();
      expect(byId.get("dev-1")!.signals.freshness).toMatchObject({ clock: "check_in", staleByTime: true });
      expect(byId.get("dev-2")!.signals.freshness).toMatchObject({ clock: "manager_touch", staleByTime: false, untouched: true, workingDaysSinceTouch: 5 });
    });

    it("applies the history cap on the canonical history day", async () => {
      await startTracking("dev-1");
      vi.setSystemTime(at("2026-03-06"));
      await service.addCheckIn("dev-1", "2026-03-06", { summary: "Review" });
      vi.setSystemTime(at("2026-03-10"));
      const history = await service.getDeveloperDayView("2026-03-05", "dev-1", { viewer: { kind: "manager", accountId: "manager-1" } });
      expect(history.day.signals.freshness).toMatchObject({ clock: "manager_touch", workingDaysSinceTouch: 3 });
      expect(history.day.signals.freshness.lastManagerTouchAt).toBeUndefined();
      const days = await db.select().from(teamTrackerDays).where(and(eq(teamTrackerDays.developerAccountId, "dev-1"), eq(teamTrackerDays.date, "2026-03-06")));
      expect(days[0]!.lastCheckInAt).toBe(at("2026-03-06").toISOString());
    });
  });
});
