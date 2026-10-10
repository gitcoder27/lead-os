import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { assertAllowedOutboundUrl, matchesOutboundHost } from "../src/net/outbound-guard";

const dnsLookup = vi.hoisted(() => vi.fn<(host: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>>());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));
const originalMode = config.NODE_ENV;

beforeEach(() => {
  config.NODE_ENV = "production";
  vi.stubEnv("JIRA_ALLOWED_HOSTS", "");
  vi.stubEnv("OUTBOUND_ALLOWED_HOSTS", "");
  dnsLookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
afterEach(() => { config.NODE_ENV = originalMode; vi.unstubAllEnvs(); });

describe("production outbound address policy", () => {
  it.each(["127.0.0.1", "127.1", "0x7f000001", "2130706433", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "[::1]", "[::]", "[fc00::1]", "[fe80::1]", "[ff02::1]", "[::ffff:127.0.0.1]", "[64:ff9b::a00:1]"])("rejects private/reserved target %s", async (host) => {
    await expect(assertAllowedOutboundUrl(`https://${host}/v1`, "ai")).rejects.toThrow("That address isn't allowed");
  });

  it.each(["http://example.com", "file:///etc/passwd", "ftp://example.com", "https://user:password@example.com", "bad-url"])("refuses scheme or embedded credentials in %s", async (url) => {
    await expect(assertAllowedOutboundUrl(url, "jira")).rejects.toThrow("That address isn't allowed");
  });

  it("refuses a hostname if any DNS answer is private", async () => {
    dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(assertAllowedOutboundUrl("https://example.com", "ai")).rejects.toThrow("That address isn't allowed");
  });

  it("fails closed on no DNS answers or resolution errors", async () => {
    dnsLookup.mockResolvedValue([]);
    await expect(assertAllowedOutboundUrl("https://example.com", "ai")).rejects.toThrow("That address isn't allowed");
    dnsLookup.mockRejectedValue(new Error("DNS secret detail"));
    await expect(assertAllowedOutboundUrl("https://example.com", "ai")).rejects.toThrow("That address isn't allowed");
  });

  it("permits public IPv4/IPv6 and rechecks hostnames on every call", async () => {
    await assertAllowedOutboundUrl("https://8.8.8.8", "ai");
    await assertAllowedOutboundUrl("https://[2606:4700::1111]", "ai");
    await assertAllowedOutboundUrl("https://example.com", "ai");
    dnsLookup.mockResolvedValue([{ address: "192.168.0.1", family: 4 }]);
    await expect(assertAllowedOutboundUrl("https://example.com", "ai")).rejects.toThrow("That address isn't allowed");
    expect(dnsLookup).toHaveBeenCalledTimes(2);
  });

  it("allows explicit operator private-host exceptions while retaining https", async () => {
    vi.stubEnv("OUTBOUND_ALLOWED_HOSTS", "internal.example.com");
    await assertAllowedOutboundUrl("https://internal.example.com", "ai");
    await expect(assertAllowedOutboundUrl("http://internal.example.com", "ai")).rejects.toThrow("That address isn't allowed");
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("enforces Jira host restrictions with exact and leading-dot suffix rules", async () => {
    vi.stubEnv("JIRA_ALLOWED_HOSTS", ".atlassian.net, jira.example.com");
    await assertAllowedOutboundUrl("https://team.atlassian.net", "jira");
    await assertAllowedOutboundUrl("https://jira.example.com", "jira");
    await expect(assertAllowedOutboundUrl("https://atlassian.net.attacker.example", "jira")).rejects.toThrow("That address isn't allowed");
    expect(matchesOutboundHost("fakeatlassian.net", ".atlassian.net")).toBe(false);
  });
});
