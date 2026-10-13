import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { JiraClient } from "../src/jira/client";
const client = () => new JiraClient("https://jira.fixture.invalid", "test@example.invalid", "test-token");
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("keeps the deadline and signal active when successful headers arrive but json stalls", async () => {
  let signal!: AbortSignal;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    signal = init.signal;
    return { ok: true, status: 200, headers: new Headers(), json: () => { started(); return new Promise(() => {}); } };
  }));
  const pending = client().getCurrentUser();
  const outcome = pending.catch(error => error.message);
  await reading;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(signal.aborted).toBe(true);
  expect(await outcome).toBe("Jira request timed out after 30000ms");
});

it("normalizes body AbortError when the deadline expires", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ({
    ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted body", "AbortError")))),
  })));
  const outcome = client().getCurrentUser().catch(error => error.message);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toBe("Jira request timed out after 30000ms");
});

it("cancels a 429 body and bounds Retry-After by the original overall deadline", async () => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn(async () => ({ ok: false, status: 429, headers: new Headers({ "retry-after": "3600" }), body: { cancel } }));
  vi.stubGlobal("fetch", fetchMock);
  const outcome = client().getCurrentUser().catch(error => error.message);
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await outcome).toBe("Jira request timed out after 30000ms");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("a retry gets only the remaining body deadline", async () => {
  let signal!: AbortSignal;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "20" }), body: { cancel } })
    .mockImplementationOnce(async (_url, init) => { signal = init.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }; });
  vi.stubGlobal("fetch", fetchMock);
  const outcome = client().getCurrentUser().catch(error => error.message);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(signal.aborted).toBe(true);
  expect(await outcome).toBe("Jira request timed out after 30000ms");
});

it.each([204, 302, 401, 403, 404, 500])("cancels an unused %s response body", async status => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status === 204, status, headers: new Headers(), body: { cancel } })));
  await client().updateIssue("TEST-1", {}).catch(() => undefined);
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts a real loopback Jira body that sends headers and never finishes", async () => {
  vi.useRealTimers();
  const fixture = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.write('{"accountId":');
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const nativeFetch = globalThis.fetch;
  let headersArrived!: () => void;
  const arrived = new Promise<void>(resolve => { headersArrived = resolve; });
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await nativeFetch(...args);
    headersArrived();
    return response;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const port = (fixture.address() as import("node:net").AddressInfo).port;
    const outcome = new JiraClient(`http://127.0.0.1:${port}`, "test@example.invalid", "test-token").getCurrentUser().catch(error => error.message);
    await arrived;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBe("Jira request timed out after 30000ms");
  } finally {
    vi.useRealTimers();
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
