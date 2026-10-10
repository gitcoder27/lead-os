import "../load-env";

import { rawDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { AuthService } from "../services/auth.service";

function usage(): string {
  return [
    "Usage:",
    "  npm run auth:create-user --workspace=server -- --username <name> --password <password> --display-name <display> --role <admin|manager|developer> [--developer-account-id <accountId>] [--install-admin]",
    "",
    "Examples:",
    "  npm run auth:create-user --workspace=server -- --username admin --password secret123 --display-name \"App Admin\" --role admin",
    "  npm run auth:create-user --workspace=server -- --username lead --password secret123 --display-name \"Team Lead\" --role manager",
    "  npm run auth:create-user --workspace=server -- --username alice --password secret123 --display-name \"Alice Smith\" --role developer --developer-account-id dev-1",
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

async function main(): Promise<void> {
  migrate(rawDb);

  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    console.log(usage());
    return;
  }

  const username = args["username"];
  const password = args["password"];
  const displayName = args["display-name"];
  const role = args["role"];
  const developerAccountId = args["developer-account-id"];

  if (!username || !password || !displayName || !role) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (role !== "admin" && role !== "manager" && role !== "developer") {
    console.error("role must be 'admin', 'manager', or 'developer'");
    process.exitCode = 1;
    return;
  }

  if (role === "developer" && !developerAccountId) {
    console.error("developer-account-id is required for developer users");
    process.exitCode = 1;
    return;
  }

  const authService = new AuthService();
  const user = await authService.createUser({
    username,
    password,
    displayName,
    role,
    developerAccountId,
    isInstallAdmin: args["install-admin"] === "true",
  });

  console.log(
    JSON.stringify(
      {
        created: true,
        user,
      },
      null,
      2
    )
  );
}

void main();
