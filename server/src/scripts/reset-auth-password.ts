import "../load-env";

import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { AuthService } from "../services/auth.service";

function usage(): string {
  return [
    "Usage:",
    "  npm run auth:reset-password --workspace=server -- --username <name> --password <new-password>",
    "  printf '%s' \"$NEW_PASSWORD\" | npm run auth:reset-password --workspace=server -- --username <name> --password-stdin",
    "",
    "Sets a new password for an existing active account (manager, developer or admin) and signs it out everywhere.",
    "Prefer --password-stdin: a --password value is visible in shell history and process listings.",
    "The password is never printed.",
  ].join("\n");
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = value;
    i += 1;
  }

  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  // Drop only the trailing newline added by echo/heredocs; spaces may be part of the password.
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args["help"] === "true") {
    console.log(usage());
    return;
  }

  const username = args["username"];
  if (!username || username === "true") {
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (args["password"] !== undefined && args["password-stdin"] !== undefined) {
    console.error("Use either --password or --password-stdin, not both");
    process.exitCode = 1;
    return;
  }

  if (args["password"] !== undefined) {
    console.error("Warning: --password is visible in shell history and process listings; prefer --password-stdin.");
  }
  const password = args["password-stdin"] === "true" ? await readStdin() : args["password"];
  if (!password || password === "true") {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  migrate(rawDb);

  try {
    const result = await new AuthService().resetPassword(username, password, {
      allowedRoles: ["admin", "manager", "developer"],
    });
    console.log(JSON.stringify({ reset: true, ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Password reset failed");
    process.exitCode = 1;
  }
}

void main();
