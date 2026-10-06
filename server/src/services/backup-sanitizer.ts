import { Worker } from "node:worker_threads";

// One CPU/disk rewrite across all BackupService instances. Waiting downloads
// acquire the slot before allocating or copying their temporary snapshot.
let active = false;
const waiting: Array<() => void> = [];
export async function withBackupSanitization<T>(operation: () => Promise<T>): Promise<T> {
  if (active) await new Promise<void>((resolve) => waiting.push(resolve));
  else active = true;
  try { return await operation(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}

// Plain CommonJS runs in both tsx development and compiled production without
// a TS loader or a separate worker asset. Native SQLite stays on this thread.
const SOURCE = `
const { workerData } = require('node:worker_threads');
const Database = require(workerData.sqliteModule);
const copy = new Database(workerData.path, { fileMustExist: true });
try {
  copy.pragma('journal_mode = DELETE');
  if (copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_sessions'").get()) {
    copy.exec('DELETE FROM app_sessions');
  }
  copy.exec('VACUUM');
} finally { copy.close(); }
`;

export function sanitizeBackupCopy(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SOURCE, { eval: true, workerData: { path, sqliteModule: require.resolve("better-sqlite3") } });
    let failure: Error | undefined;
    const timeout = setTimeout(() => {
      failure = new Error("Backup sanitization timed out");
      void worker.terminate();
    }, 300_000);
    worker.once("error", (error) => { failure = error; });
    // Wait for exit before releasing the slot or removing a file the worker
    // might still hold. Nonzero exits, native errors and timeout all reject.
    worker.once("exit", (code) => {
      clearTimeout(timeout);
      if (failure || code !== 0) reject(failure ?? new Error(`Backup sanitization worker exited with ${code}`));
      else resolve();
    });
  });
}
