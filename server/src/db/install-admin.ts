import type Database from "better-sqlite3";

/** Additive, one-time migration of the old default-workspace manager authority. */
export function migrateInstallAdmin(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const columns = sqlite.pragma("table_info(app_users)") as { name: string }[];
    if (!columns.some((column) => column.name === "is_install_admin")) {
      sqlite.exec("ALTER TABLE app_users ADD COLUMN is_install_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_install_admin IN (0, 1))");
    }
    if (sqlite.prepare("SELECT 1 FROM data_migrations WHERE name = 'install_admin_v1'").get()) return;
    const result = sqlite.prepare("UPDATE app_users SET is_install_admin = 1 WHERE workspace_id = 'default' AND role = 'manager' AND is_active = 1").run();
    sqlite.prepare("INSERT INTO data_migrations (name, applied_at, report_json) VALUES ('install_admin_v1', ?, ?)").run(new Date().toISOString(), JSON.stringify({ managersPreserved: result.changes }));
  })();
}
