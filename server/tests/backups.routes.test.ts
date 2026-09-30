import fs from "node:fs";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configTable } from "../src/db/schema";
import { db, rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { createBackupsRouter } from "../src/routes/backups";
import { BackupService } from "../src/services/backup.service";
import { SettingsService } from "../src/services/settings.service";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";

const testBackupDirectory = path.resolve("/tmp", "lead-os-test-backups-routes");
const outsideFile = path.resolve("/tmp", "lead-os-test-backups-routes-secret.db");

async function upsertConfig(key: string, value: string): Promise<void> {
  await db.insert(configTable).values({ key, value }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/backups", createBackupsRouter(new BackupService(new SettingsService(), rawDb)));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(async () => {
  migrate(rawDb);
  await resetDatabase();
  fs.rmSync(testBackupDirectory, { recursive: true, force: true });
  await upsertConfig("backup_directory", testBackupDirectory);
});

afterEach(() => {
  fs.rmSync(testBackupDirectory, { recursive: true, force: true });
  fs.rmSync(outsideFile, { force: true });
});

/** docs/56 P6-01. Who may call these routes is covered in app.routes.auth.test.ts. */
describe("backups routes", () => {
  it("runs a backup, lists it, and downloads exactly the snapshot bytes", async () => {
    const app = createTestApp();

    const run = await invoke(app, { method: "POST", url: "/api/backups/run", body: { reason: "before upgrade" } });
    expect(run.status).toBe(201);
    const name = run.body.backup.name as string;
    expect(name).toContain("before-upgrade");

    const list = await invoke(app, { method: "GET", url: "/api/backups" });
    expect(list.status).toBe(200);
    expect(list.body.backups.map((backup: { name: string }) => backup.name)).toEqual([name]);
    expect(list.body.runtime).toMatchObject({ running: false, directory: testBackupDirectory });

    const download = await invoke(app, { method: "GET", url: `/api/backups/${name}/download` });
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/octet-stream");
    expect(download.headers["content-disposition"]).toBe(`attachment; filename="${name}"`);
    expect(download.headers["cache-control"]).toBe("no-store");
    const onDisk = fs.readFileSync(path.join(testBackupDirectory, name));
    expect(Number(download.headers["content-length"])).toBe(onDisk.length);
    expect(Buffer.compare(download.body as Buffer, onDisk)).toBe(0);
    expect((download.body as Buffer).subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("404s for a name that is not a snapshot in the backup directory", async () => {
    const app = createTestApp();

    const res = await invoke(app, { method: "GET", url: "/api/backups/dashboard.backup-20260101-000000000-manual.db/download" });

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("Backup not found");
  });

  it("does not serve files outside the backup directory", async () => {
    fs.writeFileSync(outsideFile, "not a backup");
    fs.mkdirSync(testBackupDirectory, { recursive: true });
    const app = createTestApp();

    for (const name of [
      encodeURIComponent("../lead-os-test-backups-routes-secret.db"),
      "..%2F..%2Fetc%2Fpasswd",
      encodeURIComponent(outsideFile),
      "not-a-db.txt",
      `${"a".repeat(300)}.db`,
    ]) {
      const res = await invoke(app, { method: "GET", url: `/api/backups/${name}/download` });
      expect([400, 404]).toContain(res.status);
    }
  });

  it("only offers .db files, so other files placed in the directory are not downloadable", async () => {
    const app = createTestApp();
    await invoke(app, { method: "POST", url: "/api/backups/run" });
    fs.writeFileSync(path.join(testBackupDirectory, "notes.txt"), "hello");

    const list = await invoke(app, { method: "GET", url: "/api/backups" });
    expect(list.body.backups.every((backup: { name: string }) => backup.name.endsWith(".db"))).toBe(true);
    expect((await invoke(app, { method: "GET", url: "/api/backups/notes.txt/download" })).status).toBe(400);
  });
});
