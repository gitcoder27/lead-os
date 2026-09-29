import { configTable } from "../../src/db/schema";
import { ATTENTION_RULE_KEYS } from "../../src/services/settings.service";
import { db } from "./db";

/**
 * docs/56 P1-05: working-hours rules follow the workspace zone, which defaults
 * to the machine's. Fixtures written as UTC instants pin it so they read the
 * same on any machine.
 */
export async function pinAttentionTimeZone(timeZone = "UTC", workspaceId = "default"): Promise<void> {
  await db
    .insert(configTable)
    .values({ workspaceId, key: ATTENTION_RULE_KEYS.timeZone, value: timeZone })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: timeZone } });
}
