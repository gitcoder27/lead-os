import "../load-env";
import { BackupService } from "../services/backup.service";
import { TaskPhase2ExportService } from "../services/task-phase2-export.service";
import { TaskPhase2BackfillService } from "../services/task-phase2-backfill.service";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let apply = false;
  let workspace: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--workspace" && args[i + 1]) workspace = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const service = new TaskPhase2ExportService();
  const workspaces = workspace ? [workspace] : await new TaskPhase2BackfillService().workspaceIds();
  if (apply) await new BackupService().createManualBackup("pre-task-export-legacy");
  for (const id of workspaces) {
    if (!apply) {
      const plan = await service.plan(id);
      process.stdout.write(`${JSON.stringify({ workspace: id, deskRows: plan.deskRows.length, trackerRows: plan.trackerRows.length, links: plan.linkRows.length }, null, 2)}\n`);
      continue;
    }
    const result = await service.apply(id);
    process.stdout.write(`${JSON.stringify({ workspace: id, applied: true, ...result }, null, 2)}\n`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
