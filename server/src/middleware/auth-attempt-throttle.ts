import { HttpError } from "./errorHandler";

const WINDOW_MS = 15 * 60_000;
const MAX_ACCOUNTS = 10_000;

/** Bounded, process-local failures keyed by [IP, normalized username]. */
export class AuthAttemptThrottle {
  private readonly attempts = new Map<string, { failures: number; lockedUntil?: number; lastFailureAt: number }>();
  private cleanupTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly capacity = MAX_ACCOUNTS) {}

  get size(): number { return this.attempts.size; }

  private expire(): void {
    const now = Date.now();
    for (const [key, attempt] of this.attempts) {
      if (now - attempt.lastFailureAt >= WINDOW_MS) this.attempts.delete(key);
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer || !this.attempts.size) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      this.expire();
      this.scheduleCleanup();
    }, 60_000);
    this.cleanupTimer.unref?.();
  }

  assertAllowed(key: string): void {
    const attempt = this.attempts.get(key);
    if (!attempt) return;
    if (Date.now() - attempt.lastFailureAt >= WINDOW_MS || (attempt.lockedUntil && attempt.lockedUntil <= Date.now())) {
      this.attempts.delete(key);
      return;
    }
    if (attempt.lockedUntil) throw new HttpError(429, "Too many failed attempts. Try again later.");
  }

  recordSuccess(key: string): void { this.attempts.delete(key); }

  clearUsername(username: string): void {
    const normalized = username.trim().toLowerCase();
    for (const key of this.attempts.keys()) {
      if ((JSON.parse(key) as [string, string])[1] === normalized) this.attempts.delete(key);
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const previous = this.attempts.get(key);
    const failures = previous && now - previous.lastFailureAt < WINDOW_MS ? previous.failures + 1 : 1;
    if (!previous && this.attempts.size >= this.capacity) {
      this.expire();
      if (this.attempts.size >= this.capacity) this.attempts.delete(this.attempts.keys().next().value!);
    }
    const lockedUntil = failures >= 5 ? now + Math.min(WINDOW_MS, (failures - 4) * 30_000) : undefined;
    this.attempts.set(key, { failures, lockedUntil, lastFailureAt: now });
    this.scheduleCleanup();
  }
}
