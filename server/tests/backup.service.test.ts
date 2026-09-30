import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
