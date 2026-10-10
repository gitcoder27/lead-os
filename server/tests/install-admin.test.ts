import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { serializeSessionCookie } from "../src/services/auth.service";
import type { BackupService } from "../src/services/backup.service";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { runScratchPath } from "./helpers/tmp";
import { seedTenants, workspaceSnapshot } from "./helpers/tenants";

const copyPath = runScratchPath("install-admin-copy.db");
beforeEach(async () => { await resetDatabase(); });
afterEach(() => { for (const prefix of [copyPath, `${copyPath}.cli.db`]) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${prefix}${suffix}`, { force: true }); });

const backups = {
  start: async () => undefined,
  createPreResetBackup: async () => null,
  listBackups: async () => [{ name: "OWNERSECRET.backup.db", path: "/tmp/test-only.db", sizeBytes: 1, createdAt: "2026-10-10", reason: "manual" }],
  getRuntimeStatus: async () => ({ enabled: true, running: false, directory: "/tmp/test-only" }),
} as unknown as BackupService;

describe("explicit install authority", () => {
  it("denies later co-managers and ignores a requested install-admin flag", async () => {
    const { O, app, authService, friendCookie } = await seedTenants({ backupService: backups });
    const created = await O("POST", "/api/auth/register", { username: "co-manager", password: "secret123", displayName: "Co-manager", role: "manager", isInstallAdmin: true });
    expect(created.status).toBe(201);
    const session = await authService.authenticate("co-manager", "secret123");
    const cookie = serializeSessionCookie(session.sessionId);
    for (const [method, url] of [["GET", "/api/backups"], ["POST", "/api/backups/run"], ["GET", "/api/backups/OWNERSECRET.backup.db/download"]]) {
      const response = await invoke(app, { method: method!, url: url!, headers: { cookie }, body: {} });
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain("OWNERSECRET");
      expect(response.body.error).not.toContain("default workspace");
    }
    expect((await O("GET", "/api/backups")).status).toBe(200);
    const me = await invoke(app, { method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.body.features.backups).toBe(false);
    expect(me.body.user).not.toHaveProperty("isInstallAdmin");
    expect((await invoke(app, { method: "GET", url: "/api/backups", headers: { cookie: friendCookie } })).status).toBe(403);
  });

  it("keeps the user CLI working and allows explicit operator grants only to managers", () => {
    const create = (username: string, grant = false) => JSON.parse(execFileSync(process.execPath, [path.resolve("../node_modules/tsx/dist/cli.mjs"), "src/scripts/create-auth-user.ts", "--username", username, "--password", "fixture-pass-123", "--display-name", username, "--role", "manager", ...(grant ? ["--install-admin"] : [])], { env: { ...process.env, NODE_ENV: "test", DASHBOARD_DB_PATH: `${copyPath}.cli.db` }, encoding: "utf8" }));
    const owner = create("cli-owner");
    const friend = create("cli-friend");
    const grant = create("cli-trusted", true);
    expect(owner.user).toMatchObject({ workspaceId: "default", isInstallAdmin: true });
    expect(friend.user.workspaceId).not.toBe("default");
    expect(friend.user.isInstallAdmin).toBe(false);
    expect(grant.user.isInstallAdmin).toBe(true);
  });

  it("migrates a representative database copy additively and exactly once", async () => {
    await seedTenants();
    migrate(rawDb); // Complete existing migrations in this synthetic representative fixture.
    await rawDb.backup(copyPath);
    const copy = new Database(copyPath);
    try {
      const columns = copy.pragma("table_info(app_users)") as { name: string }[];
      if (columns.some((column) => column.name === "is_install_admin")) copy.exec("ALTER TABLE app_users DROP COLUMN is_install_admin");
      copy.prepare("DELETE FROM data_migrations WHERE name = 'install_admin_v1'").run();
      copy.prepare("INSERT INTO app_users (workspace_id,username,display_name,password_hash,role,is_active,created_at,updated_at) VALUES ('default',?,?,'fixture-hash','manager',?,'2026-01-01','2026-01-01')").run("existing-co-manager", "Existing co-manager", 1);
      copy.prepare("INSERT INTO app_users (workspace_id,username,display_name,password_hash,role,is_active,created_at,updated_at) VALUES ('default',?,?,'fixture-hash','manager',?,'2026-01-01','2026-01-01')").run("inactive-manager", "Inactive", 0);
      const before = workspaceSnapshot("default", copy);
      delete before.app_users;
      migrate(copy);
      const after = workspaceSnapshot("default", copy);
      delete after.app_users;
      expect(after).toEqual(before);
      expect(copy.prepare("SELECT username, is_install_admin FROM app_users ORDER BY username").all()).toEqual([
        { username: "existing-co-manager", is_install_admin: 1 }, { username: "friend", is_install_admin: 0 }, { username: "inactive-manager", is_install_admin: 0 }, { username: "owner", is_install_admin: 1 }, { username: "ownerdev", is_install_admin: 0 },
      ]);
      copy.prepare("UPDATE app_users SET is_install_admin = 0 WHERE username = 'owner'").run();
      migrate(copy);
      expect(copy.prepare("SELECT is_install_admin FROM app_users WHERE username='owner'").get()).toEqual({ is_install_admin: 0 });
      expect(copy.prepare("SELECT count(*) AS count FROM data_migrations WHERE name='install_admin_v1'").get()).toEqual({ count: 1 });
    } finally { copy.close(); }
  });
});
