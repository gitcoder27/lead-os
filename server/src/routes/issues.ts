import { listPageSchema } from "../services/list-page";
import { Router } from "express";
import { z } from "zod";
import { ISSUE_BULK_LIMIT, type IssueCommentResponse } from "shared/types";
import { IssueService } from "../services/issue.service";
import { validate } from "../middleware/validate";
import { HttpError } from "../middleware/errorHandler";

const keyRegex = /^[A-Z][A-Z0-9_]*-\d+$/;
const accountIdRegex = /^[A-Za-z0-9:-]+$/;
const filterSchema = z.enum([
  "all",
  "new",
  "recentlyAssigned",
  "inProgress",
  "reopened",
  "unassigned",
  "dueToday",
  "dueThisWeek",
  "noDueDate",
  "overdue",
  "blocked",
  "stale",
  "highPriority",
  "outOfTeam",
  'excluded',
]);
const sortSchema = z.enum(["priority", "dueDate", "updated", "created"]);
const orderSchema = z.enum(["asc", "desc"]);

const paramsSchema = z.object({
  params: z.object({ key: z.string().regex(keyRegex, "Invalid issue key format") }),
  body: z.any().optional(),
  query: z.any().optional(),
});

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day; }, 'Invalid calendar date');
const issueUpdateBody = z
    .object({
      assigneeId: z.string().regex(accountIdRegex).nullable().optional(),
      priorityName: z.enum(["Highest", "High", "Medium", "Low", "Lowest"]).optional(),
      dueDate: calendarDate.nullable().optional(),
      developmentDueDate: calendarDate.nullable().optional(),
      flagged: z.boolean().optional(),
      analysisNotes: z.string().max(10000).nullable().optional(),
    })
  .strict()
    .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const updateSchema = z.object( { ...paramsSchema.shape, body: issueUpdateBody });
const statusExpectation = z
  .object({ name: z.string().min(1).max(200), category: z.enum(['new', 'indeterminate', 'done']) })
  .strict();
const transitionSchema = z.object({
  ...paramsSchema.shape,
  body: z.object({ transitionId: z.string().regex(/^\d{1,64}$/), expectedStatus: statusExpectation }).strict(),
});
const snoozeBody = z.object({ until: z.string().datetime({ offset: true }) }).strict();
const snoozeSchema = z.object({ ...paramsSchema.shape, body: snoozeBody });
const bulkSchema = z.object({
  params: z.unknown().optional(),
  query: z.unknown().optional(),
  body: z
    .object({
      items: z
        .array(
          z
            .object({
              key: z.string().regex(keyRegex),
              operation: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('update'), update: issueUpdateBody }).strict(),
                z.object({ kind: z.literal('exclude') }).strict(),
                z.object({ kind: z.literal('restore') }).strict(),
                z.object({ kind: z.literal('snooze'), until: snoozeBody.shape.until }).strict(),
                z
                  .object({
                    kind: z.literal('transitionTo'),
                    category: z.enum(['new', 'indeterminate', 'done']),
                    expectedStatus: statusExpectation,
                  })
                  .strict(),
              ]),
            })
            .strict(),
        )
        .min(1)
        .max(ISSUE_BULK_LIMIT)
        .refine((items) => new Set(items.map((item) => item.key)).size === items.length, 'Duplicate issue keys'),
    })
    .strict(),
});

const commentSchema = z.object({
  params: z.object({ key: z.string().regex(keyRegex, "Invalid issue key format") }),
  body: z.object({ text: z.string().min(1).max(5000) }),
  query: z.any().optional(),
});

const listQuerySchema = z.object({
  query: z.object({
    ...listPageSchema.shape,
    filter: filterSchema.optional(),
    assignee: z.string().optional(),
    priority: z.string().optional(),
    status: z.string().optional(),
    trackerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: sortSchema.optional(),
    order: orderSchema.optional(),
    tags: z.string().optional(),
    noTags: z.enum(["true", "false"]).optional(),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export function createIssuesRouter(issueService: IssueService): Router {
  const router = Router();

  router.get("/", validate(listQuerySchema), async (req, res, next) => {
    try {
      const query = listQuerySchema.shape.query.parse(req.query);
      const tagsParam = typeof query.tags === 'string' ? query.tags : undefined;
      const trackerDate = typeof query.trackerDate === 'string' ? query.trackerDate : undefined;
      const tagIds = tagsParam
        ? tagsParam.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : undefined;
      const noTags = query.noTags === 'true';

      const page = await issueService.getPage({
        filter: query.filter,
        assignee: query.assignee,
        priority: query.priority,
        status: query.status,
        trackerDate,
        sort: query.sort,
        order: query.order,
        tagIds,
        noTags,
      }, listPageSchema.parse(query), req.auth!.user.workspaceId);
      res.json(page);
    } catch (error) {
      next(error);
    }
  });

  router.post('/bulk', validate(bulkSchema), async (req, res, next) => {
    try {
      res.json(await issueService.bulk(req.body.items, req.auth!.user.workspaceId));
    } catch (error) {
      next(error);
    }
  });
  router.get('/:key/transitions', validate(paramsSchema), async (req, res, next) => {
    try {
      res.json(await issueService.getTransitions(req.params.key as string, req.auth!.user.workspaceId));
    } catch (error) {
      next(error);
    }
  });
  router.post('/:key/transition', validate(transitionSchema), async (req, res, next) => {
    try {
      res.json(
        await issueService.transition(
          req.params.key as string,
          req.body.transitionId,
          req.body.expectedStatus,
          req.auth!.user.workspaceId,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post('/:key/snooze', validate(snoozeSchema), async (req, res, next) => {
    try {
      await issueService.snoozeIssue(req.params.key as string, req.body.until, req.auth!.user.workspaceId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:key", validate(paramsSchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      const trackerDate = typeof req.query.trackerDate === 'string' ? req.query.trackerDate : undefined;
      const issue = await issueService.getById(key, trackerDate, req.auth!.user.workspaceId);
      if (!issue) {
        throw new HttpError(404, "Issue not found");
      }
      res.json(issue);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:key", validate(updateSchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      const issue = await issueService.update(key, req.body, req.auth!.user.workspaceId);
      res.json(issue);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:key/comments", validate(commentSchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      await issueService.addComment(key, req.body.text, req.auth!.user.workspaceId);
      const response: IssueCommentResponse = { ok: true };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:key/exclude", validate(paramsSchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      await issueService.excludeIssue(key, req.auth!.user.workspaceId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:key/restore", validate(paramsSchema), async (req, res, next) => {
    try {
      const key = req.params.key as string;
      await issueService.restoreIssue(key, req.auth!.user.workspaceId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
