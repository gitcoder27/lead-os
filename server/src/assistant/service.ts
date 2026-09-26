import { TaskKeysService } from "../services/task-keys.service";
import { OneOnOneService } from "../services/one-on-one.service";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import type {
  AssistantActionConfirmRequest,
  AssistantChatRequest,
  AssistantConversation,
  AssistantConversationDetail,
  AssistantMemory,
  AssistantMessage,
  AssistantRole,
  AssistantStreamEvent,
  AssistantToolCallRecord,
  UserRole,
} from "shared/types";
import { db } from "../db/connection";
import { assistantConversations, assistantMessages } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { AssistantConfigService, type ResolvedAiAssistantConfig } from "../services/assistant-config.service";
import { normalizeWorkspaceId } from "../services/workspace.service";
import { logger } from "../utils/logger";
import { OpenAiCompatibleClient, type LlmClient, type LlmMessage, type LlmToolDefinition } from "./llm-client";
import { buildSystemPrompt, type AssistantContextCard } from "./prompts";
import {
  createAssistantTools,
  toLlmToolDefinitions,
  type AssistantServices,
  type AssistantToolContext,
  type AssistantToolDefinition,
} from "./tools";

const MAX_TOOL_CALLS_PER_TURN_FALLBACK =
  "I hit the tool-call limit for this turn. Here's what I found so far — could you narrow the request?";
const FOLLOWUP_SUGGESTION_PROMPT =
  "Suggest up to 3 short follow-up questions or requests the manager might send next about their LeadOS workspace. Reply with a JSON array of strings only — each under 10 words, no commentary, no markdown.";
const MAX_HISTORY_ROWS = 60;
const REQUEST_BUDGET_MS = 60_000;
const RATE_LIMIT_PER_HOUR = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONVERSATIONS = 30;

type ConversationRow = typeof assistantConversations.$inferSelect;
type MessageRow = typeof assistantMessages.$inferSelect;

type Emit = (event: AssistantStreamEvent) => void;

export interface AssistantAuth {
  managerAccountId: string;
  workspaceId: string;
  displayName: string;
  role: UserRole;
}

export interface AssistantServiceDeps extends AssistantServices {
  configService?: AssistantConfigService;
  createLlmClient?: (cfg: { baseUrl: string; apiKey: string; model: string }) => LlmClient;
  tools?: AssistantToolDefinition[];
  now?: () => Date;
}

function parseToolCalls(raw: string | null): AssistantToolCallRecord[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AssistantToolCallRecord[]) : [];
  } catch {
    return [];
  }
}

function toAssistantMessage(row: MessageRow): AssistantMessage {
  const records = parseToolCalls(row.toolCalls);
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as AssistantRole,
    content: row.content,
    toolCalls: records.length > 0 ? records : undefined,
    toolCallId: row.toolCallId ?? undefined,
    createdAt: row.createdAt,
  };
}

function toLlmMessage(row: MessageRow): LlmMessage {
  if (row.role === "assistant") {
    const records = parseToolCalls(row.toolCalls);
    return {
      role: "assistant",
      content: row.content,
      ...(records.length > 0
        ? {
            tool_calls: records.map((record) => ({
              id: record.id,
              type: "function" as const,
              function: { name: record.name, arguments: JSON.stringify(record.arguments) },
            })),
          }
        : {}),
    };
  }
  if (row.role === "tool") {
    return { role: "tool", tool_call_id: row.toolCallId ?? "", content: row.content };
  }
  return { role: "user", content: row.content };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Tool failed";
}

/** Extracts a JSON string array from model output that may wrap it in prose/fences. */
function parseFollowups(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 80)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export class AssistantService {
  private readonly configService: AssistantConfigService;
  private readonly createLlmClient: (cfg: { baseUrl: string; apiKey: string; model: string }) => LlmClient;
  private readonly tools: AssistantToolDefinition[];
  private readonly toolByName: Map<string, AssistantToolDefinition>;
  private readonly llmTools: LlmToolDefinition[];
  private readonly now: () => Date;
  private readonly rateLimitHits = new Map<string, number[]>();

  constructor(private readonly deps: AssistantServiceDeps) {
    this.configService = deps.configService ?? new AssistantConfigService();
    this.createLlmClient =
      deps.createLlmClient ?? ((cfg) => new OpenAiCompatibleClient({ ...cfg }));
    this.tools = deps.tools ?? createAssistantTools();
    this.toolByName = new Map([...this.tools, ...(deps.tools ? [] : createAssistantTools(true))].map((tool) => [tool.name, tool]));
    this.llmTools = toLlmToolDefinitions(this.tools);
    this.now = deps.now ?? (() => new Date());
  }

  async chat(auth: AssistantAuth, request: AssistantChatRequest, emit: Emit, signal?: AbortSignal): Promise<void> {
    const config = await this.assertConfigured(auth.workspaceId);
    this.assertRateLimit(auth.workspaceId, auth.managerAccountId);
    if (request.retry && request.conversationId === undefined) {
      throw new HttpError(400, "conversationId is required to retry");
    }
    if (!request.retry && !request.message?.trim()) {
      throw new HttpError(400, "message is required");
    }
    const conversation = await this.loadOrCreateConversation(auth, request);
    if (request.retry) {
      const lastUser = await this.getLastMessageByRole(conversation.id, "user");
      if (!lastUser) {
        throw new HttpError(400, "Nothing to retry");
      }
      // Drop the previous assistant turn; the loop re-answers the last user message.
      await db
        .delete(assistantMessages)
        .where(and(eq(assistantMessages.conversationId, conversation.id), gt(assistantMessages.id, lastUser.id)));
    } else {
      await this.cancelPendingProposals(conversation.id, "user sent a new message");
      await this.appendMessage(conversation.id, "user", request.message!.trim());
    }
    const budget = this.createBudget(signal);
    try {
      await this.runLoop(
        auth,
        conversation.id,
        request.date,
        request.currentView,
        config,
        emit,
        budget.signal,
        request.pageContext?.params
      );
    } finally {
      budget.dispose();
    }
  }

  async confirmAction(
    auth: AssistantAuth,
    request: AssistantActionConfirmRequest,
    emit: Emit,
    signal?: AbortSignal
  ): Promise<void> {
    const config = await this.assertConfigured(auth.workspaceId);
    this.assertRateLimit(auth.workspaceId, auth.managerAccountId);
    const conversation = await this.getOwnedConversation(auth, request.conversationId);
    const lastAssistant = await this.getLastAssistantMessage(conversation.id);
    const records = lastAssistant?.toolCalls ?? [];
    const record = records.find((entry) => entry.id === request.toolCallId && entry.status === "pending");
    if (!lastAssistant || !record) {
      throw new HttpError(404, "Proposal not found or already resolved");
    }
    const tool = this.toolByName.get(record.name);

    if (request.decision === "cancel") {
      record.status = "cancelled";
      await this.updateToolCallRecords(lastAssistant.id, records);
      await this.appendMessage(
        conversation.id,
        "tool",
        JSON.stringify({ cancelled: true, reason: "user declined" }),
        { toolCallId: record.id }
      );
      if (records.some((entry) => entry.status === "pending")) {
        emit({ type: "done", conversationId: conversation.id, status: "awaiting_confirmation" });
        return;
      }
      const row = await this.appendMessage(conversation.id, "assistant", "Cancelled — nothing was changed.");
      emit({ type: "message", message: toAssistantMessage(row) });
      emit({ type: "done", conversationId: conversation.id, status: "complete" });
      return;
    }

    const outcome = await this.executeToolCall(
      tool,
      record.id,
      record.name,
      record.arguments,
      this.toolContext(auth, request.date),
      conversation.id,
      emit
    );
    record.status = outcome.ok ? "confirmed" : "failed";
    if (outcome.ok) {
      record.resultSummary = outcome.summary;
    } else {
      record.error = outcome.summary;
    }
    await this.updateToolCallRecords(lastAssistant.id, records);
    await this.appendMessage(conversation.id, "tool", JSON.stringify(outcome.result), { toolCallId: record.id });
    emit({
      type: "action_executed",
      conversationId: conversation.id,
      toolCallId: record.id,
      tool: record.name,
      ok: outcome.ok,
      summary: outcome.summary,
      invalidate: tool?.invalidate ?? [],
    });

    if (records.some((entry) => entry.status === "pending")) {
      emit({ type: "done", conversationId: conversation.id, status: "awaiting_confirmation" });
      return;
    }

    const budget = this.createBudget(signal);
    try {
      await this.runLoop(auth, conversation.id, request.date, undefined, config, emit, budget.signal);
    } finally {
      budget.dispose();
    }
  }

  async listConversations(auth: AssistantAuth): Promise<AssistantConversation[]> {
    const rows = await db
      .select({
        id: assistantConversations.id,
        title: assistantConversations.title,
        createdAt: assistantConversations.createdAt,
        updatedAt: assistantConversations.updatedAt,
        messageCount: count(assistantMessages.id),
      })
      .from(assistantConversations)
      .leftJoin(assistantMessages, eq(assistantMessages.conversationId, assistantConversations.id))
      .where(
        and(
          eq(assistantConversations.workspaceId, auth.workspaceId),
          eq(assistantConversations.managerAccountId, auth.managerAccountId)
        )
      )
      .groupBy(assistantConversations.id)
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(MAX_CONVERSATIONS);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount,
    }));
  }

  async getConversation(auth: AssistantAuth, conversationId: number): Promise<AssistantConversationDetail> {
    const conversation = await this.getOwnedConversation(auth, conversationId);
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, conversation.id))
      .orderBy(assistantMessages.createdAt, assistantMessages.id);
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: rows.length,
      },
      messages: rows.map(toAssistantMessage),
    };
  }

  async deleteConversation(auth: AssistantAuth, conversationId: number): Promise<void> {
    const conversation = await this.getOwnedConversation(auth, conversationId);
    await db.delete(assistantConversations).where(eq(assistantConversations.id, conversation.id));
  }

  async listMemories(auth: AssistantAuth): Promise<AssistantMemory[]> {
    return this.deps.memoryService.list(auth.managerAccountId, auth.workspaceId);
  }

  async deleteMemory(auth: AssistantAuth, memoryId: number): Promise<void> {
    await this.deps.memoryService.remove(auth.managerAccountId, memoryId, auth.workspaceId);
  }

  async clearMemories(auth: AssistantAuth): Promise<void> {
    await this.deps.memoryService.clear(auth.managerAccountId, auth.workspaceId);
  }

  private async assertConfigured(workspaceId: string): Promise<ResolvedAiAssistantConfig> {
    const config = await this.configService.getResolvedConfig(normalizeWorkspaceId(workspaceId));
    if (!config.enabled || !config.apiKey) {
      throw new HttpError(400, "Copilot is not configured. Add an API key in Settings → Copilot.");
    }
    return config;
  }

  private assertRateLimit(workspaceId: string, managerAccountId: string): void {
    const key = `${workspaceId}:${managerAccountId}`;
    const now = this.now().getTime();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const hits = (this.rateLimitHits.get(key) ?? []).filter((hit) => hit > windowStart);
    if (hits.length >= RATE_LIMIT_PER_HOUR) {
      throw new HttpError(429, "Copilot rate limit reached");
    }
    hits.push(now);
    this.rateLimitHits.set(key, hits);
  }

  private createBudget(callerSignal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Assistant request timed out", "TimeoutError"));
    }, REQUEST_BUDGET_MS);
    const onCallerAbort = () => {
      controller.abort(callerSignal?.reason ?? new DOMException("Assistant request aborted", "AbortError"));
    };
    if (callerSignal) {
      if (callerSignal.aborted) {
        onCallerAbort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      },
    };
  }

  private toolContext(auth: AssistantAuth, date: string, currentView?: string): AssistantToolContext {
    return {
      managerAccountId: auth.managerAccountId,
      workspaceId: auth.workspaceId,
      date,
      currentView,
      actor: { type: auth.role, accountId: auth.managerAccountId },
      services: this.deps,
    };
  }

  private async loadOrCreateConversation(auth: AssistantAuth, request: AssistantChatRequest): Promise<ConversationRow> {
    if (request.conversationId !== undefined) {
      return this.getOwnedConversation(auth, request.conversationId);
    }
    const now = this.now().toISOString();
    const title = (request.message ?? "").trim().slice(0, 60) || "New chat";
    const inserted = await db
      .insert(assistantConversations)
      .values({
        workspaceId: auth.workspaceId,
        managerAccountId: auth.managerAccountId,
        title,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return inserted[0]!;
  }

  private async getOwnedConversation(auth: AssistantAuth, conversationId: number): Promise<ConversationRow> {
    const rows = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.id, conversationId))
      .limit(1);
    const row = rows[0];
    if (!row || row.workspaceId !== auth.workspaceId || row.managerAccountId !== auth.managerAccountId) {
      throw new HttpError(404, "Conversation not found");
    }
    return row;
  }

  private async appendMessage(
    conversationId: number,
    role: AssistantRole,
    content: string,
    options: { toolCalls?: AssistantToolCallRecord[]; toolCallId?: string } = {}
  ): Promise<MessageRow> {
    const now = this.now().toISOString();
    const inserted = await db
      .insert(assistantMessages)
      .values({
        conversationId,
        role,
        content,
        toolCalls: options.toolCalls ? JSON.stringify(options.toolCalls) : null,
        toolCallId: options.toolCallId ?? null,
        createdAt: now,
      })
      .returning();
    await db
      .update(assistantConversations)
      .set({ updatedAt: now })
      .where(eq(assistantConversations.id, conversationId));
    return inserted[0]!;
  }

  private async updateToolCallRecords(messageId: number, records: AssistantToolCallRecord[]): Promise<void> {
    await db
      .update(assistantMessages)
      .set({ toolCalls: JSON.stringify(records) })
      .where(eq(assistantMessages.id, messageId));
  }

  private async getMessageRow(messageId: number): Promise<MessageRow | undefined> {
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.id, messageId))
      .limit(1);
    return rows[0];
  }

  private async getLastAssistantMessage(conversationId: number): Promise<AssistantMessage | undefined> {
    const row = await this.getLastMessageByRole(conversationId, "assistant");
    return row ? toAssistantMessage(row) : undefined;
  }

  private async getLastMessageByRole(conversationId: number, role: AssistantRole): Promise<MessageRow | undefined> {
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(and(eq(assistantMessages.conversationId, conversationId), eq(assistantMessages.role, role)))
      .orderBy(desc(assistantMessages.id))
      .limit(1);
    return rows[0];
  }

  /** OpenAI requires every tool call to have a tool result; unresolved proposals get cancelled rows. */
  private async cancelPendingProposals(conversationId: number, reason: string): Promise<void> {
    const lastAssistant = await this.getLastAssistantMessage(conversationId);
    const records = lastAssistant?.toolCalls;
    if (!lastAssistant || !records?.some((record) => record.status === "pending")) {
      return;
    }
    const newlyCancelled: AssistantToolCallRecord[] = [];
    for (const record of records) {
      if (record.status === "pending") {
        record.status = "cancelled";
        newlyCancelled.push(record);
      }
    }
    await this.updateToolCallRecords(lastAssistant.id, records);
    for (const record of newlyCancelled) {
      await this.appendMessage(
        conversationId,
        "tool",
        JSON.stringify({ cancelled: true, reason }),
        { toolCallId: record.id }
      );
    }
  }

  private async buildPrompt(
    auth: AssistantAuth,
    date: string,
    currentView?: string,
    style?: ResolvedAiAssistantConfig["responseStyle"],
    pageParams?: Record<string, string>,
    autoConfirm?: boolean,
    customInstructions?: string
  ): Promise<string> {
    let memories: string[] | undefined;
    try {
      memories = (await this.deps.memoryService.list(auth.managerAccountId, auth.workspaceId)).map(
        (memory) => memory.text
      );
    } catch (error) {
      logger.warn({ err: error }, "Assistant memory load failed; continuing without memories");
    }
    let contextCard: AssistantContextCard | undefined;
    try {
      const today = await this.deps.todayService.getToday(auth.managerAccountId, date, auth.workspaceId);
      contextCard = {};
      for (const metric of today.summary) {
        if (metric.id === "work") {
          contextCard.activeDefects = metric.value;
        } else if (metric.id === "team") {
          contextCard.teamSize = metric.value;
        } else if (metric.id === "stale") {
          contextCard.staleCheckIns = metric.value;
        } else if (metric.id === "promises") {
          contextCard.followUpsDue = metric.value;
        } else if (metric.id === "attention") {
          contextCard.attentionRows = metric.value;
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "Assistant context card build failed; continuing without it");
      contextCard = undefined;
    }
    return buildSystemPrompt({
      managerDisplayName: auth.displayName,
      date,
      currentView,
      pageParams,
      contextCard,
      style,
      autoConfirm,
      customInstructions,
      memories,
    });
  }

  private async loadHistory(conversationId: number, charBudget?: number): Promise<LlmMessage[]> {
    let rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, conversationId))
      .orderBy(assistantMessages.createdAt, assistantMessages.id);

    let truncated = false;
    if (rows.length > MAX_HISTORY_ROWS) {
      let cutIndex = rows.length - MAX_HISTORY_ROWS;
      while (cutIndex < rows.length && rows[cutIndex]!.role !== "user") {
        cutIndex += 1;
      }
      rows = rows.slice(cutIndex);
      truncated = true;
    }

    // Token-budget guard: when the model's context window is known, drop the
    // oldest whole turns until estimated chars fit — ~4 chars/token.
    if (charBudget) {
      const cost = (row: (typeof rows)[number]) => row.content.length + (row.toolCalls?.length ?? 0);
      let total = rows.reduce((sum, row) => sum + cost(row), 0);
      let cutIndex = 0;
      while (total > charBudget && cutIndex < rows.length) {
        total -= cost(rows[cutIndex]!);
        cutIndex += 1;
        while (cutIndex < rows.length && rows[cutIndex]!.role !== "user") {
          total -= cost(rows[cutIndex]!);
          cutIndex += 1;
        }
      }
      if (cutIndex > 0) {
        rows = rows.slice(cutIndex);
        truncated = true;
      }
    }

    const history = rows.map(toLlmMessage);
    if (truncated) {
      history.unshift(
        { role: "user", content: "[earlier messages in this conversation were truncated]" },
        { role: "assistant", content: "Understood — earlier messages were truncated." }
      );
    }
    return history;
  }

  private async executeToolCall(
    tool: AssistantToolDefinition | undefined,
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    context: AssistantToolContext,
    conversationId: number,
    emit: Emit
  ): Promise<{ ok: boolean; summary: string; result: unknown }> {
    emit({
      type: "tool_start",
      toolCallId,
      name,
      label: tool ? tool.label(args) : `Running ${name}…`,
    });
    const startedAt = Date.now();
    let outcome: { ok: boolean; summary: string; result: unknown };
    if (!tool) {
      outcome = { ok: false, summary: "Unknown tool", result: { error: "Unknown tool" } };
    } else {
      try {
        const executed = await tool.execute(args, { ...context, toolCallId });
        outcome = { ok: true, summary: executed.summary, result: executed.result };
      } catch (error) {
        const message = errorMessage(error);
        outcome = { ok: false, summary: message, result: { error: message } };
      }
    }
    const durationMs = Date.now() - startedAt;
    emit({ type: "tool_end", toolCallId, name, ok: outcome.ok, summary: outcome.summary, durationMs });
    logger.info({ conversationId, tool: name, ok: outcome.ok, durationMs }, "Assistant tool executed");
    return outcome;
  }

  private async runLoop(
    auth: AssistantAuth,
    conversationId: number,
    date: string,
    currentView: string | undefined,
    config: ResolvedAiAssistantConfig,
    emit: Emit,
    signal: AbortSignal,
    pageParams?: Record<string, string>
  ): Promise<void> {
    const llm = this.createLlmClient({ baseUrl: config.baseUrl, apiKey: config.apiKey!, model: config.model });
    const systemPrompt = await this.buildPrompt(
      auth,
      date,
      currentView,
      config.responseStyle,
      pageParams,
      config.autoConfirm,
      config.customInstructions
    );
    const context = this.toolContext(auth, date, currentView);
    const taskKeys = new TaskKeysService();
    const llmTools = !this.deps.tools && await taskKeys.canonicalEnabled(auth.workspaceId)
      ? toLlmToolDefinitions(createAssistantTools(true, {
          phase3: await taskKeys.phase3Enabled(auth.workspaceId),
          // docs/48 §4.5: 1:1 tools are only advertised while the flag is on.
          oneOnOne: await new OneOnOneService().enabled(auth.workspaceId),
        }))
      : this.llmTools;
    // Reserve ~40% of the window for system/tools/output; history gets the rest (~4 chars/token).
    const historyCharBudget = config.contextWindow ? Math.floor(config.contextWindow * 0.6 * 4) : undefined;

    for (let iteration = 0; iteration < config.maxToolIterations; iteration += 1) {
      const history = await this.loadHistory(conversationId, historyCharBudget);
      const llmStartedAt = Date.now();
      let streamedContent = "";
      let result;
      try {
        result = await llm.chatStream(
          {
            messages: [{ role: "system", content: systemPrompt }, ...history],
            tools: llmTools,
            signal,
            maxTokens: config.maxOutputTokens,
            reasoningEffort: config.reasoningEffort,
            temperature: config.temperature,
          },
          {
            onContent: (delta) => {
              streamedContent += delta;
              emit({ type: "delta", content: delta });
            },
            onReasoning: (delta) => {
              emit({ type: "reasoning_delta", content: delta });
            },
          }
        );
      } catch (error) {
        // Caller disconnected or budget expired mid-stream — persist whatever
        // was already shown so a reload sees the partial answer.
        if (signal.aborted && streamedContent) {
          const partialRow = await this.appendMessage(conversationId, "assistant", streamedContent);
          emit({ type: "message", message: toAssistantMessage(partialRow) });
          emit({ type: "done", conversationId, status: "complete" });
          return;
        }
        throw error;
      }
      if (result.content && !streamedContent) {
        // Client implementation returned content without streaming it.
        emit({ type: "delta", content: result.content });
      }
      logger.info(
        {
          conversationId,
          iteration,
          toolCalls: result.toolCalls.length,
          durationMs: Date.now() - llmStartedAt,
          ...(result.usage ? { usage: result.usage } : {}),
        },
        "Assistant LLM turn completed"
      );

      if (result.toolCalls.length === 0) {
        const row = await this.appendMessage(conversationId, "assistant", result.content);
        emit({ type: "message", message: toAssistantMessage(row) });
        emit({ type: "done", conversationId, status: "complete" });
        // Follow-up chips land after done so they never hold up the answer.
        await this.emitFollowups(llm, config, conversationId, emit, signal);
        return;
      }

      const records: AssistantToolCallRecord[] = result.toolCalls.map((call) => {
        const tool = this.toolByName.get(call.name);
        return {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          confirm: tool?.confirm ?? "never",
          status: "pending",
          summary: tool ? tool.summarize(call.arguments) : call.name,
        };
      });
      const assistantRow = await this.appendMessage(conversationId, "assistant", result.content, {
        toolCalls: records,
      });
      const recordById = new Map(records.map((record) => [record.id, record]));

      let hasProposals = false;
      for (const call of result.toolCalls) {
        const tool = this.toolByName.get(call.name);
        const record = recordById.get(call.id)!;
        // Full access mode runs confirm-gated writes inline instead of proposing them.
        if (tool?.confirm === "always" && !config.autoConfirm) {
          emit({
            type: "action_proposal",
            proposal: {
              conversationId,
              toolCallId: call.id,
              tool: tool.name,
              summary: tool.summarize(call.arguments),
              preview: call.arguments,
              jiraMutating: Boolean(tool.jiraMutating),
              status: "pending",
            },
          });
          hasProposals = true;
          continue;
        }

        const outcome = await this.executeToolCall(tool, call.id, call.name, call.arguments, context, conversationId, emit);
        record.status = outcome.ok ? "executed" : "failed";
        if (outcome.ok) {
          record.resultSummary = outcome.summary;
        } else {
          record.error = outcome.summary;
        }
        await this.appendMessage(conversationId, "tool", JSON.stringify(outcome.result), { toolCallId: call.id });
        if (tool && tool.invalidate.length > 0) {
          emit({
            type: "action_executed",
            conversationId,
            toolCallId: call.id,
            tool: call.name,
            ok: outcome.ok,
            summary: outcome.summary,
            invalidate: tool.invalidate,
          });
        }
      }

      await this.updateToolCallRecords(assistantRow.id, records);

      // Send the authoritative persisted row (with resolved tool-call statuses)
      // whether the turn continues or waits on a confirmation.
      const persistedRow = await this.getMessageRow(assistantRow.id);
      if (persistedRow) {
        emit({ type: "message", message: toAssistantMessage(persistedRow) });
      }

      if (hasProposals) {
        emit({ type: "done", conversationId, status: "awaiting_confirmation" });
        return;
      }
    }

    const row = await this.appendMessage(conversationId, "assistant", MAX_TOOL_CALLS_PER_TURN_FALLBACK);
    emit({ type: "delta", content: MAX_TOOL_CALLS_PER_TURN_FALLBACK });
    emit({ type: "message", message: toAssistantMessage(row) });
    emit({ type: "done", conversationId, status: "complete" });
  }

  /** Emits `{ type: "followups" }` chips after a completed answer; never throws. */
  private async emitFollowups(
    llm: LlmClient,
    config: ResolvedAiAssistantConfig,
    conversationId: number,
    emit: Emit,
    signal: AbortSignal
  ): Promise<void> {
    if (!config.suggestFollowups) {
      return;
    }
    try {
      const rows = await db
        .select()
        .from(assistantMessages)
        .where(
          and(
            eq(assistantMessages.conversationId, conversationId),
            inArray(assistantMessages.role, ["user", "assistant"])
          )
        )
        .orderBy(desc(assistantMessages.id))
        .limit(6);
      const lastUser = rows.find((row) => row.role === "user");
      const lastAssistant = rows.find((row) => row.role === "assistant" && row.content);
      if (!lastUser || !lastAssistant) {
        return;
      }
      const result = await llm.chat({
        messages: [
          { role: "system", content: FOLLOWUP_SUGGESTION_PROMPT },
          {
            role: "user",
            content: `Manager asked: ${lastUser.content.slice(0, 300)}\nCopilot answered: ${lastAssistant.content.slice(0, 800)}`,
          },
        ],
        maxTokens: 256,
        temperature: 0.5,
        signal,
      });
      const items = parseFollowups(result.content);
      if (items.length > 0) {
        emit({ type: "followups", items });
      }
    } catch (error) {
      logger.debug({ err: error }, "Assistant follow-up suggestions failed; skipping");
    }
  }
}
