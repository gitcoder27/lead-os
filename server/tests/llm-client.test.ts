import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleClient } from "../src/assistant/llm-client";
import { HttpError } from "../src/middleware/errorHandler";

function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

function sseChunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({ choices: [{ delta }], ...extra })}\n\n`;
}

function client(overrides: { retryDelayMs?: number; timeoutMs?: number } = {}) {
  return new OpenAiCompatibleClient({
    baseUrl: "https://llm.test/v1",
    apiKey: "test-key",
    model: "test-model",
    retryDelayMs: overrides.retryDelayMs ?? 0,
    timeoutMs: overrides.timeoutMs ?? 5_000,
  });
}

function lastRequestBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const init = calls.at(-1)?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("OpenAiCompatibleClient.chatStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams content deltas, sends stream+temperature, and captures usage", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        sseChunk({ content: "Hel" }),
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "lo." } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } },
        })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const result = await client().chatStream(
      { messages: [{ role: "user", content: "hi" }] },
      { onContent: (d) => deltas.push(d) }
    );

    expect(deltas).toEqual(["Hel", "lo."]);
    expect(result.content).toBe("Hello.");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 4, reasoningTokens: 2 });

    const body = lastRequestBody();
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.3);
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer test-key");
  });

  it("merges tool_call fragments across chunks by index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseChunk({
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "get_" } },
              { index: 1, id: "call_2", function: { name: "get_alerts" } },
            ],
          }),
          sseChunk({
            tool_calls: [
              { index: 0, function: { name: "today_snapshot", arguments: '{"lim' } },
              { index: 1, function: { arguments: "{}" } },
            ],
          }),
          sseChunk({ tool_calls: [{ index: 0, function: { arguments: 'it":2}' } }] }),
          "data: [DONE]\n\n",
        ])
      )
    );

    const result = await client().chatStream({ messages: [{ role: "user", content: "go" }] });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "get_today_snapshot", arguments: { limit: 2 } },
      { id: "call_2", name: "get_alerts", arguments: {} },
    ]);
  });

  it("forwards reasoning_content deltas to onReasoning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseChunk({ reasoning_content: "let me " }),
          sseChunk({ reasoning_content: "think…" }),
          sseChunk({ content: "Answer." }),
          "data: [DONE]\n\n",
        ])
      )
    );

    const reasoning: string[] = [];
    const content: string[] = [];
    await client().chatStream(
      { messages: [{ role: "user", content: "hi" }] },
      { onReasoning: (d) => reasoning.push(d), onContent: (d) => content.push(d) }
    );

    expect(reasoning).toEqual(["let me ", "think…"]);
    expect(content).toEqual(["Answer."]);
  });

  it("surfaces the provider's error body instead of a bare status", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "1113", message: "Insufficient balance or no resource package." } }),
          { status: 429 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(client().chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 429,
      message: "AI provider rate limited — Insufficient balance or no resource package.",
    });
    // 429 is retryable — retried once, then raised.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a 5xx and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockImplementationOnce(async () =>
        sseResponse([sseChunk({ content: "ok" }), "data: [DONE]\n\n"])
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().chatStream({ messages: [{ role: "user", content: "hi" }] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("ok");
  });

  it("does not retry a non-retryable 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client().chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 502,
      message: "AI provider error (400) — bad model",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain JSON completion when the provider ignores stream:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "One shot." } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );

    const deltas: string[] = [];
    const result = await client().chatStream(
      { messages: [{ role: "user", content: "hi" }] },
      { onContent: (d) => deltas.push(d) }
    );

    expect(result.content).toBe("One shot.");
    expect(deltas).toEqual(["One shot."]);
  });

  it("maps an aborted request to a 504 HttpError", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
        }
        return Promise.resolve(new Response("never", { status: 200 }));
      })
    );

    await expect(
      client().chat({ messages: [{ role: "user", content: "hi" }], signal: controller.signal })
    ).rejects.toMatchObject({ status: 504 });
  });
});
