import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rawDb } from "../db/connection";
import {
  assistantConversations,
  assistantMessages,
  checkinTaskRefs,
  dailyNoteFollowUps,
  dailyNoteTaskRefs,
  dailyNotes,
  dataMigrations,
  configTable,
  dayFocus,
  developerNotes,
  managerDeskDays,
  managerDeskItemHistory,
  managerDeskItems,
  managerDeskLinks,
  taskKeyAliases,
  taskLegacyMap,
  taskLinks,
  tasks,
  teamTrackerDays,
  teamTrackerItems,
  workspaces,
} from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import type { ManagerDeskItem } from "shared/types";
import { isoDatePart } from "../utils/date";
import { normalizeWorkspaceId } from "./workspace.service";
import { formatDatedNoteHeading } from "./task-notes-import";
import { TaskEventsService, type TaskEventInput } from "./task-events.service";
import { TaskKeysService } from "./task-keys.service";
import { TaskService } from "./task.service";
import { TeamTrackerService } from "./team-tracker.service";
import { ManagerDeskService } from "./manager-desk.service";
import {
  compareTrackerRecency,
  issueSet,
  keyNumber,
  proposeMerges,
  proposeSplits,
  type DeskRow,
  type KeyGroup,
  type MergeProposal,
  type ProposalContext,
  type SplitProposal,
  type TrackerRow,
} from "./task-phase2-lineage";

type EventRow = Awaited<ReturnType<TaskEventsService["listRawForWorkspace"]>>[number];
type DeskDayRow = typeof managerDeskDays.$inferSelect;
type DeskLinkRow = typeof managerDeskLinks.$inferSelect;
type HistoryRow = typeof managerDeskItemHistory.$inferSelect;

export interface Phase2Decision {
  proposalId: string;
  action: "merge" | "keep" | "split";
  survivorKey?: string;
  /** S1/S2: eventId -> "row:<trackerRowId>" — unassigned events stay put. */
  eventAssignments?: Record<string, string>;
}

export interface Phase2DecisionsFile {
  inputHash: string;
  decisions: Phase2Decision[];
}

interface LoadedData {
  desks: DeskRow[];
  trackers: TrackerRow[];
  deskDays: Map<number, DeskDayRow>;
  trackerDays: Map<number, (typeof teamTrackerDays.$inferSelect)>;
  deskLinks: DeskLinkRow[];
  history: HistoryRow[];
  events: EventRow[];
  aliases: Map<string, string>;
  checkinRefKeys: Set<string>;
  noteRefKeys: Set<string>;
  assistantToolCalls: string[];
}

interface TaskPlan {
  key: string;
  title: string;
  kind: string;
  status: string;
  later: number;
  ownerType: string | null;
  ownerId: string | null;
  trackedBy: string | null;
  priority: string;
  labels: string[] | null;
  scheduledOn: string | null;
  followUpAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  participants: string | null;
  nextAction: string | null;
  outcome: string | null;
  createdByType: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  deletedAt: string | null;
  group: KeyGroup;
  rule: string;
  blockerEventBody?: string;
  blockerEventAt?: string;
}

export interface TaskPhase2Report {
  workspaceId: string;
  inputHash: string;
  generatedAt: string;
  applied: boolean;
  counts: {
    legacyDeskRows: number;
    legacyTrackerRows: number;
    keyGroups: number;
    tasksByKind: Record<string, number>;
    tasksByOwnerType: Record<string, number>;
    tasksByStatus: Record<string, number>;
  };
  findings: {
    m6Violations: { deskId: number; key: string }[];
    assigneeMismatch: { key: string; deskAssignee: string; trackerDeveloper: string }[];
    ownerFromAssigneeOnly: string[];
    deskOpenExecutionDone: string[];
    multiActiveDemotions: { ownerId: string; demotedKey: string; keptKey: string }[];
    orphans: { kind: string; id: number; detail: string }[];
    crossKeyMirrors: { trackerId: number; deskId: number }[];
    unkeyedRows: { deskIds: number[]; trackerIds: number[] };
    tombstoneKeys: string[];
    deletedDeskItems: number[];
  };
  autoMerges: MergeProposal[];
  ambiguous: MergeProposal[];
  splits: SplitProposal[];
  statusMapping: Record<string, number>;
  fieldLoss: { labelsCreated: number; prioritiesCollapsed: number; kindsRelabelled: number };
  decisionsTemplate: { inputHash: string; decisions: Phase2Decision[] };
}

export interface TaskPhase2VerifyResult {
  workspaceId: string;
  ok: boolean;
  missingLegacyMap: { sourceTable: string; sourceId: number }[];
  unrepointedEvents: number;
  multiActiveViolations: string[];
  unfilledRefs: { checkin: number; noteTask: number; noteFollowUp: number };
  parityDiffs: { surface: string; owner: string; date: string; field: string; legacy: string; tasks: string }[];
  /** Field diffs fully explained by recorded task events (point-in-time replay drift), informational only. */
  explainedDrift: { surface: string; owner: string; date: string; field: string; legacy: string; tasks: string }[];
}

const marker = (name: string, workspaceId: string) => (workspaceId === "default" ? name : `${name}:${workspaceId}`);

function lineageRoot(row: DeskRow, byId: Map<number, DeskRow>): number {
  let current = row;
  const visited = new Set([row.id]);
  while (current.sourceItemId) {
    const parent = byId.get(current.sourceItemId);
    if (!parent || visited.has(parent.id)) break;
    current = parent;
    visited.add(parent.id);
  }
  return current.id;
}

/** Same pick as the Phase 1 migration: latest createdAt, then updatedAt, then id. */
function pickCanonical(rows: DeskRow[]): DeskRow {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0]!;
}

function deskLinkIdentity(link: { linkType: string; issueKey?: string | null; developerAccountId?: string | null; externalLabel?: string | null }): { kind: string; ref: string } | null {
  switch (link.linkType) {
    case "issue": return link.issueKey ? { kind: "jira", ref: link.issueKey } : null;
    case "developer": return link.developerAccountId ? { kind: "person", ref: link.developerAccountId } : null;
    case "external_group": return link.externalLabel ? { kind: "external", ref: link.externalLabel } : null;
    default: return null;
  }
}

function labelsFor(desk: DeskRow | undefined): string[] | null {
  if (!desk) return null;
  const labels: string[] = [];
  if (desk.category && desk.category !== "other") labels.push(`category:${desk.category}`);
  if (desk.kind === "decision" || desk.kind === "waiting") labels.push(`kind:${desk.kind}`);
  if (desk.priority === "critical" || desk.priority === "low") labels.push(`priority:${desk.priority}`);
  return labels.length ? labels : null;
}

function closedAtTracker(row: TrackerRow): string {
  if (row.state === "done") return row.completedAt ?? row.updatedAt;
  if (row.state === "dropped") return row.updatedAt;
  return "9999-12-31T23:59:59.999Z";
}

export class TaskPhase2BackfillService {
  constructor(
    private readonly events = new TaskEventsService(),
    private readonly keys = new TaskKeysService(),
    private readonly taskService = new TaskService(),
  ) {}

  async workspaceIds(): Promise<string[]> {
    const [workspaceRows, deskRows, trackerRows] = await Promise.all([
      db.select({ id: workspaces.id }).from(workspaces),
      db.select({ id: managerDeskItems.workspaceId }).from(managerDeskItems),
      db.select({ id: teamTrackerItems.workspaceId }).from(teamTrackerItems),
    ]);
    return [...new Set([...workspaceRows.map((row) => row.id), ...deskRows.map((row) => row.id), ...trackerRows.map((row) => row.id)])].sort();
  }

  async computeInputHash(workspaceId: string): Promise<string> {
    const scope = normalizeWorkspaceId(workspaceId);
    const tables = ["team_tracker_items", "manager_desk_items", "manager_desk_links", "manager_desk_item_history", "task_key_aliases", "team_tracker_days", "manager_desk_days", "checkin_task_refs", "daily_note_task_refs", "daily_note_follow_ups"] as const;
    const parts = await Promise.all(tables.map(async (table) => ({ table, rows: await db.all(sql`SELECT * FROM ${sql.raw(table)} WHERE workspace_id = ${scope} ORDER BY rowid`) })));
    const events = (await this.events.listRawForWorkspace(scope)).sort((left, right) => left.id - right.id);
    return createHash("sha256").update(JSON.stringify({ parts, events })).digest("hex");
  }

  private async load(workspaceId: string): Promise<LoadedData> {
    const scope = normalizeWorkspaceId(workspaceId);
    const [desks, trackers, deskDayRows, trackerDayRows, deskLinks, history, eventRows, aliasRows, checkinRefs, noteRefs, assistantRows] = await Promise.all([
      db.select().from(managerDeskItems).where(eq(managerDeskItems.workspaceId, scope)),
      db.select().from(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, scope)),
      db.select().from(managerDeskDays).where(eq(managerDeskDays.workspaceId, scope)),
      db.select().from(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, scope)),
      db.select().from(managerDeskLinks).where(eq(managerDeskLinks.workspaceId, scope)),
      db.select().from(managerDeskItemHistory).where(eq(managerDeskItemHistory.workspaceId, scope)),
      this.events.listRawForWorkspace(scope),
      db.select().from(taskKeyAliases).where(eq(taskKeyAliases.workspaceId, scope)),
      db.select({ taskKey: checkinTaskRefs.taskKey }).from(checkinTaskRefs).where(eq(checkinTaskRefs.workspaceId, scope)),
      db.select({ taskKey: dailyNoteTaskRefs.taskKey }).from(dailyNoteTaskRefs).where(eq(dailyNoteTaskRefs.workspaceId, scope)),
      db.select({ toolCalls: assistantMessages.toolCalls }).from(assistantMessages)
        .innerJoin(assistantConversations, eq(assistantMessages.conversationId, assistantConversations.id))
        .where(eq(assistantConversations.workspaceId, scope)),
    ]);
    return {
      desks,
      trackers,
      deskDays: new Map(deskDayRows.map((row) => [row.id, row])),
      trackerDays: new Map(trackerDayRows.map((row) => [row.id, row])),
      deskLinks,
      history,
      events: eventRows,
      aliases: new Map(aliasRows.map((row) => [row.aliasKey, row.taskKey])),
      checkinRefKeys: new Set(checkinRefs.map((row) => row.taskKey)),
      noteRefKeys: new Set(noteRefs.map((row) => row.taskKey)),
      assistantToolCalls: assistantRows.map((row) => row.toolCalls ?? "").filter(Boolean),
    };
  }

  /** Group legacy rows by resolved key (B0). */
  private buildGroups(data: LoadedData, findings: TaskPhase2Report["findings"]): Map<string, KeyGroup> {
    const groups = new Map<string, KeyGroup>();
    const group = (key: string): KeyGroup => {
      const existing = groups.get(key);
      if (existing) return existing;
      const created: KeyGroup = { key, deskLineage: [], tracker: [] };
      groups.set(key, created);
      return created;
    };
    const resolve = (key: string) => data.aliases.get(key) ?? key;

    const deskById = new Map(data.desks.map((row) => [row.id, row]));
    const lineage = new Map<number, DeskRow[]>();
    for (const row of data.desks) {
      const rootId = lineageRoot(row, deskById);
      lineage.set(rootId, [...(lineage.get(rootId) ?? []), row]);
    }
    const keyedDeskByRoot = new Map<number, DeskRow>();
    for (const [rootId, rows] of lineage) {
      const keyed = rows.filter((row) => row.taskKey);
      if (keyed.length) keyedDeskByRoot.set(rootId, pickCanonical(keyed));
    }
    const canonicalIds = new Set([...keyedDeskByRoot.values()].map((row) => row.id));

    for (const row of data.desks) {
      if (canonicalIds.has(row.id)) {
        const target = group(resolve(row.taskKey!));
        if (target.desk && target.desk.id !== row.id) {
          findings.orphans.push({ kind: "second_keyed_desk_row", id: row.id, detail: `lineage has two keyed rows; kept ${target.desk.id}` });
        } else {
          target.desk = row;
        }
      } else {
        const rootId = lineageRoot(row, deskById);
        const canonical = keyedDeskByRoot.get(rootId);
        if (canonical) {
          group(resolve(canonical.taskKey!)).deskLineage.push(row);
        } else {
          findings.orphans.push({ kind: "desk_lineage_no_key", id: row.id, detail: "lineage has no keyed canonical row" });
        }
      }
    }
    for (const row of data.trackers) {
      if (!row.taskKey) {
        findings.unkeyedRows.trackerIds.push(row.id);
        continue;
      }
      group(resolve(row.taskKey)).tracker.push(row);
    }
    for (const g of groups.values()) {
      g.tracker.sort((a, b) => compareTrackerRecency(a, b, data.trackerDays));
    }
    // Cross-key mirror anomaly: a tracker row linked to a desk row in another group.
    for (const row of data.trackers) {
      if (!row.managerDeskItemId) continue;
      const desk = deskById.get(row.managerDeskItemId);
      if (!desk || !desk.taskKey) continue;
      const deskGroup = resolve(desk.taskKey);
      const rowGroup = row.taskKey ? resolve(row.taskKey) : null;
      if (rowGroup && rowGroup !== deskGroup) {
        findings.crossKeyMirrors.push({ trackerId: row.id, deskId: desk.id });
      }
    }
    return groups;
  }

  private buildProposalContext(data: LoadedData): ProposalContext {
    const originalNoteByRowId = new Map<number, string>();
    for (const event of data.events) {
      if (event.type !== "update" || !event.metaJson) continue;
      try {
        const meta = JSON.parse(event.metaJson) as { imported?: { sourceId?: number } };
        if (meta.imported?.sourceId && !originalNoteByRowId.has(meta.imported.sourceId)) {
          originalNoteByRowId.set(meta.imported.sourceId, event.body ?? "");
        }
      } catch { /* ignore malformed meta */ }
    }
    const batchCount = new Map<string, number>();
    for (const row of data.trackers) {
      const key = `${row.dayId}:${row.createdAt}`;
      batchCount.set(key, (batchCount.get(key) ?? 0) + 1);
    }
    const eventCountByKey = new Map<string, number>();
    const eventExcerptsByKey = new Map<string, string[]>();
    for (const event of [...data.events].sort((a, b) => a.id - b.id)) {
      eventCountByKey.set(event.taskKey, (eventCountByKey.get(event.taskKey) ?? 0) + 1);
      const excerpts = eventExcerptsByKey.get(event.taskKey) ?? [];
      if (excerpts.length < 3) excerpts.push((event.body ?? event.type).slice(0, 120));
      eventExcerptsByKey.set(event.taskKey, excerpts);
    }
    const referencedKeys = new Set<string>([...data.checkinRefKeys, ...data.noteRefKeys]);
    for (const key of new Set(data.events.map((row) => row.taskKey))) {
      const pattern = new RegExp(`\\b${key}\\b`);
      if (data.assistantToolCalls.some((calls) => pattern.test(calls))) referencedKeys.add(key);
    }
    return {
      dayById: data.trackerDays,
      originalNoteByRowId,
      batchSizeAt: (row) => batchCount.get(`${row.dayId}:${row.createdAt}`) ?? 1,
      eventCountByKey,
      eventExcerptsByKey,
      referencedKeys,
    };
  }

  /** B3 status mapping + B2 field derivation for one key group. */
  private deriveTask(group: KeyGroup, data: LoadedData, findings: TaskPhase2Report["findings"], statusMapping: Record<string, number>): TaskPlan {
    const desk = group.desk;
    const tLast = group.tracker.at(-1);
    // Rows merged from a ghost/alias key keep their original taskKey — the
    // survivor's own latest row decides status, so a later ghost 'planned'
    // row cannot mask an 'in_progress'/'done' survivor row.
    const tLastOwn = group.tracker.filter((row) => row.taskKey === group.key).at(-1) ?? tLast;
    // A mirror may link any row of the desk lineage (Phase 0 linked whichever
    // row existed at the time), not only the canonical one.
    const lineageIds = new Set([desk?.id, ...group.deskLineage.map((row) => row.id)].filter((id): id is number => id !== undefined));
    const mirror = desk ? group.tracker.find((row) => row.managerDeskItemId !== null && lineageIds.has(row.managerDeskItemId)) : undefined;
    const deskDay = desk ? data.deskDays.get(desk.dayId) : undefined;

    let status: string;
    let rule: string;
    let blockerEventBody: string | undefined;
    let blockerEventAt: string | undefined;
    if (desk && group.tracker.length) {
      const exec = mirror ?? tLast!;
      if (desk.status === "backlog") {
        rule = "M6";
        findings.m6Violations.push({ deskId: desk.id, key: group.key });
        status = "open"; // reported; value unused because apply aborts on M6
      } else if (desk.status === "done" || desk.status === "cancelled") {
        rule = "M5";
        status = desk.status === "done" ? "done" : "dropped";
      } else {
        switch (exec.state) {
          case "in_progress": rule = "M2"; status = "active"; break;
          case "done": rule = "M3"; status = "done"; findings.deskOpenExecutionDone.push(group.key); break;
          case "dropped": rule = "M4"; status = "dropped"; break;
          default:
            rule = "M1";
            if (desk.status === "waiting") {
              status = "blocked";
              blockerEventBody = "Waiting (migrated)";
              blockerEventAt = desk.updatedAt;
            } else {
              status = "open";
            }
        }
      }
      if (desk.assigneeDeveloperAccountId) {
        const execDev = data.trackerDays.get(exec.dayId)?.developerAccountId;
        if (execDev && execDev !== desk.assigneeDeveloperAccountId) {
          findings.assigneeMismatch.push({ key: group.key, deskAssignee: desk.assigneeDeveloperAccountId, trackerDeveloper: execDev });
        }
      }
    } else if (group.tracker.length) {
      // The task's state is the latest lineage row's state: carry-forward
      // writes a fresh row per day, so `tLast` (most recent day) is what the
      // board renders. Older 'planned' rows must not mask a later 'done'.
      rule = "tracker_only";
      const last = tLastOwn!.state;
      status = last === "in_progress" ? "active" : last === "done" ? "done" : last === "dropped" ? "dropped" : "open";
    } else {
      rule = `desk_${desk!.status}`;
      switch (desk!.status) {
        case "inbox": status = "open"; break;
        case "planned": status = "open"; break;
        case "in_progress": status = "active"; break;
        case "waiting":
          status = "blocked";
          blockerEventBody = "Waiting (migrated)";
          blockerEventAt = desk!.updatedAt;
          break;
        case "backlog": status = "open"; break;
        case "done": status = "done"; break;
        default: status = "dropped"; break; // cancelled
      }
    }
    statusMapping[rule] = (statusMapping[rule] ?? 0) + 1;

    let ownerType: string | null = null;
    let ownerId: string | null = null;
    if (group.tracker.length) {
      ownerType = "developer";
      ownerId = data.trackerDays.get(tLast!.dayId)?.developerAccountId ?? null;
      if (!ownerId) findings.orphans.push({ kind: "tracker_row_missing_day", id: tLast!.id, detail: `day_id ${tLast!.dayId} has no tracker day` });
    } else if (desk?.assigneeDeveloperAccountId) {
      ownerType = "developer";
      ownerId = desk.assigneeDeveloperAccountId;
      findings.ownerFromAssigneeOnly.push(group.key);
    } else if (desk?.status === "inbox") {
      ownerType = null;
      ownerId = null;
    } else if (desk) {
      ownerType = "manager";
      ownerId = deskDay?.managerAccountId ?? null;
    }

    const allRows = [desk, ...group.tracker].filter((row): row is DeskRow | TrackerRow => Boolean(row));
    const createdAt = allRows.reduce((min, row) => (row.createdAt < min ? row.createdAt : min), allRows[0]?.createdAt ?? "");
    const updatedAt = allRows.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), allRows[0]?.updatedAt ?? "");
    const earliest = [...allRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)[0];
    let closedAt: string | null = null;
    if (status === "done") closedAt = tLastOwn?.completedAt ?? desk?.completedAt ?? null;
    else if (status === "dropped") closedAt = tLastOwn && (tLastOwn.state === "dropped" || tLastOwn.state === "done") ? tLastOwn.updatedAt : desk?.completedAt ?? desk?.updatedAt ?? null;

    return {
      key: group.key,
      title: desk?.title ?? tLast?.title ?? group.key,
      kind: desk?.kind === "meeting" ? "meeting" : "task",
      status,
      later: desk?.status === "backlog" ? 1 : 0,
      ownerType,
      ownerId,
      trackedBy: deskDay?.managerAccountId ?? null,
      priority: desk && (desk.priority === "high" || desk.priority === "critical") ? "high" : "normal",
      labels: labelsFor(desk),
      scheduledOn: deskDay?.date ?? null,
      followUpAt: desk?.followUpAt ?? null,
      startsAt: desk?.plannedStartAt ?? null,
      endsAt: desk?.plannedEndAt ?? null,
      participants: desk?.participants ?? null,
      nextAction: desk?.nextAction ?? null,
      outcome: desk?.outcome ?? null,
      createdByType: earliest?.createdByType ?? "unknown",
      createdById: earliest?.createdById ?? null,
      createdAt,
      updatedAt,
      closedAt,
      deletedAt: null,
      group,
      rule,
      blockerEventBody,
      blockerEventAt,
    };
  }

  /** B4: one active task per developer; demote extras with a system event. */
  private applySingleActive(plans: TaskPlan[], data: LoadedData, findings: TaskPhase2Report["findings"]): { key: string; at: string }[] {
    const demotionEvents: { key: string; at: string }[] = [];
    const byOwner = new Map<string, TaskPlan[]>();
    for (const plan of plans) {
      if (plan.ownerType !== "developer" || plan.status !== "active") continue;
      byOwner.set(plan.ownerId ?? "", [...(byOwner.get(plan.ownerId ?? "") ?? []), plan]);
    }
    const focusAt = new Map<string, string>();
    for (const event of data.events) {
      if (event.type !== "focus" || !event.metaJson) continue;
      try {
        const meta = JSON.parse(event.metaJson) as { action?: string };
        if (meta.action === "set_current" && event.occurredAt > (focusAt.get(event.taskKey) ?? "")) focusAt.set(event.taskKey, event.occurredAt);
      } catch { /* ignore */ }
    }
    for (const [ownerId, actives] of byOwner) {
      if (actives.length <= 1) continue;
      const sorted = [...actives].sort((a, b) =>
        (focusAt.get(b.key) ?? b.group.tracker.at(-1)?.updatedAt ?? "").localeCompare(focusAt.get(a.key) ?? a.group.tracker.at(-1)?.updatedAt ?? "")
      );
      const [keep, ...demote] = sorted;
      for (const plan of demote) {
        plan.status = "open";
        demotionEvents.push({ key: plan.key, at: plan.updatedAt });
        findings.multiActiveDemotions.push({ ownerId, demotedKey: plan.key, keptKey: keep!.key });
      }
    }
    return demotionEvents;
  }

  /**
   * Full dry-run: preflight checks, proposals, derivations and the report.
   * Writes nothing.
   */
  async plan(workspaceId: string): Promise<TaskPhase2Report> {
    const scope = normalizeWorkspaceId(workspaceId);
    const data = await this.load(scope);
    const inputHash = await this.computeInputHash(scope);
    const findings = this.emptyFindings();
    const groups = this.buildGroups(data, findings);
    const ctx = this.buildProposalContext(data);
    const mergeProposals = proposeMerges([...groups.values()].filter((g) => !g.desk), ctx);
    const splitEventRows = new Map<string, { id: number; type: string; excerpt: string }[]>();
    for (const event of data.events) {
      splitEventRows.set(event.taskKey, [...(splitEventRows.get(event.taskKey) ?? []), { id: event.id, type: event.type, excerpt: (event.body ?? "").slice(0, 120) }]);
    }
    const splitProposals = proposeSplits([...groups.values()], ctx, splitEventRows);

    const statusMapping: Record<string, number> = {};
    const plans = [...groups.values()].map((g) => this.deriveTask(g, data, findings, statusMapping));
    this.applySingleActive(plans, data, findings);

    const autoMerges = mergeProposals.filter((p) => p.classification === "auto");
    const ambiguous = mergeProposals.filter((p) => p.classification === "ambiguous");
    const counts = {
      legacyDeskRows: data.desks.length,
      legacyTrackerRows: data.trackers.length,
      keyGroups: groups.size,
      tasksByKind: {} as Record<string, number>,
      tasksByOwnerType: {} as Record<string, number>,
      tasksByStatus: {} as Record<string, number>,
    };
    for (const plan of plans) {
      counts.tasksByKind[plan.kind] = (counts.tasksByKind[plan.kind] ?? 0) + 1;
      counts.tasksByOwnerType[plan.ownerType ?? "inbox"] = (counts.tasksByOwnerType[plan.ownerType ?? "inbox"] ?? 0) + 1;
      counts.tasksByStatus[plan.status] = (counts.tasksByStatus[plan.status] ?? 0) + 1;
    }
    const fieldLoss = {
      labelsCreated: plans.filter((p) => p.labels?.length).length,
      prioritiesCollapsed: data.desks.filter((row) => row.taskKey && (row.priority === "low" || row.priority === "critical")).length,
      kindsRelabelled: data.desks.filter((row) => row.taskKey && (row.kind === "decision" || row.kind === "waiting")).length,
    };
    return {
      workspaceId: scope,
      inputHash,
      generatedAt: new Date().toISOString(),
      applied: false,
      counts,
      findings,
      autoMerges,
      ambiguous,
      splits: splitProposals,
      statusMapping,
      fieldLoss,
      decisionsTemplate: {
        inputHash,
        decisions: [
          ...autoMerges.map((p) => ({ proposalId: p.proposalId, action: "merge" as const, survivorKey: p.survivorKey })),
          ...ambiguous.map((p) => ({ proposalId: p.proposalId, action: p.default === "merge" ? "merge" as const : "keep" as const })),
          ...splitProposals.map((p) => ({ proposalId: p.proposalId, action: "split" as const, eventAssignments: {} })),
        ],
      },
    };
  }

  private emptyFindings(): TaskPhase2Report["findings"] {
    return {
      m6Violations: [], assigneeMismatch: [], ownerFromAssigneeOnly: [], deskOpenExecutionDone: [],
      multiActiveDemotions: [], orphans: [], crossKeyMirrors: [], unkeyedRows: { deskIds: [], trackerIds: [] },
      tombstoneKeys: [], deletedDeskItems: [],
    };
  }

  /** Preflight (§2.2): abort on failure. Returns the computed input hash plus whether a prior apply completed. */
  private async preflight(scope: string, opts: { resume?: boolean }): Promise<{ inputHash: string; alreadyApplied: boolean }> {
    const marked = new Set((await db.select({ name: dataMigrations.name }).from(dataMigrations)).map((row) => row.name));
    for (const required of ["p1_assign_task_keys", "p1_import_task_notes"]) {
      if (!marked.has(marker(required, scope))) throw new HttpError(412, `Phase 1 migration has not run for workspace ${scope} (missing ${required})`);
    }
    const unkeyedTracker = await db.select({ id: teamTrackerItems.id }).from(teamTrackerItems).where(and(eq(teamTrackerItems.workspaceId, scope), isNull(teamTrackerItems.taskKey)));
    if (unkeyedTracker.length) throw new HttpError(412, `${unkeyedTracker.length} tracker rows have no task_key`);
    // Non-canonical lineage rows legitimately have NULL keys; flag only a
    // lineage whose canonical pick is unkeyed.
    const deskRows = await db.select().from(managerDeskItems).where(eq(managerDeskItems.workspaceId, scope));
    const byId = new Map(deskRows.map((row) => [row.id, row]));
    const lineageMap = new Map<number, DeskRow[]>();
    for (const row of deskRows) {
      const rootId = lineageRoot(row, byId);
      lineageMap.set(rootId, [...(lineageMap.get(rootId) ?? []), row]);
    }
    for (const rows of lineageMap.values()) {
      if (!rows.some((row) => row.taskKey)) throw new HttpError(412, `Desk lineage rooted at ${lineageRoot(rows[0]!, byId)} has no keyed canonical row`);
    }
    const existing = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.workspaceId, scope)).limit(1);
    const alreadyApplied = marked.has(marker("p2_backfill", scope));
    if (existing.length && !opts.resume && !alreadyApplied) {
      throw new HttpError(409, "tasks table is not empty for this workspace; pass --resume to re-run");
    }
    return { inputHash: await this.computeInputHash(scope), alreadyApplied };
  }

  /**
   * Apply the backfill for one workspace inside a single transaction.
   * `decisions` must cover every ambiguous/split proposal; auto-merges may be
   * omitted (their default is applied). Requires decisionsFile.inputHash to
   * match the live fingerprint.
   */
  async apply(workspaceId: string, decisionsFile: Phase2DecisionsFile, opts: { resume?: boolean } = {}): Promise<TaskPhase2Report> {
    const scope = normalizeWorkspaceId(workspaceId);
    if (await this.keys.canonicalEnabled(scope)) throw new HttpError(409, "Backfill cannot run after write cutover");
    const { inputHash, alreadyApplied } = await this.preflight(scope, { resume: opts.resume });
    // The decisions hash guards against data drift between the reviewed
    // dry-run and the apply. After a successful apply our own writes (synth
    // events, repointed ids) legitimately change the fingerprint, so an
    // idempotent re-run keys off the p2_backfill marker instead.
    if (!alreadyApplied && decisionsFile.inputHash !== inputHash) {
      throw new HttpError(409, "Decisions inputHash does not match the current data fingerprint; regenerate the dry-run report");
    }
    if (alreadyApplied) {
      const previousHash = (await db.select().from(configTable).where(and(eq(configTable.workspaceId, scope), eq(configTable.key, "tasks_phase2_backfill_hash"))).limit(1))[0]?.value;
      if (previousHash !== inputHash && (!opts.resume || decisionsFile.inputHash !== inputHash)) throw new HttpError(409, "Backfill snapshot changed; review fresh decisions and resume explicitly");
    }

    const data = await this.load(scope);
    const findings = this.emptyFindings();
    const groups = this.buildGroups(data, findings);
    const ctx = this.buildProposalContext(data);
    const mergeProposals = proposeMerges([...groups.values()].filter((g) => !g.desk), ctx);
    const splitEventRows = new Map<string, { id: number; type: string; excerpt: string }[]>();
    for (const event of data.events) {
      splitEventRows.set(event.taskKey, [...(splitEventRows.get(event.taskKey) ?? []), { id: event.id, type: event.type, excerpt: (event.body ?? "").slice(0, 120) }]);
    }
    const splitProposals = proposeSplits([...groups.values()], ctx, splitEventRows);
    const allProposals = [...mergeProposals, ...splitProposals];
    const proposalById = new Map(allProposals.map((p) => [p.proposalId, p]));
    const decisionById = new Map(decisionsFile.decisions.map((d) => [d.proposalId, d]));
    const missing = allProposals
      .filter((p) => (p.kind === "split" || p.classification === "ambiguous") && !decisionById.has(p.proposalId))
      .map((p) => p.proposalId);
    if (missing.length) throw new HttpError(400, `Undecided proposals: ${missing.join(", ")}`);
    for (const id of decisionById.keys()) {
      if (!proposalById.has(id) && !opts.resume) throw new HttpError(400, `Decision references unknown proposal ${id}`);
    }

    const p1At = (await db.select({ appliedAt: dataMigrations.appliedAt }).from(dataMigrations).where(eq(dataMigrations.name, marker("p1_assign_task_keys", scope))).limit(1))[0]?.appliedAt ?? new Date().toISOString();

    return runInTransaction(async () => {
      if (await this.computeInputHash(scope) !== inputHash || await this.keys.canonicalEnabled(scope)) throw new HttpError(409, "Migration input changed before the transaction");
      // Wipe any prior run when resuming. task_id FKs (events + ref tables)
      // point into tasks, so clear them before deleting the canonical rows.
      await this.events.clearTaskIds(scope);
      await db.update(checkinTaskRefs).set({ taskId: null }).where(eq(checkinTaskRefs.workspaceId, scope));
      await db.update(dailyNoteTaskRefs).set({ taskId: null }).where(eq(dailyNoteTaskRefs.workspaceId, scope));
      await db.update(dailyNoteFollowUps).set({ taskId: null }).where(eq(dailyNoteFollowUps.workspaceId, scope));
      await db.delete(taskLinks).where(eq(taskLinks.workspaceId, scope));
      await db.delete(dayFocus).where(eq(dayFocus.workspaceId, scope));
      await db.delete(taskLegacyMap).where(eq(taskLegacyMap.workspaceId, scope));
      await db.delete(developerNotes).where(eq(developerNotes.workspaceId, scope));
      await db.delete(tasks).where(eq(tasks.workspaceId, scope));
      const legacySeed = (rawDb.prepare("SELECT MAX(value) AS value FROM (SELECT COALESCE(MAX(id),0) AS value FROM team_tracker_items UNION ALL SELECT COALESCE(MAX(id),0) FROM manager_desk_items)").get() as { value: number }).value;
      rawDb.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'tasks'").run(legacySeed);
      if (!rawDb.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'tasks'").get()) rawDb.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('tasks',?)").run(legacySeed);

      // ── B0: apply decisions ──
      for (const proposal of mergeProposals) {
        const decision = decisionById.get(proposal.proposalId);
        const action = decision?.action ?? (proposal.classification === "auto" ? "merge" : proposal.default);
        if (action !== "merge") continue;
        const survivor = decision?.survivorKey ?? proposal.survivorKey;
        const mergedKey = survivor === proposal.mergedKey ? proposal.survivorKey : proposal.mergedKey;
        if (![proposal.survivorKey, proposal.mergedKey].includes(survivor)) throw new HttpError(400, `Decision ${proposal.proposalId}: survivorKey must be one of the proposal's keys`);
        data.aliases.set(mergedKey, survivor);
        await db.insert(taskKeyAliases).values({ workspaceId: scope, aliasKey: mergedKey, taskKey: survivor, reason: `p2_merge:${proposal.proposalId}`, createdAt: new Date().toISOString() }).onConflictDoNothing();
        await this.events.appendBackfill({
          taskKey: survivor, workspaceId: scope, type: "merged", body: null,
          meta: { survivorKey: survivor, mergedKey, decisionRef: proposal.proposalId },
          dedupeKey: `p2:mg:${proposal.proposalId}`,
        }, { type: "system" });
      }
      for (const proposal of splitProposals) {
        const decision = decisionById.get(proposal.proposalId);
        if (decision?.action !== "split") continue;
        const movedRows = data.trackers.filter((row) => proposal.moveRowIds.includes(row.id));
        if (movedRows.length !== proposal.moveRowIds.length) throw new HttpError(400, `Decision ${proposal.proposalId}: unknown row ids`);
        const assignments = decision.eventAssignments ?? {};
        const assignedTargets = new Map<number, number[]>(); // newRowId -> eventIds
        for (const [eventId, target] of Object.entries(assignments)) {
          const match = /^row:(\d+)$/.exec(target);
          const rowId = match ? Number(match[1]) : NaN;
          if (!proposal.moveRowIds.includes(rowId) && !data.trackers.some((row) => row.id === rowId && row.taskKey === proposal.key)) {
            throw new HttpError(400, `Decision ${proposal.proposalId}: event ${eventId} targets unknown row ${target}`);
          }
          assignedTargets.set(rowId, [...(assignedTargets.get(rowId) ?? []), Number(eventId)]);
        }
        if (proposal.oneKeyPerRow) {
          for (const row of movedRows) {
            const newKey = this.keys.allocate(scope);
            await db.update(teamTrackerItems).set({ taskKey: newKey }).where(eq(teamTrackerItems.id, row.id));
            row.taskKey = newKey;
            await this.events.moveEventsToKey(scope, assignedTargets.get(row.id) ?? [], newKey);
            for (const event of data.events) if (assignedTargets.get(row.id)?.includes(event.id)) event.taskKey = newKey;
            await this.events.appendBackfill({
              taskKey: newKey, workspaceId: scope, type: "merged", body: null,
              meta: { survivorKey: newKey, mergedKey: proposal.key, decisionRef: proposal.proposalId },
              dedupeKey: `p2:sp:${proposal.proposalId}:${row.id}`,
            }, { type: "system" });
          }
        } else {
          const newKey = this.keys.allocate(scope);
          await db.update(teamTrackerItems).set({ taskKey: newKey }).where(inArrayIds(teamTrackerItems.id, proposal.moveRowIds));
          for (const row of movedRows) row.taskKey = newKey;
          for (const [rowId, eventIds] of assignedTargets) {
            const target = proposal.moveRowIds.includes(rowId) ? newKey : proposal.key;
            await this.events.moveEventsToKey(scope, eventIds, target);
            for (const event of data.events) if (eventIds.includes(event.id)) event.taskKey = target;
          }
          await this.events.appendBackfill({
            taskKey: newKey, workspaceId: scope, type: "merged", body: null,
            meta: { survivorKey: newKey, mergedKey: proposal.key, decisionRef: proposal.proposalId },
            dedupeKey: `p2:sp:${proposal.proposalId}`,
          }, { type: "system" });
        }
      }

      // ── Rebuild groups post-decisions, derive tasks (B1–B4) ──
      const groups2 = this.buildGroups(data, findings);
      const statusMapping: Record<string, number> = {};
      const plans = [...groups2.values()].map((g) => this.deriveTask(g, data, findings, statusMapping));
      const demotionEvents = this.applySingleActive(plans, data, findings);
      if (findings.m6Violations.length) {
        throw new HttpError(409, `M6 violation: backlog desk items with tracker mirrors: ${findings.m6Violations.map((v) => v.key).join(", ")}`);
      }
      plans.sort((a, b) => keyNumber(a.key) - keyNumber(b.key) || a.createdAt.localeCompare(b.createdAt));

      const keyToTaskId = new Map<string, number>();
      const now = new Date().toISOString();
      for (const plan of plans) {
        const inserted = await db.insert(tasks).values({
          workspaceId: scope,
          taskKey: plan.key,
          title: plan.title,
          kind: plan.kind,
          status: plan.status,
          later: plan.later,
          ownerType: plan.ownerType,
          ownerId: plan.ownerId,
          trackedByManagerId: plan.trackedBy,
          priority: plan.priority,
          labelsJson: plan.labels ? JSON.stringify(plan.labels) : null,
          scheduledOn: plan.scheduledOn,
          followUpAt: plan.followUpAt,
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
          participants: plan.participants,
          nextAction: plan.nextAction,
          outcome: plan.outcome,
          createdByType: plan.createdByType,
          createdById: plan.createdById,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          closedAt: plan.closedAt,
          deletedAt: plan.deletedAt,
        }).returning({ id: tasks.id });
        keyToTaskId.set(plan.key, inserted[0]!.id);
      }

      // ── task_legacy_map (B1 + B2) ──
      for (const plan of plans) {
        const taskId = keyToTaskId.get(plan.key)!;
        const g = plan.group;
        if (g.desk) await db.insert(taskLegacyMap).values({ workspaceId: scope, taskId, sourceTable: "manager_desk_items", sourceId: g.desk.id, role: "canonical" });
        for (const row of g.deskLineage) {
          await db.insert(taskLegacyMap).values({ workspaceId: scope, taskId, sourceTable: "manager_desk_items", sourceId: row.id, role: "lineage" });
        }
        const lineageIds = new Set([g.desk?.id, ...g.deskLineage.map((row) => row.id)].filter((id): id is number => id !== undefined));
        const mirror = g.desk ? g.tracker.find((row) => row.managerDeskItemId !== null && lineageIds.has(row.managerDeskItemId)) : undefined;
        for (const row of g.tracker) {
          const role = row === mirror ? "mirror" : (!g.desk && row === g.tracker.at(-1)) ? "canonical" : "copy";
          await db.insert(taskLegacyMap).values({ workspaceId: scope, taskId, sourceTable: "team_tracker_items", sourceId: row.id, role });
        }
      }

      // ── B5: task_links ──
      for (const plan of plans) {
        const taskId = keyToTaskId.get(plan.key)!;
        const g = plan.group;
        const seen = new Set<string>();
        const insertLink = async (kind: string, ref: string, role: string | null, createdAt: string) => {
          const dedupeKey = `${kind}:${ref}`;
          if (seen.has(dedupeKey)) return;
          seen.add(dedupeKey);
          await db.insert(taskLinks).values({ workspaceId: scope, taskId, kind, ref, role, createdAt }).onConflictDoNothing();
        };
        const deskLinks = g.desk ? data.deskLinks.filter((link) => link.itemId === g.desk!.id) : [];
        const primary = g.tracker.at(-1)?.jiraKey ?? deskLinks.find((l) => l.linkType === "issue")?.issueKey;
        if (primary) await insertLink("jira", primary.trim().toUpperCase(), "primary", g.tracker.at(-1)?.createdAt ?? g.desk!.createdAt);
        for (const row of g.tracker) {
          for (const ref of issueSet(row)) if (ref !== primary) await insertLink("jira", ref, "related", row.createdAt);
        }
        for (const link of deskLinks) {
          const identity = deskLinkIdentity(link);
          if (!identity) continue;
          if (identity.kind === "jira" && identity.ref.toUpperCase() === primary) continue;
          await insertLink(identity.kind, identity.kind === "jira" ? identity.ref.toUpperCase() : identity.ref, identity.kind === "jira" ? "related" : null, link.createdAt);
        }
      }

      // ── B6: day_focus ──
      const focusSeen = new Map<string, number>(); // ws|date|owner|task -> position
      for (const plan of plans) {
        const taskId = keyToTaskId.get(plan.key)!;
        for (const row of plan.group.tracker) {
          const day = data.trackerDays.get(row.dayId);
          if (!day) continue;
          const unique = `${day.date}|${day.developerAccountId}|${taskId}`;
          const existing = focusSeen.get(unique);
          if (existing === undefined) {
            focusSeen.set(unique, row.position);
            await db.insert(dayFocus).values({
              workspaceId: scope, date: day.date, ownerType: "developer", ownerId: day.developerAccountId,
              taskId, position: row.position, source: "backfill", createdAt: row.createdAt,
            }).onConflictDoNothing();
          } else if (row.position < existing) {
            focusSeen.set(unique, row.position);
            await db.update(dayFocus).set({ position: row.position }).where(and(
              eq(dayFocus.workspaceId, scope), eq(dayFocus.date, day.date), eq(dayFocus.ownerType, "developer"),
              eq(dayFocus.ownerId, day.developerAccountId), eq(dayFocus.taskId, taskId)
            ));
          }
        }
      }

      // ── B9: deleted Desk items → deleted tasks ──
      // deskItemKey maps every desk row id (canonical or lineage) plus every
      // resurrected deleted item to the canonical key its history belongs to.
      const deskItemKey = new Map<number, string>();
      for (const plan of plans) {
        if (plan.group.desk) deskItemKey.set(plan.group.desk.id, plan.key);
        for (const row of plan.group.deskLineage) deskItemKey.set(row.id, plan.key);
      }
      const historyByItem = new Map<number, HistoryRow[]>();
      for (const row of data.history) historyByItem.set(row.itemId, [...(historyByItem.get(row.itemId) ?? []), row]);
      const liveDeskIds = new Set(data.desks.map((row) => row.id));
      for (const [itemId, rows] of historyByItem) {
        const sorted = [...rows].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id);
        const latest = sorted.at(-1)!;
        if (latest.eventType !== "deleted" || liveDeskIds.has(itemId)) continue;
        const snapshot = [...sorted].reverse().find((row) => row.eventType === "upsert");
        if (!snapshot) continue;
        const snap = JSON.parse(snapshot.snapshotJson) as { taskKey?: string; title?: string; status?: string; dayId?: number; createdAt?: string; updatedAt?: string };
        let key = snap.taskKey ? (data.aliases.get(snap.taskKey) ?? snap.taskKey) : undefined;
        if (key && keyToTaskId.has(key)) {
          deskItemKey.set(itemId, key); // history still synthesizes onto the surviving task
          continue;
        }
        if (!key) key = this.keys.allocate(scope);
        deskItemKey.set(itemId, key);
        findings.deletedDeskItems.push(itemId);
        const statusMap: Record<string, string> = { inbox: "open", planned: "open", in_progress: "active", waiting: "blocked", backlog: "open", done: "done", cancelled: "dropped" };
        const inserted = await db.insert(tasks).values({
          workspaceId: scope, taskKey: key, title: snap.title ?? key, kind: "task",
          status: statusMap[snap.status ?? ""] ?? "open",
          later: snap.status === "backlog" ? 1 : 0,
          trackedByManagerId: latest.managerAccountId,
          createdByType: "unknown",
          createdAt: snap.createdAt ?? snapshot.recordedAt,
          updatedAt: snap.updatedAt ?? latest.recordedAt,
          closedAt: latest.recordedAt,
          deletedAt: latest.recordedAt,
        }).returning({ id: tasks.id });
        keyToTaskId.set(key, inserted[0]!.id);
      }

      // ── B7: tombstones for event-only keys (repoint happens after all
      // event writes, below — synthesized events insert with task_id NULL). ──
      const eventKeys = new Set(data.events.map((row) => data.aliases.get(row.taskKey) ?? row.taskKey));
      for (const key of eventKeys) {
        if (keyToTaskId.has(key)) continue;
        const rows = data.events.filter((event) => (data.aliases.get(event.taskKey) ?? event.taskKey) === key);
        const sorted = [...rows].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
        const created = [...sorted].reverse().find((event) => event.type === "created");
        let title = key;
        if (created?.metaJson) {
          try { title = (JSON.parse(created.metaJson) as { title?: string }).title ?? key; } catch { /* keep key */ }
        }
        findings.tombstoneKeys.push(key);
        const inserted = await db.insert(tasks).values({
          workspaceId: scope, taskKey: key, title, kind: "task", status: "dropped",
          createdByType: "unknown",
          createdAt: sorted[0]!.occurredAt, updatedAt: sorted.at(-1)!.occurredAt,
          closedAt: sorted.at(-1)!.occurredAt, deletedAt: sorted.at(-1)!.occurredAt,
        }).returning({ id: tasks.id });
        keyToTaskId.set(key, inserted[0]!.id);
      }

      // ── B8: synthesized history events (pre-P1 only) ──
      const synth = async (input: Omit<TaskEventInput, "workspaceId"> & { dedupeKey: string }, actorId?: string) => {
        if ((input.occurredAt ?? "") >= p1At) return; // live emission already recorded it
        await this.events.appendBackfill({ ...input, workspaceId: scope } as TaskEventInput, { type: "system", accountId: actorId });
      };
      for (const [itemId, rows] of historyByItem) {
        const key = deskItemKey.get(itemId);
        if (!key || !keyToTaskId.has(key)) continue;
        const sorted = [...rows].filter((row) => row.recordedAt < p1At).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id);
        let prev: Record<string, unknown> | null = null;
        for (const row of sorted) {
          if (row.eventType === "deleted") continue;
          const snapRow = JSON.parse(row.snapshotJson) as Record<string, unknown> & { links?: { linkType: string; issueKey?: string; developerAccountId?: string; externalLabel?: string }[]; delegatedExecution?: { state?: string } };
          const base = { taskKey: key, occurredAt: row.recordedAt };
          if (!prev) {
            await synth({ ...base, type: "created", body: null, meta: { source: "desk", ownerType: "manager", ownerId: row.managerAccountId, title: String(snapRow.title ?? key), approximateTime: true }, dedupeKey: `p2:dh:${row.id}:created` });
          } else {
            if (snapRow.status !== prev.status) await synth({ ...base, type: "status", body: null, meta: { domain: "desk_status", from: (prev.status as string) ?? null, to: String(snapRow.status), reason: "migration", approximateTime: true }, dedupeKey: `p2:dh:${row.id}:status` });
            if (snapRow.title !== prev.title) await synth({ ...base, type: "title", body: null, meta: { from: String(prev.title ?? ""), to: String(snapRow.title ?? ""), approximateTime: true }, dedupeKey: `p2:dh:${row.id}:title` });
            if (snapRow.assigneeDeveloperAccountId !== prev.assigneeDeveloperAccountId) await synth({ ...base, type: "assign", body: null, meta: { fromType: prev.assigneeDeveloperAccountId ? "developer" : null, fromId: (prev.assigneeDeveloperAccountId as string) ?? null, toType: snapRow.assigneeDeveloperAccountId ? "developer" : null, toId: (snapRow.assigneeDeveloperAccountId as string) ?? null, approximateTime: true }, dedupeKey: `p2:dh:${row.id}:assign` });
            for (const [field, column] of [["plannedStartAt", "planned_start_at"], ["plannedEndAt", "planned_end_at"], ["followUpAt", "follow_up_at"], ["originDate", "day"]] as const) {
              if ((snapRow[field] ?? null) !== (prev[field] ?? null)) {
                await synth({ ...base, type: "schedule", body: null, meta: { field: column, from: (prev[field] as string) ?? null, to: (snapRow[field] as string) ?? null, via: "edit", approximateTime: true }, dedupeKey: `p2:dh:${row.id}:${field}` });
              }
            }
            const prevLinks = new Set(((prev.links as { linkType: string; issueKey?: string; developerAccountId?: string; externalLabel?: string }[] | undefined) ?? []).map(deskLinkIdentity).filter(Boolean).map((i) => `${i!.kind}:${i!.ref}`));
            const snapLinks = new Set((snapRow.links ?? []).map(deskLinkIdentity).filter(Boolean).map((i) => `${i!.kind}:${i!.ref}`));
            for (const link of snapRow.links ?? []) {
              const identity = deskLinkIdentity(link);
              if (identity && !prevLinks.has(`${identity.kind}:${identity.ref}`)) {
                await synth({ ...base, type: "link", body: null, meta: { action: "added", kind: identity.kind as "jira" | "person" | "external", ref: identity.ref, approximateTime: true }, dedupeKey: `p2:dh:${row.id}:link:${identity.kind}:${identity.ref}` });
              }
            }
            for (const link of (prev.links as typeof snapRow.links | undefined) ?? []) {
              const identity = deskLinkIdentity(link);
              if (identity && !snapLinks.has(`${identity.kind}:${identity.ref}`)) {
                await synth({ ...base, type: "link", body: null, meta: { action: "removed", kind: identity.kind as "jira" | "person" | "external", ref: identity.ref, approximateTime: true }, dedupeKey: `p2:dh:${row.id}:unlink:${identity.kind}:${identity.ref}` });
              }
            }
            if (snapRow.delegatedExecution?.state !== (prev.delegatedExecution as { state?: string } | undefined)?.state) {
              await synth({ ...base, type: "status", body: null, meta: { domain: "tracker_state", from: ((prev.delegatedExecution as { state?: string } | undefined)?.state) ?? null, to: String(snapRow.delegatedExecution?.state ?? ""), reason: "migration", approximateTime: true }, dedupeKey: `p2:dh:${row.id}:exec` });
            }
            if (!prev.outcome && snapRow.outcome) {
              await synth({ ...base, type: "decision", body: String(snapRow.outcome), meta: { approximateTime: true }, dedupeKey: `p2:dh:${row.id}:outcome` });
            }
          }
          prev = snapRow;
        }
      }
      for (const plan of plans) {
        const trackerRows = plan.group.tracker;
        if (!trackerRows.length) continue;
        const first = trackerRows[0]!;
        await synth({ taskKey: plan.key, type: "created", body: null, meta: { source: "tracker", ownerType: "developer", ownerId: data.trackerDays.get(first.dayId)?.developerAccountId ?? null, title: plan.title, approximateTime: true }, occurredAt: first.createdAt, dedupeKey: `p2:tc:${first.id}` });
        for (const row of trackerRows.slice(1)) {
          await synth({ taskKey: plan.key, type: "schedule", body: null, meta: { field: "day", from: null, to: data.trackerDays.get(row.dayId)?.date ?? null, via: "carry_forward", approximateTime: true }, occurredAt: row.createdAt, dedupeKey: `p2:cf:${row.id}` });
          if (!row.managerDeskItemId && (row.state === "done" || row.state === "dropped")) {
            await synth({ taskKey: plan.key, type: "status", body: null, meta: { domain: "tracker_state", from: null, to: row.state, reason: "migration", approximateTime: true }, occurredAt: row.state === "done" ? (row.completedAt ?? row.updatedAt) : row.updatedAt, dedupeKey: `p2:ts:${row.id}` });
          }
          if (!row.managerDeskItemId && row.state === "in_progress") {
            await synth({ taskKey: plan.key, type: "focus", body: null, meta: { action: "set_current", date: data.trackerDays.get(row.dayId)?.date ?? "", approximateTime: true }, occurredAt: row.updatedAt, dedupeKey: `p2:fc:${row.id}` });
          }
        }
        const firstRowState = first;
        if (!firstRowState.managerDeskItemId && (first.state === "done" || first.state === "dropped")) {
          await synth({ taskKey: plan.key, type: "status", body: null, meta: { domain: "tracker_state", from: null, to: first.state, reason: "migration", approximateTime: true }, occurredAt: first.state === "done" ? (first.completedAt ?? first.updatedAt) : first.updatedAt, dedupeKey: `p2:ts:${first.id}` });
        }
        if (!firstRowState.managerDeskItemId && first.state === "in_progress") {
          await synth({ taskKey: plan.key, type: "focus", body: null, meta: { action: "set_current", date: data.trackerDays.get(first.dayId)?.date ?? "", approximateTime: true }, occurredAt: first.updatedAt, dedupeKey: `p2:fc:${first.id}` });
        }
      }

      // ── B3 extras: blocker events for migrated "waiting" ──
      for (const plan of plans) {
        if (plan.blockerEventBody && plan.blockerEventAt && plan.blockerEventAt < p1At) {
          await this.events.appendBackfill({
            taskKey: plan.key, workspaceId: scope, type: "blocker", body: plan.blockerEventBody,
            meta: { action: "raised", approximateTime: true }, occurredAt: plan.blockerEventAt,
            dedupeKey: `p2:dw:${plan.group.desk!.id}`,
          }, { type: "system" });
        }
      }

      // ── B4 demotion events ──
      for (const demotion of demotionEvents) {
        await this.events.appendBackfill({
          taskKey: demotion.key, workspaceId: scope, type: "status", body: null,
          meta: { domain: "task_status", from: "active", to: "open", reason: "single_current", approximateTime: true },
          occurredAt: demotion.at, dedupeKey: `p2:sa:${demotion.key}`,
        }, { type: "system" });
      }

      // ── B10: refs + developer notes ──
      const resolveRefKey = (key: string) => keyToTaskId.get(data.aliases.get(key) ?? key) ?? null;
      const checkinRefsRows = await db.select().from(checkinTaskRefs).where(eq(checkinTaskRefs.workspaceId, scope));
      for (const ref of checkinRefsRows) {
        const taskId = resolveRefKey(ref.taskKey);
        if (taskId && ref.taskId !== taskId) {
          await db.update(checkinTaskRefs).set({ taskId }).where(and(
            eq(checkinTaskRefs.workspaceId, scope), eq(checkinTaskRefs.checkinId, ref.checkinId), eq(checkinTaskRefs.taskKey, ref.taskKey)
          ));
        }
      }
      const noteRefRows = await db.select().from(dailyNoteTaskRefs).where(eq(dailyNoteTaskRefs.workspaceId, scope));
      for (const ref of noteRefRows) {
        const taskId = resolveRefKey(ref.taskKey);
        if (taskId && ref.taskId !== taskId) {
          await db.update(dailyNoteTaskRefs).set({ taskId }).where(and(
            eq(dailyNoteTaskRefs.workspaceId, scope), eq(dailyNoteTaskRefs.noteId, ref.noteId),
            eq(dailyNoteTaskRefs.taskKey, ref.taskKey), eq(dailyNoteTaskRefs.relation, ref.relation)
          ));
        }
      }
      const noteById = new Map((await db.select().from(dailyNotes).where(eq(dailyNotes.workspaceId, scope))).map((row) => [row.id, row]));
      const followUpRows = await db.select().from(dailyNoteFollowUps).where(eq(dailyNoteFollowUps.workspaceId, scope));
      for (const followUp of followUpRows) {
        const mapped = await db.select({ taskId: taskLegacyMap.taskId }).from(taskLegacyMap).where(and(
          eq(taskLegacyMap.sourceTable, "manager_desk_items"), eq(taskLegacyMap.sourceId, followUp.itemId)
        )).limit(1);
        if (mapped[0] && followUp.taskId !== mapped[0].taskId) {
          await db.update(dailyNoteFollowUps).set({ taskId: mapped[0].taskId }).where(eq(dailyNoteFollowUps.id, followUp.id));
        }
        const note = noteById.get(followUp.noteId);
        const deskRow = data.desks.find((row) => row.id === followUp.itemId);
        const key = deskRow?.taskKey ? (data.aliases.get(deskRow.taskKey) ?? deskRow.taskKey) : null;
        if (note && key && keyToTaskId.has(key)) {
          await this.events.appendBackfill({
            taskKey: key, workspaceId: scope, type: "note_ref", body: null,
            meta: { noteId: note.id, noteDate: note.date, relation: "created_from" },
            dedupeKey: `p2:nfu:${followUp.id}`,
          }, { type: "manager", accountId: followUp.managerAccountId });
        }
      }
      const notesByDeveloper = new Map<string, { date: string; body: string }[]>();
      for (const day of data.trackerDays.values()) {
        if (day.workspaceId !== scope || !day.managerNotes?.trim()) continue;
        notesByDeveloper.set(day.developerAccountId, [...(notesByDeveloper.get(day.developerAccountId) ?? []), { date: day.date, body: day.managerNotes.trim() }]);
      }
      for (const [developerId, entries] of notesByDeveloper) {
        entries.sort((a, b) => a.date.localeCompare(b.date));
        const sections: string[] = [];
        let previous = "";
        for (const entry of entries) {
          if (entry.body === previous) continue; // Phase 0 seeded duplicates forward
          previous = entry.body;
          sections.push(`${formatDatedNoteHeading(entry.date)}\n${entry.body}`);
        }
        if (!sections.length) continue;
        await db.insert(developerNotes).values({
          workspaceId: scope, developerAccountId: developerId, body: sections.join("\n\n"), updatedAt: now,
        }).onConflictDoUpdate({ target: [developerNotes.workspaceId, developerNotes.developerAccountId], set: { body: sections.join("\n\n"), updatedAt: now } });
      }

      // ── B7 repoint (runs after every event write so synthesized events get
      // task_id too) ──
      const allEventRows = await this.events.listRawForWorkspace(scope);
      for (const key of new Set(allEventRows.map((row) => row.taskKey))) {
        const resolved = data.aliases.get(key) ?? key;
        const taskId = keyToTaskId.get(resolved);
        if (taskId) await this.events.repointKeyToTaskId(scope, key, taskId);
      }

      // ── B11: structural verification before commit ──
      const verify = await this.verifyStructure(scope);
      if (!verify.ok) {
        throw new HttpError(500, `Backfill verification failed: ${JSON.stringify({ missingLegacyMap: verify.missingLegacyMap.slice(0, 5), unrepointedEvents: verify.unrepointedEvents, multiActive: verify.multiActiveViolations })}`);
      }

      const report = await this.planReport(scope, inputHash, findings, true);
      await db.insert(dataMigrations).values({ name: marker("p2_backfill", scope), appliedAt: new Date().toISOString(), reportJson: JSON.stringify(report) }).onConflictDoNothing();
      const snapshotHash = await this.computeInputHash(scope);
      await db.delete(configTable).where(and(eq(configTable.workspaceId, scope), eq(configTable.key, "tasks_phase2_verified")));
      await db.insert(configTable).values({ workspaceId: scope, key: "tasks_phase2_backfill_hash", value: snapshotHash }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: snapshotHash } });
      return report;
    });
  }

  private async planReport(scope: string, inputHash: string, findings: TaskPhase2Report["findings"], applied: boolean): Promise<TaskPhase2Report> {
    const data = await this.load(scope);
    const groups = this.buildGroups(data, this.emptyFindings());
    const ctx = this.buildProposalContext(data);
    const mergeProposals = proposeMerges([...groups.values()].filter((g) => !g.desk), ctx);
    const statusMapping: Record<string, number> = {};
    const inserted = await db.select().from(tasks).where(eq(tasks.workspaceId, scope));
    const counts = {
      legacyDeskRows: data.desks.length,
      legacyTrackerRows: data.trackers.length,
      keyGroups: groups.size,
      tasksByKind: {} as Record<string, number>,
      tasksByOwnerType: {} as Record<string, number>,
      tasksByStatus: {} as Record<string, number>,
    };
    for (const row of inserted) {
      counts.tasksByKind[row.kind] = (counts.tasksByKind[row.kind] ?? 0) + 1;
      counts.tasksByOwnerType[row.ownerType ?? "inbox"] = (counts.tasksByOwnerType[row.ownerType ?? "inbox"] ?? 0) + 1;
      counts.tasksByStatus[row.status] = (counts.tasksByStatus[row.status] ?? 0) + 1;
    }
    return {
      workspaceId: scope, inputHash, generatedAt: new Date().toISOString(), applied,
      counts, findings,
      autoMerges: mergeProposals.filter((p) => p.classification === "auto"),
      ambiguous: mergeProposals.filter((p) => p.classification === "ambiguous"),
      splits: [],
      statusMapping,
      fieldLoss: { labelsCreated: 0, prioritiesCollapsed: 0, kindsRelabelled: 0 },
      decisionsTemplate: { inputHash, decisions: [] },
    };
  }

  /** B11 structural invariants (runs inside the apply transaction and standalone). */
  async verifyStructure(workspaceId: string): Promise<TaskPhase2VerifyResult> {
    const scope = normalizeWorkspaceId(workspaceId);
    const [mappedRows, eventRows, actives, checkinNulls, noteNulls, followUpNulls] = await Promise.all([
      db.select().from(taskLegacyMap).where(eq(taskLegacyMap.workspaceId, scope)),
      this.events.listRawForWorkspace(scope),
      this.taskService.activeCountsByDeveloper(scope),
      db.select({ id: checkinTaskRefs.checkinId }).from(checkinTaskRefs).where(and(eq(checkinTaskRefs.workspaceId, scope), isNull(checkinTaskRefs.taskId))),
      db.select({ noteId: dailyNoteTaskRefs.noteId }).from(dailyNoteTaskRefs).where(and(eq(dailyNoteTaskRefs.workspaceId, scope), isNull(dailyNoteTaskRefs.taskId))),
      db.select({ id: dailyNoteFollowUps.id }).from(dailyNoteFollowUps).where(and(eq(dailyNoteFollowUps.workspaceId, scope), isNull(dailyNoteFollowUps.taskId))),
    ]);
    const mapped = new Set(mappedRows.map((row) => `${row.sourceTable}:${row.sourceId}`));
    const missingLegacyMap: { sourceTable: string; sourceId: number }[] = [];
    const [desks, trackers] = await Promise.all([
      db.select({ id: managerDeskItems.id }).from(managerDeskItems).where(eq(managerDeskItems.workspaceId, scope)),
      db.select({ id: teamTrackerItems.id }).from(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, scope)),
    ]);
    for (const row of desks) if (!mapped.has(`manager_desk_items:${row.id}`)) missingLegacyMap.push({ sourceTable: "manager_desk_items", sourceId: row.id });
    for (const row of trackers) if (!mapped.has(`team_tracker_items:${row.id}`)) missingLegacyMap.push({ sourceTable: "team_tracker_items", sourceId: row.id });
    const unrepointed = eventRows.filter((row) => row.taskId === null).length;
    const multiActiveViolations = [...actives.entries()].filter(([, count]) => count > 1).map(([owner]) => owner);
    return {
      workspaceId: scope,
      ok: !missingLegacyMap.length && unrepointed === 0 && !multiActiveViolations.length && !checkinNulls.length && !noteNulls.length && !followUpNulls.length,
      missingLegacyMap,
      unrepointedEvents: unrepointed,
      multiActiveViolations,
      unfilledRefs: { checkin: checkinNulls.length, noteTask: noteNulls.length, noteFollowUp: followUpNulls.length },
      parityDiffs: [],
      explainedDrift: [],
    };
  }

  /**
   * --verify: structural invariants plus parity between the legacy projections
   * and the TaskService projections over the last 14 days (§2.2.13).
   */
  async verify(workspaceId: string, opts: { strict?: boolean } = {}): Promise<TaskPhase2VerifyResult> {
    const scope = normalizeWorkspaceId(workspaceId);
    const result = await this.verifyStructure(scope);
    const parityDiffs: TaskPhase2VerifyResult["parityDiffs"] = [];

    const trackerService = new TeamTrackerService();
    const deskService = new ManagerDeskService();
    const today = isoDatePart(new Date().toISOString())!;
    const dates = Array.from({ length: 15 }, (_, i) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return isoDatePart(d.toISOString())!;
    });

    const board = await trackerService.getBoard(today, { workspaceId: scope });
    const legacyDevStatus = (state: string) => ({ planned: "open", in_progress: "active", done: "done", dropped: "dropped" }[state] ?? state);
    for (const devDay of board.developers ?? []) {
      const legacy = new Map<string, { title: string; status: string }>();
      for (const item of [devDay.currentItem, ...devDay.plannedItems, ...devDay.completedItems, ...devDay.droppedItems].filter(Boolean)) {
        if (item!.taskKey) legacy.set(item!.taskKey, { title: item!.title, status: legacyDevStatus(item!.state) });
      }
      const projected = new Map((await this.taskService.projectDeveloperBoardDay(devDay.developer.accountId, today, scope)).map((p) => [p.taskKey, p]));
      for (const [key, item] of legacy) {
        const task = projected.get(key);
        if (!task) parityDiffs.push({ surface: "board", owner: devDay.developer.accountId, date: today, field: "presence", legacy: `${key}:${item.title}`, tasks: "(absent)" });
        else {
          if (task.title !== item.title) parityDiffs.push({ surface: "board", owner: devDay.developer.accountId, date: today, field: "title", legacy: item.title, tasks: task.title });
          if (task.status !== item.status) parityDiffs.push({ surface: "board", owner: devDay.developer.accountId, date: today, field: "status", legacy: item.status, tasks: task.status });
        }
      }
      for (const key of projected.keys()) {
        if (!legacy.has(key)) parityDiffs.push({ surface: "board", owner: devDay.developer.accountId, date: today, field: "presence", legacy: "(absent)", tasks: key });
      }
    }

    // Historical dev days: rows on that day vs day_focus.
    const trackerDayRows = await db.select().from(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, scope));
    const trackerItemRows = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, scope));
    const taskRows = await db.select().from(tasks).where(eq(tasks.workspaceId, scope));
    const allEventRows = await this.events.listRawForWorkspace(scope);
    const currentByKey = new Map(taskRows.map((row) => [row.taskKey, row]));
    const eventsByKey = new Map<string, typeof allEventRows>();
    for (const event of allEventRows) {
      eventsByKey.set(event.taskKey, [...(eventsByKey.get(event.taskKey) ?? []), event]);
    }
    const explainedDrift: TaskPhase2VerifyResult["parityDiffs"] = [];
    // Legacy history views show the day's rows with their *current* mutated
    // values; canonical replays events to true point-in-time state (the §2.3.3
    // B9 fix). A field diff is explained drift — not a parity violation — when
    // the canonical task's current value equals the legacy row's current value
    // and a recorded task event after the day's end accounts for the change.
    const explainedField = (key: string, field: "title" | "status", legacyValue: string, dayEndIso: string): boolean => {
      const current = currentByKey.get(key);
      if (!current || current[field] !== legacyValue) return false;
      return (eventsByKey.get(key) ?? []).some((event) => event.type === field && event.occurredAt >= dayEndIso);
    };
    for (const date of dates.slice(1)) {
      for (const day of trackerDayRows.filter((row) => row.date === date)) {
        const legacyKeys = new Map<string, { title: string; status: string }>();
        const byKey = new Map<string, typeof trackerItemRows[number][]>();
        for (const row of trackerItemRows.filter((item) => item.dayId === day.id)) {
          byKey.set(row.taskKey ?? "", [...(byKey.get(row.taskKey ?? "") ?? []), row]);
        }
        for (const [key, rows] of byKey) {
          if (!key) continue;
          const latest = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0]!;
          legacyKeys.set(key, { title: latest.title, status: legacyDevStatus(latest.state) });
        }
        const projected = new Map((await this.taskService.projectDeveloperHistoryDay(day.developerAccountId, date, scope)).map((p) => [p.taskKey, p]));
        const [year, month, dayNum] = date.split("-").map(Number);
        const dayEndIso = new Date(year!, month! - 1, dayNum! + 1).toISOString();
        for (const [key, item] of legacyKeys) {
          const task = projected.get(key);
          if (!task) parityDiffs.push({ surface: "board", owner: day.developerAccountId, date, field: "presence", legacy: `${key}:${item.title}`, tasks: "(absent)" });
          else {
            if (task.title !== item.title) {
              (explainedField(key, "title", item.title, dayEndIso) ? explainedDrift : parityDiffs)
                .push({ surface: "board", owner: day.developerAccountId, date, field: "title", legacy: item.title, tasks: task.title });
            }
            if (task.status !== item.status) {
              (explainedField(key, "status", item.status, dayEndIso) ? explainedDrift : parityDiffs)
                .push({ surface: "board", owner: day.developerAccountId, date, field: "status", legacy: item.status, tasks: task.status });
            }
          }
        }
      }
    }

    // Desk today parity.
    const legacyDeskStatus = (status: string) => ({ inbox: "open", planned: "open", in_progress: "active", waiting: "blocked", backlog: "open", done: "done", cancelled: "dropped" }[status] ?? status);
    const managers = [...new Set((await db.select({ id: managerDeskDays.managerAccountId }).from(managerDeskDays).where(eq(managerDeskDays.workspaceId, scope))).map((row) => row.id))];
    for (const manager of managers) {
      const legacyItems = await deskService.getTodayItems(manager, today, scope);
      const projected = new Map((await this.taskService.projectTodayItems(manager, today, scope)).map((p) => [p.taskKey, p]));
      const legacy = new Map(legacyItems.filter((item) => item.taskKey).map((item) => [item.taskKey!, { title: item.title, status: legacyDeskStatus(item.status) }]));
      for (const [key, item] of legacy) {
        const task = projected.get(key);
        if (!task) parityDiffs.push({ surface: "desk_today", owner: manager, date: today, field: "presence", legacy: `${key}:${item.title}`, tasks: "(absent)" });
        else {
          if (task.title !== item.title) parityDiffs.push({ surface: "desk_today", owner: manager, date: today, field: "title", legacy: item.title, tasks: task.title });
          if (task.status !== item.status) parityDiffs.push({ surface: "desk_today", owner: manager, date: today, field: "status", legacy: item.status, tasks: task.status });
        }
      }
      for (const key of projected.keys()) {
        if (!legacy.has(key)) parityDiffs.push({ surface: "desk_today", owner: manager, date: today, field: "presence", legacy: "(absent)", tasks: key });
      }
    }

    // Desk day views: live/planning/history parity per manager per date.
    // Closed-date coverage comes through live+history including items
    // closedAt === date.
    const deskDayRows = await db.select().from(managerDeskDays).where(eq(managerDeskDays.workspaceId, scope));
    const deskItemRows = await db.select().from(managerDeskItems).where(eq(managerDeskItems.workspaceId, scope));
    const deskLinkRows = await db.select().from(managerDeskLinks).where(eq(managerDeskLinks.workspaceId, scope));
    const taskLinkRows = await db.select().from(taskLinks).where(eq(taskLinks.workspaceId, scope));
    const mappedRows = await db.select().from(taskLegacyMap).where(eq(taskLegacyMap.workspaceId, scope));
    const deskManagerByDay = new Map(deskDayRows.map((row) => [row.id, row.managerAccountId]));
    const developerIds = [...new Set(trackerDayRows.map((row) => row.developerAccountId))];
    // History snapshots predate the taskKey field — resolve legacy item ids to
    // task keys through task_legacy_map for all three desk views.
    const taskKeyById = new Map(taskRows.map((row) => [row.id, row.taskKey]));
    const deskKeyByItemId = new Map<number, string>();
    for (const row of mappedRows.filter((r) => r.sourceTable === "manager_desk_items")) {
      const key = taskKeyById.get(row.taskId);
      if (key && !deskKeyByItemId.has(row.sourceId)) deskKeyByItemId.set(row.sourceId, key);
    }
    const deskDayViews = [
      {
        view: "live" as const,
        surface: "desk_live",
        project: (m: string, d: string) => this.taskService.projectDeskDay(m, d, scope),
      },
      {
        view: "planning" as const,
        surface: "desk_planning",
        project: (m: string, d: string) => this.taskService.projectDeskPlanningDay(m, d, scope),
      },
      {
        view: "history" as const,
        surface: "desk_history",
        project: async (m: string, d: string) =>
          (await this.taskService.history(m, d, scope)).map((row) => ({ taskKey: row.taskKey, title: row.title, status: row.status })),
      },
    ];
    for (const manager of managers) {
      const managerItemRows = deskItemRows.filter((row) => deskManagerByDay.get(row.dayId) === manager);
      for (const date of dates) {
        for (const { view, surface, project } of deskDayViews) {
          const legacyItems = (await deskService.parityDayView(manager, date, view, scope))
            .map((item) => ({ item, key: item.taskKey ?? deskKeyByItemId.get(item.id) }))
            .filter((entry): entry is { item: ManagerDeskItem; key: string } => Boolean(entry.key));
          const legacy = new Map(legacyItems.map(({ item, key }) => [key, { title: item.title, status: legacyDeskStatus(item.status) }]));
          const projected = new Map((await project(manager, date)).map((p) => [p.taskKey, p]));
          for (const [key, item] of legacy) {
            const task = projected.get(key);
            if (!task) parityDiffs.push({ surface, owner: manager, date, field: "presence", legacy: `${key}:${item.title}`, tasks: "(absent)" });
            else {
              if (task.title !== item.title) parityDiffs.push({ surface, owner: manager, date, field: "title", legacy: item.title, tasks: task.title });
              if (task.status !== item.status) parityDiffs.push({ surface, owner: manager, date, field: "status", legacy: item.status, tasks: task.status });
            }
          }
          for (const key of projected.keys()) {
            if (!legacy.has(key)) parityDiffs.push({ surface, owner: manager, date, field: "presence", legacy: "(absent)", tasks: key });
          }
        }
      }

      // Follow-ups + meetings parity (§2.3.3 #7 memory surfaces).
      const compareSets = (surface: string, legacyKeys: Set<string>, projectedKeys: Set<string>) => {
        for (const key of legacyKeys) {
          if (!projectedKeys.has(key)) {
            parityDiffs.push({ surface, owner: manager, date: today, field: "presence", legacy: key, tasks: "(absent)" });
          }
        }
        for (const key of projectedKeys) {
          if (!legacyKeys.has(key)) {
            parityDiffs.push({ surface, owner: manager, date: today, field: "presence", legacy: "(absent)", tasks: key });
          }
        }
      };
      compareSets(
        "follow_ups",
        new Set(managerItemRows.filter((row) => row.taskKey && (row.category === "follow_up" || row.followUpAt)).map((row) => row.taskKey as string)),
        new Set((await this.taskService.projectFollowUps(manager, scope)).map((p) => p.taskKey))
      );
      compareSets(
        "meetings",
        new Set(managerItemRows.filter((row) => row.taskKey && row.kind === "meeting").map((row) => row.taskKey as string)),
        new Set((await this.taskService.projectMeetings(manager, scope)).map((p) => p.taskKey))
      );
    }

    // Task links parity: manager_desk_links rows must map 1:1 onto task_links
    // for the mapped task, and tracker jira keys must appear as jira links.
    const taskLinksByTask = new Map<number, (typeof taskLinkRows)[number][]>();
    for (const link of taskLinkRows) {
      const bucket = taskLinksByTask.get(link.taskId) ?? [];
      bucket.push(link);
      taskLinksByTask.set(link.taskId, bucket);
    }
    const deskLinksByItem = new Map<number, number>();
    for (const link of deskLinkRows) {
      deskLinksByItem.set(link.itemId, (deskLinksByItem.get(link.itemId) ?? 0) + 1);
    }
    for (const row of mappedRows.filter((r) => r.sourceTable === "manager_desk_items" && r.role !== "superseded")) {
      const expected = deskLinksByItem.get(row.sourceId) ?? 0;
      const actual = (taskLinksByTask.get(row.taskId) ?? []).length;
      if (expected !== actual) {
        parityDiffs.push({
          surface: "links",
          owner: "workspace",
          date: today,
          field: "desk_link_count",
          legacy: `item:${row.sourceId} links:${expected}`,
          tasks: `task:${row.taskId} links:${actual}`,
        });
      }
    }
    const trackerItemsById = new Map(trackerItemRows.map((row) => [row.id, row]));
    for (const row of mappedRows.filter((r) => r.sourceTable === "team_tracker_items")) {
      const item = trackerItemsById.get(row.sourceId);
      if (!item) continue;
      let related: string[] = [];
      try {
        related = item.relatedJiraKeys ? (JSON.parse(item.relatedJiraKeys) as string[]) : [];
      } catch {
        related = [];
      }
      const keys = [item.jiraKey, ...related].filter((k): k is string => Boolean(k));
      const jiraRefs = new Set((taskLinksByTask.get(row.taskId) ?? []).filter((link) => link.kind === "jira").map((link) => link.ref));
      for (const key of keys) {
        if (!jiraRefs.has(key)) {
          parityDiffs.push({ surface: "links", owner: "workspace", date: today, field: "jira_link", legacy: `item:${row.sourceId} ${key}`, tasks: "(absent)" });
        }
      }
    }

    // §2.3.2 privacy: developer surface DTOs must not expose manager-private
    // fields on tracked tasks.
    const trackedSample = taskRows.find((row) => row.trackedByManagerId);
    if (trackedSample) {
      const developerViewer = developerIds[0] ?? (trackedSample.ownerType === "developer" ? trackedSample.ownerId as string : trackedSample.trackedByManagerId as string);
      const dto = (
        await this.taskService.surfaceDtos([trackedSample], {
          date: today,
          principal: { type: "developer", accountId: developerViewer, workspaceId: scope },
        })
      )[0] as Record<string, unknown> | undefined;
      for (const field of ["trackedByManagerId", "labels", "later", "parentId", "nextAction", "followUpAt", "legacyDeskItemId"]) {
        if (dto && Object.prototype.hasOwnProperty.call(dto, field)) {
          parityDiffs.push({ surface: "privacy", owner: developerViewer, date: today, field, legacy: "leaked", tasks: "(exposed)" });
        }
      }
    }

    result.parityDiffs = parityDiffs;
    result.explainedDrift = explainedDrift;
    result.ok = result.ok && (opts.strict ? parityDiffs.length === 0 : true);
    return result;
  }
}

// drizzle-orm's inArray needs a non-empty array; this helper keeps split moves tidy.
function inArrayIds(column: typeof teamTrackerItems.id, ids: number[]) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;
}

