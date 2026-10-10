/** Install-wide callers must declare their scope, including under the isolation harness. */
export const INSTALL_WORKSPACE_ID = "default";
export const DEFAULT_WORKSPACE_ID = INSTALL_WORKSPACE_ID;

export function normalizeWorkspaceId(workspaceId?: string | null): string {
  const normalized = workspaceId?.trim();
  if (normalized) return normalized;
  if (process.env.LEADOS_STRICT_WORKSPACE === "1") {
    throw new Error("Explicit workspace scope required");
  }
  return DEFAULT_WORKSPACE_ID;
}
