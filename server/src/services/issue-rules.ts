import type { AttentionRules, JiraSyncScopeMode } from "shared/types";
import { hasWorkingHoursElapsed, weekdayWindow } from "./working-hours";

type RuleIssue = {
  statusCategory: string;
  excluded?: boolean | number | null;
  snoozedUntil?: string | null;
  teamScopeState?: string | null;
  syncScopeState?: string | null;
  dueDate?: string | null;
  developmentDueDate?: string | null;
  updatedAt: string;
};

export function isExcluded(issue: Pick<RuleIssue, "excluded" | 'snoozedUntil'>): boolean {
  return (issue.excluded === true || issue.excluded === 1 ||
    Boolean(issue.snoozedUntil && Date.parse(issue.snoozedUntil) > Date.now())
  );
}

export function getEffectiveDueDate(issue: Pick<RuleIssue, "developmentDueDate" | "dueDate">): string | null {
  return issue.developmentDueDate ?? issue.dueDate ?? null;
}

export function isActiveTeamIssue(issue: Pick<RuleIssue, "statusCategory" | "excluded" | 'snoozedUntil' | "teamScopeState" | "syncScopeState">): boolean {
  return issue.statusCategory !== "done" &&
    !isExcluded(issue) &&
    (issue.teamScopeState ?? "in_team") !== "out_of_team" &&
    (issue.syncScopeState ?? "active") === "active";
}

export function isVisibleWorkIssue(
  issue: Pick<RuleIssue, "statusCategory" | "excluded" | 'snoozedUntil' | "teamScopeState" | "syncScopeState">,
  mode: JiraSyncScopeMode
): boolean {
  if (issue.statusCategory === "done" || isExcluded(issue) || (issue.syncScopeState ?? "active") !== "active") {
    return false;
  }

  if (mode === "base_query") {
    return true;
  }

  return (issue.teamScopeState ?? "in_team") !== "out_of_team";
}

export function isOutOfTeamIssue(issue: Pick<RuleIssue, "statusCategory" | "excluded" | 'snoozedUntil' | "teamScopeState" | "syncScopeState">): boolean {
  return issue.statusCategory !== "done" &&
    !isExcluded(issue) &&
    (issue.teamScopeState ?? "in_team") === "out_of_team" &&
    (issue.syncScopeState ?? "active") === "active";
}

export type JiraStaleRule = Pick<AttentionRules, "jiraStaleHours" | "timeZone">;

/** docs/56 P1-05: stale after `jiraStaleHours` of weekday time (weekends do not count). */
export function isStaleIssue(issue: Pick<RuleIssue, "updatedAt">, rule: JiraStaleRule, now = new Date()): boolean {
  return hasWorkingHoursElapsed(issue.updatedAt, now, rule.jiraStaleHours, weekdayWindow(rule.timeZone));
}
