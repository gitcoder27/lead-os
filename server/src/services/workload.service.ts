import { and, eq, inArray } from "drizzle-orm";
import type { AssignmentSuggestion, Developer, DeveloperWorkload, WorkloadLevel } from "shared/types";
import { db } from "../db/connection";
import { developers, issues, teamTrackerDays, teamTrackerItems } from "../db/schema";
import { todayIsoDate } from "../utils/date";
import { getEffectiveDueDate, isActiveTeamIssue } from "./issue-rules";
import { DeveloperAvailabilityService } from "./developer-availability.service";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskKeysService } from "./task-keys.service";
import { TeamTrackerService } from "./team-tracker.service";

const PRIORITY_WEIGHTS: Record<string, number> = {
  Highest: 5,
  High: 3,
  Medium: 1,
  Low: 0.5,
  Lowest: 0.5,
};

const TRACKER_STALE_HOURS = 4;
const ACTIVE_TRACKER_STATUSES = new Set([
  "on_track",
  "at_risk",
  "waiting",
  undefined,
]);

function isTrackerStale(lastCheckInAt: string | null, now = new Date()): boolean {
  if (!lastCheckInAt) {
    return true;
  }

  const diff = now.getTime() - new Date(lastCheckInAt).getTime();
  return diff > TRACKER_STALE_HOURS * 60 * 60 * 1000;
}

function getTrackerAvailabilityRank(status?: DeveloperWorkload["trackerStatus"]): number {
  if (ACTIVE_TRACKER_STATUSES.has(status)) {
    return 0;
  }
  if (status === "done_for_today") {
    return 1;
  }
  if (status === "blocked") {
    return 2;
  }
  return 0;
}

function buildSuggestionReason(entry: DeveloperWorkload): string {
  const loadSummary = `${entry.assignedTodayCount ?? 0} planned today`;
  const issueLabel = entry.activeDefects === 1 ? "issue" : "issues";
  const statusNote = entry.trackerStatus === "done_for_today"
    ? ", marked done for today"
    : entry.trackerStatus === "blocked"
      ? ", currently blocked"
      : "";

  return `${loadSummary}, backlog score ${entry.score} across ${entry.activeDefects} active Jira ${issueLabel}${statusNote}`;
}

export class WorkloadService {
  constructor(
    private readonly availability = new DeveloperAvailabilityService()
  ) {}

  async getDevelopers(date?: string, workspaceId?: string): Promise<Developer[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(developers)
      .where(and(eq(developers.workspaceId, normalizedWorkspaceId), eq(developers.isActive, 1)));
    const mapped = rows.map((row) => ({
      accountId: row.accountId,
      displayName: row.displayName,
      email: row.email ?? undefined,
      avatarUrl: row.avatarUrl ?? undefined,
      source: row.source as Developer["source"],
      jiraAccountId: row.jiraAccountId ?? undefined,
      isActive: row.isActive === 1,
    }));

    if (!date) {
      return mapped;
    }

    const availabilityByAccountId = await this.availability.getAvailabilityMapForDate(
      mapped.map((developer) => developer.accountId),
      date,
      normalizedWorkspaceId
    );
    return mapped.map((developer) => ({
      ...developer,
      availability: availabilityByAccountId.get(developer.accountId) ?? { state: "active" as const },
    }));
  }

  async getTeamWorkload(date = todayIsoDate(), workspaceId?: string): Promise<DeveloperWorkload[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const devs = (await this.getDevelopers(date, normalizedWorkspaceId)).filter(
      (developer) => developer.availability?.state !== "inactive"
    );
    const canonicalDays = await new TaskKeysService().canonicalEnabled(normalizedWorkspaceId)
      ? (await new TeamTrackerService().getBoard(date, { workspaceId: normalizedWorkspaceId })).developers : undefined;
    const issueRows = await db.select().from(issues).where(eq(issues.workspaceId, normalizedWorkspaceId));
    const dayRows = await db
      .select()
      .from(teamTrackerDays)
      .where(and(eq(teamTrackerDays.workspaceId, normalizedWorkspaceId), eq(teamTrackerDays.date, date)));
    const trackerItems = !canonicalDays && dayRows.length > 0
      ? await db
        .select()
        .from(teamTrackerItems)
        .where(inArray(teamTrackerItems.dayId, dayRows.map((row) => row.id)))
      : [];

    const trackerDayByDeveloper = new Map(
      dayRows.map((row) => [row.developerAccountId, row])
    );
    const trackerItemsByDayId = new Map<number, Array<typeof teamTrackerItems.$inferSelect>>();

    for (const item of trackerItems) {
      const existing = trackerItemsByDayId.get(item.dayId);
      if (existing) {
        existing.push(item);
      } else {
        trackerItemsByDayId.set(item.dayId, [item]);
      }
    }

    return devs.map((dev) => {
      const jiraAccountId = dev.jiraAccountId ?? (dev.source === "manual" ? undefined : dev.accountId);
      const mine = issueRows.filter(
        (issue) => jiraAccountId !== undefined && issue.assigneeId === jiraAccountId && isActiveTeamIssue(issue)
      );
      const score = this.calculateScore(mine.map((item) => item.priorityName));
      const trackerDay = trackerDayByDeveloper.get(dev.accountId);
      const trackerDayItems = trackerDay ? trackerItemsByDayId.get(trackerDay.id) ?? [] : [];
      const canonicalDay = canonicalDays?.find((day) => day.developer.accountId === dev.accountId);
      const currentCount = (canonicalDay ? Boolean(canonicalDay.currentItem) : trackerDayItems.some((item) => item.state === "in_progress")) ? 1 : 0;
      const plannedCount = canonicalDay?.plannedItems.length ?? trackerDayItems.filter((item) => item.state === "planned").length;
      const completedTodayCount = canonicalDay?.completedItems.length ?? trackerDayItems.filter((item) => item.state === "done").length;
      const droppedTodayCount = canonicalDay?.droppedItems.length ?? trackerDayItems.filter((item) => item.state === "dropped").length;
      const assignedTodayCount = currentCount + plannedCount;
      const hasCurrentItem = currentCount === 1;
      const noCurrentItem = assignedTodayCount > 0 && !hasCurrentItem;
      const idle = assignedTodayCount === 0 && trackerDay?.status !== "done_for_today";

      return {
        developer: dev,
        activeDefects: mine.length,
        dueToday: mine.filter((item) => getEffectiveDueDate(item) === date).length,
        blocked: mine.filter((item) => item.flagged === 1).length,
        score,
        level: this.getLevel(score),
        currentCount,
        plannedCount,
        assignedTodayCount,
        completedTodayCount,
        droppedTodayCount,
        trackerStatus: trackerDay?.status as DeveloperWorkload["trackerStatus"],
        isTrackerStale: trackerDay ? isTrackerStale(trackerDay.lastCheckInAt) : false,
        hasCurrentItem,
        signals: {
          idle,
          noCurrentItem,
          backlogTrackerMismatch: mine.length > 0 && assignedTodayCount === 0,
        },
      };
    });
  }

  async getDeveloperIssues(accountId: string, workspaceId?: string): Promise<Array<typeof issues.$inferSelect>> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, normalizedWorkspaceId), eq(issues.assigneeId, accountId)));
    return rows.filter((issue) => isActiveTeamIssue(issue));
  }

  async getIdleDevelopers(date = todayIsoDate(), workspaceId?: string): Promise<Developer[]> {
    const team = await this.getTeamWorkload(date, workspaceId);
    return team.filter((entry) => entry.signals?.idle === true).map((entry) => entry.developer);
  }

  async suggestAssignee(workspaceId?: string): Promise<AssignmentSuggestion[]> {
    const team = await this.getTeamWorkload(todayIsoDate(), workspaceId);
    return [...team]
      .filter((entry) => Boolean(entry.developer.jiraAccountId ?? (entry.developer.source === "manual" ? undefined : entry.developer.accountId)))
      .sort((a, b) => {
        const trackerAvailabilityDelta =
          getTrackerAvailabilityRank(a.trackerStatus) - getTrackerAvailabilityRank(b.trackerStatus);
        if (trackerAvailabilityDelta !== 0) {
          return trackerAvailabilityDelta;
        }

        const assignedDelta = (a.assignedTodayCount ?? 0) - (b.assignedTodayCount ?? 0);
        if (assignedDelta !== 0) {
          return assignedDelta;
        }

        const scoreDelta = a.score - b.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return a.activeDefects - b.activeDefects;
      })
      .map((entry) => ({
        developer: entry.developer,
        score: entry.score,
        reason: buildSuggestionReason(entry),
        workload: entry,
      }));
  }

  calculateScore(priorities: string[]): number {
    return priorities.reduce((sum, p) => sum + (PRIORITY_WEIGHTS[p] ?? 0.5), 0);
  }

  getLevel(score: number): WorkloadLevel {
    if (score < 5) {
      return "light";
    }
    if (score < 12) {
      return "medium";
    }
    return "heavy";
  }
}
