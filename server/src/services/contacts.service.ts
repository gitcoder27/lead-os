import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Contact, CreateContactRequest } from "shared/types";
import { db } from "../db/connection";
import { contacts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";

type ContactRow = typeof contacts.$inferSelect;

/** Same characters capture's `@ident` accepts (shared/capture-grammar PERSON_REF). */
const HANDLE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export const createContactSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().toLowerCase().regex(HANDLE, "Handle may use letters, digits, '.', '_', ':' and '-'").optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

/** "Acme Legal" → "acme-legal". */
export function contactHandleFrom(displayName: string): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 60);
  return slug || "contact";
}

/** The SQLite unique-index error, raw or wrapped by the query builder (as `cause`). */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; typeof current === "object" && current !== null; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

function toContact(row: ContactRow): Contact {
  return { id: row.id, displayName: row.displayName, handle: row.handle, note: row.note, createdAt: row.createdAt };
}

/**
 * docs/57 §2 (P3-03): external stakeholders a manager waits on. Contacts are
 * private to the owning manager (every query is keyed on managerAccountId) and
 * never become logins or task owners.
 */
export class ContactsService {
  async list(managerAccountId: string, workspaceId?: string): Promise<Contact[]> {
    const rows = await db.select().from(contacts).where(and(
      eq(contacts.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(contacts.managerAccountId, managerAccountId),
      isNull(contacts.archivedAt),
    )).orderBy(asc(contacts.displayName), asc(contacts.id));
    return rows.map(toContact);
  }

  async get(managerAccountId: string, id: number, workspaceId?: string): Promise<Contact | undefined> {
    const row = (await db.select().from(contacts).where(and(
      eq(contacts.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(contacts.managerAccountId, managerAccountId),
      eq(contacts.id, id),
      isNull(contacts.archivedAt),
    )).limit(1))[0];
    return row ? toContact(row) : undefined;
  }

  /**
   * An explicit handle must be free (409); a derived one gets a numeric suffix
   * until it is unique for this manager. If another create takes the same handle
   * first, the unique index answers: 409 for an explicit handle, the next suffix
   * for a derived one (never a 500).
   */
  async create(managerAccountId: string, input: CreateContactRequest, workspaceId?: string): Promise<Contact> {
    const parsed = createContactSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
    const scope = normalizeWorkspaceId(workspaceId);
    const explicit = parsed.data.handle;
    const base = explicit ?? contactHandleFrom(parsed.data.displayName);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const taken = new Set((await db.select({ handle: contacts.handle }).from(contacts).where(and(
        eq(contacts.workspaceId, scope),
        eq(contacts.managerAccountId, managerAccountId),
      ))).map((row) => row.handle));
      let handle = base;
      if (explicit) {
        if (taken.has(handle)) throw new HttpError(409, `A contact with handle @${handle} already exists`);
      } else {
        for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
      }
      try {
        const [row] = await db.insert(contacts).values({
          workspaceId: scope,
          managerAccountId,
          displayName: parsed.data.displayName,
          handle,
          note: parsed.data.note ?? null,
          createdAt: new Date().toISOString(),
        }).returning();
        return toContact(row!);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (explicit) throw new HttpError(409, `A contact with handle @${handle} already exists`);
      }
    }
    throw new HttpError(409, `Could not find a free handle for ${parsed.data.displayName}; pick one`);
  }

  /**
   * Archiving frees the handle for a new contact: the row keeps a `~<id>` suffix, which no valid
   * handle can contain, so capture never resolves it and the unique index stays satisfied.
   */
  async archive(managerAccountId: string, id: number, workspaceId?: string): Promise<void> {
    const existing = await this.get(managerAccountId, id, workspaceId);
    if (!existing) throw new HttpError(404, "Contact not found");
    await db.update(contacts).set({ archivedAt: new Date().toISOString(), handle: `${existing.handle}~${id}` }).where(eq(contacts.id, id));
  }
}
