import "../load-env";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { WorkspacePurgeService } from "../services/workspace-purge.service";
async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const workspace = value("--workspace");
  if (!workspace) throw new Error("Use --workspace <id> [--confirm <id> --apply]. Dry run is the default.");
  if (args.includes("--apply") && value("--confirm") !== workspace) throw new Error("--confirm must match --workspace exactly before applying");
  migrate(rawDb);
  const service = new WorkspacePurgeService();
  const result = args.includes("--apply") ? await service.purge(workspace, value("--confirm")!) : { ...service.preview(workspace), applied: false };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Workspace deletion failed"}\n`); process.exitCode = 1; });
