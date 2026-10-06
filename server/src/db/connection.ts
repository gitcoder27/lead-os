import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDbPath } from "./paths";

const dbPath = getDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
// Team picker search follows JavaScript Unicode case folding, including literal %/_ terms.
sqlite.function("lead_os_lower", { deterministic: true }, (value: unknown) => typeof value === "string" ? value.toLowerCase() : null);

export const rawDb = sqlite;
export const db = drizzle(sqlite);
