import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AssistantStreamEvent } from "shared/types";
import { invoke } from "./helpers/http";
import { resetDatabase } from "./helpers/db";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { AuthService } from "../src/services/auth.service";
import { createAssistantRouter } from "../src/routes/assistant";
import type { LlmClient } from "../src/assistant/llm-client";
import { AssistantService } from "../src/assistant/service";
import { AlertService } from "../src/services/alert.service";
import { AssistantConfigService } from "../src/services/assistant-config.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { AutomationService } from "../src/services/automation.service";
import { SearchService } from "../src/services/search.service";
import { SettingsService } from "../src/services/settings.service";
import { TagService } from "../src/services/tag.service";
import { WorkSavedViewsService } from "../src/services/work-saved-views.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { WorkloadService } from "../src/services/workload.service";

const WORKSPACE_ID = "default";
const DATE = "2026-03-07";

type ScriptStep = {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
};

function createScriptedClient(script: ScriptStep[]): LlmClient {
  let index = 0;
  const next = () => {
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    return step;
  };
  return {
    chat: async () => {
      const step = next();
      return { content: step.content ?? "", toolCalls: step.toolCalls ?? [] };
    },
    chatStream: async (_params, sink) => {
      const step = next();
      if (step.reasoning) {
        sink?.onReasoning?.(step.reasoning);
      }
      if (step.content) {
        sink?.onContent?.(step.content);
      }
      return { content: step.content ?? "", toolCalls: step.toolCalls ?? [] };
    },
  };
}

const syncEngineStub = {
  getRuntimeStatus: () => ({ status: "idle" as const }),
  getLastSyncLog: async () => undefined,
  isAutoSyncEnabled: async () => false,
  syncNow: async () => ({
    status: "success" as const,
    issuesSynced: 0,
    startedAt: "",
    completedAt: "",
  }),
};

function buildService(client: LlmClient): AssistantService {
  const settingsService = new SettingsService();
  const teamTrackerService = new TeamTrackerService();
  const managerDeskService = new ManagerDeskService(teamTrackerService);
  const issueService = new IssueService(undefined, settingsService, teamTrackerService);
  const workloadService = new WorkloadService();
  const alertService = new AlertService(workloadService, settingsService);
  const dailyNotesService = new DailyNotesService(managerDeskService);
  const searchService = new SearchService(settingsService, dailyNotesService);
  const todayService = new TodayService(issueService, teamTrackerService, managerDeskService, syncEngineStub);

  return new AssistantService({
    todayService,
    teamTrackerService,
    managerDeskService,
    issueService,
    dailyNotesService,
    workloadService,
    alertService,
    searchService,
    syncEngine: syncEngineStub,
    tagService: new TagService(),
    workSavedViewsService: new WorkSavedViewsService(),
    automationService: new AutomationService(workloadService),
    settingsService,
    createLlmClient: () => client,
  });
}

function createTestApp(
  service: AssistantService,
  options: { auth: "manager" | "developer" | "none" } = { auth: "manager" }
) {
  const app = express();
  app.use(express.json());

  if (options.auth !== "none") {
    app.use((req, _res, next) => {
      req.auth = {
        sessionId: "test-session",
        user: {
          username: "manager",
          accountId: "manager-1",
          workspaceId: WORKSPACE_ID,
          displayName: "Manager One",
          role: options.auth === "manager" ? "manager" : "developer",
        },
      };
      next();
    });
  }

  app.use("/api/assistant", requireManager(new AuthService()), createAssistantRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function parseNdjson(raw: string): AssistantStreamEvent[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AssistantStreamEvent);
}

describe("assistant routes", () => {
  beforeEach(async () => {
    await resetDatabase();
    await new AssistantConfigService().update(WORKSPACE_ID, { enabled: true, apiKey: "test-key" });
  });

  it("returns 401 when unauthenticated", async () => {
    const app = createTestApp(buildService(createScriptedClient([{ content: "hi" }])), { auth: "none" });
    const res = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Hello", date: DATE },
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ status: 401 });
  });

  it("returns 403 for developer role", async () => {
    const app = createTestApp(buildService(createScriptedClient([{ content: "hi" }])), { auth: "developer" });
    const res = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Hello", date: DATE },
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ status: 403 });
  });

  it("streams NDJSON events for POST /chat", async () => {
    const app = createTestApp(
      buildService(
        createScriptedClient([
          { toolCalls: [{ id: "call-1", name: "get_today_snapshot", arguments: {} }] },
          { content: "Here is your day." },
        ])
      )
    );

    const res = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Brief me", date: DATE },
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.headers["cache-control"]).toBe("no-store");

    const events = parseNdjson(res.body);
    expect(events.map((event) => event.type)).toEqual(["tool_start", "tool_end", "message", "delta", "message", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "complete" });
  });

  it("returns 400 JSON for a missing date", async () => {
    const app = createTestApp(buildService(createScriptedClient([{ content: "hi" }])));
    const res = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Hello" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400 });
    expect(typeof res.body.error).toBe("string");
  });

  it("returns 400 JSON when copilot is not configured", async () => {
    await resetDatabase();
    const app = createTestApp(buildService(createScriptedClient([{ content: "hi" }])));
    const res = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Hello", date: DATE },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400 });
  });

  it("runs the confirm flow end-to-end", async () => {
    const app = createTestApp(
      buildService(
        createScriptedClient([
          {
            toolCalls: [
              { id: "call-1", name: "create_desk_item", arguments: { title: "Follow up with Alice" } },
            ],
          },
          { content: "Done." },
        ])
      )
    );

    const chatRes = await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "Create a follow-up", date: DATE },
    });
    expect(chatRes.status).toBe(200);
    const chatEvents = parseNdjson(chatRes.body);
    expect(chatEvents.at(-1)).toMatchObject({ type: "done", status: "awaiting_confirmation" });
    const proposal = chatEvents.find((event) => event.type === "action_proposal") as
      | { proposal: { conversationId: number; toolCallId: string } }
      | undefined;
    expect(proposal).toBeDefined();

    const confirmRes = await invoke(app, {
      method: "POST",
      url: "/api/assistant/actions/confirm",
      body: {
        conversationId: proposal!.proposal.conversationId,
        toolCallId: proposal!.proposal.toolCallId,
        decision: "confirm",
        date: DATE,
      },
    });
    expect(confirmRes.status).toBe(200);
    const confirmEvents = parseNdjson(confirmRes.body);
    expect(confirmEvents.map((event) => event.type)).toContain("action_executed");
    expect(confirmEvents.at(-1)).toMatchObject({ type: "done", status: "complete" });
  });

  it("lists, reads, and deletes conversations", async () => {
    const app = createTestApp(buildService(createScriptedClient([{ content: "Done." }])));

    await invoke(app, {
      method: "POST",
      url: "/api/assistant/chat",
      body: { message: "First thread", date: DATE },
    });

    const listRes = await invoke(app, { method: "GET", url: "/api/assistant/conversations" });
    expect(listRes.status).toBe(200);
    expect(listRes.body.conversations).toHaveLength(1);
    expect(listRes.body.conversations[0]).toMatchObject({ title: "First thread", messageCount: 2 });

    const detailRes = await invoke(app, { method: "GET", url: "/api/assistant/conversations/1" });
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.messages.map((row: { role: string }) => row.role)).toEqual(["user", "assistant"]);

    const deleteRes = await invoke(app, { method: "DELETE", url: "/api/assistant/conversations/1" });
    expect(deleteRes.status).toBe(204);

    const goneRes = await invoke(app, { method: "GET", url: "/api/assistant/conversations/1" });
    expect(goneRes.status).toBe(404);
  });
});
