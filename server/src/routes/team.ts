import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { WorkloadService } from "../services/workload.service";
import type { AuthService } from "../services/auth.service";
import { runInTransaction } from "../db/transaction";
import { JiraClient } from "../jira/client";
import { db } from "../db/connection";
import { configTable, developers as developersTable, issues } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { config } from "../config";
import { getJiraApiToken } from "../runtime-credentials";
import { getPersistedJiraApiToken } from "../services/jira-credentials.service";
import { getParticipatingDeveloperIds } from "../services/developer-participation.service";
import type { Developer } from "shared/types";

const paramsSchema = z.object({
  params: z.object({ accountId: z.string().regex(/^[A-Za-z0-9:-]+$/, "Invalid account id format") }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const workloadQuerySchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).optional(),
  body: z.any().optional(),
  params: z.any().optional(),
});

const saveDevelopersSchema = z.object({
  body: z.object({
    developers: z.array(
      z.object({
        accountId: z.string().min(1),
        displayName: z.string().min(1),
        email: z.string().optional(),
        avatarUrl: z.string().optional(),
        source: z.enum(["jira", "manual"]).optional(),
        jiraAccountId: z.string().trim().optional(),
      })
    ),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const manualDeveloperSchema = z.object({
  body: z.object({
    displayName: z.string().trim().min(1),
    email: z.string().trim().email().optional().or(z.literal("")),
    jiraAccountId: z.string().trim().optional().or(z.literal("")),
  }),
  params: z.any().optional(),
  query: z.any().optional(),
});

const updateDeveloperSchema = z.object({
  params: z.object({ accountId: z.string().regex(/^[A-Za-z0-9:-]+$/, "Invalid account id format") }),
  body: z.object({
    displayName: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional().or(z.literal("")),
    jiraAccountId: z.string().trim().optional().or(z.literal("")),
    isActive: z.boolean().optional(),
  }),
  query: z.any().optional(),
}).refine(
  (value) => Object.keys(value.body).length > 0,
  { message: "At least one team member field must be provided", path: ["body"] }
);

type DeveloperUpdateValues = Partial<typeof developersTable.$inferInsert>;

function serializeDeveloper(row: typeof developersTable.$inferSelect, participants: ReadonlySet<string>): Developer {
  return {
    accountId: row.accountId,
    displayName: row.displayName,
    email: row.email ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    source: row.source as "jira" | "manual",
    jiraAccountId: row.jiraAccountId ?? undefined,
    isActive: row.isActive === 1,
    participates: participants.has(row.accountId),
  };
}

function createDeveloperUpdateValues(body: {
  displayName?: string;
  email?: string;
  jiraAccountId?: string;
  isActive?: boolean;
}): DeveloperUpdateValues {
  const updates: DeveloperUpdateValues = {};

  if (body.displayName !== undefined) {
    updates.displayName = body.displayName.trim();
  }

  if (body.email !== undefined) {
    updates.email = body.email.trim() || null;
  }

  if (body.jiraAccountId !== undefined) {
    updates.jiraAccountId = body.jiraAccountId.trim() || null;
  }

  if (body.isActive !== undefined) {
    updates.isActive = body.isActive ? 1 : 0;
  }

  return updates;
}

const developersQuerySchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).optional(),
  body: z.any().optional(),
  params: z.any().optional(),
});

const discoverSchema = z.object({
  body: z
    .object({
      jiraApiToken: z.string().min(1).optional(),
      query: z.string().optional(),
      startAt: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    })
    .default({}),
  params: z.any().optional(),
  query: z.any().optional(),
});

async function getConfigValue(key: string, workspaceId: string): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(configTable)
    .where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key)))
    .limit(1);
  return rows[0]?.value;
}

function makeManualAccountId(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "member";
  return `manual:${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createTeamRouter(workloadService: WorkloadService, authService: AuthService): Router {
  const router = Router();

  router.get("/workload", validate(workloadQuerySchema), async (req, res, next) => {
    try {
      const workloads = await workloadService.getTeamWorkload(
        req.query.date as string | undefined,
        req.auth!.user.workspaceId
      );
      res.json({ developers: workloads });
    } catch (error) {
      next(error);
    }
  });

  router.get("/developers", validate(developersQuerySchema), async (req, res, next) => {
    try {
      const developers = await workloadService.getDevelopers(
        req.query.date as string | undefined,
        req.auth!.user.workspaceId
      );
      res.json({ developers });
    } catch (error) {
      next(error);
    }
  });

  router.post("/discover", validate(discoverSchema), async (req, res, next) => {
    try {
      const workspaceId = req.auth!.user.workspaceId;
      const jiraBaseUrl = (await getConfigValue("jira_base_url", workspaceId)) ?? config.JIRA_BASE_URL ?? "";
      const jiraEmail = (await getConfigValue("jira_email", workspaceId)) ?? config.JIRA_EMAIL ?? "";
      const projectKey = (await getConfigValue("jira_project_key", workspaceId)) ?? config.JIRA_PROJECT_KEY ?? "";
      const token = req.body.jiraApiToken ?? (await getPersistedJiraApiToken(workspaceId)) ?? getJiraApiToken(workspaceId) ?? config.JIRA_API_TOKEN ?? "";
      const query = (req.body.query as string | undefined)?.trim() || undefined;
      const startAt = (req.body.startAt as number | undefined) ?? 0;
      const maxResults = (req.body.maxResults as number | undefined) ?? 50;
      const missing: string[] = [];

      if (!jiraBaseUrl) {
        missing.push("jira base url");
      }
      if (!jiraEmail) {
        missing.push("jira email");
      }
      if (!projectKey) {
        missing.push("jira project key");
      }
      if (!token) {
        missing.push("jira api token");
      }

      if (missing.length > 0) {
        res.status(400).json({
          error: `Jira not configured: missing ${missing.join(", ")}`,
          status: 400,
        });
        return;
      }

      const client = new JiraClient(jiraBaseUrl, jiraEmail, token);
      const users = await client.getAssignableUsers(projectKey, {
        query,
        startAt,
        maxResults,
      });
      res.json({
        users: users.map((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          email: u.emailAddress,
          avatarUrl: u.avatarUrls?.["48x48"],
        })),
        startAt,
        maxResults,
        count: users.length,
        hasMore: users.length === maxResults,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/developers", validate(saveDevelopersSchema), async (req, res, next) => {
    try {
      const devs = req.body.developers as Array<{
        accountId: string;
        displayName: string;
        email?: string;
        avatarUrl?: string;
        source?: "jira" | "manual";
        jiraAccountId?: string;
      }>;
      const workspaceId = req.auth!.user.workspaceId;

      // Members who are new or coming back from removal: any session left over from
      // an earlier stint must not come back to life with them. Members who were
      // already active keep their sessions (this endpoint upserts the whole roster).
      const alreadyActive = new Set(
        (
          devs.length === 0 ? [] : await db
            .select({ accountId: developersTable.accountId })
            .from(developersTable)
            .where(
              and(
                eq(developersTable.workspaceId, workspaceId),
                eq(developersTable.isActive, 1),
                inArray(developersTable.accountId, devs.map((dev) => dev.accountId))
              )
            )
        ).map((row) => row.accountId)
      );

      for (const dev of devs) {
        const source = dev.source ?? "jira";
        const jiraAccountId = source === "jira"
          ? (dev.jiraAccountId?.trim() || dev.accountId)
          : (dev.jiraAccountId?.trim() || null);
        await db
          .insert(developersTable)
          .values({
            workspaceId,
            accountId: dev.accountId,
            displayName: dev.displayName,
            email: dev.email ?? null,
            avatarUrl: dev.avatarUrl ?? null,
            source,
            jiraAccountId,
            isActive: 1,
          })
          .onConflictDoUpdate({
            target: [developersTable.workspaceId, developersTable.accountId],
            set: {
              displayName: dev.displayName,
              email: dev.email ?? null,
              avatarUrl: dev.avatarUrl ?? null,
              source,
              jiraAccountId,
              isActive: 1,
            },
          });
      }

      for (const dev of devs) {
        if (!alreadyActive.has(dev.accountId)) {
          await authService.revokeDeveloperSessions(dev.accountId, workspaceId);
        }
      }

      res.json({ success: true, count: devs.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/developers/manual", validate(manualDeveloperSchema), async (req, res, next) => {
    try {
      const displayName = req.body.displayName.trim();
      const email = req.body.email?.trim() || null;
      const jiraAccountId = req.body.jiraAccountId?.trim() || null;
      const accountId = makeManualAccountId(displayName);
      const workspaceId = req.auth!.user.workspaceId;

      const rows = await db
        .insert(developersTable)
        .values({
          workspaceId,
          accountId,
          displayName,
          email,
          avatarUrl: null,
          source: "manual",
          jiraAccountId,
          isActive: 1,
        })
        .returning();

      const created = rows[0];
      if (!created) {
        throw new Error("Failed to create manual team member");
      }
      res.status(201).json({
        developer: serializeDeveloper(created, await getParticipatingDeveloperIds(workspaceId)),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/developers/:accountId", validate(updateDeveloperSchema), async (req, res, next) => {
    try {
      const accountId = req.params.accountId as string;
      const updates = createDeveloperUpdateValues(req.body);
      const workspaceId = req.auth!.user.workspaceId;

      const updated = await runInTransaction(async () => {
        const before = (
          await db
            .select({ isActive: developersTable.isActive })
            .from(developersTable)
            .where(and(eq(developersTable.workspaceId, workspaceId), eq(developersTable.accountId, accountId)))
            .limit(1)
        )[0];
        const rows = await db
          .update(developersTable)
          .set(updates)
          .where(and(eq(developersTable.workspaceId, workspaceId), eq(developersTable.accountId, accountId)))
          .returning();
        // Deactivating via PATCH is a removal too: revoke logins. Reactivating drops
        // stale sessions so they cannot resume with the member.
        if (rows[0] && updates.isActive === 0) {
          await authService.revokeDeveloperAccess(accountId, workspaceId);
        } else if (rows[0] && updates.isActive === 1 && before?.isActive !== 1) {
          await authService.revokeDeveloperSessions(accountId, workspaceId);
        }
        return rows[0];
      });
      if (!updated) {
        res.status(404).json({ error: "Team member not found", status: 404 });
        return;
      }

      res.json({ developer: serializeDeveloper(updated, await getParticipatingDeveloperIds(req.auth!.user.workspaceId)) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/developers/:accountId", validate(paramsSchema), async (req, res, next) => {
    try {
      const accountId = req.params.accountId as string;

      const workspaceId = req.auth!.user.workspaceId;

      // Deactivate and revoke together: a removed member must not keep a working login.
      await runInTransaction(async () => {
        await db
          .update(developersTable)
          .set({ isActive: 0 })
          .where(and(eq(developersTable.workspaceId, workspaceId), eq(developersTable.accountId, accountId)));
        await authService.revokeDeveloperAccess(accountId, workspaceId);
      });

      res.json({ success: true, accountId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:accountId/issues", validate(paramsSchema), async (req, res, next) => {
    try {
      const accountId = req.params.accountId as string;
      const issues = await workloadService.getDeveloperIssues(accountId, req.auth!.user.workspaceId);
      res.json({ issues });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
