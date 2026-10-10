import type BetterSqlite3 from "better-sqlite3";
import { HttpError } from "../middleware/errorHandler";
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Names come exclusively from SQLite's schema; workspace values are always bound. */
export function workspacePurgeTables(sqlite: BetterSqlite3.Database) {
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(row => row.name);
  const scoped = tables.filter(name => (sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[]).some(column => column.name === "workspace_id"));
  const parents = new Map(scoped.map(name => [name, (sqlite.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all() as { table: string }[]).map(fk => fk.table).filter(parent => parent !== name)]));
  const order: string[] = []; const visiting = new Set<string>();
  const visit = (name: string) => {
    if (order.includes(name)) return;
    if (visiting.has(name)) throw new HttpError(409, "Workspace deletion requires a reviewed migration for cyclic table dependencies");
    visiting.add(name);
    for (const child of scoped) if (parents.get(child)!.includes(name)) visit(child);
    visiting.delete(name); order.push(name);
  };
  for (const name of scoped) visit(name);
  return order;
}
export function workspacePurgeCounts(sqlite: BetterSqlite3.Database, workspace: string) {
  const counts = Object.fromEntries(workspacePurgeTables(sqlite).map(table => [table, (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE workspace_id=?`).get(workspace) as { n: number }).n]));
  counts.assistant_messages = (sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_messages WHERE conversation_id IN (SELECT id FROM assistant_conversations WHERE workspace_id=?)").get(workspace) as { n: number }).n;
  counts.app_sessions = (sqlite.prepare("SELECT COUNT(*) AS n FROM app_sessions WHERE user_id IN (SELECT id FROM app_users WHERE workspace_id=?)").get(workspace) as { n: number }).n;
  counts.workspaces = (sqlite.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE id=?").get(workspace) as { n: number }).n;
  return counts;
}
export function deleteWorkspaceRows(sqlite: BetterSqlite3.Database, workspace: string): void {
  sqlite.prepare("DELETE FROM assistant_messages WHERE conversation_id IN (SELECT id FROM assistant_conversations WHERE workspace_id=?)").run(workspace);
  sqlite.prepare("DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM app_users WHERE workspace_id=?)").run(workspace);
  for (const table of workspacePurgeTables(sqlite)) sqlite.prepare(`DELETE FROM ${quote(table)} WHERE workspace_id=?`).run(workspace);
  sqlite.prepare("DELETE FROM workspaces WHERE id=?").run(workspace);
}
