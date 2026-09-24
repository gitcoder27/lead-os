import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  DailyNote,
  DailyNoteFollowUp,
  DailyNoteResponse,
  DailyNoteSourcesResponse,
  DailyNoteSummary,
  DailyNotesResponse,
  AppendDailyNotePayload,
  CreateDailyNoteFollowUpPayload,
  ManagerDeskStatus,
  SaveDailyNotePayload,
} from "shared/types";
import { db, rawDb } from "../db/connection";
import {
  dailyNoteCaptures,
  dailyNoteFollowUps,
  dailyNotes,
  dailyNoteTaskRefs,
  managerDeskDays,
  managerDeskItems,
} from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { ManagerDeskService } from "./manager-desk.service";
import { TeamTrackerService } from "./team-tracker.service";
import { TaskKeysService } from "./task-keys.service";
import { TaskEventsService } from "./task-events.service";
import { todayIsoDate } from "../utils/date";
import { normalizeWorkspaceId } from "./workspace.service";

const MAX_BODY_LENGTH = 50000;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const TITLE_LENGTH = 120;
const EXCERPT_LENGTH = 180;
const NOTE_CONFLICT_MESSAGE = "This note changed elsewhere. Review the latest version before saving.";

type DailyNoteRow = typeof dailyNotes.$inferSelect;

function nowIso(): string {
  return new Date().toISOString();
}

function assertScope(managerAccountId: string, workspaceId: string): void {
  if (!managerAccountId?.trim() || !workspaceId?.trim()) {
    throw new HttpError(403, "Daily notes are private to their author");
  }
}

function deriveTitle(body: string): string {
  const line = body
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line ? line.slice(0, TITLE_LENGTH) : "Daily note";
}

function buildExcerpt(body: string, query?: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= EXCERPT_LENGTH) {
    return collapsed;
  }

  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    const matchIndex = collapsed.toLowerCase().indexOf(normalizedQuery.toLowerCase());
    if (matchIndex >= 0) {
      const start = Math.max(
        0,
        Math.min(
          matchIndex - Math.floor((EXCERPT_LENGTH - normalizedQuery.length) / 2),
          collapsed.length - EXCERPT_LENGTH
        )
      );
      return collapsed.slice(start, start + EXCERPT_LENGTH);
    }
  }

  return collapsed.slice(0, EXCERPT_LENGTH);
}

function toSummary(row: DailyNoteRow, query?: string): DailyNoteSummary {
  return {
    id: row.id,
    date: row.date,
    title: deriveTitle(row.body),
    excerpt: buildExcerpt(row.body, query),
    updatedAt: row.updatedAt,
  };
}

function toNote(row: DailyNoteRow): DailyNote {
  return {
    ...toSummary(row),
    body: row.body,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function hashPayload(shape: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

export class DailyNotesService {
  private readonly followUpOperations = new Map<string, Promise<void>>();

  constructor(private readonly managerDesk = new ManagerDeskService(), private readonly tracker = new TeamTrackerService()) {}
  private readonly taskKeys = new TaskKeysService();
  private readonly eventsService = new TaskEventsService(this.taskKeys);

  private async scanMentions(note: DailyNoteRow): Promise<void> {
    if (!(await this.taskKeys.enabled(note.workspaceId))) return;
    for (const match of note.body.matchAll(/\bT-\d{1,9}\b/gi)) {
      const key = await this.taskKeys.resolve(note.workspaceId, match[0]);
      if (!key) continue;
      try { if ((await this.taskKeys.resolveTask(note.workspaceId, key)).deleted) continue; } catch { continue; }
      const inserted = await db.insert(dailyNoteTaskRefs).values({ workspaceId: note.workspaceId, managerAccountId: note.managerAccountId, noteId: note.id, taskKey: key, relation: "mentioned", createdAt: nowIso() }).onConflictDoNothing().returning();
      if (!inserted.length) continue;
      const index = match.index ?? 0;
      await this.eventsService.append({ workspaceId: note.workspaceId, taskKey: key, type: "note_ref", body: null, meta: { noteId: note.id, noteDate: note.date, relation: "mentioned", excerpt: note.body.slice(Math.max(0, index - 80), index + match[0].length + 80) } }, { type: "system", accountId: note.managerAccountId });
    }
  }

  /**
   * FTS5-ranked body search; undefined when the query has no searchable terms
   * or the index is unavailable — callers fall back to substring matching.
   */
  private searchNoteBodies(
    managerAccountId: string,
    workspaceId: string,
    query: string,
    before: string | undefined,
    limit: number
  ): DailyNoteRow[] | undefined {
    const terms = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
    if (terms.length === 0) {
      return undefined;
    }
    const match = terms
      .map((term) => (term.length >= 3 ? `${term}*` : `"${term.replace(/"/g, '""')}"`))
      .join(" ");
    try {
      const params: unknown[] = [match, workspaceId, managerAccountId];
      if (before) {
        params.push(before);
      }
      params.push(limit);
      const rows = rawDb
        .prepare(
          `SELECT n.id, n.workspace_id, n.manager_account_id, n.date, n.body, n.revision, n.created_at, n.updated_at
           FROM daily_notes_fts
           JOIN daily_notes n ON n.id = daily_notes_fts.rowid
           WHERE daily_notes_fts MATCH ?
             AND n.workspace_id = ?
             AND n.manager_account_id = ?
             ${before ? "AND n.date < ?" : ""}
           ORDER BY bm25(daily_notes_fts) ASC, n.date DESC
           LIMIT ?`
        )
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as number,
        workspaceId: row.workspace_id as string,
        managerAccountId: row.manager_account_id as string,
        date: row.date as string,
        body: row.body as string,
        revision: row.revision as number,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      }));
    } catch {
      return undefined;
    }
  }

  async list(
    managerAccountId: string,
    query: { q?: string; before?: string; limit?: number },
    workspaceId: string
  ): Promise<DailyNotesResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
    const trimmedQuery = query.q?.trim();

    let rows: DailyNoteRow[] | undefined = trimmedQuery
      ? this.searchNoteBodies(managerAccountId, normalizedWorkspaceId, trimmedQuery, query.before, limit + 1)
      : undefined;

    if (!rows) {
      const conditions = [
        eq(dailyNotes.workspaceId, normalizedWorkspaceId),
        eq(dailyNotes.managerAccountId, managerAccountId),
      ];
      if (query.before) {
        conditions.push(lt(dailyNotes.date, query.before));
      }
      if (trimmedQuery) {
        conditions.push(
          sql`(instr(lower(${dailyNotes.body}), lower(${trimmedQuery})) > 0 OR instr(${dailyNotes.date}, ${trimmedQuery}) > 0)`
        );
      }

      rows = await db
        .select()
        .from(dailyNotes)
        .where(and(...conditions))
        .orderBy(desc(dailyNotes.date))
        .limit(limit + 1);
    }

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      notes: page.map((row) => toSummary(row, trimmedQuery)),
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.date : null,
    };
  }

  async getDay(managerAccountId: string, date: string, workspaceId: string): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (!note) {
      return { note: null, followUps: [] };
    }

    const followUpRows = await db
      .select({
        itemId: dailyNoteFollowUps.itemId,
        date: managerDeskDays.date,
        title: managerDeskItems.title,
        status: managerDeskItems.status,
        followUpAt: managerDeskItems.followUpAt,
      })
      .from(dailyNoteFollowUps)
      .innerJoin(managerDeskItems, eq(dailyNoteFollowUps.itemId, managerDeskItems.id))
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
          eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
          eq(dailyNoteFollowUps.noteId, note.id),
          eq(managerDeskItems.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId)
        )
      )
      .orderBy(dailyNoteFollowUps.itemId);

    return {
      note: toNote(note),
      followUps: followUpRows.map((row) => ({
        itemId: row.itemId,
        date: row.date,
        title: row.title,
        status: row.status as ManagerDeskStatus,
        followUpAt: row.followUpAt ?? undefined,
      })),
    };
  }

  async save(
    managerAccountId: string,
    date: string,
    input: SaveDailyNotePayload,
    workspaceId: string
  ): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!Number.isInteger(input.revision) || input.revision < 0) {
      throw new HttpError(400, "revision must be a non-negative integer");
    }
    if (input.body.length > MAX_BODY_LENGTH) {
      throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
    }

    return runInTransaction(async () => {
    rawDb.transaction(() => {
      const current = db
        .select()
        .from(dailyNotes)
        .where(
          and(
            eq(dailyNotes.workspaceId, normalizedWorkspaceId),
            eq(dailyNotes.managerAccountId, managerAccountId),
            eq(dailyNotes.date, date)
          )
        )
        .get();

      if (!current) {
        if (input.revision !== 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        if (input.body.trim().length === 0) {
          return;
        }
        const now = nowIso();
        const inserted = db
          .insert(dailyNotes)
          .values({
            workspaceId: normalizedWorkspaceId,
            managerAccountId,
            date,
            body: input.body,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        if (inserted.changes === 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        return;
      }

      if (input.body === current.body) {
        return;
      }

      const updated = db
        .update(dailyNotes)
        .set({ body: input.body, revision: input.revision + 1, updatedAt: nowIso() })
        .where(
          and(
            eq(dailyNotes.id, current.id),
            eq(dailyNotes.revision, input.revision)
          )
        )
        .run();
      if (updated.changes === 0) {
        throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
      }
    })();
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (note) await this.scanMentions(note);
    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
    });
  }

  async append(
    managerAccountId: string,
    date: string,
    input: AppendDailyNotePayload,
    workspaceId: string
  ): Promise<DailyNoteResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const text = input.text.trim();
    if (!text) {
      throw new HttpError(400, "text is required");
    }
    if (text.length > MAX_BODY_LENGTH) {
      throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
    }
    const payloadHash = hashPayload({ route: "append", date, text });

    return runInTransaction(async () => {
    rawDb.transaction(() => {
      const receipt = db
        .select()
        .from(dailyNoteCaptures)
        .where(
          and(
            eq(dailyNoteCaptures.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteCaptures.managerAccountId, managerAccountId),
            eq(dailyNoteCaptures.requestId, input.requestId)
          )
        )
        .get();

      if (receipt) {
        if (receipt.payloadHash !== payloadHash) {
          throw new HttpError(409, "requestId was already used with a different payload");
        }
        return;
      }

      const current = db
        .select()
        .from(dailyNotes)
        .where(
          and(
            eq(dailyNotes.workspaceId, normalizedWorkspaceId),
            eq(dailyNotes.managerAccountId, managerAccountId),
            eq(dailyNotes.date, date)
          )
        )
        .get();

      const now = nowIso();
      let noteId: number;
      if (current) {
        const combined = current.body.length > 0 ? `${current.body}\n\n${text}` : text;
        if (combined.length > MAX_BODY_LENGTH) {
          throw new HttpError(400, `Note body must be ${MAX_BODY_LENGTH} characters or fewer`);
        }
        db.update(dailyNotes)
          .set({ body: combined, revision: current.revision + 1, updatedAt: now })
          .where(eq(dailyNotes.id, current.id))
          .run();
        noteId = current.id;
      } else {
        const inserted = db
          .insert(dailyNotes)
          .values({
            workspaceId: normalizedWorkspaceId,
            managerAccountId,
            date,
            body: text,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        if (inserted.changes === 0) {
          throw new HttpError(409, NOTE_CONFLICT_MESSAGE);
        }
        noteId = Number(inserted.lastInsertRowid);
      }

      db.insert(dailyNoteCaptures)
        .values({
          workspaceId: normalizedWorkspaceId,
          managerAccountId,
          noteId,
          requestId: input.requestId,
          payloadHash,
          createdAt: now,
        })
        .run();
    })();
    const note = await this.findNote(managerAccountId, date, normalizedWorkspaceId);
    if (note) await this.scanMentions(note);
    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
    });
  }

  async addTaskUpdate(managerAccountId: string, noteDate: string, input: { taskKey: string; text: string; type?: "update" | "instruction" | "decision"; visibility?: "shared" | "private"; requestId: string }, workspaceId: string) {
    await this.taskKeys.assertEnabled(workspaceId);
    return runInTransaction(async () => {
      const note = await this.findNote(managerAccountId, noteDate, workspaceId);
      if (!note) throw new HttpError(404, "Note not found");
      const task = await this.taskKeys.resolveTask(workspaceId, input.taskKey);
      if (task.deleted) throw new HttpError(410, "Task was deleted");
      const type = input.type ?? "update";
      const event = await this.eventsService.append({ workspaceId, taskKey: task.taskKey, type, body: input.text, meta: { via: "notes_page" }, visibility: input.visibility ?? "private", requestId: input.requestId }, { type: "manager", accountId: managerAccountId });
      await db.insert(dailyNoteTaskRefs).values({ workspaceId, managerAccountId, noteId: note.id, taskKey: task.taskKey, relation: "update_from", requestId: input.requestId, createdAt: nowIso() }).onConflictDoNothing();
      await this.eventsService.append({ workspaceId, taskKey: task.taskKey, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "update_from" }, dedupeKey: `note:ref:${input.requestId}` }, { type: "system", accountId: managerAccountId });
      return event;
    });
  }

  async createTask(managerAccountId: string, noteDate: string, input: { title: string; developerAccountId?: string; jiraKey?: string; context?: string; requestId: string }, workspaceId: string) {
    await this.taskKeys.assertEnabled(workspaceId);
    return runInTransaction(async () => {
      const note = await this.findNote(managerAccountId, noteDate, workspaceId);
      if (!note) throw new HttpError(404, "Note not found");
      const receipt = (await db.select().from(dailyNoteTaskRefs).where(and(eq(dailyNoteTaskRefs.workspaceId, workspaceId), eq(dailyNoteTaskRefs.managerAccountId, managerAccountId), eq(dailyNoteTaskRefs.requestId, input.requestId))).limit(1))[0];
      if (receipt) {
        const existing = await this.taskKeys.resolveTask(workspaceId, receipt.taskKey);
        if (receipt.relation !== "created_from" || existing.title !== input.title.trim() || existing.developer?.accountId !== input.developerAccountId) throw new HttpError(409, "requestId was already used with a different payload");
        return existing;
      }
      const actor = { type: "manager" as const, accountId: managerAccountId };
      const created = input.developerAccountId
        ? await this.tracker.addItem(input.developerAccountId, todayIsoDate(), { title: input.title, jiraKey: input.jiraKey, source: "note", actor }, workspaceId)
        : await this.managerDesk.createItem(managerAccountId, { date: todayIsoDate(), title: input.title, status: "inbox", source: "note", actor }, workspaceId);
      const key = created.taskKey;
      if (!key) throw new Error("Task key was not allocated");
      if (input.context?.trim()) await this.eventsService.append({ workspaceId, taskKey: key, type: "update", body: input.context, meta: { via: "notes_page" }, visibility: "private" }, actor);
      await db.insert(dailyNoteTaskRefs).values({ workspaceId, managerAccountId, noteId: note.id, taskKey: key, relation: "created_from", requestId: input.requestId, createdAt: nowIso() });
      await this.eventsService.append({ workspaceId, taskKey: key, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "created_from" } }, { type: "system", accountId: managerAccountId });
      return this.taskKeys.resolveTask(workspaceId, key);
    });
  }

  async createFollowUp(
    managerAccountId: string,
    noteDate: string,
    input: CreateDailyNoteFollowUpPayload,
    workspaceId: string
  ): Promise<DailyNoteFollowUp> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const key = `${normalizedWorkspaceId}:${managerAccountId}:${input.requestId}`;
    const previous = this.followUpOperations.get(key) ?? Promise.resolve();
    const operation = previous.then(() =>
      this.createFollowUpInternal(managerAccountId, noteDate, input, normalizedWorkspaceId)
    );
    const tracked = operation.then(
      () => undefined,
      () => undefined
    );
    this.followUpOperations.set(key, tracked);
    try {
      return await operation;
    } finally {
      if (this.followUpOperations.get(key) === tracked) {
        this.followUpOperations.delete(key);
      }
    }
  }

  async getSources(
    managerAccountId: string,
    itemIds: number[],
    workspaceId: string
  ): Promise<DailyNoteSourcesResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const ids = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) {
      return { sources: [] };
    }

    const rows = await db
      .select({
        itemId: dailyNoteFollowUps.itemId,
        noteId: dailyNoteFollowUps.noteId,
        date: dailyNotes.date,
      })
      .from(dailyNoteFollowUps)
      .innerJoin(dailyNotes, eq(dailyNoteFollowUps.noteId, dailyNotes.id))
      .where(
        and(
          eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
          eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
          eq(dailyNotes.workspaceId, normalizedWorkspaceId),
          eq(dailyNotes.managerAccountId, managerAccountId),
          inArray(dailyNoteFollowUps.itemId, ids)
        )
      )
      .orderBy(dailyNoteFollowUps.itemId);

    return {
      sources: rows.map((row) => ({ itemId: row.itemId, noteId: row.noteId, date: row.date })),
    };
  }

  private async createFollowUpInternal(
    managerAccountId: string,
    noteDate: string,
    input: CreateDailyNoteFollowUpPayload,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteFollowUp> {
    const note = await this.findNote(managerAccountId, noteDate, normalizedWorkspaceId);
    if (!note) {
      throw new HttpError(404, "Note not found");
    }

    const title = input.title.trim();
    const payloadHash = hashPayload({
      route: "follow-up",
      noteDate,
      date: input.date,
      title,
      followUpAt: input.followUpAt,
    });

    return runInTransaction(async () => {
      const receiptRows = await db
        .select()
        .from(dailyNoteFollowUps)
        .where(
          and(
            eq(dailyNoteFollowUps.workspaceId, normalizedWorkspaceId),
            eq(dailyNoteFollowUps.managerAccountId, managerAccountId),
            eq(dailyNoteFollowUps.requestId, input.requestId)
          )
        )
        .limit(1);
      const receipt = receiptRows[0];

      if (receipt) {
        if (receipt.payloadHash !== payloadHash) {
          throw new HttpError(409, "requestId was already used with a different payload");
        }
        const existing = await this.findFollowUp(managerAccountId, receipt.itemId, normalizedWorkspaceId);
        if (existing) {
          return existing;
        }
        await db.delete(dailyNoteFollowUps).where(eq(dailyNoteFollowUps.id, receipt.id));
      }

      const item = await this.managerDesk.createItem(managerAccountId, {
        date: input.date,
        title,
        kind: "action",
        category: "follow_up",
        status: "planned",
        priority: "medium",
        followUpAt: input.followUpAt,
        source: "note",
        actor: { type: "manager", accountId: managerAccountId },
      }, normalizedWorkspaceId);

      await db.insert(dailyNoteFollowUps).values({
        workspaceId: normalizedWorkspaceId,
        managerAccountId,
        noteId: note.id,
        itemId: item.id,
        requestId: input.requestId,
        payloadHash,
        createdAt: nowIso(),
      });
      if (item.taskKey) {
        await db.insert(dailyNoteTaskRefs).values({ workspaceId: normalizedWorkspaceId, managerAccountId, noteId: note.id, taskKey: item.taskKey, relation: "created_from", createdAt: nowIso() }).onConflictDoNothing();
        await this.eventsService.append({ workspaceId: normalizedWorkspaceId, taskKey: item.taskKey, type: "note_ref", body: null, meta: { noteId: note.id, noteDate, relation: "created_from" } }, { type: "system", accountId: managerAccountId });
      }

      return {
        itemId: item.id,
        date: input.date,
        title: item.title,
        status: item.status,
        followUpAt: item.followUpAt,
      };
    });
  }

  private async findFollowUp(
    managerAccountId: string,
    itemId: number,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteFollowUp | undefined> {
    const rows = await db
      .select({
        itemId: managerDeskItems.id,
        date: managerDeskDays.date,
        title: managerDeskItems.title,
        status: managerDeskItems.status,
        followUpAt: managerDeskItems.followUpAt,
      })
      .from(managerDeskItems)
      .innerJoin(managerDeskDays, eq(managerDeskItems.dayId, managerDeskDays.id))
      .where(
        and(
          eq(managerDeskItems.id, itemId),
          eq(managerDeskItems.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.workspaceId, normalizedWorkspaceId),
          eq(managerDeskDays.managerAccountId, managerAccountId)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      itemId: row.itemId,
      date: row.date,
      title: row.title,
      status: row.status as ManagerDeskStatus,
      followUpAt: row.followUpAt ?? undefined,
    };
  }

  private async findNote(
    managerAccountId: string,
    date: string,
    normalizedWorkspaceId: string
  ): Promise<DailyNoteRow | undefined> {
    const rows = await db
      .select()
      .from(dailyNotes)
      .where(
        and(
          eq(dailyNotes.workspaceId, normalizedWorkspaceId),
          eq(dailyNotes.managerAccountId, managerAccountId),
          eq(dailyNotes.date, date)
        )
      )
      .limit(1);
    return rows[0];
  }
}
