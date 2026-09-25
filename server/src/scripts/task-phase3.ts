import "../load-env";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { TaskKeysService } from "../services/task-keys.service";
import { TaskLabelsService } from "../services/task-labels.service";

/**
 * Phase 3 flag command (P3 §0): `tasks_phase3_enabled` is CLI-only and refuses
 * unless the workspace is at stage `2c`/`2d`. Enabling seeds `task_labels`
 * from existing `tasks.labels_json` values; disabling just flips the flag —
 * no data changes, and the Phase 2 UI returns.
 *
 *   npm run tasks:phase3 --workspace=server -- --workspace default --status
 *   npm run tasks:phase3 --workspace=server -- --workspace default --enable
 *   npm run tasks:phase3 --workspace=server -- --workspace default --disable
 */
async function main(): Promise<void> {
  // Idempotent — mirrors server startup so the flag can be toggled before the
  // dev server has restarted and applied the task_labels migration.
  migrate(rawDb);
  const args = process.argv.slice(2);
  let workspace = "default";
  let enable = false;
  let disable = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--enable") enable = true;
    else if (args[index] === "--disable") disable = true;
    else if (args[index] !== "--status") throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (enable === disable) {
    if (!enable) {
      // --status (or bare invocation): report state.
      const keys = new TaskKeysService();
      process.stdout.write(`${JSON.stringify({
        workspace,
        stage: (await keys.stage(workspace)) ?? null,
        tasksPhase3Enabled: await keys.phase3Enabled(workspace),
      }, null, 2)}\n`);
      return;
    }
    throw new Error("Pass exactly one of --enable or --disable");
  }
  const keys = new TaskKeysService();
  await keys.setPhase3Enabled(workspace, enable);
  let seeded: number | undefined;
  if (enable) {
    // P3 §3.3: existing label strings are seeded idempotently on enable.
    seeded = await new TaskLabelsService().seedFromTasks(workspace);
  }
  process.stdout.write(`${JSON.stringify({
    workspace,
    tasksPhase3Enabled: enable,
    stage: await keys.stage(workspace),
    ...(seeded !== undefined && { labelNamesSeeded: seeded }),
  }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
