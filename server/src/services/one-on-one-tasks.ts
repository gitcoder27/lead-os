import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { oneOnOneAgendaItems } from "../db/schema";
import { normalizeWorkspaceId } from "./workspace.service";

/**
 * docs/59 §4, §10: 1:1 agenda topics and session action items are ordinary manager-owned tasks,
 * and the only reliable marker is a row in `one_on_one_agenda_items` (the `one_on_one` source lives
 * on a creation event, which tasks attached later do not have). Everything that leaves the weekly
 * review (the sections, the update, the CSV, the digest) drops these task ids. Read it once per
 * request; it is data-based, so it applies whether or not the 1:1 workspace is switched on.
 */
export async function oneOnOneTaskIds(workspaceId?: string): Promise<Set<number>> {
  const rows = await db
    .select({ taskId: oneOnOneAgendaItems.taskId })
    .from(oneOnOneAgendaItems)
    .where(eq(oneOnOneAgendaItems.workspaceId, normalizeWorkspaceId(workspaceId)));
  return new Set(rows.map((row) => row.taskId));
}
