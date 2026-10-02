import { and, eq } from "drizzle-orm";
import {
  ISSUE_BULK_LIMIT,
  type IssueBulkItem,
  type IssueBulkResponse,
  type IssueStatusExpectation,
  type IssueTransition,
  type IssueTransitionResponse,
  type IssueTransitionsResponse,
} from "shared/types";
import { db } from "../db/connection";
import { issues } from "../db/schema";
import type { JiraClient } from "../jira/client";
import type { JiraIssue, JiraTransition } from "../jira/types";
import { HttpError } from "../middleware/errorHandler";
import type { IssueService } from "./issue.service";
import { normalizeWorkspaceId } from "./workspace.service";

export type JiraMutationClient = Pick<JiraClient, "updateIssue" | "addComment"> &
  Partial<Pick<JiraClient, "getIssue" | "getTransitions" | "transitionIssue">>;
function transitionDto(row: JiraTransition): IssueTransition {
  const supported =
    row.isAvailable !== false &&
    row.hasScreen === false &&
    !Object.values(row.fields ?? {}).some((field) => field.required) &&
    Boolean(row.to?.name && /^(new|indeterminate|done)$/.test(row.to.statusCategory?.key ?? ""));
  return {
    id: row.id,
    name: row.name,
    to: { name: row.to?.name ?? "Unknown", category: row.to?.statusCategory?.key ?? "unknown" },
    supported,
    ...(!supported && { reason: "Open in Jira to complete this transition's form." }),
  };
}

/** Bounded writes use Jira's allowed transitions, rechecked at execution time. No workflow ids are guessed. */
export class IssueExecutionService {
  constructor(
    private readonly issuesService: IssueService,
    private readonly resolveClient: () => Promise<JiraMutationClient>,
  ) {}

  private async mirrorStatus(key: string, source: JiraIssue, workspaceId?: string, localWrite = false) {
    const scope = normalizeWorkspaceId(workspaceId);
    const [existing] = await db
      .select({ resolvedAt: issues.resolvedAt, statusCategory: issues.statusCategory })
      .from(issues)
      .where(and(eq(issues.workspaceId, scope), eq(issues.jiraKey, key)));
    const status = source.fields.status;
    if (!status?.name || !status.statusCategory?.key) throw new HttpError(502, "Couldn't read the Jira status");
    const resolution = source.fields.resolutiondate;
    await db
      .update(issues)
      .set({
        statusName: status.name,
        statusCategory: status.statusCategory.key,
        ...(localWrite && { localUpdatedAt: new Date().toISOString() }),
        ...(source.fields.updated &&
          Number.isFinite(Date.parse(source.fields.updated)) && { updatedAt: source.fields.updated }),
        ...(typeof resolution === "string" && Number.isFinite(Date.parse(resolution))
          ? { resolvedAt: new Date(resolution).toISOString() }
          : status.statusCategory.key === "done" && existing?.statusCategory !== "done" && !existing?.resolvedAt
            ? { resolvedAt: new Date().toISOString() }
            : {}),
      })
      .where(and(eq(issues.workspaceId, scope), eq(issues.jiraKey, key)));
  }

  async getTransitions(key: string, workspaceId?: string): Promise<IssueTransitionsResponse> {
    if (!(await this.issuesService.getById(key, undefined, workspaceId))) throw new HttpError(404, "Issue not found");
    const client = await this.resolveClient();
    if (!client.getTransitions || !client.getIssue) throw new HttpError(503, "Jira transitions are unavailable");
    try {
      const current = await client.getIssue(key);
      await this.mirrorStatus(key, current, workspaceId);
      const transitions = (await client.getTransitions(key))
        .filter((row) => /^\d{1,64}$/.test(row.id))
        .slice(0, 50)
        .map(transitionDto)
        .map((row) =>
          row.to.name === current.fields.status?.name
            ? { ...row, supported: false, reason: "Use Jira for actions that keep the same status." }
            : row,
        );
      return {
        transitions,
        currentStatus: { name: current.fields.status!.name!, category: current.fields.status!.statusCategory!.key! },
      };
    } catch {
      throw new HttpError(502, "Couldn't load Jira transitions. Check the connection and retry.");
    }
  }

  async transition(
    key: string,
    id: string,
    expected: IssueStatusExpectation,
    workspaceId?: string,
  ): Promise<IssueTransitionResponse> {
    if (!(await this.issuesService.getById(key, undefined, workspaceId))) throw new HttpError(404, "Issue not found");
    const client = await this.resolveClient();
    if (!client.getIssue || !client.getTransitions || !client.transitionIssue)
      throw new HttpError(503, "Jira transitions are unavailable");
    let current: JiraIssue;
    let available: JiraTransition[];
    try {
      current = await client.getIssue(key);
      available = await client.getTransitions(key);
    } catch {
      throw new HttpError(502, "Couldn't check the current Jira status. Refresh and retry.");
    }
    const status = current.fields.status;
    if (status?.name !== expected.name || status.statusCategory?.key !== expected.category)
      throw new HttpError(409, "Jira status changed. Refresh the issue before retrying.");
    const transition = available.find((row) => row.id === id);
    if (!transition || !transitionDto(transition).supported)
      throw new HttpError(409, "This transition is unavailable or needs a Jira form. Open it in Jira.");
    if (transition.to?.name === status.name)
      throw new HttpError(409, "Use Jira for actions that keep the same status.");
    try {
      await client.transitionIssue(key, id);
    } catch {
      throw new HttpError(502, "Jira didn't acknowledge this transition. Refresh the issue before retrying.");
    }

    // POST is acknowledged. A failed follow-up read must never turn it into a failed write to replay.
    let refreshed: JiraIssue | undefined;
    try {
      refreshed = await client.getIssue(key);
    } catch {
      /* the next normal sync can reconcile it */
    }
    await this.mirrorStatus(
      key,
      refreshed ?? { ...current, fields: { ...current.fields, status: transition.to } },
      workspaceId,
      true,
    );
    return {
      issue: (await this.issuesService.getById(key, undefined, workspaceId))!,
      ...(!refreshed && { refreshPending: true }),
    };
  }

  async bulk(items: IssueBulkItem[], workspaceId?: string): Promise<IssueBulkResponse> {
    if (
      !items.length ||
      items.length > ISSUE_BULK_LIMIT ||
      new Set(items.map((item) => item.key)).size !== items.length
    )
      throw new HttpError(400, `Choose 1–${ISSUE_BULK_LIMIT} distinct issues`);
    const results: IssueBulkResponse["results"] = [];
    for (const { key, operation } of items) {
      try {
        if (!(await this.issuesService.getById(key, undefined, workspaceId)))
          throw new HttpError(404, "Issue not found");
        switch (operation.kind) {
          case "update":
            results.push({ key, ok: true, issue: await this.issuesService.update(key, operation.update, workspaceId) });
            break;
          case "exclude":
            await this.issuesService.excludeIssue(key, workspaceId);
            results.push({ key, ok: true });
            break;
          case "restore":
            await this.issuesService.restoreIssue(key, workspaceId);
            results.push({ key, ok: true });
            break;
          case "snooze":
            await this.issuesService.snoozeIssue(key, operation.until, workspaceId);
            results.push({ key, ok: true });
            break;
          case "transitionTo": {
            const allowed = (await this.getTransitions(key, workspaceId)).transitions.filter(
              (item) =>
                item.supported &&
                item.to.category === operation.category &&
                item.to.name !== operation.expectedStatus.name,
            );
            if (allowed.length !== 1)
              throw new HttpError(409, "Choose the status transition on this issue individually.");
            const response = await this.transition(key, allowed[0]!.id, operation.expectedStatus, workspaceId);
            results.push({ key, ok: true, ...response });
            break;
          }
        }
      } catch (error) {
        results.push({
          key,
          ok: false,
          status: error instanceof HttpError ? error.status : 502,
          error:
            error instanceof HttpError
              ? error.message
              : "Jira could not apply this change. Refresh the issue before retrying.",
        });
      }
    }
    return { results };
  }
}
