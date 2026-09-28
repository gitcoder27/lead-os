import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { AuthService } from "../src/services/auth.service";
import { parseTrustProxy } from "../src/utils/trust-proxy";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const authService = new AuthService();

function buildApp(trustProxy?: string | number | false) {
  return createApp(
    {
      issueService: {} as any,
      workloadService: {} as any,
      alertService: {} as any,
      automationService: {} as any,
      syncEngine: {} as any,
      backupService: {} as any,
      tagService: {} as any,
      teamTrackerService: {} as any,
      authService,
      myDayService: {} as any,
      managerDeskService: {} as any,
      todayService: {} as any,
      searchService: {} as any,
      workSavedViewsService: {} as any,
    },
    trustProxy === undefined ? {} : { trustProxy }
  );
}

type App = ReturnType<typeof buildApp>;

function login(app: App, options: { password?: string; username?: string; forwardedFor?: string; remoteAddress?: string }) {
  return invoke(app, {
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: options.remoteAddress ?? "127.0.0.1",
    headers: options.forwardedFor ? { "x-forwarded-for": options.forwardedFor } : {},
    body: { username: options.username ?? "manager", password: options.password ?? "wrong-password" },
  });
}

async function failFiveTimes(app: App, options: Parameters<typeof login>[1] | ((index: number) => Parameters<typeof login>[1])) {
  for (let index = 0; index < 5; index += 1) {
    const result = await login(app, typeof options === "function" ? options(index) : options);
    expect(result.status).toBe(401);
  }
}

describe("login throttle behind a reverse proxy (TRUST_PROXY)", () => {
  const savedEnv = process.env.TRUST_PROXY;

  beforeEach(async () => {
    delete process.env.TRUST_PROXY;
    await resetDatabase();
    await authService.createUser({ username: "manager", displayName: "Manager", password: "secret123", role: "manager" });
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedEnv;
  });

  it("unset: keys on the socket address and ignores X-Forwarded-For, so proxied clients share one lockout (unchanged behavior)", async () => {
    const app = buildApp();
    await failFiveTimes(app, { forwardedFor: "203.0.113.5" });

    // A different real client behind the same proxy is locked out too.
    const otherClient = await login(app, { password: "secret123", forwardedFor: "203.0.113.99" });
    expect(otherClient.status).toBe(429);
  });

  it("set to loopback: keys on the forwarded client IP, so one client's failures don't lock out others", async () => {
    const app = buildApp("loopback");
    await failFiveTimes(app, { forwardedFor: "203.0.113.5" });

    expect((await login(app, { password: "secret123", forwardedFor: "203.0.113.5" })).status).toBe(429);
    const otherClient = await login(app, { password: "secret123", forwardedFor: "203.0.113.99" });
    expect(otherClient.status).toBe(200);
  });

  it("set to loopback: a client-supplied X-Forwarded-For prefix cannot dodge the lockout", async () => {
    const app = buildApp("loopback");
    // The proxy appends the real peer (203.0.113.5) after whatever the client sent.
    await failFiveTimes(app, (index) => ({ forwardedFor: `10.0.0.${index}, 203.0.113.5` }));

    const attempt = await login(app, { password: "secret123", forwardedFor: "10.9.9.9, 203.0.113.5" });
    expect(attempt.status).toBe(429);
  });

  it("set to loopback: X-Forwarded-For from a non-proxy peer is ignored (no spoofing by direct connections)", async () => {
    const app = buildApp("loopback");
    await failFiveTimes(app, (index) => ({ remoteAddress: "198.51.100.7", forwardedFor: `203.0.113.${index}` }));

    const attempt = await login(app, { password: "secret123", remoteAddress: "198.51.100.7", forwardedFor: "203.0.113.200" });
    expect(attempt.status).toBe(429);
  });

  it("reads TRUST_PROXY from the environment when no option is passed", async () => {
    process.env.TRUST_PROXY = "loopback";
    const app = buildApp();
    expect(app.get("trust proxy")).toBe("loopback");

    await failFiveTimes(app, { forwardedFor: "203.0.113.5" });
    expect((await login(app, { password: "secret123", forwardedFor: "203.0.113.99" })).status).toBe(200);
  });

  it("does not enable trust proxy when TRUST_PROXY is unset", () => {
    expect(buildApp().get("trust proxy")).toBeFalsy();
  });

  it("refuses to start with a blanket or malformed TRUST_PROXY", () => {
    process.env.TRUST_PROXY = "true";
    expect(() => buildApp()).toThrow(/TRUST_PROXY/);
  });
});

describe("parseTrustProxy", () => {
  it("treats unset, empty, false and 0 as off", () => {
    for (const value of [undefined, "", "  ", "false", "FALSE", "0"]) {
      expect(parseTrustProxy(value)).toBe(false);
    }
  });

  it("accepts hop counts, keywords and IP/CIDR lists", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy(" 2 ")).toBe(2);
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("Loopback, uniquelocal")).toBe("loopback,uniquelocal");
    expect(parseTrustProxy("127.0.0.1, 10.0.0.0/8, ::1")).toBe("127.0.0.1,10.0.0.0/8,::1");
  });

  it("rejects values that would trust every hop or are malformed", () => {
    for (const value of ["true", "TRUE", "all", "*", "11", "999", "0.0.0.0/0x", "10.0.0.0/33", "not-an-ip", "loopback,,", "1,2"]) {
      expect(() => parseTrustProxy(value), value).toThrow(/TRUST_PROXY/);
    }
  });
});
