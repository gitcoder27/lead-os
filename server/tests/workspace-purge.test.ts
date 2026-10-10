import path from "node:path";
import { execFileSync } from "node:child_process";
import { migrate } from "../src/db/migrate";
import fs from "node:fs";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { workspacePurgeCounts } from "../src/db/workspace-purge";
import { WorkspacePurgeService } from "../src/services/workspace-purge.service";
import { resetDatabase } from "./helpers/db";
import { runScratchPath } from "./helpers/tmp";
import { seedTenants, workspaceSnapshot } from "./helpers/tenants";
import { seedRegisteredTenant } from "./helpers/registered-tenant";
async function fixture() {
  const { F, friend, day } = await seedTenants();
  await seedRegisteredTenant(F, friend.workspaceId, day);
  migrate(rawDb); // Settle existing one-time migrations before copying the representative fixture.
  const file = runScratchPath("purge-copy.db"); const backupFile = runScratchPath("purge-backup.db"); await rawDb.backup(file);
  const copy = new Database(file); copy.pragma("foreign_keys=ON");
  const createManualBackup = vi.fn(async () => { await copy.backup(backupFile); return { path: backupFile, name: "purge-backup.db", reason: "pre-workspace-purge", sizeBytes: 1, createdAt: new Date().toISOString() }; });
  return { copy, workspace: friend.workspaceId, service: new WorkspacePurgeService({ createManualBackup }, copy), createManualBackup, backupFile, cleanup: () => { copy.close(); for (const p of [file, backupFile]) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(p + suffix, { force: true }); } };
}
describe("backup-gated workspace purge", () => {
  beforeEach(resetDatabase);
  it("defaults to a full count preview, refuses default and requires exact confirmation", async () => {
    const f = await fixture(); try {
      const before = workspaceSnapshot(f.workspace, f.copy);
      expect(f.service.preview(f.workspace).counts.tasks).toBeGreaterThan(0);
      expect(f.createManualBackup).not.toHaveBeenCalled(); expect(workspaceSnapshot(f.workspace, f.copy)).toEqual(before);
      expect(() => f.service.preview("default")).toThrow(/cannot be deleted/);
      await expect(f.service.purge(f.workspace, "wrong")).rejects.toMatchObject({ status: 400 }); expect(f.createManualBackup).not.toHaveBeenCalled();
    } finally { f.cleanup(); }
  });
  it("empties every scoped table, messages, sessions and FTS while retaining the owner and a recoverable backup", async () => {
    const f = await fixture(); try {
      const owner = workspaceSnapshot("default", f.copy);
      const result = await f.service.purge(f.workspace, f.workspace); expect(result.applied).toBe(true); expect(f.createManualBackup).toHaveBeenCalledWith("pre-workspace-purge");
      expect(Object.values(workspacePurgeCounts(f.copy, f.workspace)).every(count => count === 0)).toBe(true);
      expect(workspaceSnapshot("default", f.copy)).toEqual(owner);
      expect(f.copy.prepare("SELECT COUNT(*) AS n FROM daily_notes_fts WHERE daily_notes_fts MATCH 'FRIENDSECRET'").get()).toEqual({ n: 0 });
      expect(f.copy.prepare("SELECT COUNT(*) AS n FROM daily_notes_fts WHERE daily_notes_fts MATCH 'OWNERSECRET'").get()).toEqual({ n: 1 });
      expect(f.copy.pragma("foreign_key_check")).toEqual([]);
      const backup = new Database(f.backupFile, { readonly: true }); try { expect(workspacePurgeCounts(backup, f.workspace).tasks).toBeGreaterThan(0); } finally { backup.close(); }
    } finally { f.cleanup(); }
  });
  it("refuses to mutate when backup creation fails", async () => {
    const f = await fixture(); try {
      const before = workspaceSnapshot(f.workspace, f.copy); f.createManualBackup.mockRejectedValueOnce(new Error("fixture backup unavailable"));
      await expect(f.service.purge(f.workspace, f.workspace)).rejects.toThrow(/backup unavailable/); expect(workspaceSnapshot(f.workspace, f.copy)).toEqual(before);
    } finally { f.cleanup(); }
  });
  it("runs the real CLI dry-run and apply exclusively on the copy and a scratch backup directory", async () => {
    const f = await fixture(); const directory = runScratchPath("purge-cli-backups");
    try {
      f.copy.prepare("INSERT INTO config (workspace_id,key,value) VALUES ('default','backup_directory',?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value").run(directory);
      const owner = workspaceSnapshot("default", f.copy); const own = workspaceSnapshot(f.workspace, f.copy);
      const cli = (...args: string[]) => execFileSync(process.execPath, [path.resolve("../node_modules/tsx/dist/cli.mjs"), "src/scripts/delete-workspace.ts", "--workspace", f.workspace, ...args], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test", DASHBOARD_DB_PATH: runScratchPath("purge-copy.db") } });
      expect(cli()).toContain('"applied": false'); expect(workspaceSnapshot(f.workspace, f.copy)).toEqual(own); expect(workspaceSnapshot("default", f.copy)).toEqual(owner);
      expect(cli("--confirm", f.workspace, "--apply")).toContain('"applied": true');
      expect(Object.values(workspacePurgeCounts(f.copy, f.workspace)).every(count => count === 0)).toBe(true); expect(workspaceSnapshot("default", f.copy)).toEqual(owner);
      expect(fs.readdirSync(directory).some(name => name.endsWith(".db"))).toBe(true);
    } finally { f.cleanup(); fs.rmSync(directory, { force: true, recursive: true }); }
  }, 15000);
  it("does not trust backup metadata pointing to a nonexistent file", async () => {
    const f = await fixture(); try {
      const before = workspaceSnapshot(f.workspace, f.copy);
      f.createManualBackup.mockResolvedValueOnce({ path: runScratchPath("nonexistent.db"), name: "none.db", reason: "pre-workspace-purge", sizeBytes: 1, createdAt: "" });
      await expect(f.service.purge(f.workspace, f.workspace)).rejects.toMatchObject({ status: 409 }); expect(workspaceSnapshot(f.workspace, f.copy)).toEqual(before);
    } finally { f.cleanup(); }
  });
  it("rolls back every deletion if a later table refuses a write", async () => {
    const f = await fixture(); try {
      const before = workspaceSnapshot(f.workspace, f.copy); const owner = workspaceSnapshot("default", f.copy);
      f.copy.exec("CREATE TRIGGER fail_purge BEFORE DELETE ON workspaces BEGIN SELECT RAISE(ABORT,'fixture purge crash'); END");
      await expect(f.service.purge(f.workspace, f.workspace)).rejects.toThrow(/fixture purge crash/);
      expect(workspaceSnapshot(f.workspace, f.copy)).toEqual(before); expect(workspaceSnapshot("default", f.copy)).toEqual(owner);
    } finally { f.cleanup(); }
  });
});
