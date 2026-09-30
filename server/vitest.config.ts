import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Each run gets its own test database. With one fixed `data/dashboard.test.db`, two runs at the
// same time (another terminal or agent session on this checkout) locked and reset each other's
// tables mid-file, which showed up as random failures. Files in one run still share it and run
// one at a time. `tests/global-setup.ts` removes the directory when the run ends.
const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "lead-os-server-tests-"));
process.env.LEAD_OS_TEST_DB_DIR = testDbDir;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "../shared/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DASHBOARD_DB_PATH: path.join(testDbDir, "dashboard.test.db"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/services/**/*.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
