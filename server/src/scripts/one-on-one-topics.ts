import "../load-env";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { OneOnOneTopicCleanupService } from "../services/one-on-one-topic-cleanup.service";

/**
 * docs/56 P0-S5: find 1:1 topics that were created as developer-owned tasks
 * (visible to the developer) and move the ones you pick to manager ownership.
 * Dry run by default; nothing is reassigned automatically.
 *
 *   npm run one-on-one:topics --workspace=server -- --workspace default
 *   npm run one-on-one:topics --workspace=server -- --workspace default --keys T-12,T-15
 *   npm run one-on-one:topics --workspace=server -- --workspace default --keys T-12,T-15 --apply
 */
async function main(): Promise<void> {
  migrate(rawDb);
  const args = process.argv.slice(2);
  let workspace = "default";
  let keys: string[] = [];
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--keys" && args[index + 1]) keys = args[++index]!.split(",").map((key) => key.trim()).filter(Boolean);
    else if (args[index] === "--apply") apply = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (apply && !keys.length) throw new Error("--apply needs --keys: pick which topics to move");

  const service = new OneOnOneTopicCleanupService();
  if (!apply) {
    const candidates = await service.listCandidates(workspace);
    process.stdout.write(`${JSON.stringify({ workspace, dryRun: true, candidates: keys.length ? candidates.filter((entry) => keys.map((key) => key.toUpperCase()).includes(entry.taskKey)) : candidates }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ workspace, dryRun: false, ...(await service.moveToManager(keys, workspace)) }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
