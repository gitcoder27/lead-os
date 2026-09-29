import { configTable } from "../../src/db/schema";
import { db } from "./db";

/**
 * docs/56 P2-03: a complete (fake) Jira connection in config, so `isJiraConfigured`
 * is true. Nothing here ever reaches Jira; sync is always mocked in tests.
 */
export async function configureJira(workspaceId = "default"): Promise<void> {
  const rows = [
    { key: "jira_base_url", value: "https://tenant.atlassian.net" },
    { key: "jira_email", value: "ops@example.com" },
    { key: "jira_project_key", value: "AM" },
    { key: "jira_api_token", value: "token" },
  ].map((row) => ({ workspaceId, ...row }));
  await db.insert(configTable).values(rows).onConflictDoNothing();
}
