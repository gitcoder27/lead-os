import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/connection";
import { configTable, dataMigrations, managerDeskDays, managerDeskItems, taskKeySequences, teamTrackerDays, teamTrackerItems, workspaces } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { TaskEventsService } from "./task-events.service";
import { parseTaskNotes } from "./task-notes-import";

type Desk = typeof managerDeskItems.$inferSelect;
type Tracker = typeof teamTrackerItems.$inferSelect;
type Candidate = { createdAt: string; minId: number; desk?: Desk; tracker: Tracker[] };

function carryKey(row: Tracker): string {
  let related: string[] = [];
  try { related = row.relatedJiraKeys ? JSON.parse(row.relatedJiraKeys) as string[] : []; } catch { related = []; }
  return JSON.stringify([row.jiraKey ?? null, related, row.title]);
}

function root(row: Desk, byId: Map<number, Desk>): number {
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

export interface TaskPhase1Report {
  workspaceId: string;
  deskCandidates: number;
  trackerCandidates: number;
  linkedTrackerRows: number;
  recurrenceSplits: { rowId: number; title: string }[];
  deskLineageNonCanonical: number[];
  phase2ReviewHints: { sameDayRows: number[][]; changedNotes: number[][] };
  maxKey: number;
  deskNoteEvents: number;
  trackerNoteEvents: number;
  oversizedNotes: number[];
}

export class TaskPhase1MigrationService {
  constructor(private readonly events = new TaskEventsService()) {}

  async workspaceIds(): Promise<string[]> {
    const [workspaceRows, deskRows, trackerRows] = await Promise.all([
      db.select({ id: workspaces.id }).from(workspaces),
      db.select({ id: managerDeskItems.workspaceId }).from(managerDeskItems),
      db.select({ id: teamTrackerItems.workspaceId }).from(teamTrackerItems),
    ]);
    return [...new Set([...workspaceRows.map((row) => row.id), ...deskRows.map((row) => row.id), ...trackerRows.map((row) => row.id)])].sort();
  }

  async migrate(workspaceId: string, apply = false, forceSteps: string[] = []): Promise<TaskPhase1Report> {
    const desks = await db.select().from(managerDeskItems).where(eq(managerDeskItems.workspaceId, workspaceId));
    const trackers = await db.select().from(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, workspaceId));
    const [deskDays, trackerDays] = await Promise.all([
      db.select().from(managerDeskDays).where(eq(managerDeskDays.workspaceId, workspaceId)),
      db.select().from(teamTrackerDays).where(eq(teamTrackerDays.workspaceId, workspaceId)),
    ]);
    const byDesk = new Map(desks.map((row) => [row.id, row]));
    const dayByDesk = new Map(deskDays.map((row) => [row.id, row]));
    const dayByTracker = new Map(trackerDays.map((row) => [row.id, row]));
    const lineage = new Map<number, Desk[]>();
    for (const row of desks) {
      const id = root(row, byDesk);
      lineage.set(id, [...(lineage.get(id) ?? []), row]);
    }
    const canonical = new Map<number, Candidate>();
    const nonCanonical: number[] = [];
    for (const [id, rows] of lineage) {
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
      const chosen = rows[0]!;
      canonical.set(id, { createdAt: rows.reduce((earliest, row) => row.createdAt < earliest ? row.createdAt : earliest, chosen.createdAt), minId: Math.min(...rows.map((row) => row.id)), desk: chosen, tracker: [] });
      nonCanonical.push(...rows.slice(1).map((row) => row.id));
    }
    let linkedTrackerRows = 0;
    const groups = new Map<string, Tracker[]>();
    for (const row of trackers) {
      if (row.managerDeskItemId && byDesk.has(row.managerDeskItemId)) {
        canonical.get(root(byDesk.get(row.managerDeskItemId)!, byDesk))!.tracker.push(row);
        linkedTrackerRows++;
      } else {
        const dev = dayByTracker.get(row.dayId)?.developerAccountId ?? "";
        const group = JSON.stringify([dev, carryKey(row)]);
        groups.set(group, [...(groups.get(group) ?? []), row]);
      }
    }
    const recurrenceSplits: TaskPhase1Report["recurrenceSplits"] = [];
    const candidates: Candidate[] = [...canonical.values()];
    for (const rows of groups.values()) {
      rows.sort((a, b) => (dayByTracker.get(a.dayId)?.date ?? "").localeCompare(dayByTracker.get(b.dayId)?.date ?? "") || a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      let candidate: Candidate | undefined;
      for (const row of rows) {
        const previous = candidate?.tracker ?? [];
        const allClosed = previous.length > 0 && previous.every((item) => item.state === "done" || item.state === "dropped");
        const lastClosedAt = previous.reduce((latest, item) => (item.completedAt ?? item.updatedAt) > latest ? (item.completedAt ?? item.updatedAt) : latest, "");
        if (!candidate || (allClosed && lastClosedAt < row.createdAt)) {
          if (candidate) recurrenceSplits.push({ rowId: row.id, title: row.title });
          candidate = { createdAt: row.createdAt, minId: row.id, tracker: [] };
          candidates.push(candidate);
        }
        candidate.tracker.push(row);
        if (row.createdAt < candidate.createdAt) candidate.createdAt = row.createdAt;
        candidate.minId = Math.min(candidate.minId, row.id);
      }
    }
    candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.minId - b.minId);
    const sequence = (await db.select().from(taskKeySequences).where(eq(taskKeySequences.workspaceId, workspaceId)).limit(1))[0];
    const existingNumbers = [...desks, ...trackers].map((row) => Number(row.taskKey?.slice(2) ?? 0));
    let next = Math.max(sequence?.nextValue ?? 1, ...existingNumbers.map((number) => number + 1), 1);
    const keys = new Map<Candidate, string>();
    for (const candidate of candidates) {
      const existing = candidate.desk?.taskKey ?? candidate.tracker.find((row) => row.taskKey)?.taskKey;
      keys.set(candidate, existing ?? `T-${next++}`);
    }
    const report: TaskPhase1Report = {
      workspaceId, deskCandidates: canonical.size, trackerCandidates: candidates.length - canonical.size, linkedTrackerRows,
      recurrenceSplits, deskLineageNonCanonical: nonCanonical,
      phase2ReviewHints: { sameDayRows: [], changedNotes: [] }, maxKey: next - 1,
      deskNoteEvents: 0, trackerNoteEvents: 0, oversizedNotes: [],
    };
    const imports: { key: string; body: string; authorId?: string; field: "desk_context_note" | "tracker_note"; sourceId: number; sectionDate: string | null; occurredAt: string; dedupeKey: string }[] = [];
    for (const candidate of candidates) {
      const key = keys.get(candidate)!;
      if (candidate.desk?.contextNote) {
        const row = candidate.desk;
        const managerId = dayByDesk.get(row.dayId)?.managerAccountId;
        if (!managerId) throw new Error(`Desk item ${row.id} has no manager day`);
        const notes = parseTaskNotes(row.contextNote!);
        for (const section of [{ date: null, body: notes.legacyBody }, ...notes.datedSections]) {
          if (!section.body) continue;
          imports.push({ key, body: section.body, authorId: managerId, field: "desk_context_note", sourceId: row.id, sectionDate: section.date, occurredAt: section.date ? `${section.date}T12:00:00.000Z` : row.createdAt, dedupeKey: `imp:dcn:${row.id}:${section.date ?? "legacy"}` });
          report.deskNoteEvents++;
        }
      }
      const trackerRows = [...candidate.tracker].sort((a, b) => (dayByTracker.get(a.dayId)?.date ?? "").localeCompare(dayByTracker.get(b.dayId)?.date ?? "") || a.updatedAt.localeCompare(b.updatedAt) || a.id - b.id);
      let previous: string | undefined;
      for (const row of trackerRows) {
        const body = row.note?.trim();
        if (!body || body === previous) continue;
        previous = body;
        imports.push({ key, body, field: "tracker_note", sourceId: row.id, sectionDate: null, occurredAt: row.updatedAt, dedupeKey: `imp:tn:${row.id}` });
        report.trackerNoteEvents++;
      }
      const byDate = new Map<string, number[]>();
      for (const row of candidate.tracker) {
        const day = dayByTracker.get(row.dayId)?.date ?? "";
        byDate.set(day, [...(byDate.get(day) ?? []), row.id]);
      }
      report.phase2ReviewHints.sameDayRows.push(...[...byDate.values()].filter((ids) => ids.length > 1));
      if (new Set(candidate.tracker.map((row) => row.note ?? "")).size > 1) report.phase2ReviewHints.changedNotes.push(candidate.tracker.map((row) => row.id));
    }
    report.oversizedNotes = imports.filter((item) => item.body.length > 4000).map((item) => item.sourceId);
    if (!apply) return report;
    if (report.oversizedNotes.length) throw new Error(`Note sections exceed 4000 characters: ${report.oversizedNotes.join(", ")}`);
    const marker = (name: string) => workspaceId === "default" ? name : `${name}:${workspaceId}`;
    const already = await db.select({ name: dataMigrations.name }).from(dataMigrations);
    const marked = new Set(already.map((row) => row.name));
    const shouldRun = (name: string) => !marked.has(marker(name)) || forceSteps.includes(name);
    if (shouldRun("p1_assign_task_keys")) await runInTransaction(async () => {
      for (const candidate of candidates) {
        const key = keys.get(candidate)!;
        if (candidate.desk && !candidate.desk.taskKey) await db.update(managerDeskItems).set({ taskKey: key }).where(eq(managerDeskItems.id, candidate.desk.id));
        for (const row of candidate.tracker) if (!row.taskKey) await db.update(teamTrackerItems).set({ taskKey: key }).where(eq(teamTrackerItems.id, row.id));
      }
      await db.update(managerDeskItems).set({ createdByType: "unknown" }).where(and(eq(managerDeskItems.workspaceId, workspaceId), isNull(managerDeskItems.createdByType)));
      await db.update(teamTrackerItems).set({ createdByType: "unknown" }).where(and(eq(teamTrackerItems.workspaceId, workspaceId), isNull(teamTrackerItems.createdByType)));
      await db.insert(taskKeySequences).values({ workspaceId, nextValue: next }).onConflictDoUpdate({ target: taskKeySequences.workspaceId, set: { nextValue: next } });
      await db.insert(dataMigrations).values({ name: marker("p1_assign_task_keys"), appliedAt: new Date().toISOString(), reportJson: JSON.stringify(report) }).onConflictDoNothing();
    });
    if (shouldRun("p1_import_task_notes")) await runInTransaction(async () => {
      for (const item of imports) await this.events.appendImport({ workspaceId, taskKey: item.key, type: "update", body: item.body, meta: { imported: { field: item.field, sourceTable: item.field === "desk_context_note" ? "manager_desk_items" : "team_tracker_items", sourceId: item.sourceId, sectionDate: item.sectionDate, approximateTime: true } }, sourceTable: item.field === "desk_context_note" ? "manager_desk_items" : "team_tracker_items", sourceId: item.sourceId, dedupeKey: item.dedupeKey, occurredAt: item.occurredAt }, { type: item.field === "desk_context_note" ? "manager" : "system", accountId: item.authorId });
      await db.insert(dataMigrations).values({ name: marker("p1_import_task_notes"), appliedAt: new Date().toISOString(), reportJson: JSON.stringify(report) }).onConflictDoNothing();
    });
    await db.insert(configTable).values({ workspaceId, key: "tasks_phase1_enabled", value: "true" }).onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: "true" } });
    return report;
  }
}
