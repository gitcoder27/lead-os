import "../load-env";
import path from "node:path";
import { BackupService } from "../services/backup.service";
import { TaskContractService } from "../services/task-contract.service";

/**
 * Phase 2d contract command (§2.3.2). Dry-run by default; `--apply` takes a
 * `pre-task-contract` backup, then in one transaction drops the legacy
 * read-only triggers, renames the frozen task tables to `legacy_*`, records
 * the `p2_contract` marker, sets `tasks_phase2_stage = "2d"`, and contracts
 * `task_events.task_id` to NOT NULL.
 *
 *   npm run tasks:contract --workspace=server -- --workspace default            # plan
 *   npm run tasks:contract --workspace=server -- --workspace default --apply    # backup + apply
 *
 * Prerequisites (all enforced, refusing with the failing checks listed):
 * stage "2c", `tasks_phase2c_completed_at` older than two weeks, a clean
 * structural verification, and no adapter callers / legacy-table route
 * consumers in the server source tree.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let workspace = "default";
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--apply") apply = true;
    else if (args[index] !== "--dry-run") throw new Error(`Unknown argument: ${args[index]}`);
  }
  const service = new TaskContractService();
  const serverSrcDir = path.resolve(__dirname, "..");
  if (!apply) {
    const plan = await service.plan(workspace, { serverSrcDir });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (!plan.ok) process.exitCode = 1;
    return;
  }
  const backup = await new BackupService().createManualBackup("pre-task-contract");
  const result = await service.apply(workspace, { serverSrcDir });
  process.stdout.write(`${JSON.stringify({ backup: backup.path ?? backup, ...result }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
