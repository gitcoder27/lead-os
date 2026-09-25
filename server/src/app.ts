import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import type { SendFileOptions } from "express-serve-static-core";
import type { ServeStaticOptions } from "serve-static";
import { createIssuesRouter } from "./routes/issues";
import { createOverviewRouter } from "./routes/overview";
import { createTeamRouter } from "./routes/team";
import { createAlertsRouter } from "./routes/alerts";
import { createSuggestionsRouter } from "./routes/suggestions";
import { createSyncRouter } from "./routes/sync";
import { createConfigRouter } from "./routes/config";
import { createBackupsRouter } from "./routes/backups";
import { createTagsRouter } from "./routes/tags";
import { createTeamTrackerRouter } from "./routes/team-tracker";
import { createAuthRouter } from "./routes/auth";
import { createMyDayRouter } from "./routes/my-day";
import { createManagerDeskRouter } from "./routes/manager-desk";
import { createManagerActionsRouter } from "./routes/manager-actions";
import { createTodayRouter } from "./routes/today";
import { createSearchRouter } from "./routes/search";
import { createTasksRouter } from "./routes/tasks";
import { createTaskLabelsRouter } from "./routes/task-labels";
import { createNotesRouter } from "./routes/notes";
import { createPreferencesRouter } from "./routes/preferences";
import { createWorkSavedViewsRouter } from "./routes/work";
import { createAssistantRouter } from "./routes/assistant";
import type { AssistantService } from "./assistant/service";
import { requireAdmin, requireManager } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { AlertService } from "./services/alert.service";
import { AutomationService } from "./services/automation.service";
import { AuthService } from "./services/auth.service";
import { BackupService } from "./services/backup.service";
import { IssueService } from "./services/issue.service";
import { DailyNotesService } from "./services/daily-notes.service";
import { ManagerDeskService } from "./services/manager-desk.service";
import { MyDayService } from "./services/my-day.service";
import { NavPreferencesService } from "./services/nav-preferences.service";
import { WorkloadService } from "./services/workload.service";
import { SearchService } from "./services/search.service";
import { TaskKeysService } from "./services/task-keys.service";
import { TaskEventsService } from "./services/task-events.service";
import { TaskLabelsService } from "./services/task-labels.service";
import { CaptureService } from "./services/capture.service";
import { createCaptureRouter } from "./routes/capture";
import { WorkSavedViewsService } from "./services/work-saved-views.service";
import { TagService } from "./services/tag.service";
import { TeamTrackerService } from "./services/team-tracker.service";
import { TodayService } from "./services/today.service";
import { SyncEngine } from "./sync/engine";
import { resolveWorkspaceRoot } from "./db/paths";

// Vite emits content-hashed filenames (e.g. assets/index-CnNbQUcO.js), which are
// safe to cache forever: any change produces a new URL.
const fingerprintedAssetPattern = /\/assets\/[^/]*-[0-9A-Za-z_-]{8,}\.[a-z0-9]+$/i;
const executableAssetPattern = /\.(?:css|js|mjs)$/i;
const htmlAssetPattern = /\.html?$/i;

export const productionStaticOptions: ServeStaticOptions = {
  acceptRanges: false,
  cacheControl: false,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    res.removeHeader("Accept-Ranges");

    if (fingerprintedAssetPattern.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (htmlAssetPattern.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else {
      // Non-fingerprinted static files (favicon, images) revalidate via ETag.
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }

    if (executableAssetPattern.test(filePath)) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
  },
};

const indexHtmlSendFileOptions: SendFileOptions = {
  acceptRanges: false,
  cacheControl: false,
  etag: true,
  lastModified: true,
  headers: {
    // Keep the entry document fresh so new deploys are picked up immediately,
    // while allowing cheap 304 revalidation on repeat loads.
    "Cache-Control": "no-cache, must-revalidate",
  },
};

export interface AppServices {
  issueService: IssueService;
  workloadService: WorkloadService;
  alertService: AlertService;
  automationService: AutomationService;
  syncEngine: SyncEngine;
  backupService: BackupService;
  tagService: TagService;
  teamTrackerService: TeamTrackerService;
  authService: AuthService;
  myDayService: MyDayService;
  managerDeskService: ManagerDeskService;
  todayService: TodayService;
  searchService: SearchService;
  taskKeysService?: TaskKeysService;
  taskEventsService?: TaskEventsService;
  workSavedViewsService: WorkSavedViewsService;
  dailyNotesService?: DailyNotesService;
  navPreferencesService?: NavPreferencesService;
  assistantService?: AssistantService;
}

export function createApp(services: AppServices) {
  const app = express();
  app.use("/api/notes", express.json({ limit: "512kb" }));
  app.use(express.json());

  const dailyNotesService = services.dailyNotesService ?? new DailyNotesService(services.managerDeskService);
  const navPreferencesService = services.navPreferencesService ?? new NavPreferencesService();
  const taskKeysService = services.taskKeysService ?? new TaskKeysService();
  const taskEventsService = services.taskEventsService ?? new TaskEventsService(taskKeysService);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/issues", requireManager(services.authService), createIssuesRouter(services.issueService));
  app.use("/api/overview", requireManager(services.authService), createOverviewRouter(services.issueService));
  app.use("/api/team", requireManager(services.authService), createTeamRouter(services.workloadService));
  app.use("/api/alerts", requireManager(services.authService), createAlertsRouter(services.alertService));
  app.use(
    "/api/suggestions",
    requireManager(services.authService),
    createSuggestionsRouter(services.automationService, services.issueService)
  );
  app.use("/api/sync", requireManager(services.authService), createSyncRouter(services.syncEngine));
  app.use(
    "/api/config",
    requireManager(services.authService),
    createConfigRouter(services.syncEngine, services.backupService)
  );
  app.use("/api/backups", requireAdmin(services.authService), createBackupsRouter(services.backupService));
  app.use(
    "/api/tags",
    requireManager(services.authService),
    createTagsRouter(services.tagService, services.issueService)
  );
  app.use("/api/auth", createAuthRouter(services.authService));
  app.use("/api/today", requireManager(services.authService), createTodayRouter(services.todayService));
  app.use(
    "/api/manager-actions",
    requireManager(services.authService),
    createManagerActionsRouter(services.todayService)
  );
  app.use(
    "/api/team-tracker",
    requireManager(services.authService),
    createTeamTrackerRouter(services.teamTrackerService, services.managerDeskService)
  );
  app.use("/api/my-day", createMyDayRouter(services.myDayService, services.authService, services.issueService));
  app.use(
    "/api/manager-desk",
    createManagerDeskRouter(services.managerDeskService, services.authService)
  );
  app.use("/api/search", requireManager(services.authService), createSearchRouter(services.searchService));
  app.use("/api/tasks", requireManager(services.authService), createTasksRouter(taskKeysService, taskEventsService));
  app.use("/api/task-labels", requireManager(services.authService), createTaskLabelsRouter(new TaskLabelsService()));
  app.use("/api/capture", requireManager(services.authService), createCaptureRouter(new CaptureService()));
  app.use("/api/notes", requireManager(services.authService), createNotesRouter(dailyNotesService));
  app.use(
    "/api/preferences",
    requireManager(services.authService),
    createPreferencesRouter(navPreferencesService)
  );
  app.use(
    "/api/work",
    requireManager(services.authService),
    createWorkSavedViewsRouter(services.workSavedViewsService)
  );
  if (services.assistantService) {
    app.use(
      "/api/assistant",
      requireManager(services.authService),
      createAssistantRouter(services.assistantService)
    );
  }

  if (process.env.NODE_ENV === "production") {
    const clientDistPath = path.resolve(resolveWorkspaceRoot(), "client", "dist");
    if (existsSync(clientDistPath)) {
      app.use(express.static(clientDistPath, productionStaticOptions));
      app.get(/^\/(?!api).*/, (_req, res) => {
        res.sendFile(path.join(clientDistPath, "index.html"), indexHtmlSendFileOptions);
      });
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
