import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./helpers/db";
import {
  configTable,
  dailyNotes,
  developers,
  issues,
  managerDeskDays,
  managerDeskItems,
  teamTrackerCheckIns,
  teamTrackerDays,
} from "../src/db/schema";
import { SearchService } from "../src/services/search.service";

const searchService = new SearchService();

async function seedIssue(overrides: Partial<typeof issues.$inferInsert> = {}) {
  await db.insert(issues).values({
    jiraKey: "PROJ-1",
    summary: "Payment provider timeouts",
    priorityName: "High",
    priorityId: "1",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: null,
    assigneeName: null,
    teamScopeState: "in_team",
    syncScopeState: "active",
    reporterName: null,
    component: null,
    labels: null,
    dueDate: null,
    developmentDueDate: null,
    flagged: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
    syncedAt: "2026-03-05T00:00:00.000Z",
    ...overrides,
  });
}

async function seedDeskItem(
  options: {
    managerAccountId: string;
    date?: string;
    title?: string;
    workspaceId?: string;
    updatedAt?: string;
  }
) {
  const [day] = await db
    .insert(managerDeskDays)
    .values({
      workspaceId: options.workspaceId ?? "default",
      date: options.date ?? "2026-03-07",
      managerAccountId: options.managerAccountId,
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
    })
    .returning();

  const [item] = await db
    .insert(managerDeskItems)
    .values({
      workspaceId: options.workspaceId ?? "default",
      dayId: day!.id,
      title: options.title ?? "Follow up on payment bug",
      kind: "action",
      category: "follow_up",
      status: "planned",
      priority: "medium",
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: options.updatedAt ?? "2026-03-07T09:00:00.000Z",
    })
    .returning();

  return item!;
}

async function seedNote(options: { body: string; managerAccountId: string; date?: string; workspaceId?: string }) {
  const [note] = await db
    .insert(dailyNotes)
    .values({
      workspaceId: options.workspaceId ?? "default",
      managerAccountId: options.managerAccountId,
      date: options.date ?? "2026-03-07",
      body: options.body,
      revision: 1,
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T09:00:00.000Z",
    })
    .returning();

  return note!;
}

async function seedCheckIn(options: { summary: string; developerAccountId?: string; date?: string; workspaceId?: string }) {
  const [day] = await db
    .insert(teamTrackerDays)
    .values({
      workspaceId: options.workspaceId ?? "default",
      date: options.date ?? "2026-03-07",
      developerAccountId: options.developerAccountId ?? "dev-1",
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
    })
    .returning();

  const [checkIn] = await db
    .insert(teamTrackerCheckIns)
    .values({
      workspaceId: options.workspaceId ?? "default",
      dayId: day!.id,
      summary: options.summary,
      status: "on_track",
      authorType: "developer",
      authorAccountId: options.developerAccountId ?? "dev-1",
      createdAt: "2026-03-07T08:00:00.000Z",
    })
    .returning();

  return checkIn!;
}

beforeEach(async () => {
  await resetDatabase();
  await db.insert(developers).values([
    {
      accountId: "dev-1",
      displayName: "Alice Smith",
      email: "alice@example.com",
      isActive: 1,
    },
    {
      accountId: "dev-2",
      displayName: "Rahul Sharma",
      email: "rahul@example.com",
      isActive: 1,
    },
    {
      accountId: "dev-3",
      displayName: "Zara Archived",
      email: "zara@example.com",
      isActive: 0,
    },
  ]);
});

describe("SearchService.search", () => {
  it("returns empty groups for queries shorter than two characters", async () => {
    await seedIssue();

    const result = await searchService.search("p");

    expect(result).toEqual({ query: "p", issues: [], deskItems: [], checkIns: [], developers: [], notes: [] });
  });

  it("matches issues by key, summary, and assignee name", async () => {
    await seedIssue({ jiraKey: "PROJ-100", summary: "Payment provider timeouts", assigneeName: "Alice Smith", updatedAt: "2026-03-06T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-101", summary: "Unrelated login defect", assigneeName: "Priya Paymentwall", updatedAt: "2026-03-05T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-102", summary: "Cart edge case", assigneeName: "Rahul Sharma", updatedAt: "2026-03-04T00:00:00.000Z" });

    const result = await searchService.search("payment");

    expect(result.issues.map((issue) => issue.jiraKey)).toEqual(["PROJ-100", "PROJ-101"]);
    expect(result.issues[0]).toMatchObject({ jiraKey: "PROJ-100", assigneeName: "Alice Smith", dueDate: undefined });

    const byAssignee = await searchService.search("rahul");
    expect(byAssignee.issues.map((issue) => issue.jiraKey)).toEqual(["PROJ-102"]);
  });

  it("orders issue results by most recently updated", async () => {
    await seedIssue({ jiraKey: "PROJ-1", summary: "Payment old", updatedAt: "2026-03-01T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-2", summary: "Payment new", updatedAt: "2026-03-09T00:00:00.000Z" });

    const result = await searchService.search("payment");

    expect(result.issues.map((issue) => issue.jiraKey)).toEqual(["PROJ-2", "PROJ-1"]);
  });

  it("hides closed, excluded, and out-of-team issues to match the Work board", async () => {
    await seedIssue({ jiraKey: "PROJ-OPEN", summary: "Payment provider timeouts", updatedAt: "2026-03-06T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-CLOSED", summary: "Payment closed long ago", statusName: "Closed", statusCategory: "done", updatedAt: "2026-03-08T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-EXCLUDED", summary: "Payment excluded issue", excluded: 1, updatedAt: "2026-03-07T00:00:00.000Z" });
    await seedIssue({ jiraKey: "PROJ-OUT", summary: "Payment out of team", teamScopeState: "out_of_team", updatedAt: "2026-03-05T00:00:00.000Z" });

    const result = await searchService.search("payment");

    expect(result.issues.map((issue) => issue.jiraKey)).toEqual(["PROJ-OPEN"]);
  });

  it("includes out-of-team issues when the workspace syncs by base query", async () => {
    await db.insert(configTable).values({
      workspaceId: "default",
      key: "jira_sync_scope_mode",
      value: "base_query",
    });
    await seedIssue({ jiraKey: "PROJ-OUT", summary: "Payment out of team", teamScopeState: "out_of_team" });

    const result = await searchService.search("payment");

    expect(result.issues.map((issue) => issue.jiraKey)).toEqual(["PROJ-OUT"]);
  });

  it("limits issue results", async () => {
    for (let index = 0; index < 9; index += 1) {
      await seedIssue({ jiraKey: `PROJ-${index}`, summary: `Payment overflow ${index}`, updatedAt: `2026-03-0${(index % 8) + 1}T00:00:00.000Z` });
    }

    const result = await searchService.search("overflow");

    expect(result.issues).toHaveLength(6);
  });

  it("matches desk items by title and scopes them to the requesting manager", async () => {
    await seedDeskItem({ managerAccountId: "manager-a", title: "Follow up on payment bug" });
    await seedDeskItem({ managerAccountId: "manager-b", title: "Payment review with finance" });

    const result = await searchService.search("payment", "default", "manager-a");

    expect(result.deskItems).toHaveLength(1);
    expect(result.deskItems[0]).toMatchObject({
      title: "Follow up on payment bug",
      date: "2026-03-07",
      kind: "action",
      category: "follow_up",
      status: "planned",
    });
  });

  it("matches desk items on notes and actions", async () => {
    const [day] = await db
      .insert(managerDeskDays)
      .values({
        date: "2026-03-07",
        managerAccountId: "manager-a",
        createdAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      })
      .returning();
    await db.insert(managerDeskItems).values({
      dayId: day!.id,
      title: "Weekly sync",
      kind: "meeting",
      category: "team_management",
      status: "done",
      priority: "medium",
      nextAction: "Circulate the rollout decision",
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T10:00:00.000Z",
    });

    const result = await searchService.search("rollout", "default", "manager-a");

    expect(result.deskItems).toHaveLength(1);
    expect(result.deskItems[0]?.title).toBe("Weekly sync");
  });

  it("matches check-ins by summary and developer name", async () => {
    await seedCheckIn({ summary: "Blocked on the payment gateway API keys", developerAccountId: "dev-1" });
    await seedCheckIn({ summary: "Finished code review", developerAccountId: "dev-2" });

    const bySummary = await searchService.search("gateway");
    expect(bySummary.checkIns).toHaveLength(1);
    expect(bySummary.checkIns[0]).toMatchObject({
      developerAccountId: "dev-1",
      developerName: "Alice Smith",
      date: "2026-03-07",
      status: "on_track",
    });

    const byDeveloper = await searchService.search("sharma");
    expect(byDeveloper.checkIns).toHaveLength(1);
    expect(byDeveloper.checkIns[0]?.summary).toBe("Finished code review");
  });

  it("matches active developers by display name and excludes inactive ones", async () => {
    const result = await searchService.search("ali");

    expect(result.developers).toEqual([
      {
        accountId: "dev-1",
        displayName: "Alice Smith",
        email: "alice@example.com",
        avatarUrl: undefined,
      },
    ]);
    expect(result.developers.some((developer) => developer.displayName === "Zara Archived")).toBe(false);
  });

  it("does not leak results across workspaces", async () => {
    await seedIssue({ jiraKey: "PROJ-1", summary: "Payment provider timeouts" });
    await seedIssue({ workspaceId: "other", jiraKey: "PROJ-1", summary: "Payment provider timeouts" });
    await seedDeskItem({ managerAccountId: "manager-a", title: "Follow up on payment bug", workspaceId: "other" });
    await seedCheckIn({ summary: "Blocked on payment gateway", workspaceId: "other" });

    const result = await searchService.search("payment");

    expect(result.issues).toHaveLength(1);
    expect(result.deskItems).toHaveLength(0);
    expect(result.checkIns).toHaveLength(0);
  });

  it("returns notes scoped to the requesting manager and workspace", async () => {
    await seedNote({ body: "payment retro scratchpad", managerAccountId: "manager-a" });
    await seedNote({ body: "payment notes from another manager", managerAccountId: "manager-b" });
    await seedNote({ body: "payment notes in another workspace", managerAccountId: "manager-a", workspaceId: "other" });

    const result = await searchService.search("payment", "default", "manager-a");

    expect(result.notes).toHaveLength(1);
    expect(result.notes?.[0]).toMatchObject({
      date: "2026-03-07",
      title: "payment retro scratchpad",
    });
    expect(result.notes?.[0]).not.toHaveProperty("body");
  });

  it("returns no notes when the manager account is absent", async () => {
    await seedNote({ body: "payment retro scratchpad", managerAccountId: "manager-a" });

    const result = await searchService.search("payment", "default");

    expect(result.notes).toEqual([]);
  });

  it("treats LIKE wildcards in the query as literals", async () => {
    await seedIssue({ jiraKey: "PROJ-1", summary: "Payment provider timeouts" });
    await seedIssue({ jiraKey: "PROJ-2", summary: "Unrelated issue" });

    const result = await searchService.search("payment % timeouts _");

    expect(result.issues).toHaveLength(0);
  });
});
