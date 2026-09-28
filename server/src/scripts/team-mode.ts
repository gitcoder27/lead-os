import "../load-env";
import { TEAM_MODES, type TeamMode } from "shared/types";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { SettingsService } from "../services/settings.service";

/**
 * docs/56 P1-01: workspace `team_mode` command — CLI toggle mirroring the
 * manager-only Settings control (`PUT /api/config/team-mode`).
 *
 *   npm run team-mode --workspace=server -- --workspace default --status
 *   npm run team-mode --workspace=server -- --workspace default --set solo
 *   npm run team-mode --workspace=server -- --workspace default --set collab
 */
async function main(): Promise<void> {
  // Idempotent — mirrors server startup so the toggle works before the dev
  // server has applied the migration.
  migrate(rawDb);
  const args = process.argv.slice(2);
  let workspace = "default";
  let next: TeamMode | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workspace" && args[index + 1]) workspace = args[++index]!;
    else if (args[index] === "--set" && args[index + 1]) {
      const value = args[++index]!;
      if (!(TEAM_MODES as readonly string[]).includes(value)) {
        throw new Error(`--set expects one of: ${TEAM_MODES.join(", ")}`);
      }
      next = value as TeamMode;
    } else if (args[index] !== "--status") throw new Error(`Unknown argument: ${args[index]}`);
  }
  const service = new SettingsService();
  const teamMode = next ? await service.setTeamMode(workspace, next) : await service.getTeamMode(workspace);
  process.stdout.write(`${JSON.stringify({ workspace, teamMode }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
