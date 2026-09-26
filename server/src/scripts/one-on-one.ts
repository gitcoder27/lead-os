import "../load-env";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { OneOnOneService } from "../services/one-on-one.service";

/**
 * docs/48 §0: `one_on_one_enabled` flag command — CLI-only toggle with no
 * task-stage prerequisite. Enabling flips the flag only; the 1:1 tables are
 * created by the additive migration, and disabling leaves data in place while
 * the routes return 404 and the UI hides.
 *
 *   npm run one-on-one --workspace=server -- --workspace default --status
 *   npm run one-on-one --workspace=server -- --workspace default --enable
 *   npm run one-on-one --workspace=server -- --workspace default --disable
 */
async function main(): Promise<void> {
  // Idempotent — mirrors server startup so the toggle works before the dev
  // server has applied the migration.
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
  const service = new OneOnOneService();
  if (enable === disable) {
    if (!enable) {
      process.stdout.write(`${JSON.stringify({
        workspace,
        oneOnOneEnabled: await service.enabled(workspace),
      }, null, 2)}\n`);
      return;
    }
    throw new Error("Pass exactly one of --enable or --disable");
  }
  await service.setEnabled(workspace, enable);
  process.stdout.write(`${JSON.stringify({
    workspace,
    oneOnOneEnabled: enable,
  }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
