import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { TaskService, taskCreateSchema, taskUpdateSchema, taskLinkSchema } from "../services/task.service";
import { TaskKeysService } from "../services/task-keys.service";
import { CaptureService } from "../services/capture.service";
import { compact, type AssistantToolDefinition, type AssistantToolContext } from "./tools";

const key = z.string().regex(/^[Tt]-\d{1,9}$/);
const taskKeyProperty = { type: "string", pattern: "^[Tt]-[0-9]{1,9}$" };
const fields = {
  title: { type: "string" }, kind: { type: "string", enum: ["task", "meeting"] }, status: { type: "string", enum: ["open", "active", "blocked", "done", "dropped"] },
  ownerType: { type: ["string", "null"], enum: ["manager", "developer", null] }, ownerId: { type: ["string", "null"] },
  later: { type: "boolean" }, priority: { type: "string", enum: ["normal", "high"] }, labels: { type: "array", items: { type: "string" } },
  scheduledOn: { type: ["string", "null"] }, dueAt: { type: ["string", "null"] }, followUpAt: { type: ["string", "null"] },
  startsAt: { type: ["string", "null"] }, endsAt: { type: ["string", "null"] }, participants: { type: ["string", "null"] },
  nextAction: { type: ["string", "null"] }, outcome: { type: ["string", "null"] }, parentId: { type: ["integer", "null"] },
};

export function canonicalTaskTools(): AssistantToolDefinition[] {
  const service = new TaskService();
  const principal = (ctx: AssistantToolContext) => ({ type: "copilot" as const, accountId: ctx.managerAccountId, workspaceId: ctx.workspaceId });
  function tool<T>(name: string, description: string, schema: z.ZodType<T>, properties: Record<string, unknown>, required: string[], write: boolean, execute: (args: T, ctx: AssistantToolContext) => Promise<unknown>): AssistantToolDefinition {
    return { name, description, parameters: { type: "object", properties, required, additionalProperties: false }, confirm: write ? "always" : "never",
      invalidate: write ? ["tasks", "task-events", "task-resolution", "today", "team-tracker", "my-day", "manager-desk", "daily-notes", "workload"] : [],
      label: () => description, summarize: (args) => `${name.replaceAll("_", " ")}${args.taskKey ? ` ${String(args.taskKey)}` : args.title ? `: ${String(args.title)}` : ""}`,
      execute: async (raw, ctx) => {
        if (!(await new TaskKeysService().canonicalEnabled(ctx.workspaceId))) throw new HttpError(409, "Canonical tasks are not enabled");
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
        return { result: await execute(parsed.data, ctx), summary: description };
      },
    };
  }
  const update = taskUpdateSchema.extend({ taskKey: key });
  return [
    tool("list_tasks", "List tasks", z.object({ view: z.enum(["desk", "follow-ups", "meetings", "developer", "all"]).optional(), ownerId: z.string().optional(), date: z.string().optional(), closedFrom: z.string().optional(), closedTo: z.string().optional() }).strict(),
      { view: { type: "string", enum: ["desk", "follow-ups", "meetings", "developer", "all"] }, ownerId: { type: "string" }, date: { type: "string" }, closedFrom: { type: "string" }, closedTo: { type: "string" } }, [], false,
      async (args, ctx) => ({ tasks: await Promise.all((await service.list(principal(ctx), args)).slice(0, 100).map((row) => service.toDto(row, principal(ctx)))) })),
    tool("create_task", "Create task", taskCreateSchema, fields, ["title"], true, async (args, ctx) => service.toDto(await service.create(args, principal(ctx)), principal(ctx))),
    tool("update_task", "Update task", update, { ...fields, taskKey: taskKeyProperty }, ["taskKey"], true, async ({ taskKey, ...args }, ctx) => service.toDto(await service.update(taskKey, args, principal(ctx)), principal(ctx))),
    tool("delete_task", "Delete task", z.object({ taskKey: key }).strict(), { taskKey: taskKeyProperty }, ["taskKey"], true, async ({ taskKey }, ctx) => { await service.remove(taskKey, principal(ctx)); return { deleted: true, taskKey }; }),
    tool("reassign_task", "Reassign task", z.object({ taskKey: key, toAccountId: z.string().min(1) }).strict(), { taskKey: taskKeyProperty, toAccountId: { type: "string" } }, ["taskKey", "toAccountId"], true,
      async ({ taskKey, toAccountId }, ctx) => service.toDto(await service.update(taskKey, { ownerType: "developer", ownerId: toAccountId }, principal(ctx)), principal(ctx))),
    tool("reschedule_task", "Reschedule task", z.object({ taskKey: key, scheduledOn: z.string() }).strict(), { taskKey: taskKeyProperty, scheduledOn: { type: "string" } }, ["taskKey", "scheduledOn"], true,
      async ({ taskKey, scheduledOn }, ctx) => service.toDto(await service.update(taskKey, { scheduledOn }, principal(ctx)), principal(ctx))),
    tool("link_task", "Link task", taskLinkSchema.extend({ taskKey: key }), { taskKey: taskKeyProperty, kind: { type: "string", enum: ["jira", "person", "external", "task"] }, ref: { type: "string" }, role: { type: "string", enum: ["primary", "related"] } }, ["taskKey", "kind", "ref"], true,
      async ({ taskKey, ...args }, ctx) => service.addLink(taskKey, args, principal(ctx))),
    tool("unlink_task", "Unlink task", z.object({ taskKey: key, linkId: z.number().int().positive() }).strict(), { taskKey: taskKeyProperty, linkId: { type: "integer" } }, ["taskKey", "linkId"], true,
      async ({ taskKey, linkId }, ctx) => { await service.removeLink(taskKey, linkId, principal(ctx)); return { deleted: true }; }),
    // Phase 3 (P3-D8): the shared capture grammar as a confirm-gated tool.
    {
      name: "capture",
      description:
        "Capture text through the shared grammar: 'T-n: …' logs an update, '/note …' appends to today's daily note, and anything else creates a task. Tokens: @person (owner), #JIRA-KEY, ^T-n (parent), T-n (link), !today/!tomorrow/!weekday/!+Nd/!+Nw/!YYYY-MM-DD, !! (high priority), /later, /meeting, /f [date] (follow-up), +label.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["tasks", "task-events", "task-resolution", "today", "team-tracker", "my-day", "manager-desk", "daily-notes"],
      label: () => "Capturing…",
      summarize: (args) => `Capture "${String(args.text ?? "")}"`,
      execute: async (raw, ctx) => {
        if (!(await new TaskKeysService().phase3Enabled(ctx.workspaceId))) throw new HttpError(409, "Phase 3 capture is not enabled");
        const parsed = z.object({ text: z.string().min(1).max(4000) }).strict().safeParse(raw);
        if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
        const outcome = await new CaptureService().run(
          { text: parsed.data.text, confirm: true },
          { type: "copilot", accountId: ctx.managerAccountId, workspaceId: ctx.workspaceId },
        );
        if (outcome.blocked) {
          const first = outcome.diagnostics.find((entry) => entry.severity === "error");
          throw new HttpError(400, first?.message ?? "Capture is blocked");
        }
        return { result: compact(outcome), summary: outcome.task ? `Captured ${outcome.task.taskKey}: ${outcome.task.title}` : outcome.event ? `Logged update on ${outcome.event.taskKey}` : "Captured note" };
      },
    },
  ];
}