import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "../shared/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DASHBOARD_DB_PATH: path.resolve(__dirname, "../data/dashboard.test.db"),
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
