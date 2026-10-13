import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ManagerActionCommandRequest, ManagerActionCommandResponse } from "shared/types";
import { db } from "../db/connection";
import { managerActionReceipts } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";

// Share overlapping attempts across service instances; SQLite keeps the receipt across restarts.
const pending = new Map<string, { hash: string; result: Promise<ManagerActionCommandResponse> }>();
const payloadHash = (request: ManagerActionCommandRequest) => createHash("sha256").update(JSON.stringify(request, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest("hex");
const conflict = () => new HttpError(409, "requestId was already used with a different payload. Close this dialog and start a new submission.");

export class ManagerActionReplayService {
  async run(managerAccountId: string, request: ManagerActionCommandRequest, workspaceId: string | undefined, apply: () => Promise<ManagerActionCommandResponse>) {
    const scope = normalizeWorkspaceId(workspaceId);
    const requestId = request.requestId!;
    const hash = payloadHash(request);
    const key = JSON.stringify([scope, managerAccountId, requestId]);
    const active = pending.get(key);
    if (active) {
      if (active.hash !== hash) throw conflict();
      return active.result;
    }
    const result = runInTransaction(async () => {
      const receipt = (await db.select().from(managerActionReceipts).where(and(
        eq(managerActionReceipts.workspaceId, scope), eq(managerActionReceipts.managerAccountId, managerAccountId), eq(managerActionReceipts.requestId, requestId),
      )).limit(1))[0];
      if (receipt) {
        if (receipt.payloadHash !== hash) throw conflict();
        return JSON.parse(receipt.responseJson) as ManagerActionCommandResponse;
      }
      const response = await apply();
      await db.insert(managerActionReceipts).values({ workspaceId: scope, managerAccountId, requestId, payloadHash: hash, responseJson: JSON.stringify(response), createdAt: new Date().toISOString() });
      return response;
    });
    pending.set(key, { hash, result });
    try { return await result; }
    finally { pending.delete(key); }
  }
}
