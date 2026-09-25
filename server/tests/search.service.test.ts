import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
  teamTrackerItems,
} from "../src/db/schema";
import { SearchService } from "../src/services/search.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TaskEventsService } from "../src/services/task-events.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";

const searchService = new SearchService();
const trackerService = new TeamTrackerService();
const managerDeskService = new ManagerDeskService(trackerService);
const eventsService = new TaskEventsService();

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

async function seedTrackerItem(
  options: {
    title: string;
    developerAccountId?: string;
    date?: string;
    note?: string;
    jiraKey?: string;
    state?: string;
    managerDeskItemId?: number;
    workspaceId?: string;
    updatedAt?: string;
  }
) {
  const [existingDay] = await db
    .select()
    .from(teamTrackerDays)
    .where(
      and(
        eq(teamTrackerDays.workspaceId, options.workspaceId ?? "default"),
        eq(teamTrackerDays.developerAccountId, options.developerAccountId ?? "dev-1"),
        eq(teamTrackerDays.date, options.date ?? "2026-03-07")
      )
    );

  const day =
    existingDay ??
    (
      await db
        .insert(teamTrackerDays)
        .values({
          workspaceId: options.workspaceId ?? "default",
          date: options.date ?? "2026-03-07",
          developerAccountId: options.developerAccountId ?? "dev-1",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        })
        .returning()
    )[0]!;

  const [item] = await db
    .insert(teamTrackerItems)
    .values({
      workspaceId: options.workspaceId ?? "default",
      dayId: day.id,
      itemType: options.jiraKey ? "jira" : "custom",
      jiraKey: options.jiraKey ?? null,
      title: options.title,
      state: options.state ?? "planned",
      note: options.note ?? null,
      managerDeskItemId: options.managerDeskItemId ?? null,
      position: 0,
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: options.updatedAt ?? "2026-03-07T09:00:00.000Z",
    })
    .returning();

  return item!;
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

    expect(result).toEqual({ query: "p", tasks: [], issues: [], deskItems: [], checkIns: [], trackerItems: [], developers: [], notes: [] });
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

  it("matches tracker items by title, note, and Jira key with developer context", async () => {
    const linked = await seedTrackerItem({
      title: "Reproduce payment gateway timeouts",
      developerAccountId: "dev-1",
      jiraKey: "PROJ-900",
      state: "in_progress",
      managerDeskItemId: 42,
    });
    await seedTrackerItem({
      title: "Note about the payment retry loop",
      developerAccountId: "dev-2",
      note: "payment edge cases",
    });
    await seedTrackerItem({
      title: "Unrelated cleanup",
      developerAccountId: "dev-1",
    });

    const byTitle = await searchService.search("payment");
    expect(byTitle.trackerItems.map((item) => item.itemId)).toContain(linked.id);
    const linkedResult = byTitle.trackerItems.find((item) => item.itemId === linked.id);
    expect(linkedResult).toMatchObject({
      date: "2026-03-07",
      developerAccountId: "dev-1",
      developerName: "Alice Smith",
      state: "in_progress",
      lifecycle: "manager_desk_linked",
      jiraKey: "PROJ-900",
      managerDeskItemId: 42,
    });

    const byNote = await searchService.search("edge cases");
    expect(byNote.trackerItems).toEqual([
      expect.objectContaining({ title: "Note about the payment retry loop", developerAccountId: "dev-2" }),
    ]);

    const byJiraKey = await searchService.search("PROJ-900");
    expect(byJiraKey.trackerItems).toEqual([
      expect.objectContaining({ itemId: linked.id }),
    ]);
  });

  it("collapses repeated tracker rows for the same task across days", async () => {
    const stale = await seedTrackerItem({
      title: "Carried task",
      developerAccountId: "dev-1",
      date: "2026-03-06",
      updatedAt: "2026-03-06T09:00:00.000Z",
    });
    const fresh = await seedTrackerItem({
      title: "Carried task",
      developerAccountId: "dev-1",
      date: "2026-03-07",
      updatedAt: "2026-03-07T09:00:00.000Z",
    });

    const result = await searchService.search("carried");

    expect(result.trackerItems).toEqual([
      expect.objectContaining({ itemId: fresh.id, date: "2026-03-07" }),
    ]);
    expect(result.trackerItems.some((item) => item.itemId === stale.id)).toBe(false);
  });

  it("does not return tracker items from other workspaces", async () => {
    await seedTrackerItem({
      title: "Payment task in another workspace",
      developerAccountId: "dev-1",
      workspaceId: "other",
    });

    const result = await searchService.search("payment");

    expect(result.trackerItems).toHaveLength(0);
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

  describe("tasks group", () => {
    async function enableTaskKeys() {
      await db.insert(configTable).values({ key: "tasks_phase1_enabled", value: "true" });
    }

    it("matches tasks by title across tracker items", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Quartz payment migration",
      });

      const result = await searchService.search("quartz", "default", "manager-a");

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        taskKey: item.taskKey,
        title: "Quartz payment migration",
        matchedIn: "title",
        developerName: "Alice Smith",
      });
    });

    it("matches tasks by event body with excerpt", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Unrelated title",
      });
      await eventsService.append(
        {
          taskKey: item.taskKey!,
          type: "instruction",
          body: "Verify the quartz rollout window",
          meta: { via: "task_drawer" },
          visibility: "shared",
        },
        { type: "manager", accountId: "manager-a" }
      );

      const result = await searchService.search("quartz", "default", "manager-a");

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        taskKey: item.taskKey,
        matchedIn: "event",
      });
      expect(result.tasks[0]?.excerpt).toContain("quartz rollout");
    });

    it("never matches another manager's private events", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Shared title",
      });
      await eventsService.append(
        {
          taskKey: item.taskKey!,
          type: "instruction",
          body: "Private quartz note",
          meta: { via: "task_drawer" },
          visibility: "private",
        },
        { type: "manager", accountId: "manager-a" }
      );

      const otherManager = await searchService.search("quartz", "default", "manager-b");
      expect(otherManager.tasks).toHaveLength(0);

      const author = await searchService.search("quartz", "default", "manager-a");
      expect(author.tasks).toHaveLength(1);
      expect(author.tasks[0]?.matchedIn).toBe("event");
    });

    it("de-duplicates desk items when their task key already appears in tasks", async () => {
      await enableTaskKeys();
      const deskItem = await managerDeskService.createItem("manager-a", {
        date: "2026-03-07",
        title: "Quartz migration follow-up",
      });
      expect(deskItem.taskKey).toBeDefined();

      const result = await searchService.search("quartz", "default", "manager-a");

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.taskKey).toBe(deskItem.taskKey);
      expect(result.deskItems).toHaveLength(0);
    });

    it("matches tasks directly by task key", async () => {
      await enableTaskKeys();
      const item = await trackerService.addItem("dev-1", "2026-03-07", {
        title: "Unrelated title",
      });

      const result = await searchService.search(item.taskKey!, "default", "manager-a");

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        taskKey: item.taskKey,
        matchedIn: "key",
      });
    });
  });
});
