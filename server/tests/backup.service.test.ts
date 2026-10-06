import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configTable, developers, issues } from "../src/db/schema";
import { db, rawDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { BackupService } from "../src/services/backup.service";
import { SettingsService } from "../src/services/settings.service";
import { storeJiraApiToken } from "../src/services/jira-credentials.service";
import { isEncryptedSecret } from "../src/services/secret-crypto";
import { resetDatabase } from "./helpers/db";
import { runScratchPath } from "./helpers/tmp";

const testBackupDirectory = runScratchPath("backups-service");

async function upsertConfig(key: string, value: string): Promise<void> {
  await db.insert(configTable).values({ key, value }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
}

function createBackupService(): BackupService {
  return new BackupService(new SettingsService(), rawDb);
}

beforeEach(async () => {
  migrate(rawDb);
  await resetDatabase();
  fs.rmSync(testBackupDirectory, { recursive: true, force: true });
  await upsertConfig("backup_directory", testBackupDirectory);
  await upsertConfig("backup_enabled", "true");
  await upsertConfig("backup_interval_minutes", "30");
  await upsertConfig("backup_retention_days", "14");
  await upsertConfig("backup_max_scheduled_snapshots", "96");
  await upsertConfig("backup_on_startup", "true");
  await upsertConfig("backup_startup_max_age_hours", "12");
  await upsertConfig("backup_before_reset", "true");
});

afterEach(() => {
  fs.rmSync(testBackupDirectory, { recursive: true, force: true });
});

describe("BackupService", () => {
  it("creates a verified manual backup that includes persisted data", async () => {
    await db.insert(developers).values({ accountId: "dev-1", displayName: "Developer One", isActive: 1 });
    await db.insert(issues).values({
      jiraKey: "AM-1",
      summary: "Backup me",
      description: "notes",
      priorityName: "High",
      priorityId: "1",
      statusName: "To Do",
      statusCategory: "new",
      assigneeId: "dev-1",
      assigneeName: "Developer One",
      reporterName: "ops@example.com",
      component: "API",
      labels: "[]",
      dueDate: null,
      developmentDueDate: null,
      flagged: 0,
      createdAt: "2026-03-07T18:00:00.000Z",
      updatedAt: "2026-03-07T18:00:00.000Z",
      syncedAt: "2026-03-07T18:00:00.000Z",
    });

    const backupService = createBackupService();
    const backup = await backupService.createManualBackup("manual-check");

    expect(fs.existsSync(backup.path)).toBe(true);
    expect(backup.name).toContain("manual-check");

    const restored = new Database(backup.path, { readonly: true, fileMustExist: true });
    try {
      const row = restored.prepare("SELECT jira_key, summary FROM issues WHERE jira_key = ?").get("AM-1") as
        | { jira_key: string; summary: string }
        | undefined;
      expect(row).toEqual({ jira_key: "AM-1", summary: "Backup me" });
    } finally {
      restored.close();
    }
  });

  it("copies encrypted Jira tokens without leaking plaintext into backup files", async () => {
    await storeJiraApiToken("super-secret-token");

    const backupService = createBackupService();
    const backup = await backupService.createManualBackup("secret-check");
    const backupBytes = fs.readFileSync(backup.path);

    expect(backupBytes.includes(Buffer.from("super-secret-token"))).toBe(false);

    const restored = new Database(backup.path, { readonly: true, fileMustExist: true });
    try {
      const row = restored.prepare("SELECT value FROM config WHERE key = ?").get("jira_api_token") as
        | { value: string }
        | undefined;
      expect(row?.value).toBeDefined();
      expect(row?.value).not.toBe("super-secret-token");
      expect(isEncryptedSecret(row!.value)).toBe(true);
    } finally {
      restored.close();
    }
  });

  it("prunes expired backups based on retention", async () => {
    const backupService = createBackupService();
    const oldBackup = await backupService.createManualBackup("old-retained");
    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldBackup.path, oldDate, oldDate);
    await upsertConfig("backup_retention_days", "1");

    await backupService.createManualBackup("fresh-retained");
    const backups = await backupService.listBackups();

    expect(backups.some((backup) => backup.name === oldBackup.name)).toBe(false);
    expect(backups.some((backup) => backup.reason === "fresh retained")).toBe(true);
  });

  it("caps scheduled backups while keeping manual backups", async () => {
    await upsertConfig("backup_max_scheduled_snapshots", "2");
    const backupService = createBackupService();

    await (backupService as any).createBackup({ reason: "scheduled", prune: true });
    await (backupService as any).createBackup({ reason: "scheduled", prune: true });
    const manualBackup = await backupService.createManualBackup("keep-me");
    await (backupService as any).createBackup({ reason: "scheduled", prune: true });

    const backups = await backupService.listBackups();
    const scheduledBackups = backups.filter((backup) => backup.reason === "scheduled");

    expect(scheduledBackups).toHaveLength(2);
    expect(backups.some((backup) => backup.name === manualBackup.name)).toBe(true);
  });

  it("creates a startup backup when there is no recent snapshot", async () => {
    const backupService = createBackupService();

    await backupService.initialize();
    backupService.stop();

    const backups = await backupService.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]?.reason).toBe("startup");
  });

  it("skips startup backup when a recent backup already exists", async () => {
    const backupService = createBackupService();
    await backupService.createManualBackup("recent");

    await upsertConfig("backup_startup_max_age_hours", "48");
    expect(await backupService.shouldCreateStartupBackup()).toBe(false);
  });

  it("returns null for pre-reset backup when the feature is disabled", async () => {
    await upsertConfig("backup_before_reset", "false");
    const backupService = createBackupService();

    await expect(backupService.createPreResetBackup()).resolves.toBeNull();
  });

  it("lists and prunes only this database's own snapshots in a shared directory", async () => {
    // UX-01: a scratch or mis-pointed instance sharing a backup directory must never touch
    // another database's snapshots. "alpha.sandbox" also checks the prefix is not a loose match.
    const scratchDir = path.join(testBackupDirectory, "..", "backups-service-dbs");
    const alpha = new BackupService(new SettingsService(), rawDb, path.join(scratchDir, "alpha.db"));
    const sandbox = new BackupService(new SettingsService(), rawDb, path.join(scratchDir, "alpha.sandbox.db"));
    const beta = new BackupService(new SettingsService(), rawDb, path.join(scratchDir, "beta.db"));

    await (alpha as any).createBackup({ reason: "scheduled", prune: false });
    await (alpha as any).createBackup({ reason: "scheduled", prune: false });
    const alphaManual = await alpha.createManualBackup("keep-alpha");
    const sandboxBackup = await sandbox.createManualBackup("keep-sandbox");
    const legacyName = "alpha.backup-20260306-192527.db";
    fs.copyFileSync(alphaManual.path, path.join(testBackupDirectory, legacyName));
    fs.writeFileSync(path.join(testBackupDirectory, "unrelated.db"), "");

    // Make every alpha snapshot expired, then let beta prune with a tight retention and cap.
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const backup of await alpha.listBackups()) {
      fs.utimesSync(backup.path, oldDate, oldDate);
    }
    await upsertConfig("backup_retention_days", "1");
    await upsertConfig("backup_max_scheduled_snapshots", "1");
    await (beta as any).createBackup({ reason: "scheduled", prune: true });
    await (beta as any).createBackup({ reason: "scheduled", prune: true });

    const betaNames = (await beta.listBackups()).map((backup) => backup.name);
    expect(betaNames).toHaveLength(1);
    expect(betaNames.every((name) => name.startsWith("beta.backup-"))).toBe(true);

    const alphaNames = (await alpha.listBackups()).map((backup) => backup.name);
    expect(alphaNames).toHaveLength(4);
    expect(alphaNames).toContain(legacyName);
    expect(alphaNames).toContain(alphaManual.name);
    expect(alphaNames.some((name) => name.startsWith("alpha.sandbox."))).toBe(false);
    expect((await sandbox.listBackups()).map((backup) => backup.name)).toEqual([sandboxBackup.name]);
    expect(fs.existsSync(path.join(testBackupDirectory, "unrelated.db"))).toBe(true);

    // Downloads resolve only this database's snapshots.
    expect(await beta.findBackup(alphaManual.name)).toBeUndefined();
    expect(await alpha.findBackup(alphaManual.name)).toBeDefined();

    // Alpha's own prune still applies its retention to its own files.
    await alpha.createManualBackup("fresh-alpha");
    const remaining = (await alpha.listBackups()).map((backup) => backup.name);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain("fresh-alpha");
    expect((await sandbox.listBackups()).map((backup) => backup.name)).toEqual([sandboxBackup.name]);
  });

  it("updates runtime status when scheduling starts and stops", async () => {
    const backupService = createBackupService();

    await backupService.start();
    const runningStatus = await backupService.getRuntimeStatus();
    expect(runningStatus.enabled).toBe(true);
    expect(runningStatus.nextRunAt).toBeTruthy();

    backupService.stop();
    const stoppedStatus = await backupService.getRuntimeStatus();
    expect(stoppedStatus.nextRunAt).toBeUndefined();
  });
});

it('P12 cleans temporary download directories when worker sanitization fails', async () => {
  const service = createBackupService();
  const backup = await service.createManualBackup('corrupt-fixture');
  await fs.promises.writeFile(backup.path, 'not sqlite');
  const mkdtemp = vi.spyOn(fs.promises, 'mkdtemp');
  await expect(service.createDownloadCopy(backup.name)).rejects.toThrow();
  const directory = await mkdtemp.mock.results[0]!.value;
  expect(fs.existsSync(directory)).toBe(false);
  mkdtemp.mockRestore();
});
