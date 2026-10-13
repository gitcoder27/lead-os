import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthAttemptThrottle } from "../src/middleware/auth-attempt-throttle";
const key = (username: string, ip = "fixture-ip") => JSON.stringify([ip, username]);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T00:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("expires single failures without ever receiving the key or any request again", async () => {
  const throttle = new AuthAttemptThrottle();
  for (let i = 0; i < 100; i++) throttle.recordFailure(key(`never-reused-${i}`));
  expect(throttle.size).toBe(100);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(throttle.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("caps retained entries when all keys are unique, retaining recent failures", () => {
  const throttle = new AuthAttemptThrottle(3);
  for (let i = 0; i < 100; i++) { throttle.recordFailure(key(String(i))); expect(throttle.size).toBeLessThanOrEqual(3); }
  for (let i = 0; i < 4; i++) throttle.recordFailure(key("99"));
  expect(() => throttle.assertAllowed(key("99"))).toThrow("Too many failed attempts");
  expect(throttle.size).toBe(3);
});

it("preserves lock expiry, success cleanup, per-IP separation and reset cleanup", async () => {
  const throttle = new AuthAttemptThrottle();
  for (let i = 0; i < 5; i++) throttle.recordFailure(key("alice"));
  expect(() => throttle.assertAllowed(key("alice"))).toThrow();
  expect(() => throttle.assertAllowed(key("alice", "another-ip"))).not.toThrow();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(() => throttle.assertAllowed(key("alice"))).not.toThrow();
  throttle.recordFailure(key("alice"));
  throttle.recordFailure(key("alice", "another-ip"));
  throttle.recordFailure(key("bob"));
  throttle.clearUsername(" ALICE ");
  expect(throttle.size).toBe(1);
  throttle.recordSuccess(key("bob"));
  expect(throttle.size).toBe(0);
});
