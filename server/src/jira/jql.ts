import type { JiraSyncScopeMode } from "shared/types";

function isBoundaryChar(char: string | undefined): boolean {
  return !char || !/[A-Za-z0-9_]/.test(char);
}

function startsWithKeyword(source: string, index: number, keyword: string): boolean {
  const slice = source.slice(index, index + keyword.length);
  if (slice.toUpperCase() !== keyword) {
    return false;
  }

  return isBoundaryChar(source[index - 1]) && isBoundaryChar(source[index + keyword.length]);
}

function splitOrderBy(query: string): { body: string; orderBy: string } {
  let parenDepth = 0;
  let inDoubleQuote = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === '"' && query[index - 1] !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inDoubleQuote) {
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }

    if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (parenDepth === 0 && startsWithKeyword(query, index, "ORDER")) {
      let cursor = index + "ORDER".length;
      while (cursor < query.length && /\s/.test(query[cursor] ?? "")) {
        cursor += 1;
      }

      if (startsWithKeyword(query, cursor, "BY")) {
        return {
          body: query.slice(0, index).trim(),
          orderBy: query.slice(index).trim(),
        };
      }
    }
  }

  return { body: query.trim(), orderBy: "" };
}

function splitTopLevelAndClauses(body: string): string[] {
  const clauses: string[] = [];
  let segmentStart = 0;
  let parenDepth = 0;
  let inDoubleQuote = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"' && body[index - 1] !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inDoubleQuote) {
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }

    if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (parenDepth === 0 && startsWithKeyword(body, index, "AND")) {
      clauses.push(body.slice(segmentStart, index).trim());
      segmentStart = index + "AND".length;
    }
  }

  clauses.push(body.slice(segmentStart).trim());
  return clauses.filter(Boolean);
}

function hasTopLevelKeyword(body: string, keyword: "OR"): boolean {
  let parenDepth = 0;
  let inDoubleQuote = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"' && body[index - 1] !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inDoubleQuote) {
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }

    if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (parenDepth === 0 && startsWithKeyword(body, index, keyword)) {
      return true;
    }
  }

  return false;
}

function joinClauses(clauses: string[], multiline: boolean): string {
  return clauses.join(multiline ? "\nAND " : " AND ").trim();
}

/** The parenthesised clause the team-and-unassigned scope appends. */
const MANAGED_TEAM_OR_UNASSIGNED = /^\(\s*assignee\s+IN\s*\(.*\)\s+OR\s+assignee\s+IS\s+EMPTY\s*\)$/is;

function isAssigneeClause(clause: string): boolean {
  const trimmed = clause.trim();
  return /^assignee\b/i.test(trimmed) || MANAGED_TEAM_OR_UNASSIGNED.test(trimmed);
}

function combineBodyAndOrder(body: string, orderBy: string): string {
  if (body && orderBy) {
    return `${body}\n${orderBy}`;
  }
  return body || orderBy;
}

export function stripManagedAssigneeClause(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }

  const { body, orderBy } = splitOrderBy(trimmed);
  const multiline = body.includes("\n");
  const remainingClauses = splitTopLevelAndClauses(body).filter((clause) => !isAssigneeClause(clause));
  const normalizedBody = joinClauses(remainingClauses, multiline);
  return combineBodyAndOrder(normalizedBody, orderBy);
}

function quoteAccountId(accountId: string): string {
  return JSON.stringify(accountId);
}

export function appendManagedAssigneeClause(
  query: string,
  teamAccountIds: Iterable<string>,
  includeUnassigned = false
): string {
  const uniqueTeamIds = Array.from(new Set(Array.from(teamAccountIds).map((id) => id.trim()).filter(Boolean)));
  const teamClause = `assignee IN (${uniqueTeamIds.map(quoteAccountId).join(", ")})`;
  // docs/56 P5-01: with unassigned included an empty roster still returns the unassigned issues.
  const assigneeClause = includeUnassigned
    ? (uniqueTeamIds.length > 0 ? `(${teamClause} OR assignee IS EMPTY)` : "assignee IS EMPTY")
    : (uniqueTeamIds.length > 0 ? teamClause : "assignee IS EMPTY AND assignee IS NOT EMPTY");
  const { body, orderBy } = splitOrderBy(query.trim());
  const multiline = body.includes("\n");
  const clauses = hasTopLevelKeyword(body, "OR")
    ? [multiline ? `(\n${body}\n)` : `(${body})`]
    : splitTopLevelAndClauses(body);
  clauses.push(assigneeClause);
  const nextBody = joinClauses(clauses, multiline);
  return combineBodyAndOrder(nextBody, orderBy);
}

function buildBaseJql(projectKey: string, configuredJql: string | undefined, normalizeManagedAssigneeClause: boolean): string {
  const rawConfigured = (configuredJql ?? "").trim();
  if (!rawConfigured) {
    return `project = ${projectKey} AND issuetype = Bug AND statusCategory != Done`;
  }

  const query = rawConfigured.replaceAll("{PROJECT_KEY}", projectKey);
  return normalizeManagedAssigneeClause ? stripManagedAssigneeClause(query) : query;
}

/** Modes where the sync appends (and the saved JQL must not carry) an assignee clause. */
export function isManagedAssigneeMode(mode: JiraSyncScopeMode): boolean {
  return mode === "team_assignees" || mode === "team_and_unassigned";
}

export function normalizeConfiguredJqlForMode(query: string, mode: JiraSyncScopeMode): string {
  return isManagedAssigneeMode(mode) ? stripManagedAssigneeClause(query) : query.trim();
}

export function buildScopedJql(
  projectKey: string,
  configuredJql: string | undefined,
  teamAccountIds: Iterable<string>,
  mode: JiraSyncScopeMode
): string {
  const baseQuery = buildBaseJql(projectKey, configuredJql, isManagedAssigneeMode(mode));
  if (mode === "base_query") {
    return baseQuery;
  }

  return appendManagedAssigneeClause(baseQuery, teamAccountIds, mode === "team_and_unassigned");
}
