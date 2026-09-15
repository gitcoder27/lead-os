import { HttpError } from "../middleware/errorHandler";

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmChatParams {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
  maxTokens?: number;
  /** Sampling temperature; defaults to a crisp 0.3 for workspace Q&A. */
  temperature?: number;
  /**
   * Thinking-level override sent as `reasoning_effort` + `thinking.type`
   * (the shared ZAI/DeepSeek/OpenAI-compatible dialect). "off" disables
   * thinking where supported and degrades to low effort elsewhere.
   */
  reasoningEffort?: "off" | "low" | "high" | "max";
}

export interface LlmChatResult {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens?: number;
  };
}

/** Live callbacks while a streamed completion is in flight. */
export interface LlmStreamSink {
  onContent?: (delta: string) => void;
  /** Reasoning models (e.g. GLM thinking) emit reasoning_content before content. */
  onReasoning?: (delta: string) => void;
}

export interface LlmClient {
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  /** Streams the completion, invoking sink callbacks as deltas arrive. */
  chatStream(params: LlmChatParams, sink?: LlmStreamSink): Promise<LlmChatResult>;
}

interface OpenAiCompatibleClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Base delay before the single retry on 429/5xx/network errors (jittered). */
  retryDelayMs?: number;
}

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 5_000;

interface UsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: UsagePayload;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: UsagePayload;
  error?: { code?: string | number; message?: string };
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** z.ai and OpenAI both return { error: { code, message } }; tolerate { error: string } and { message } too. */
async function providerErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const providerError = body?.error;
    if (typeof providerError === "string" && providerError) {
      return providerError;
    }
    if (typeof providerError === "object" && providerError !== null && providerError.message) {
      return providerError.message;
    }
    if (typeof body?.message === "string" && body.message) {
      return body.message;
    }
  } catch {
    // body wasn't JSON — no detail available
  }
  return undefined;
}

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const detail = await providerErrorDetail(response);
  const suffix = detail ? ` — ${detail}` : "";
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(502, `AI credentials invalid${suffix}`);
  }
  if (response.status === 429) {
    throw new HttpError(429, `AI provider rate limited${suffix}`);
  }
  throw new HttpError(502, `AI provider error (${response.status})${suffix}`);
}

function toResult(
  content: string,
  rawToolCalls: Array<{ id?: string; name?: string; arguments?: string }>,
  usageRaw?: UsagePayload
): LlmChatResult {
  const toolCalls = rawToolCalls
    .filter((call) => typeof call?.id === "string" && typeof call?.name === "string")
    .map((call) => ({
      id: call.id!,
      name: call.name!,
      arguments: parseToolArguments(call.arguments),
    }));
  return {
    content,
    toolCalls,
    usage: usageRaw
      ? {
          promptTokens: usageRaw.prompt_tokens ?? 0,
          completionTokens: usageRaw.completion_tokens ?? 0,
          ...(usageRaw.completion_tokens_details?.reasoning_tokens !== undefined
            ? { reasoningTokens: usageRaw.completion_tokens_details.reasoning_tokens }
            : {}),
        }
      : undefined,
  };
}

interface RequestGuard {
  signal: AbortSignal;
  /** Resets the idle timeout — call on every streamed chunk. */
  touch: () => void;
  dispose: () => void;
}

export class OpenAiCompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    const guard = this.guard(params.signal);
    try {
      const response = await this.request(this.buildPayload(params), guard);
      await raiseForStatus(response);
      const body = (await response.json()) as ChatCompletionResponse;
      const message = body.choices?.[0]?.message;
      return toResult(
        typeof message?.content === "string" ? message.content : "",
        (message?.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments,
        })),
        body.usage
      );
    } finally {
      guard.dispose();
    }
  }

  async chatStream(params: LlmChatParams, sink?: LlmStreamSink): Promise<LlmChatResult> {
    const guard = this.guard(params.signal);
    try {
      const response = await this.request({ ...this.buildPayload(params), stream: true }, guard);
      await raiseForStatus(response);

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream") || !response.body) {
        // Provider ignored stream:true — fall back to a normal JSON completion.
        const body = (await response.json()) as ChatCompletionResponse;
        const message = body.choices?.[0]?.message;
        const content = typeof message?.content === "string" ? message.content : "";
        if (content) {
          sink?.onContent?.(content);
        }
        return toResult(
          content,
          (message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments,
          })),
          body.usage
        );
      }

      return await this.consumeSse(response.body, sink, guard.touch);
    } finally {
      guard.dispose();
    }
  }

  /**
   * Abort controller covering the whole call: aborts on caller signal or after
   * `timeoutMs` with no progress (touch() resets it while a stream is flowing).
   */
  private guard(callerSignal?: AbortSignal): RequestGuard {
    const controller = new AbortController();
    const onTimeout = () => {
      controller.abort(new DOMException("AI request timed out", "TimeoutError"));
    };
    let timer = setTimeout(onTimeout, this.timeoutMs);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, this.timeoutMs);
    };
    const onCallerAbort = () => {
      controller.abort(callerSignal?.reason ?? new DOMException("AI request aborted", "AbortError"));
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
      touch,
      dispose: () => {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      },
    };
  }

  private buildPayload(params: LlmChatParams): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: this.model,
      messages: params.messages,
      temperature: params.temperature ?? DEFAULT_TEMPERATURE,
    };
    if (params.tools && params.tools.length > 0) {
      payload.tools = params.tools;
      payload.tool_choice = "auto";
    }
    if (params.maxTokens !== undefined) {
      payload.max_tokens = params.maxTokens;
    }
    if (params.reasoningEffort === "off") {
      payload.reasoning_effort = "low";
      payload.thinking = { type: "disabled" };
    } else if (params.reasoningEffort) {
      payload.reasoning_effort = params.reasoningEffort;
      payload.thinking = { type: "enabled" };
    }
    return payload;
  }

  /** Performs the POST with a single retry on 429/5xx/network errors. */
  private async request(payload: Record<string, unknown>, guard: RequestGuard): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: guard.signal,
        });
        if (attempt === 0 && !response.ok && isRetryableStatus(response.status)) {
          const delay = this.retryDelay(response.headers.get("retry-after"));
          void response.body?.cancel().catch(() => undefined);
          await this.sleep(delay, guard.signal);
          continue;
        }
        return response;
      } catch (error) {
        if (isAbortLike(error)) {
          throw new HttpError(504, "AI request timed out");
        }
        if (error instanceof HttpError) {
          throw error;
        }
        if (attempt === 0) {
          await this.sleep(this.jitteredDelay(), guard.signal);
          continue;
        }
        throw new HttpError(502, "AI provider unreachable");
      }
    }
  }

  private retryDelay(retryAfter: string | null): number {
    const seconds = retryAfter ? Number.parseFloat(retryAfter) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    return this.jitteredDelay();
  }

  private jitteredDelay(): number {
    return this.retryDelayMs + Math.random() * this.retryDelayMs;
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }

  /** Parses `data: {...}` SSE frames; merges tool_call fragments by index. */
  private async consumeSse(
    body: ReadableStream<Uint8Array>,
    sink: LlmStreamSink | undefined,
    touch: () => void
  ): Promise<LlmChatResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: UsagePayload | undefined;
    const toolParts = new Map<number, { id?: string; name?: string; args: string }>();

    const applyChunk = (chunk: ChatCompletionChunk): void => {
      if (chunk.error) {
        throw new HttpError(502, `AI provider error — ${chunk.error.message ?? chunk.error.code ?? "stream failed"}`);
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) {
        sink?.onReasoning?.(delta.reasoning_content);
      }
      if (delta?.content) {
        content += delta.content;
        sink?.onContent?.(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const part = toolParts.get(index) ?? { args: "" };
        if (call.id) {
          part.id = call.id;
        }
        if (call.function?.name) {
          part.name = (part.name ?? "") + call.function.name;
        }
        if (call.function?.arguments) {
          part.args += call.function.arguments;
        }
        toolParts.set(index, part);
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    };

    const processBlock = (block: string): void => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") {
        return;
      }
      applyChunk(JSON.parse(data) as ChatCompletionChunk);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        touch();
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          processBlock(buffer.slice(0, boundary));
          const match = buffer.slice(boundary).match(/^\r?\n\r?\n/)!;
          buffer = buffer.slice(boundary + match[0].length);
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        processBlock(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    const merged = [...toolParts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, part]) => ({ id: part.id, name: part.name, arguments: part.args }));
    return toResult(content, merged, usage);
  }
}
