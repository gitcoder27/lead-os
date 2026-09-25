import "../load-env";
import { BackupService } from "../services/backup.service";
import { TaskCutoverService } from "../services/task-cutover.service";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let workspace = "default";
  let apply = false;
  let verify = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--apply") apply = true;
    else if (args[index] === "--verify") verify = true;
    else if (args[index] !== "--dry-run") throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (verify && apply) throw new Error("Run verification separately from cutover");
  const service = new TaskCutoverService();
  if (apply) await new BackupService().createManualBackup("pre-task-cutover");
  const result = verify ? await service.verify(workspace) : await service.cutover(workspace, apply);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});