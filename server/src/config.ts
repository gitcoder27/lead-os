import { INSTALL_WORKSPACE_ID } from "./workspace-scope";
import { z } from "zod";
import { getJiraApiToken, hasJiraApiToken } from "./runtime-credentials";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().min(1).optional(),
  JIRA_SYNC_JQL: z.string().min(1).optional(),
  JIRA_DEV_DUE_DATE_FIELD: z.string().default(''),
  JIRA_ASPEN_SEVERITY_FIELD: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = parsed.data;

export function hasJiraCredentials(): boolean {
  const hasToken = Boolean(config.JIRA_API_TOKEN || hasJiraApiToken(INSTALL_WORKSPACE_ID));
  return Boolean(config.JIRA_BASE_URL && config.JIRA_EMAIL && hasToken && config.JIRA_PROJECT_KEY);
}
