import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { sanitizeBackupCopy, withBackupSanitization } from "../src/services/backup-sanitizer";

it("serializes rewrites across callers and releases the slot after rejection", async () => {
  let running = 0;
  let maximum = 0;
  const job = async (fail: boolean) => {
    running++;
    maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    if (fail) throw new Error("bad copy");
    return true;
  };
  const results = await Promise.allSettled([withBackupSanitization(() => job(true)), withBackupSanitization(() => job(false)), withBackupSanitization(() => job(false))]);
  expect(maximum).toBe(1);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
});
it("sanitizes off the HTTP thread, removes session bytes and keeps snapshot data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lead-os-sanitizer-test-"));
  const filename = path.join(directory, "copy.db");
  try {
    const copy = new Database(filename);
    copy.exec("CREATE TABLE app_sessions(id TEXT); CREATE TABLE retained(value TEXT)");
    copy.prepare("INSERT INTO app_sessions VALUES (?)").run("session-secret-marker");
    copy.prepare("INSERT INTO retained VALUES (?)").run("kept");
    copy.close();
    const exec = vi.spyOn(Database.prototype, "exec");
    let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 1);
    try { await sanitizeBackupCopy(filename); }
    finally { clearInterval(timer); }
    expect(heartbeats).toBeGreaterThan(0);
    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
    expect((await fs.readFile(filename)).includes(Buffer.from("session-secret-marker"))).toBe(false);
    const result = new Database(filename, { readonly: true });
    try {
      expect(result.prepare("SELECT COUNT(*) AS count FROM app_sessions").get()).toEqual({ count: 0 });
      expect(result.prepare("SELECT value FROM retained").get()).toEqual({ value: "kept" });
    } finally { result.close(); }
    await fs.writeFile(path.join(directory, "corrupt.db"), "invalid");
    await expect(sanitizeBackupCopy(path.join(directory, "corrupt.db"))).rejects.toThrow();
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
