import "../load-env";
import { writeFile } from "node:fs/promises";
import { BackupService } from "../services/backup.service";
import { TaskPhase1MigrationService } from "../services/task-phase1-migration.service";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let apply = false;
  let workspace: string | undefined;
  let reportPath: string | undefined;
  const forceSteps: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--workspace" && args[i + 1]) workspace = args[++i];
    else if (arg === "--report" && args[i + 1]) reportPath = args[++i];
    else if (arg === "--force-step" && args[i + 1] && ["p1_assign_task_keys", "p1_import_task_notes"].includes(args[i + 1]!)) forceSteps.push(args[++i]!);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const service = new TaskPhase1MigrationService();
  const workspaces = workspace ? [workspace] : await service.workspaceIds();
  if (apply) await new BackupService().createManualBackup("pre-task-phase1");
  const reports = [];
  for (const id of workspaces) reports.push(await service.migrate(id, apply, forceSteps));
  const output = JSON.stringify({ applied: apply, workspaces: reports }, null, 2);
  process.stdout.write(`${output}\n`);
  if (reportPath) await writeFile(reportPath, output, { encoding: "utf8", flag: "w" });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
