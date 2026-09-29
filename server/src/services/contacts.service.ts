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
   * until it is unique for this manager.
   */
  async create(managerAccountId: string, input: CreateContactRequest, workspaceId?: string): Promise<Contact> {
    const parsed = createContactSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
    const scope = normalizeWorkspaceId(workspaceId);
    const taken = new Set((await db.select({ handle: contacts.handle }).from(contacts).where(and(
      eq(contacts.workspaceId, scope),
      eq(contacts.managerAccountId, managerAccountId),
    ))).map((row) => row.handle));
    let handle = parsed.data.handle;
    if (handle) {
      if (taken.has(handle)) throw new HttpError(409, `A contact with handle @${handle} already exists`);
    } else {
      const base = contactHandleFrom(parsed.data.displayName);
      handle = base;
      for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
    }
    const [row] = await db.insert(contacts).values({
      workspaceId: scope,
      managerAccountId,
      displayName: parsed.data.displayName,
      handle,
      note: parsed.data.note ?? null,
      createdAt: new Date().toISOString(),
    }).returning();
    return toContact(row!);
  }

  async archive(managerAccountId: string, id: number, workspaceId?: string): Promise<void> {
    const existing = await this.get(managerAccountId, id, workspaceId);
    if (!existing) throw new HttpError(404, "Contact not found");
    await db.update(contacts).set({ archivedAt: new Date().toISOString() }).where(eq(contacts.id, id));
  }
}
