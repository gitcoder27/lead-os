import fs from "node:fs";
import Database from "better-sqlite3";
import { rawDb } from "../db/connection";
import { deleteWorkspaceRows, workspacePurgeCounts } from "../db/workspace-purge";
import { HttpError } from "../middleware/errorHandler";
import { INSTALL_WORKSPACE_ID } from "../workspace-scope";
import { BackupService } from "./backup.service";

/** Host-operator CLI only. There is deliberately no HTTP workspace deletion route. */
export class WorkspacePurgeService {
  constructor(private readonly backups: Pick<BackupService, "createManualBackup"> = new BackupService(), private readonly database = rawDb) {}
  preview(workspace: string) {
    if (!workspace.trim() || workspace === INSTALL_WORKSPACE_ID) throw new HttpError(403, "The default workspace cannot be deleted");
    if (!this.database.prepare("SELECT id FROM workspaces WHERE id=?").get(workspace)) throw new HttpError(404, "Workspace not found");
    return { workspaceId: workspace, counts: workspacePurgeCounts(this.database, workspace), retained: "Existing snapshots and off-box copies retain this data until they are removed or expire." };
  }
  async purge(workspace: string, confirmation: string) {
    this.preview(workspace);
    if (confirmation !== workspace) throw new HttpError(400, "Confirmation must match the workspace id exactly");
    const backup = await this.backups.createManualBackup("pre-workspace-purge");
    if (!backup?.path || !fs.existsSync(backup.path)) throw new HttpError(409, "A verified backup is required before deleting a workspace");
    const copy = new Database(backup.path, { readonly: true, fileMustExist: true });
    try {
      if ((copy.pragma("quick_check", { simple: true })) !== "ok" || !copy.prepare("SELECT id FROM workspaces WHERE id=?").get(workspace)) throw new HttpError(409, "Backup verification failed; workspace was preserved");
    } finally { copy.close(); }
    const preview = this.database.transaction(() => {
      const current = this.preview(workspace);
      deleteWorkspaceRows(this.database, workspace);
      if (Object.values(workspacePurgeCounts(this.database, workspace)).some(count => count !== 0)) throw new HttpError(409, "Workspace deletion verification failed");
      return current;
    })();
    return { ...preview, applied: true, backup: backup.path };
  }
}
