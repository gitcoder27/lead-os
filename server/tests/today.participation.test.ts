import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { enableCollabParticipation } from "./helpers/team-mode";
import { configTable, developers } from "../src/db/schema";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import type { TodayResponse } from "shared/types";

/**
 * docs/56 P1-03: developer-participation flows on /api/today are suppressed
 * in solo mode and for non-participating developers, and unchanged for a
 * collab team whose developers check in.
 *
 * Scenario: dev-1 is blocked (manager-set), dev-2 has nothing planned. Both
 * have no current work and no check-in. Times are Asia/Kolkata, on a Monday.
 * docs/56 P1-05: hour rules count working time (09:00 start), so the flows
 * are checked at 11:30 with a 2h stale threshold; 08:00 is always quiet.
 */
const DATE = "2026-03-09";
const TZ = "Asia/Kolkata";
const EARLY = "2026-03-09T02:30:00.000Z"; // 08:00 IST, before day start
const MORNING = "2026-03-09T06:00:00.000Z"; // 11:30 IST, standup_window
const MIDDAY = "2026-03-09T06:30:00.000Z"; // 12:00 IST, midday_check
const WRAP_UP = "2026-03-09T10:30:00.000Z"; // 16:00 IST, wrap_up

const authService = new AuthService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const issueService = new IssueService(undefined, undefined, trackerService);
const todayService = new TodayService(issueService, trackerService, managerDeskService, {
  getLastSyncLog: async () => undefined,
  getRuntimeStatus: () => ({ status: "idle" }),
}, { todayCacheTtlMs: 0 });

function createTestApp(today: TodayService = todayService) {
  return createApp({
    issueService,
    workloadService: {} as any,
    alertService: {} as any,
    automationService: {} as any,
    syncEngine: { getLastSyncLog: async () => undefined, getRuntimeStatus: () => ({ status: "idle" }) } as any,
    backupService: {} as any,
    tagService: {} as any,
    teamTrackerService: trackerService,
    authService,
    myDayService: {} as any,
    managerDeskService,
    todayService: today,
    searchService: {} as any,
    workSavedViewsService: {} as any,
  });
}

let cookie = "";
let workspaceId = "default";

async function getToday(at: string): Promise<TodayResponse> {
  vi.setSystemTime(new Date(at));
  const response = await invoke(createTestApp(), { method: "GET", url: `/api/today?date=${DATE}&tz=${encodeURIComponent(TZ)}`, headers: { cookie } });
  expect(response.status).toBe(200);
  return response.body as TodayResponse;
}

async function ask(developerAccountId: string) {
  return invoke(createTestApp(), {
    method: "POST",
    url: "/api/manager-actions/commands",
    headers: { cookie },
    body: {
      date: DATE,
      command: { kind: "ask_check_in", label: "Ask for update", target: { type: "developer", view: "team", developerAccountId, date: DATE }, confirm: false },
    },
  });
}

/** Every command kind offered anywhere for a developer (rows, pulse, focus). */
function commandKindsFor(today: TodayResponse, accountId: string): string[] {
  const kinds: string[] = [];
  const visit = (value: unknown, owner?: string): void => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, owner));
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const target = record.target as { developerAccountId?: string } | undefined;
    const who = (record.accountId as string | undefined) ?? target?.developerAccountId ?? owner;
    if (typeof record.kind === "string" && record.target && who === accountId) kinds.push(record.kind);
    for (const child of Object.values(record)) visit(child, who);
  };
  visit(today);
  return kinds;
}

function allRows(today: TodayResponse) {
  return [...today.actionItems, ...(today.overflowActionItems ?? [])];
}

function developerRow(today: TodayResponse, accountId: string) {
  return allRows(today).find((item) => item.target.developerAccountId === accountId);
}

describe("GET /api/today developer-participation flows (P1-03)", () => {
  beforeEach(async () => {
    // Only the clock: faking setImmediate stalls Express's error path.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(MORNING));
    await resetDatabase();
    await db.insert(developers).values([
      { accountId: "dev-1", displayName: "Alice Smith", email: null, avatarUrl: null, isActive: 1 },
      { accountId: "dev-2", displayName: "Bob Jones", email: null, avatarUrl: null, isActive: 1 },
    ]);
    const user = await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
    workspaceId = user.workspaceId ?? "default";
    cookie = serializeSessionCookie((await authService.authenticate("manager", "secret123")).sessionId);
    // Phase 3 turns on the standup focus and the "Start standup" row.
    await db.insert(configTable).values([
      { workspaceId, key: "tasks_phase1_enabled", value: "true" },
      { workspaceId, key: "tasks_phase2_stage", value: "2c" },
      { workspaceId, key: "tasks_phase3_enabled", value: "true" },
      { workspaceId, key: "attention_time_zone", value: TZ },
      { workspaceId, key: "team_tracker_stale_threshold_hours", value: "2" },
    ]);
    await trackerService.updateDay("dev-1", DATE, { status: "blocked" }, workspaceId, { type: "manager" });
    await trackerService.ensureDay(DATE, "dev-2", workspaceId);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("solo", () => {
    it("emits no stale_check_in rows, no ask_check_in commands and no Stale check-ins metric", async () => {
      const today = await getToday(MORNING);

      expect(allRows(today).some((item) => item.type === "stale_check_in")).toBe(false);
      expect(JSON.stringify(today)).not.toContain("\"ask_check_in\"");
      expect(today.summary.map((metric) => metric.id)).not.toContain("stale");
      // Blocked still surfaces; asking does not.
      expect(developerRow(today, "dev-1")).toMatchObject({ type: "developer_attention" });
      expect(developerRow(today, "dev-1")?.secondaryActions.map((action) => action.kind)).not.toContain("ask_check_in");
    });

    it("drops no-current-only people from the pulse and 'N stale' from the standup row", async () => {
      const today = await getToday(MORNING);

      expect(today.teamPulse.map((item) => item.accountId)).toEqual(["dev-1"]);
      const standup = allRows(today).find((item) => item.id === "today-standup-start");
      expect(standup?.context).toBe("1 blocked");
    });

    it("has no 'Quiet since standup' people at midday and no 'No check-in today' at wrap-up", async () => {
      const midday = await getToday(MIDDAY);
      expect(midday.focus).toMatchObject({ stage: "midday_check", midday: { silentSinceStandup: [] } });

      const wrapUp = await getToday(WRAP_UP);
      expect(wrapUp.focus).toMatchObject({ stage: "wrap_up", wrapUp: { missingCheckIns: [] } });
    });

    it("words the pulse freshness as the manager's last touch, never as a missing check-in", async () => {
      // The opt-in puts never-touched dev-2 in the pulse; dev-1's blocked status was set by the manager.
      await db.insert(configTable).values({ workspaceId, key: "team_tracker_solo_no_current_enabled", value: "true" });
      const today = await getToday(MORNING);
      const byId = new Map(today.teamPulse.map((item) => [item.accountId, item]));
      expect(byId.get("dev-2")?.lastUpdate).toBe("Not touched yet");
      expect(byId.get("dev-1")?.lastUpdate).toBe("Touched just now");
      expect(JSON.stringify(today)).not.toContain("No check-in\"");
      expect(developerRow(today, "dev-1")?.freshness).toBe("Touched just now");
    });

    it("hides a lingering ask and refuses a new one", async () => {
      await todayService.state.createCheckInAsk({ managerAccountId: "manager", developerAccountId: "dev-1", date: DATE, title: "Check-in request: quick status update" }, workspaceId);
      const today = await getToday(MORNING);
      expect(today.checkInAsks).toEqual([]);
      expect(today.teamPulse.find((item) => item.accountId === "dev-1")).not.toHaveProperty("askedAt");

      const response = await ask("dev-1");
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ status: 409, error: expect.stringContaining("doesn't check in") });
    });
  });

  describe("mode and rule changes", () => {
    // The in-process `invoke` helper never emits `finish`, which is what the
    // cache-clearing middleware listens for, so this one talks over a socket.
    it("are visible on the next /api/today even with the 25s cache on (F1)", async () => {
      const cached = new TodayService(issueService, trackerService, managerDeskService, {
        getLastSyncLog: async () => undefined,
        getRuntimeStatus: () => ({ status: "idle" }),
      }, { todayCacheTtlMs: 60_000 });
      const server = createTestApp(cached).listen(0, "127.0.0.1");
      try {
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const call = (path: string, init: RequestInit = {}) =>
          fetch(`${base}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
        const metrics = async () =>
          ((await (await call(`/api/today?date=${DATE}&tz=${encodeURIComponent(TZ)}`)).json()) as TodayResponse).summary.map((metric) => metric.id);
        vi.setSystemTime(new Date(MORNING));

        // Solo: no stale-check-in metric.
        expect(await metrics()).not.toContain("stale");
        // Flipped out-of-band (as the CLI does): the cached payload is still served.
        await enableCollabParticipation(["dev-1"], workspaceId);
        expect(await metrics()).not.toContain("stale");

        // A config write drops the cache; the next read reflects the mode.
        const put = await call("/api/config/team-mode", { method: "PUT", body: JSON.stringify({ teamMode: "collab" }) });
        expect(put.status).toBe(200);
        expect(await metrics()).toContain("stale");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe("collab with a non-participating developer", () => {
    beforeEach(async () => {
      await enableCollabParticipation(["dev-1"], workspaceId);
    });

    it("keeps check-in flows for the participating developer only", async () => {
      const today = await getToday(MORNING);

      expect(developerRow(today, "dev-1")?.type).toBe("stale_check_in");
      expect(commandKindsFor(today, "dev-1")).toContain("ask_check_in");
      expect(commandKindsFor(today, "dev-2")).not.toContain("ask_check_in");
      expect(developerRow(today, "dev-2")?.type).not.toBe("stale_check_in");
      // The metric exists in collab and counts only people on the check-in clock.
      expect(today.summary.find((metric) => metric.id === "stale")).toMatchObject({ value: 1 });
      expect(allRows(today).find((item) => item.id === "today-standup-start")?.context).toBe("1 blocked · 1 stale");
      // Collab keeps no-current people in the pulse, but without an ask.
      expect(today.teamPulse.map((item) => item.accountId).sort()).toEqual(["dev-1", "dev-2"]);
    });

    it("limits 'Quiet since standup' and 'No check-in today' to the participating developer", async () => {
      const midday = await getToday(MIDDAY);
      const silent = midday.focus && "midday" in midday.focus ? midday.focus.midday.silentSinceStandup : [];
      expect(silent.map((person) => person.accountId)).toEqual(["dev-1"]);

      const wrapUp = await getToday(WRAP_UP);
      const missing = wrapUp.focus && "wrapUp" in wrapUp.focus ? wrapUp.focus.wrapUp.missingCheckIns : [];
      expect(missing.map((person) => person.accountId)).toEqual(["dev-1"]);
      expect(missing[0]?.primaryAction).toMatchObject({ kind: "ask_check_in" });
    });

    it("does not let a manager's note close 'Quiet since standup' or 'No check-in today' (P0-V2)", async () => {
      await trackerService.addCheckIn("dev-1", DATE, { summary: "Manager note" }, { type: "manager" });
      const midday = await getToday(MIDDAY);
      const silent = midday.focus && "midday" in midday.focus ? midday.focus.midday.silentSinceStandup : [];
      expect(silent.map((person) => person.accountId)).toEqual(["dev-1"]);
      const wrapUp = await getToday(WRAP_UP);
      const missing = wrapUp.focus && "wrapUp" in wrapUp.focus ? wrapUp.focus.wrapUp.missingCheckIns : [];
      expect(missing.map((person) => person.accountId)).toEqual(["dev-1"]);

      await trackerService.addCheckIn("dev-1", DATE, { summary: "My own update" }, { type: "developer", accountId: "dev-1" });
      const answered = await getToday(WRAP_UP);
      const stillMissing = answered.focus && "wrapUp" in answered.focus ? answered.focus.wrapUp.missingCheckIns : [];
      expect(stillMissing).toEqual([]);
    });

    it("accepts an ask for the participating developer and refuses the other", async () => {
      expect((await ask("dev-1")).status).toBe(200);
      expect((await ask("dev-2")).status).toBe(409);
    });
  });

  describe("collab, everyone participates (unchanged)", () => {
    beforeEach(async () => {
      await enableCollabParticipation(["dev-1", "dev-2"], workspaceId);
    });

    it("reads nobody as stale before day start (P1-05 morning noise)", async () => {
      const early = await getToday(EARLY);
      expect(allRows(early).some((item) => item.type === "stale_check_in")).toBe(false);
      expect(early.summary.find((metric) => metric.id === "stale")?.value ?? 0).toBe(0);
    });

    it("keeps every check-in flow as before", async () => {
      const morning = await getToday(MORNING);
      expect(developerRow(morning, "dev-1")?.type).toBe("stale_check_in");
      expect(developerRow(morning, "dev-2")?.type).toBe("stale_check_in");
      expect(commandKindsFor(morning, "dev-1")).toContain("ask_check_in");
      expect(commandKindsFor(morning, "dev-2")).toContain("ask_check_in");
      expect(morning.summary.find((metric) => metric.id === "stale")).toMatchObject({ label: "Stale check-ins", value: 2 });
      expect(allRows(morning).find((item) => item.id === "today-standup-start")?.context).toBe("1 blocked · 2 stale");
      expect(morning.teamPulse.map((item) => item.accountId).sort()).toEqual(["dev-1", "dev-2"]);

      const midday = await getToday(MIDDAY);
      const silent = midday.focus && "midday" in midday.focus ? midday.focus.midday.silentSinceStandup : [];
      expect(silent.map((person) => person.accountId).sort()).toEqual(["dev-1", "dev-2"]);

      const wrapUp = await getToday(WRAP_UP);
      const missing = wrapUp.focus && "wrapUp" in wrapUp.focus ? wrapUp.focus.wrapUp.missingCheckIns : [];
      expect(missing.map((person) => person.accountId).sort()).toEqual(["dev-1", "dev-2"]);

      expect((await ask("dev-2")).status).toBe(200);
      const asked = await getToday(WRAP_UP);
      expect(asked.checkInAsks?.map((entry) => entry.developerAccountId)).toEqual(["dev-2"]);
    });
  });
});
