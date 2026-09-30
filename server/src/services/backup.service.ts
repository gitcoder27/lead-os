import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { BackupRecord, BackupRuntimeStatus, BackupSummary } from "shared/types";
import { rawDb } from "../db/connection";
import { getDbPath, getDefaultBackupDirectory, resolveWorkspacePath } from "../db/paths";
import {
  DEFAULT_BACKUP_ENABLED,
  DEFAULT_BACKUP_INTERVAL_MINUTES,
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_BACKUP_ON_STARTUP,
  DEFAULT_BACKUP_STARTUP_MAX_AGE_HOURS,
  DEFAULT_BACKUP_BEFORE_RESET,
} from "./settings.service";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";
import { SettingsService } from "./settings.service";

interface CreateBackupOptions {
  reason: string;
  skipIfRunning?: boolean;
  prune?: boolean;
}

export type { BackupRecord, BackupRuntimeStatus, BackupSummary };

/** docs/56 P6-01 review: "Back up now" from the UI is limited to one per minute. */
export const MANUAL_BACKUP_MIN_INTERVAL_MS = 60_000;

/** A snapshot without its server path, for API responses. */
export function toBackupSummary(backup: BackupRecord): BackupSummary {
  return { name: backup.name, sizeBytes: backup.sizeBytes, createdAt: backup.createdAt, reason: backup.reason };
}

export interface BackupDownload {
  name: string;
  path: string;
  sizeBytes: number;
  /** Removes the temporary copy; call once the response is done. */
  cleanup: () => Promise<void>;
}

export class BackupService {
  private task?: NodeJS.Timeout;
  private running = false;
  private nextRunAt?: string;
  private lastError?: string;
  private lastRequestedAt = 0;

  constructor(
    private readonly settings = new SettingsService(),
    private readonly database = rawDb,
    private readonly dbPath = getDbPath()
  ) {}

  async start(): Promise<void> {
    this.stop();
    await this.pruneOldBackups();

    const enabled = await this.settings.getBackupEnabled();
    if (!enabled) {
      this.nextRunAt = undefined;
      return;
    }

    const intervalMinutes = await this.settings.getBackupIntervalMinutes();
    const intervalMs = intervalMinutes * 60_000;
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    this.task = setInterval(() => {
      void this.runScheduledBackup();
    }, intervalMs);
  }

  stop(): void {
    if (this.task) {
      clearInterval(this.task);
    }
    this.task = undefined;
    this.nextRunAt = undefined;
  }

  async initialize(): Promise<void> {
    await this.ensureBackupDirectory();

    const enabled = await this.settings.getBackupEnabled();
    if (enabled && (await this.settings.getBackupOnStartup()) && (await this.shouldCreateStartupBackup())) {
      await this.createBackup({ reason: "startup", skipIfRunning: false, prune: true });
    }

    await this.start();
  }

  async createManualBackup(reason = "manual"): Promise<BackupRecord> {
    return this.createBackup({ reason, prune: true });
  }

  /**
   * docs/56 P6-01 review: a backup asked for over HTTP. Throttled (429) so repeated clicks
   * or a script cannot fill the disk; CLI callers use `createManualBackup` directly.
   */
  async createRequestedBackup(reason = "manual", now = Date.now()): Promise<BackupRecord> {
    const waitMs = this.lastRequestedAt + MANUAL_BACKUP_MIN_INTERVAL_MS - now;
    if (waitMs > 0) {
      throw new HttpError(429, `A backup was just taken. Try again in ${Math.ceil(waitMs / 1000)} s.`);
    }
    this.lastRequestedAt = now;
    return this.createManualBackup(reason);
  }

  async createPreResetBackup(workspaceId?: string): Promise<BackupRecord | null> {
    const enabled = await this.settings.getBackupBeforeReset(workspaceId);
    if (!enabled) {
      return null;
    }
    return this.createBackup({ reason: "pre-reset", prune: true });
  }

  async listBackups(): Promise<BackupRecord[]> {
    const backupDirectory = await this.getBackupDirectory();
    if (!fs.existsSync(backupDirectory)) {
      return [];
    }

    const entries = await fs.promises.readdir(backupDirectory, { withFileTypes: true });
    const backups = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
        .map(async (entry) => {
          const filePath = path.join(backupDirectory, entry.name);
          const stats = await fs.promises.stat(filePath);
          return {
            name: entry.name,
            path: filePath,
            sizeBytes: stats.size,
            createdAt: stats.mtime.toISOString(),
            reason: this.parseReasonFromFilename(entry.name),
          } satisfies BackupRecord;
        })
    );

    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return backups;
  }

  /**
   * The snapshot with exactly this file name, or undefined. Matching against the directory
   * listing (not joining the name onto a path) is what keeps a download from leaving the
   * backup directory.
   */
  async findBackup(name: string): Promise<BackupRecord | undefined> {
    return (await this.listBackups()).find((backup) => backup.name === name);
  }

  /**
   * docs/56 P6-01 review: the file a download serves. A temporary copy of the snapshot with
   * `app_sessions` emptied and the file vacuumed, so a downloaded backup never carries live
   * session ids (they are the cookie values). Restoring it signs everyone out; nothing else
   * changes. Undefined when no snapshot has this name.
   */
  async createDownloadCopy(name: string): Promise<BackupDownload | undefined> {
    const backup = await this.findBackup(name);
    if (!backup) {
      return undefined;
    }
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lead-os-backup-download-"));
    const cleanup = () => fs.promises.rm(directory, { recursive: true, force: true });
    try {
      const copyPath = path.join(directory, backup.name);
      await fs.promises.copyFile(backup.path, copyPath);
      const copy = new Database(copyPath, { fileMustExist: true });
      try {
        copy.pragma("journal_mode = DELETE");
        const hasSessions = copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_sessions'").get();
        if (hasSessions) {
          copy.exec("DELETE FROM app_sessions");
        }
        // VACUUM rewrites the file so deleted session rows do not linger in free pages.
        copy.exec("VACUUM");
      } finally {
        copy.close();
      }
      const stats = await fs.promises.stat(copyPath);
      return { name: backup.name, path: copyPath, sizeBytes: stats.size, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async getRuntimeStatus(): Promise<BackupRuntimeStatus> {
    return {
      enabled: await this.settings.getBackupEnabled(),
      running: this.running,
      directory: await this.getBackupDirectory(),
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
    };
  }

  async shouldCreateStartupBackup(): Promise<boolean> {
    const backups = await this.listBackups();
    if (backups.length === 0) {
      return true;
    }

    const maxAgeHours = await this.settings.getBackupStartupMaxAgeHours();
    const latestBackup = backups[0];
    if (!latestBackup) {
      return true;
    }
    const ageMs = Date.now() - new Date(latestBackup.createdAt).getTime();
    return ageMs >= maxAgeHours * 60 * 60 * 1000;
  }

  private async runScheduledBackup(): Promise<void> {
    const intervalMinutes = await this.settings.getBackupIntervalMinutes();
    try {
      await this.createBackup({ reason: "scheduled", skipIfRunning: true, prune: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backup error";
      this.lastError = message;
      logger.error({ err: error }, "Scheduled backup failed");
    } finally {
      const intervalMs = intervalMinutes * 60_000;
      this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }
  }

  private async createBackup(options: CreateBackupOptions): Promise<BackupRecord> {
    if (this.running) {
      if (options.skipIfRunning) {
        throw new Error("Backup already in progress");
      }
      throw new Error("Cannot create backup while another backup is in progress");
    }

    this.running = true;
    this.lastError = undefined;

    try {
      const backupDirectory = await this.ensureBackupDirectory();
      const backupName = this.buildBackupFilename(options.reason);
      const backupPath = path.join(backupDirectory, backupName);

      await this.database.backup(backupPath);
      await this.verifyBackup(backupPath);

      if (options.prune) {
        await this.pruneOldBackups();
      }

      const stats = await fs.promises.stat(backupPath);
      logger.info({ backupPath, reason: options.reason, sizeBytes: stats.size }, "SQLite backup created");

      return {
        name: backupName,
        path: backupPath,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
        reason: this.parseReasonFromFilename(backupName),
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown backup error";
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async verifyBackup(backupPath: string): Promise<void> {
    const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      const tables = backupDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('issues', 'config', 'developers')")
        .all() as Array<{ name: string }>;
      if (tables.length < 3) {
        throw new Error(`Backup verification failed for ${backupPath}`);
      }
    } finally {
      backupDb.close();
    }
  }

  private async pruneOldBackups(): Promise<void> {
    const retentionDays = await this.settings.getBackupRetentionDays();
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const backups = await this.listBackups();
    const backupsToDelete = new Set<string>();

    for (const backup of backups) {
      if (new Date(backup.createdAt).getTime() < cutoffMs) {
        backupsToDelete.add(backup.path);
      }
    }

    const maxScheduledSnapshots = await this.settings.getBackupMaxScheduledSnapshots();
    const scheduledBackups = backups.filter((backup) => backup.reason === "scheduled");
    for (const backup of scheduledBackups.slice(maxScheduledSnapshots)) {
      backupsToDelete.add(backup.path);
    }

    await Promise.all(
      backups
        .filter((backup) => backupsToDelete.has(backup.path))
        .map(async (backup) => {
          await fs.promises.unlink(backup.path);
          logger.info({ backupPath: backup.path, reason: backup.reason }, "Pruned backup");
        })
    );
  }

  private async getBackupDirectory(): Promise<string> {
    const configured = await this.settings.getBackupDirectory();
    return configured ? resolveWorkspacePath(configured) : getDefaultBackupDirectory();
  }

  private async ensureBackupDirectory(): Promise<string> {
    const backupDirectory = await this.getBackupDirectory();
    await fs.promises.mkdir(backupDirectory, { recursive: true });
    return backupDirectory;
  }

  private buildBackupFilename(reason: string): string {
    const now = new Date();
    const timestamp = [
      now.getUTCFullYear().toString().padStart(4, "0"),
      (now.getUTCMonth() + 1).toString().padStart(2, "0"),
      now.getUTCDate().toString().padStart(2, "0"),
    ].join("") +
      "-" +
      [
        now.getUTCHours().toString().padStart(2, "0"),
        now.getUTCMinutes().toString().padStart(2, "0"),
        now.getUTCSeconds().toString().padStart(2, "0"),
        now.getUTCMilliseconds().toString().padStart(3, "0"),
      ].join("");

    const sanitizedReason = reason
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "manual";

    const dbName = path.basename(this.dbPath, ".db");
    return `${dbName}.backup-${timestamp}-${sanitizedReason}.db`;
  }

  private parseReasonFromFilename(filename: string): string {
    const match = filename.match(/\.backup-\d{8}-\d{9}-(.+)\.db$/);
    return match?.[1]?.replace(/-/g, " ") ?? "unknown";
  }
}
