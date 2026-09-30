import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import type { BackupListResponse, BackupRunResponse } from "shared/types";
import { HttpError } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { BackupService, toBackupSummary } from "../services/backup.service";

const manualBackupSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(1).max(64).optional(),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const downloadSchema = z.object({
  params: z.object({ name: z.string().regex(/^[A-Za-z0-9._-]{1,200}\.db$/, "Invalid backup name") }),
  body: z.any().optional(),
  query: z.any().optional(),
});

/**
 * docs/56 P6-01: mounted under `requireInstallManager` (a manager of the default workspace), because
 * a snapshot is the whole install. Responses never carry server paths, downloads leave out login
 * sessions, and "Back up now" is throttled. Restore is deliberately not an endpoint: it replaces the
 * live database, so it stays the `npm run backup:restore` CLI.
 */
export function createBackupsRouter(backupService: BackupService): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const [backups, runtime] = await Promise.all([backupService.listBackups(), backupService.getRuntimeStatus()]);
      const response: BackupListResponse = { backups: backups.map(toBackupSummary), runtime };
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/run", validate(manualBackupSchema), async (req, res, next) => {
    try {
      const backup = await backupService.createRequestedBackup(req.body.reason);
      const response: BackupRunResponse = { success: true, backup: toBackupSummary(backup) };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:name/download", validate(downloadSchema), async (req, res, next) => {
    try {
      const download = await backupService.createDownloadCopy(req.params.name as string);
      if (!download) {
        throw new HttpError(404, "Backup not found");
      }
      // Remove the temporary copy once it has been read, or when the client goes away first.
      const cleanup = () => void download.cleanup();
      res.on("close", cleanup);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(download.sizeBytes));
      res.setHeader("Content-Disposition", `attachment; filename="${download.name}"`);
      res.setHeader("Cache-Control", "no-store");
      const stream = fs.createReadStream(download.path);
      stream.on("error", next);
      stream.on("close", cleanup);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
