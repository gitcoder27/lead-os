import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { OneOnOneService } from "../services/one-on-one.service";
import type { TaskPrincipal } from "../services/task.service";
import { compact, type AssistantToolDefinition, type AssistantToolContext } from "./tools";

const seriesRef = z.object({
  seriesId: z.number().int().positive().optional(),
  developerAccountId: z.string().trim().min(1).optional(),
}).strict();

const seriesRefProperties = {
  seriesId: { type: "integer", description: "Series id, if known" },
  developerAccountId: { type: "string", description: "Developer account id (alternative to seriesId)" },
};

/**
 * docs/48 §4.5: flag-scoped Copilot tools. Registered only while
 * `one_on_one_enabled` is on, and each execute re-checks the flag defensively.
 * Manager-only by construction — assistant tools run under the manager
 * principal.
 */
export function oneOnOneTools(): AssistantToolDefinition[] {
  const service = new OneOnOneService();
  const principal = (ctx: AssistantToolContext): TaskPrincipal => ({
    type: "copilot",
    accountId: ctx.managerAccountId,
    workspaceId: ctx.workspaceId,
  });
  const assertOn = async (ctx: AssistantToolContext): Promise<void> => {
    if (!(await service.enabled(ctx.workspaceId))) {
      throw new HttpError(409, "One-on-ones are not enabled");
    }
  };
  const resolveSeriesId = async (
    args: { seriesId?: number; developerAccountId?: string },
    ctx: AssistantToolContext,
  ): Promise<number> => {
    if (args.seriesId !== undefined) return args.seriesId;
    if (!args.developerAccountId) throw new HttpError(400, "Provide seriesId or developerAccountId");
    const match = (await service.listSeries(ctx.workspaceId)).find(
      (series) => series.developerAccountId === args.developerAccountId,
    );
    if (!match) throw new HttpError(404, "No 1:1 series exists for that developer");
    return match.id;
  };

  return [
    {
      name: "one_on_one_list",
      description:
        "List the manager's recurring 1:1 series: developer, cadence, next session date, overdue days, and open agenda count.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Listing 1:1 series…",
      summarize: () => "List 1:1 series",
      execute: async (_raw, ctx) => {
        await assertOn(ctx);
        return { result: compact({ series: await service.listSeries(ctx.workspaceId) }), summary: "Listed 1:1 series" };
      },
    },
    {
      name: "one_on_one_agenda",
      description:
        "Read a developer's 1:1 workspace: series summary, the upcoming session, the ordered agenda (with carried markers), and the last sessions.",
      parameters: { type: "object", properties: seriesRefProperties, required: [], additionalProperties: false },
      confirm: "never",
      invalidate: [],
      label: () => "Reading 1:1 agenda…",
      summarize: (args) => `Read 1:1 agenda${args.developerAccountId ? ` for ${String(args.developerAccountId)}` : ""}`,
      execute: async (raw, ctx) => {
        await assertOn(ctx);
        const args = seriesRef.safeParse(raw);
        if (!args.success) throw new HttpError(400, args.error.issues.map((issue) => issue.message).join(", "));
        const seriesId = await resolveSeriesId(args.data, ctx);
        const detail = await service.getDetail(seriesId, ctx.workspaceId);
        return {
          result: compact({ ...detail, sessions: detail.sessions.slice(0, 5) }),
          summary: `Loaded 1:1 for ${detail.series.developerName}`,
        };
      },
    },
    {
      name: "one_on_one_add_agenda",
      description:
        "Add a task to a developer's 1:1 agenda — by taskKey/taskId, or a freeform title that creates a canonical task on the developer.",
      parameters: {
        type: "object",
        properties: {
          ...seriesRefProperties,
          title: { type: "string", description: "Freeform agenda item — creates a canonical task" },
          taskKey: { type: "string", pattern: "^[Tt]-[0-9]{1,9}$" },
          taskId: { type: "integer" },
        },
        required: [],
        additionalProperties: false,
      },
      confirm: "always",
      invalidate: ["one-on-ones", "tasks", "task-resolution", "team-tracker", "today"],
      label: () => "Adding to 1:1 agenda…",
      summarize: (args) =>
        `Add to 1:1 agenda${args.title ? `: ${String(args.title)}` : args.taskKey ? ` ${String(args.taskKey)}` : ""}`,
      execute: async (raw, ctx) => {
        await assertOn(ctx);
        const args = seriesRef
          .extend({ title: z.string().trim().min(1).max(500).optional(), taskKey: z.string().trim().min(1).max(32).optional(), taskId: z.number().int().positive().optional() })
          .safeParse(raw);
        if (!args.success) throw new HttpError(400, args.error.issues.map((issue) => issue.message).join(", "));
        if (args.data.title === undefined && args.data.taskKey === undefined && args.data.taskId === undefined) {
          throw new HttpError(400, "Provide title, taskKey, or taskId");
        }
        const seriesId = await resolveSeriesId(args.data, ctx);
        const item = await service.attachAgenda(
          seriesId,
          { title: args.data.title, taskKey: args.data.taskKey, taskId: args.data.taskId },
          principal(ctx),
          ctx.workspaceId,
        );
        return { result: compact({ item }), summary: `Added ${item.task.taskKey} to the 1:1 agenda` };
      },
    },
  ];
}
