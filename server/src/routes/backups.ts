import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { BackupService } from "../services/backup.service";

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
 * docs/56 P6-01: manager-only (mounted under `requireManager`). Restore is deliberately not an
 * endpoint: it replaces the live database, so it stays the `npm run backup:restore` CLI.
 */
export function createBackupsRouter(backupService: BackupService): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const [backups, runtime] = await Promise.all([backupService.listBackups(), backupService.getRuntimeStatus()]);
      res.json({ backups, runtime });
    } catch (error) {
      next(error);
    }
  });

  router.post("/run", validate(manualBackupSchema), async (req, res, next) => {
    try {
      const backup = await backupService.createManualBackup(req.body.reason);
      res.status(201).json({ success: true, backup });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:name/download", validate(downloadSchema), async (req, res, next) => {
    try {
      const backup = await backupService.findBackup(req.params.name as string);
      if (!backup) {
        throw new HttpError(404, "Backup not found");
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(backup.sizeBytes));
      res.setHeader("Content-Disposition", `attachment; filename="${backup.name}"`);
      res.setHeader("Cache-Control", "no-store");
      const stream = fs.createReadStream(backup.path);
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
