import "../load-env";
import { TaskLegacyDropService } from "../services/task-legacy-drop.service";

/**
 * Phase 3f legacy-table drop (§8.2). Dry-run by default; `--apply` takes a
 * `pre-legacy-drop` backup, then in one transaction drops the three
 * `legacy_*` archive tables and records a `p3_legacy_drop` marker.
 *
 *   npm run tasks:drop-legacy --workspace=server -- --workspace default            # plan
 *   npm run tasks:drop-legacy --workspace=server -- --workspace default --apply    # backup + drop
 *
 * Prerequisites (all enforced, refusing with the failing checks listed):
 * stage "2d", a `p2_contract` marker, and `tasks_phase2_contracted_at` at
 * least 30 days old. Repeat application reports `alreadyApplied` instead of
 * re-dropping.
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
  const service = new TaskLegacyDropService();
  if (!apply) {
    const plan = await service.plan(workspace);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (!plan.ok) process.exitCode = 1;
    return;
  }
  const result = await service.apply(workspace);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.applied && !result.alreadyApplied) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
