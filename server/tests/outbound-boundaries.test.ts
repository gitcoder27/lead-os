import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { JiraClient } from "../src/jira/client";
import { OpenAiCompatibleClient } from "../src/assistant/llm-client";
import { resetDatabase } from "./helpers/db";
import { seedTenants } from "./helpers/tenants";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
const originalMode = config.NODE_ENV;
const privateBody = "INTERNAL-ONLY-SECRET";

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("JIRA_ALLOWED_HOSTS", "");
  vi.stubEnv("OUTBOUND_ALLOWED_HOSTS", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: privateBody } }), { status: 500 })));
});
afterEach(() => { config.NODE_ENV = originalMode; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("outbound tenant boundaries", () => {
  it("refuses a friend's Jira connection test to a private address without making a request", async () => {
    const { F } = await seedTenants();
    config.NODE_ENV = "production";
    const response = await F("POST", "/api/config/test", { jiraBaseUrl: "https://127.0.0.1/internal", jiraEmail: "friend@example.com", jiraApiToken: "test-token" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(privateBody);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses private Copilot URLs on save and connection test", async () => {
    const { F, settings, friend } = await seedTenants();
    config.NODE_ENV = "production";
    const saved = await F("PUT", "/api/config/ai", { baseUrl: "https://169.254.169.254/v1", model: "test-model" });
    expect(saved.status).toBe(400);
    expect(await settings.getConfigValue("ai_base_url", friend.workspaceId)).toBeUndefined();
    const tested = await F("POST", "/api/config/ai/test", { baseUrl: "https://169.254.169.254/v1", model: "test-model", apiKey: "test-key" });
    expect(tested.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates provider-profile addresses before any part of an AI patch is saved", async () => {
    const { F, settings, friend, snapshot, before } = await seedTenants();
    config.NODE_ENV = "production";
    const response = await F("PUT", "/api/config/ai", { enabled: true, upsertProvider: { baseUrl: "https://192.168.1.1/v1", model: "test-model", apiKey: "test-key" } });
    expect(response.status).toBe(400);
    expect(await settings.getConfigValue("ai_assistant_enabled", friend.workspaceId)).toBeUndefined();
    expect(snapshot()).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses redirects instead of forwarding credentials to another target", async () => {
    config.NODE_ENV = "production";
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://127.0.0.1" } }));
    await expect(new JiraClient("https://jira.example.com", "test@example.com", "test-token").getCurrentUser()).rejects.toThrow("Jira API error (302)");
    const client = new OpenAiCompatibleClient({ baseUrl: "https://ai.example.com/v1", apiKey: "test-key", model: "test-model", maxRetries: 0 });
    await expect(client.chat({ messages: [] })).rejects.toThrow("AI provider error (302)");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map((call) => call[1]?.redirect)).toEqual(["manual", "manual"]);
  });

  it("also guards Jira and Copilot runtime requests", async () => {
    config.NODE_ENV = "production";
    await expect(new JiraClient("https://[::1]", "test@example.com", "test-token").getCurrentUser()).rejects.toThrow("That address isn't allowed");
    const client = new OpenAiCompatibleClient({ baseUrl: "https://10.1.2.3/v1", apiKey: "test-key", model: "test-model", maxRetries: 0 });
    await expect(client.chat({ messages: [] })).rejects.toThrow("That address isn't allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not reflect raw upstream response bodies from public providers", async () => {
    config.NODE_ENV = "production";
    await expect(new JiraClient("https://jira.example.com", "test@example.com", "test-token").getCurrentUser()).rejects.toThrow(/^Jira API error \(500\)$/);
    const client = new OpenAiCompatibleClient({ baseUrl: "https://ai.example.com/v1", apiKey: "test-key", model: "test-model", maxRetries: 0 });
    await expect(client.chat({ messages: [] })).rejects.toThrow(/^AI provider error \(500\)$/);
  });
});
