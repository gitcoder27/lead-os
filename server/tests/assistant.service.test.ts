import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantStreamEvent } from "shared/types";
import { db, resetDatabase } from "./helpers/db";
import { developers } from "../src/db/schema";
import type { LlmClient, LlmMessage } from "../src/assistant/llm-client";
import { AssistantService, type AssistantAuth } from "../src/assistant/service";
import { AlertService } from "../src/services/alert.service";
import { AssistantConfigService } from "../src/services/assistant-config.service";
import { DailyNotesService } from "../src/services/daily-notes.service";
import { IssueService } from "../src/services/issue.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { SearchService } from "../src/services/search.service";
import { SettingsService } from "../src/services/settings.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { TodayService } from "../src/services/today.service";
import { WorkloadService } from "../src/services/workload.service";
import { HttpError } from "../src/middleware/errorHandler";

const WORKSPACE_ID = "default";
const DATE = "2026-03-07";

const AUTH: AssistantAuth = {
  managerAccountId: "manager-1",
  workspaceId: WORKSPACE_ID,
  displayName: "Manager One",
  role: "manager",
};

type ScriptStep = {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
};

function createScriptedClient(script: ScriptStep[]): { client: LlmClient; calls: LlmMessage[][] } {
  const calls: LlmMessage[][] = [];
  let index = 0;
  const next = (params: { messages: LlmMessage[] }) => {
    calls.push(params.messages);
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    return step;
  };
  return {
    calls,
    client: {
      chat: async (params) => {
        const step = next(params);
        return { content: step.content ?? "", toolCalls: step.toolCalls ?? [] };
      },
      chatStream: async (params, sink) => {
        const step = next(params);
        if (step.reasoning) {
          sink?.onReasoning?.(step.reasoning);
        }
        if (step.content) {
          sink?.onContent?.(step.content);
        }
        return { content: step.content ?? "", toolCalls: step.toolCalls ?? [] };
      },
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
    createLlmClient: () => client,
  });
}

async function enableCopilot(patch: Parameters<AssistantConfigService["update"]>[1] = {}) {
  await new AssistantConfigService().update(WORKSPACE_ID, { enabled: true, apiKey: "test-key", ...patch });
}

function collectEvents(): { events: AssistantStreamEvent[]; emit: (event: AssistantStreamEvent) => void } {
  const events: AssistantStreamEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

function eventTypes(events: AssistantStreamEvent[]): string[] {
  return events.map((event) => event.type);
}

async function seedDeveloper() {
  await db.insert(developers).values({
    accountId: "dev-1",
    displayName: "Alice Smith",
    email: null,
    avatarUrl: null,
    isActive: 1,
  });
}

describe("AssistantService", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    await resetDatabase();
    await seedDeveloper();
    await enableCopilot();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a read-tool loop and persists rows", async () => {
    const { client } = createScriptedClient([
      { toolCalls: [{ id: "call-1", name: "get_today_snapshot", arguments: {} }] },
      { content: "Here is your day." },
    ]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Brief me", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["tool_start", "tool_end", "message", "delta", "message", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "complete" });

    const detail = await service.getConversation(AUTH, 1);
    expect(detail.messages.map((row) => row.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(detail.messages[1]!.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      name: "get_today_snapshot",
      status: "executed",
    });
    expect(detail.messages[2]!.toolCallId).toBe("call-1");
    expect(detail.messages[3]!.content).toBe("Here is your day.");
  });

  it("stops after maxToolIterations and emits a fallback message", async () => {
    await enableCopilot({ maxToolIterations: 2 });
    const { client, calls } = createScriptedClient([
      { toolCalls: [{ id: "call-1", name: "get_today_snapshot", arguments: {} }] },
    ]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Loop forever", date: DATE }, emit);

    expect(calls).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool_start")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "complete" });
    const messageEvent = events.filter((event) => event.type === "message").at(-1);
    expect(messageEvent).toBeDefined();
    expect((messageEvent as { message: { content: string } }).message.content).toContain("tool-call limit");
  });

  it("gates write tools behind confirmation and executes on confirm", async () => {
    const { client } = createScriptedClient([
      {
        toolCalls: [
          { id: "call-1", name: "create_desk_item", arguments: { title: "Follow up with Alice", kind: "action" } },
        ],
      },
      { content: "Done — created the desk item." },
    ]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Create a follow-up", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["action_proposal", "message", "done"]);
    const proposal = events[0] as { proposal: { toolCallId: string; tool: string; status: string } };
    expect(proposal.proposal).toMatchObject({ toolCallId: "call-1", tool: "create_desk_item", status: "pending" });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "awaiting_confirmation" });

    const deskService = new ManagerDeskService(new TeamTrackerService());
    const before = await deskService.getDay(AUTH.managerAccountId, DATE, WORKSPACE_ID);
    expect(before.items).toHaveLength(0);

    const confirmRun = collectEvents();
    await service.confirmAction(
      AUTH,
      { conversationId: 1, toolCallId: "call-1", decision: "confirm", date: DATE },
      confirmRun.emit
    );

    expect(eventTypes(confirmRun.events)).toEqual([
      "tool_start",
      "tool_end",
      "action_executed",
      "delta",
      "message",
      "done",
    ]);
    const executed = confirmRun.events[2] as { ok: boolean; invalidate: string[] };
    expect(executed.ok).toBe(true);
    expect(executed.invalidate).toContain("manager-desk");
    expect(confirmRun.events.at(-1)).toMatchObject({ type: "done", status: "complete" });

    const after = await deskService.getDay(AUTH.managerAccountId, DATE, WORKSPACE_ID);
    expect(after.items.map((item) => item.title)).toContain("Follow up with Alice");
  });

  it("cancels a proposal without writing and 404s on repeat", async () => {
    const { client } = createScriptedClient([
      {
        toolCalls: [
          { id: "call-1", name: "create_desk_item", arguments: { title: "Follow up with Alice" } },
        ],
      },
    ]);
    const service = buildService(client);
    const { emit } = collectEvents();
    await service.chat(AUTH, { message: "Create a follow-up", date: DATE }, emit);

    const cancelRun = collectEvents();
    await service.confirmAction(
      AUTH,
      { conversationId: 1, toolCallId: "call-1", decision: "cancel", date: DATE },
      cancelRun.emit
    );

    expect(eventTypes(cancelRun.events)).toEqual(["message", "done"]);
    const message = cancelRun.events[0] as { message: { content: string } };
    expect(message.message.content).toBe("Cancelled — nothing was changed.");
    expect(cancelRun.events.at(-1)).toMatchObject({ type: "done", status: "complete" });

    const deskService = new ManagerDeskService(new TeamTrackerService());
    const day = await deskService.getDay(AUTH.managerAccountId, DATE, WORKSPACE_ID);
    expect(day.items).toHaveLength(0);

    const detail = await service.getConversation(AUTH, 1);
    const record = detail.messages
      .find((row) => row.role === "assistant")
      ?.toolCalls?.find((entry) => entry.id === "call-1");
    expect(record?.status).toBe("cancelled");

    await expect(
      service.confirmAction(
        AUTH,
        { conversationId: 1, toolCallId: "call-1", decision: "cancel", date: DATE },
        collectEvents().emit
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it("auto-cancels a pending proposal when a new chat message arrives", async () => {
    const { client } = createScriptedClient([
      {
        toolCalls: [
          { id: "call-1", name: "create_desk_item", arguments: { title: "Follow up with Alice" } },
        ],
      },
      { content: "Sure, moved on." },
    ]);
    const service = buildService(client);
    const { emit } = collectEvents();
    await service.chat(AUTH, { message: "Create a follow-up", date: DATE }, emit);

    const secondRun = collectEvents();
    await service.chat(
      AUTH,
      { conversationId: 1, message: "Actually, never mind", date: DATE },
      secondRun.emit
    );

    expect(secondRun.events.at(-1)).toMatchObject({ type: "done", status: "complete" });

    const detail = await service.getConversation(AUTH, 1);
    const record = detail.messages
      .find((row) => row.role === "assistant")
      ?.toolCalls?.find((entry) => entry.id === "call-1");
    expect(record?.status).toBe("cancelled");

    const toolRow = detail.messages.find((row) => row.role === "tool" && row.toolCallId === "call-1");
    expect(JSON.parse(toolRow!.content)).toEqual({ cancelled: true, reason: "user sent a new message" });
  });

  it("rejects chat when copilot is not configured", async () => {
    await resetDatabase();
    const { client } = createScriptedClient([{ content: "hi" }]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await expect(service.chat(AUTH, { message: "Hello", date: DATE }, emit)).rejects.toMatchObject({
      status: 400,
    });
    expect(events).toHaveLength(0);
  });

  it("rejects another manager's conversationId with 404", async () => {
    const { client } = createScriptedClient([{ content: "hi" }]);
    const service = buildService(client);
    const { emit } = collectEvents();
    await service.chat(AUTH, { message: "Hello", date: DATE }, emit);

    const other: AssistantAuth = { ...AUTH, managerAccountId: "manager-2" };
    await expect(
      service.chat(other, { conversationId: 1, message: "Snoop", date: DATE }, collectEvents().emit)
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.getConversation(other, 1)).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteConversation(other, 1)).rejects.toMatchObject({ status: 404 });
  });

  it("getConversation parses toolCalls and listConversations reports counts", async () => {
    const { client } = createScriptedClient([
      { toolCalls: [{ id: "call-1", name: "get_today_snapshot", arguments: {} }] },
      { content: "Done." },
    ]);
    const service = buildService(client);
    const { emit } = collectEvents();
    await service.chat(AUTH, { message: "Brief me on today", date: DATE }, emit);

    const conversations = await service.listConversations(AUTH);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ title: "Brief me on today", messageCount: 4 });

    const detail = await service.getConversation(AUTH, conversations[0]!.id);
    const assistantRow = detail.messages.find((row) => row.toolCalls?.length);
    expect(assistantRow?.toolCalls?.[0]).toMatchObject({
      name: "get_today_snapshot",
      status: "executed",
    });
  });

  it("forwards reasoning deltas before content deltas", async () => {
    const { client } = createScriptedClient([{ reasoning: "mulling it over", content: "The answer." }]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Think", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["reasoning_delta", "delta", "message", "done"]);
    expect(events[0]).toMatchObject({ type: "reasoning_delta", content: "mulling it over" });
    expect(events[1]).toMatchObject({ type: "delta", content: "The answer." });
  });

  it("emits a fallback delta when the client returns content without streaming it", async () => {
    const client: LlmClient = {
      chat: async () => ({ content: "", toolCalls: [] }),
      chatStream: async () => ({ content: "All at once.", toolCalls: [] }),
    };
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Hello", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["delta", "message", "done"]);
    expect(events[0]).toMatchObject({ type: "delta", content: "All at once." });
  });

  it("persists partial streamed content when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    const client: LlmClient = {
      chat: async () => ({ content: "", toolCalls: [] }),
      chatStream: async (_params, sink) => {
        sink?.onContent?.("Half an ans");
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    };
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Hello", date: DATE }, emit, controller.signal);

    expect(eventTypes(events)).toEqual(["delta", "message", "done"]);
    const detail = await service.getConversation(AUTH, 1);
    expect(detail.messages.at(-1)).toMatchObject({ role: "assistant", content: "Half an ans" });
  });

  it("emits follow-up suggestions after a completed answer", async () => {
    const { client } = createScriptedClient([
      { content: "Two developers are stale." },
      { content: '["Nudge stale check-ins","Show my desk","Who is overloaded?"]' },
    ]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Who is stale?", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["delta", "message", "done", "followups"]);
    const followups = events.at(-1) as { type: "followups"; items: string[] };
    expect(followups.items).toEqual(["Nudge stale check-ins", "Show my desk", "Who is overloaded?"]);
  });

  it("skips follow-ups when the suggestion call returns no JSON", async () => {
    const { client } = createScriptedClient([{ content: "Plain answer." }]);
    const service = buildService(client);
    const { events, emit } = collectEvents();

    await service.chat(AUTH, { message: "Hi", date: DATE }, emit);

    expect(eventTypes(events)).toEqual(["delta", "message", "done"]);
  });

  it("retry re-answers the last user message and discards the old turn", async () => {
    const { client } = createScriptedClient([{ content: "First answer." }, { content: "Better answer." }]);
    const service = buildService(client);
    const { emit } = collectEvents();
    await service.chat(AUTH, { message: "Brief me", date: DATE }, emit);

    const before = await service.getConversation(AUTH, 1);
    const oldAssistantId = before.messages.at(-1)!.id;

    const retryRun = collectEvents();
    await service.chat(AUTH, { conversationId: 1, retry: true, date: DATE }, retryRun.emit);

    expect(retryRun.events.at(-1)).toMatchObject({ type: "done", status: "complete" });

    const after = await service.getConversation(AUTH, 1);
    expect(after.messages.map((row) => row.role)).toEqual(["user", "assistant"]);
    const newAssistant = after.messages.at(-1)!;
    expect(newAssistant.id).not.toBe(oldAssistantId);
    expect(newAssistant.content).toBe("Better answer.");
  });

  it("rejects retry without a conversationId", async () => {
    const { client } = createScriptedClient([{ content: "hi" }]);
    const service = buildService(client);

    await expect(
      service.chat(AUTH, { retry: true, date: DATE }, collectEvents().emit)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails the stream with an HttpError when the LLM call throws", async () => {
    const client: LlmClient = {
      chat: async () => {
        throw new HttpError(502, "AI provider unreachable");
      },
      chatStream: async () => {
        throw new HttpError(502, "AI provider unreachable");
      },
    };
    const service = buildService(client);

    await expect(
      service.chat(AUTH, { message: "Hello", date: DATE }, collectEvents().emit)
    ).rejects.toMatchObject({ status: 502 });
  });
});
