import "../load-env";
import { TaskCutoverService } from "../services/task-cutover.service";

/**
 * Stage transitions between Phase 2 stages (§2.3.2).
 *
 *   npm run tasks:stage --workspace=server -- --workspace default --to 2c --dry-run
 *   npm run tasks:stage --workspace=server -- --workspace default --to 2c --apply
 *   npm run tasks:stage --workspace=server -- --workspace default --complete 2c --apply
 *
 * `--to 2c` requires stage "2b" plus the one-week post-cutover soak
 * (`tasks_phase2_cutover_at`). `--complete 2c` records
 * `tasks_phase2c_completed_at`, from which the two-week 2d soak is measured.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let workspace = "default";
  let apply = false;
  let to: string | undefined;
  let complete: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--to" && args[index + 1]) to = args[++index]!;
    else if (args[index] === "--complete" && args[index + 1]) complete = args[++index]!;
    else if (args[index] === "--apply") apply = true;
    else if (args[index] !== "--dry-run") throw new Error(`Unknown argument: ${args[index]}`);
  }
  const service = new TaskCutoverService();
  let result: unknown;
  if (to === "2c") {
    result = await service.advanceTo2c(workspace, apply);
  } else if (complete === "2c") {
    result = await service.complete2c(workspace, apply);
  } else {
    throw new Error("Specify --to 2c or --complete 2c");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
