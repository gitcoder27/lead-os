import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawDb } from "../src/db/connection";
import { BackupService } from "../src/services/backup.service";
import { SettingsService } from "../src/services/settings.service";
import { resetDatabase } from "./helpers/db";
import { runScratchPath } from "./helpers/tmp";
import { seedTenants } from "./helpers/tenants";

const directory = runScratchPath("tenant-backup-limits");
const backupService = () => new BackupService(new SettingsService(), rawDb);

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
  rawDb.prepare("INSERT INTO config (workspace_id,key,value) VALUES ('default','backup_directory',?)").run(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe("install-wide reset snapshot limits", () => {
  it("reuses one recent snapshot across tenants and service restarts", async () => {
    const first = await backupService().createPreResetBackup("default");
    const second = await backupService().createPreResetBackup("friend");
    expect(second?.name).toBe(first?.name);
    expect(await backupService().listBackups()).toHaveLength(1);
  });

  it("takes a fresh snapshot once the ten-minute reuse window expires", async () => {
    const service = backupService();
    const first = await service.createPreResetBackup("default");
    expect(first).not.toBeNull();
    const old = new Date(Date.now() - 600001);
    fs.utimesSync(first!.path, old, old);
    const next = await service.createPreResetBackup("friend");
    expect(next?.name).not.toBe(first?.name);
    expect(await service.listBackups()).toHaveLength(2);
  });

  it("coalesces simultaneous reset requests from different workspaces", async () => {
    const service = backupService();
    const results = await Promise.allSettled([service.createPreResetBackup("default"), service.createPreResetBackup("friend")]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    if (results[0]?.status === "fulfilled" && results[1]?.status === "fulfilled") expect(results[0].value?.name).toBe(results[1].value?.name);
    expect(await service.listBackups()).toHaveLength(1);
  });

  it("caps pre-reset files at ten without pruning the owner's manual backup", async () => {
    const service = backupService();
    const manual = await service.createManualBackup();
    for (let i = 0; i < 12; i++) await service.createManualBackup("pre-reset");
    const files = await service.listBackups();
    expect(files.filter((file) => file.reason === "pre reset")).toHaveLength(10);
    expect(files.some((file) => file.name === manual.name)).toBe(true);
  });

  it("allows repeated friend configuration resets with one install snapshot", async () => {
    const service = backupService();
    const { F, snapshot } = await seedTenants({ backupService: service });
    const before = snapshot();
    for (let i = 0; i < 3; i++) {
      expect((await F("POST", "/api/config/reset", { confirmationText: "RESET CONFIGURATION" })).status).toBe(200);
    }
    expect((await service.listBackups()).filter((file) => file.reason === "pre reset")).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });
});
