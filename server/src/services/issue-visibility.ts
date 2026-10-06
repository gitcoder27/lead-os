import { and, ne, sql } from "drizzle-orm";
import type { JiraSyncScopeMode } from "shared/types";
import { issues } from "../db/schema";

/** SQL equivalent of isVisibleWorkIssue, including invalid/expired snoozes. */
export function visibleWorkIssuePredicate(mode: JiraSyncScopeMode, now = new Date()) {
  return and(
    ne(issues.statusCategory, "done"),
    sql`COALESCE(${issues.excluded}, 0) <> 1`,
    sql`COALESCE(${issues.syncScopeState}, 'active') = 'active'`,
    mode === "base_query" ? undefined : sql`COALESCE(${issues.teamScopeState}, 'in_team') <> 'out_of_team'`,
    sql`COALESCE(julianday(${issues.snoozedUntil}), 0) <= julianday(${now.toISOString()})`,
  )!;
}
