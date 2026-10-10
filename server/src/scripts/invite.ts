import "../load-env";
import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { config } from "../config";
import { RegistrationService } from "../services/registration.service";

function main(): void {
  const args = process.argv.slice(2);
  const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (args.filter(arg => ["--create", "--list", "--revoke"].includes(arg)).length !== 1) throw new Error("Use --create [--note <name>] [--expires-days <days>], --list, or --revoke <id>");
  if (args.includes("--create") && !config.LEADOS_PUBLIC_URL) throw new Error("Set LEADOS_PUBLIC_URL before creating an invite");
  migrate(rawDb);
  const service = new RegistrationService();
  if (args.includes("--list")) process.stdout.write(`${JSON.stringify(service.listInvites(), null, 2)}\n`);
  else if (args.includes("--revoke")) process.stdout.write(`${JSON.stringify(service.revokeInvite(Number(value("--revoke"))))}\n`);
  else {
    const { token, ...invite } = service.createInvite({ note: value("--note"), expiresDays: value("--expires-days") ? Number(value("--expires-days")) : undefined });
    const url = new URL("/join", config.LEADOS_PUBLIC_URL!); url.searchParams.set("invite", token);
    process.stdout.write(`${JSON.stringify({ ...invite, url: url.toString() }, null, 2)}\n`);
  }
}
try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Invite command failed"}\n`); process.exitCode = 1; }
