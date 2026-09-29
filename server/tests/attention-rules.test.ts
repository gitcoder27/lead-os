import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { DEFAULT_ATTENTION_RULES } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers } from "../src/db/schema";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createConfigRouter } from "../src/routes/config";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
import { ATTENTION_RULE_KEYS, SettingsService } from "../src/services/settings.service";
import { serverTimeZone } from "../src/services/today-clock";

// docs/56 P1-05: the one "Attention rules" block behind /api/config/attention-rules.
const auth = new AuthService();
const settings = new SettingsService();
const app = express();
app.use(express.json());
app.use("/api/config", requireManager(auth), createConfigRouter());
app.use(notFoundHandler);
app.use(errorHandler);

const defaults = { ...DEFAULT_ATTENTION_RULES, timeZone: serverTimeZone() };

async function cookie(username: string): Promise<string> {
  const { sessionId } = await auth.authenticate(username, "secret123");
  return serializeSessionCookie(sessionId, auth.sessionMaxAgeSeconds);
}

let managerHeaders: Record<string, string> = {};

beforeEach(async () => {
  await resetDatabase();
  await auth.createUser({ username: "manager-a", displayName: "Manager", password: "secret123", role: "manager" });
  managerHeaders = { cookie: await cookie("manager-a") };
});

describe("GET /api/config/attention-rules", () => {
  it("serves the defaults from one place when nothing is saved", async () => {
    const res = await invoke(app, { method: "GET", url: "/api/config/attention-rules", headers: managerHeaders });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rules: defaults, defaults });
    expect(res.body.rules).toMatchObject({ staleHours: 4, noCurrentHours: 2, managerTouchDays: 5, jiraStaleHours: 48, dayStart: "09:00", dayEnd: "18:00" });
  });

  it("carries over values saved under the older config keys", async () => {
    await db.insert(configTable).values([
      { key: "team_tracker_stale_threshold_hours", value: "6" },
      { key: "stale_threshold_hours", value: "72" },
    ]);
    const res = await invoke(app, { method: "GET", url: "/api/config/attention-rules", headers: managerHeaders });
    expect(res.body.rules).toMatchObject({ staleHours: 6, jiraStaleHours: 72 });
  });

  it("falls back per field when a stored value is unusable", async () => {
    await db.insert(configTable).values([
      { key: ATTENTION_RULE_KEYS.dayStart, value: "19:00" },
      { key: ATTENTION_RULE_KEYS.dayEnd, value: "08:00" },
      { key: ATTENTION_RULE_KEYS.timeZone, value: "Mars/Olympus" },
      { key: ATTENTION_RULE_KEYS.noCurrentHours, value: "-3" },
    ]);
    const rules = await settings.getAttentionRules();
    expect(rules).toMatchObject({ dayStart: "09:00", dayEnd: "18:00", timeZone: serverTimeZone(), noCurrentHours: 2 });
  });
});

describe("PUT /api/config/attention-rules", () => {
  it("saves a partial update and leaves the other rules alone", async () => {
    const res = await invoke(app, {
      method: "PUT",
      url: "/api/config/attention-rules",
      headers: managerHeaders,
      body: { staleHours: 6, dayStart: "08:30", dayEnd: "17:30", timeZone: "Europe/Berlin" },
    });
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual({ ...defaults, staleHours: 6, dayStart: "08:30", dayEnd: "17:30", timeZone: "Europe/Berlin" });
    expect(res.body.defaults).toEqual(defaults);
    expect(await settings.getAttentionRules()).toEqual(res.body.rules);
  });

  it.each([
    [{ staleHours: 0 }, undefined],
    [{ jiraStaleHours: 1.5 }, undefined],
    [{ managerTouchDays: 61 }, undefined],
    [{ dayStart: "9:00" }, "HH:MM"],
    [{ dayStart: "18:00", dayEnd: "09:00" }, "Day start must be before day end"],
    [{ dayStart: "18:00" }, "Day start must be before day end"],
    [{ timeZone: "Not/AZone" }, "valid IANA zone"],
    [{ workingDays: [1, 2] }, undefined],
  ])("rejects %j without saving anything", async (body, message) => {
    const res = await invoke(app, { method: "PUT", url: "/api/config/attention-rules", headers: managerHeaders, body });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe(400);
    if (message) expect(res.body.error).toContain(message);
    expect(await settings.getAttentionRules()).toEqual(defaults);
  });

  it("is manager-only", async () => {
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Dev", email: null, avatarUrl: null, isActive: 1 });
    await auth.createUser({ username: "dev-user", displayName: "Dev", password: "secret123", role: "developer", developerAccountId: "dev-1" });
    const headers = { cookie: await cookie("dev-user") };
    expect((await invoke(app, { method: "GET", url: "/api/config/attention-rules", headers })).status).toBe(403);
    expect((await invoke(app, { method: "PUT", url: "/api/config/attention-rules", headers, body: { staleHours: 9 } })).status).toBe(403);
    expect((await settings.getAttentionRules()).staleHours).toBe(4);
  });
});

describe("legacy /api/config Jira stale hours", () => {
  it("reads through the Attention rules and is no longer reset by a save that omits it", async () => {
    await invoke(app, { method: "PUT", url: "/api/config/attention-rules", headers: managerHeaders, body: { jiraStaleHours: 96 } });
    expect((await invoke(app, { method: "GET", url: "/api/config", headers: managerHeaders })).body.staleThresholdHours).toBe(96);

    const save = await invoke(app, {
      method: "PUT",
      url: "/api/config",
      headers: managerHeaders,
      body: { jiraBaseUrl: "https://tenant.atlassian.net", jiraEmail: "ops@example.com", jiraProjectKey: "AM", jiraApiToken: "token" },
    });
    expect(save.status).toBe(200);
    expect((await settings.getAttentionRules()).jiraStaleHours).toBe(96);
  });

  it("holds the legacy field to the same limits as the Attention rules", async () => {
    const base = { jiraBaseUrl: "https://tenant.atlassian.net", jiraEmail: "ops@example.com", jiraProjectKey: "AM", jiraApiToken: "token" };
    for (const staleThresholdHours of [0, 2161, 1.5]) {
      const res = await invoke(app, { method: "PUT", url: "/api/config", headers: managerHeaders, body: { ...base, staleThresholdHours } });
      expect(res.status).toBe(400);
    }
    expect((await settings.getAttentionRules()).jiraStaleHours).toBe(48);
    const ok = await invoke(app, { method: "PUT", url: "/api/config", headers: managerHeaders, body: { ...base, staleThresholdHours: 72 } });
    expect(ok.status).toBe(200);
    expect((await settings.getAttentionRules()).jiraStaleHours).toBe(72);
  });
});
