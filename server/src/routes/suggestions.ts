import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { AutomationService } from "../services/automation.service";
import { IssueService } from "../services/issue.service";
import { HttpError } from "../middleware/errorHandler";

/** Jira project keys may contain digits and underscores after the first letter (e.g. `AB2-12`). */
const issueKeyRegex = /^[A-Z][A-Z0-9_]*-\d+$/;

const keySchema = z.object({
  params: z.object({ key: z.string().regex(issueKeyRegex) }),
  query: z.any().optional(),
  body: z.any().optional(),
});

const prioritySchema = z.object({
  params: z.object({ priority: z.enum(["Highest", "High", "Medium", "Low", "Lowest"]) }),
  // docs/56 P5-02: with an issue key the target counts from that issue's creation, not from now.
  query: z.object({ issue: z.string().regex(issueKeyRegex).optional() }).passthrough().optional(),
  body: z.any().optional(),
});

export function createSuggestionsRouter(automationService: AutomationService, issueService: IssueService): Router {
  const router = Router();

  router.get("/assignee/:key", validate(keySchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      const issue = await issueService.getById(key, undefined, req.auth!.user.workspaceId);
      if (!issue) {
        throw new HttpError(404, "Issue not found");
      }
      const ranked = await automationService.suggestAssignee(req.auth!.user.workspaceId);
      res.json({ issueKey: issue.jiraKey, suggestions: ranked });
    } catch (error) {
      next(error);
    }
  });

  router.get("/priority/:key", validate(keySchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      const issue = await issueService.getById(key, undefined, req.auth!.user.workspaceId);
      if (!issue) {
        throw new HttpError(404, "Issue not found");
      }
      res.json(automationService.suggestPriority(issue.labels));
    } catch (error) {
      next(error);
    }
  });

  router.get("/duedate/:priority", validate(prioritySchema), async (req, res, next) => {
    try {
      const priority = req.params.priority as string;
      const issueKey = typeof req.query.issue === "string" ? req.query.issue : undefined;
      let createdAt = new Date().toISOString();
      if (issueKey) {
        const issue = await issueService.getById(issueKey, undefined, req.auth!.user.workspaceId);
        if (!issue) {
          throw new HttpError(404, "Issue not found");
        }
        createdAt = issue.createdAt;
      }
      res.json(automationService.suggestDueDate(priority, createdAt));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
