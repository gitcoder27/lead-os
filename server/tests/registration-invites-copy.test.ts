import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { beforeEach, expect, it } from "vitest";
import { rawDb } from "../src/db/connection";
import { migrateRegistrationInvites } from "../src/db/registration-invites";
import { resetDatabase } from "./helpers/db";
import { runScratchPath } from "./helpers/tmp";
import { seedTenants, workspaceSnapshot } from "./helpers/tenants";
beforeEach(resetDatabase);
it("migrates a populated scratch copy and exercises create/list/revoke through the real CLI", async () => {
  await seedTenants();
  const file = runScratchPath("invite-cli-copy.db"); await rawDb.backup(file);
  const copy = new Database(file);
  try {
    copy.exec("DROP TABLE registration_invites");
    const before = workspaceSnapshot("default", copy);
    migrateRegistrationInvites(copy); migrateRegistrationInvites(copy);
    expect(workspaceSnapshot("default", copy)).toEqual(before);
    const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [path.resolve("../node_modules/tsx/dist/cli.mjs"), "src/scripts/invite.ts", ...args], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test", DASHBOARD_DB_PATH: file, LEADOS_PUBLIC_URL: "https://lead.example.com", LEADOS_REGISTRATION: "off" } }));
    const invite = cli("--create", "--note", "Friend");
    const token = new URL(invite.url).searchParams.get("invite");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const listed = cli("--list");
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0].state).toBe("active");
    expect(cli("--revoke", String(invite.id))).toEqual({ revoked: true, id: invite.id });
    expect(cli("--list")[0].state).toBe("revoked");
  } finally { copy.close(); for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true }); }
}, 15000);
