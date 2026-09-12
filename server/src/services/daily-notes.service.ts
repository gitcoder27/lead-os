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
  managerDeskDays,
  managerDeskItems,
} from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { ManagerDeskService } from "./manager-desk.service";
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

  constructor(private readonly managerDesk = new ManagerDeskService()) {}

  async list(
    managerAccountId: string,
    query: { q?: string; before?: string; limit?: number },
    workspaceId: string
  ): Promise<DailyNotesResponse> {
    assertScope(managerAccountId, workspaceId);
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
    const trimmedQuery = query.q?.trim();

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

    const rows = await db
      .select()
      .from(dailyNotes)
      .where(and(...conditions))
      .orderBy(desc(dailyNotes.date))
      .limit(limit + 1);

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

    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
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

    return this.getDay(managerAccountId, date, normalizedWorkspaceId);
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
