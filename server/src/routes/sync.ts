import { Router } from "express";
import { SyncEngine } from "../sync/engine";

export function createSyncRouter(syncEngine: SyncEngine): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const result = await syncEngine.syncNow(req.auth!.user.workspaceId);
      if (result.status === "skipped") {
        res.status(202).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/status", async (req, res, next) => {
    try {
      const latest = await syncEngine.getLastSyncLog(req.auth!.user.workspaceId);
      const runtime = syncEngine.getRuntimeStatus(req.auth!.user.workspaceId);
      const autoSyncEnabled = await syncEngine.isAutoSyncEnabled(req.auth!.user.workspaceId);
      const status = runtime.status === "syncing" || runtime.status === "error"
        ? runtime.status
        : latest?.status === "error"
        ? "error"
        : "idle";
      res.json({
        lastSyncedAt: latest?.completedAt,
        status,
        issuesSynced: latest?.issuesSynced,
        errorMessage: runtime.errorMessage ?? latest?.errorMessage ?? undefined,
        autoSyncEnabled,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
