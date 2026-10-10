import { eq } from "drizzle-orm";
import { db } from "./connection";
import { configTable, workspaces } from "./schema";

/** Legacy DDL and triggers affect the whole installation, even when the CLI names one workspace. */
export function taskInstallReadiness(target: string, operation: "cutover" | "contract" | "drop") {
  const allowed = operation === "cutover" ? ["2b", "2c", "2d"] : operation === "contract" ? ["2c", "2d"] : ["2d"];
  const blocked = db.select({ id: workspaces.id }).from(workspaces).all().filter(({ id }) => {
    if (id === target) return false;
    const rows = db.select().from(configTable).where(eq(configTable.workspaceId, id)).all();
    const setting = (key: string) => rows.find(row => row.key === key)?.value;
    if (setting("tasks_canonical_from_start_at")) return false;
    const stage = setting("tasks_phase2_stage") ?? "";
    if (!allowed.includes(stage)) return true;
    if (operation === "cutover" || (operation === "contract" && stage === "2d")) return false;
    const since = Date.parse(setting(operation === "contract" ? "tasks_phase2c_completed_at" : "tasks_phase2_contracted_at") ?? "");
    return !Number.isFinite(since) || Date.now() - since < (operation === "contract" ? 14 : 30) * 86400000;
  });
  return { name: "all_workspaces", ok: blocked.length === 0, detail: blocked.length ? `Other workspaces are not ready for install-wide ${operation}: ${blocked.map(row => row.id).join(", ")}` : "All workspaces qualify for the install-wide operation" };
}
