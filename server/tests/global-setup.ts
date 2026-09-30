import fs from "node:fs";

/** Removes this run's temporary test database directory (created in vitest.config.ts). */
export default function setup(): () => void {
  return () => {
    const dir = process.env.LEAD_OS_TEST_DB_DIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };
}
