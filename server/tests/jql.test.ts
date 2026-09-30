import { describe, expect, it } from "vitest";
import { appendManagedAssigneeClause, buildScopedJql, normalizeConfiguredJqlForMode, stripManagedAssigneeClause } from "../src/jira/jql";

describe("jira jql helpers", () => {
  it("removes a top-level assignee clause and preserves ordering", () => {
    const query = `project = AM
AND issuetype = "AS: Test Defect"
AND assignee IN ("lead-1", "dev-1")
ORDER BY updated DESC`;

    expect(stripManagedAssigneeClause(query)).toBe(`project = AM
AND issuetype = "AS: Test Defect"
ORDER BY updated DESC`);
  });

  it("appends the managed assignee clause before ORDER BY", () => {
    const query = `project = AM
AND issuetype = Bug
ORDER BY updated DESC`;

    expect(appendManagedAssigneeClause(query, ["lead-1", "dev-1"])).toBe(`project = AM
AND issuetype = Bug
AND assignee IN ("lead-1", "dev-1")
ORDER BY updated DESC`);
  });

  it("builds a scoped query from the normalized base query", () => {
    const query = `project = {PROJECT_KEY}
AND statusCategory != Done
AND assignee IN ("legacy-user")
    ORDER BY Rank ASC`;

    expect(buildScopedJql("AM", query, ["lead-1", "dev-1"], "team_assignees")).toBe(`project = AM
AND statusCategory != Done
AND assignee IN ("lead-1", "dev-1")
ORDER BY Rank ASC`);
  });

  it("wraps top-level OR queries before appending the managed assignee clause", () => {
    const query = 'status = Open OR status = "In Progress"';

    expect(appendManagedAssigneeClause(query, ["lead-1"])).toBe(
      '(status = Open OR status = "In Progress") AND assignee IN ("lead-1")'
    );
  });

  it("falls back to the default query when no custom base query is configured", () => {
    expect(buildScopedJql("AM", "", ["lead-1"], "team_assignees")).toBe(
      'project = AM AND issuetype = Bug AND statusCategory != Done AND assignee IN ("lead-1")'
    );
  });

  it("builds a match-nothing scoped query when no assignee scope is configured", () => {
    expect(buildScopedJql("AM", "", [], "team_assignees")).toBe(
      "project = AM AND issuetype = Bug AND statusCategory != Done AND assignee IS EMPTY AND assignee IS NOT EMPTY"
    );
  });

  it("uses the configured base query without managed assignee changes in base-query mode", () => {
    const query = `project = {PROJECT_KEY}
AND assignee IN ("external-1", "external-2")
ORDER BY updated DESC`;

    expect(buildScopedJql("AM", query, ["lead-1"], "base_query")).toBe(`project = AM
AND assignee IN ("external-1", "external-2")
ORDER BY updated DESC`);
  });

  it("falls back to the default defect universe without assignee scope in base-query mode", () => {
    expect(buildScopedJql("AM", "", [], "base_query")).toBe(
      "project = AM AND issuetype = Bug AND statusCategory != Done"
    );
  });

  describe("team + unassigned scope (docs/56 P5-01)", () => {
    it("adds the roster and unassigned issues as one parenthesised clause", () => {
      expect(buildScopedJql("AM", "", ["lead-1", "dev-1"], "team_and_unassigned")).toBe(
        'project = AM AND issuetype = Bug AND statusCategory != Done AND (assignee IN ("lead-1", "dev-1") OR assignee IS EMPTY)'
      );
    });

    it("still returns unassigned issues when the roster is empty", () => {
      expect(buildScopedJql("AM", "", [], "team_and_unassigned")).toBe(
        "project = AM AND issuetype = Bug AND statusCategory != Done AND assignee IS EMPTY"
      );
    });

    it("keeps ORDER BY last and wraps a top-level OR base query", () => {
      const query = `status = Open OR status = "In Progress"
ORDER BY updated DESC`;
      expect(buildScopedJql("AM", query, ["lead-1"], "team_and_unassigned")).toBe(
        '(status = Open OR status = "In Progress") AND (assignee IN ("lead-1") OR assignee IS EMPTY)\nORDER BY updated DESC'
      );
    });

    it("strips its own managed clause so a saved query never accumulates it", () => {
      const scoped = buildScopedJql("AM", "project = {PROJECT_KEY} AND statusCategory != Done", ["lead-1", "dev-1"], "team_and_unassigned");
      expect(normalizeConfiguredJqlForMode(scoped, "team_and_unassigned")).toBe("project = AM AND statusCategory != Done");
      expect(buildScopedJql("AM", scoped, ["lead-1", "dev-1"], "team_and_unassigned")).toBe(scoped);
    });

    it("does not strip a user's own parenthesised assignee logic in base-query mode", () => {
      const query = 'project = AM AND (assignee IN ("x") OR assignee IS EMPTY)';
      expect(normalizeConfiguredJqlForMode(query, "base_query")).toBe(query);
    });

    it("still adds the plain roster clause in team-assignees mode (existing workspaces)", () => {
      expect(buildScopedJql("AM", "", ["lead-1"], "team_assignees")).toBe(
        'project = AM AND issuetype = Bug AND statusCategory != Done AND assignee IN ("lead-1")'
      );
    });
  });
});
