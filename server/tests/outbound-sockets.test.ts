import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:https";
import { createServer as createSocketServer } from "node:net";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "../src/config";
import { outboundFetch } from "../src/net/outbound-fetch";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));
const originalMode = config.NODE_ENV;
afterEach(() => { config.NODE_ENV = originalMode; vi.unstubAllEnvs(); dnsLookup.mockReset(); });

it.each(["jira", "ai"] as const)("blocks %s rebinding at the connector after a public preflight", async purpose => {
  config.NODE_ENV = "production";
  vi.stubEnv("JIRA_ALLOWED_HOSTS", "");
  vi.stubEnv("OUTBOUND_ALLOWED_HOSTS", "");
  dnsLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  let connections = 0;
  const fixture = createSocketServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  try {
    const port = (fixture.address() as import("node:net").AddressInfo).port;
    await expect(outboundFetch(`https://rebind.invalid:${port}`, purpose, {})).rejects.toMatchObject({ cause: { status: 400 } });
    expect(dnsLookup).toHaveBeenCalledTimes(2);
    expect(connections).toBe(0);
  } finally { await new Promise<void>(resolve => fixture.close(() => resolve())); }
});

it("Jira and Copilot connect using vetted DNS, preserve Host/SNI, trust the fixture CA and refuse wrong-host TLS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lead-os-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=fixture.invalid", "-addext", "subjectAltName=DNS:fixture.invalid"], { stdio: "ignore" });
  const hosts: string[] = [];
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    hosts.push(`${req.headers.host}|${(req.socket as import("node:tls").TLSSocket).servername}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url?.includes("completions") ? { choices: [{ message: { content: "fixture-ok" } }] } : { accountId: "fixture" }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const script = join(dir, "probe.cjs");
    writeFileSync(script, `
      require('dns').promises.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
      require('dns').lookup = () => { throw new Error('Unvetted second DNS resolution'); };
      const { JiraClient } = require(${JSON.stringify(resolve("src/jira/client.ts"))});
      const { OpenAiCompatibleClient } = require(${JSON.stringify(resolve("src/assistant/llm-client.ts"))});
      (async () => {
        const jira = new JiraClient('https://fixture.invalid:${port}', 'test@example.invalid', 'test-token');
        if ((await jira.getCurrentUser()).accountId !== 'fixture') throw new Error('Jira failed');
        const ai = new OpenAiCompatibleClient({ baseUrl: 'https://fixture.invalid:${port}/v1', apiKey: 'test-key', model: 'fixture', maxRetries: 0 });
        if ((await ai.chat({ messages: [] })).content !== 'fixture-ok') throw new Error('AI failed');
        try { await new JiraClient('https://wrong.invalid:${port}', 'test@example.invalid', 'test-token').getCurrentUser(); throw new Error('TLS unexpectedly accepted'); }
        catch (error) { if (error.cause?.code !== 'ERR_TLS_CERT_ALTNAME_INVALID') throw error; }
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `);
    await promisify(execFile)(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(), timeout: 15_000,
      env: { ...process.env, NODE_ENV: "production", NODE_EXTRA_CA_CERTS: cert, JIRA_ALLOWED_HOSTS: "fixture.invalid,wrong.invalid", OUTBOUND_ALLOWED_HOSTS: "fixture.invalid,wrong.invalid" },
    });
    expect(hosts).toEqual([`fixture.invalid:${port}|fixture.invalid`, `fixture.invalid:${port}|fixture.invalid`]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
