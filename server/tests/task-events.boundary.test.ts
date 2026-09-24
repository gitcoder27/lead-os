import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const allowed = new Set(["db/migrate.ts", "db/schema.ts", "services/task-events.service.ts", "scripts/task-phase2-backfill.ts"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith(".ts") ? [file] : [];
  });
}

describe("task event table boundary", () => {
  it("has a single service owning all task event reads and writes", () => {
    const violations = sourceFiles(root).filter((file) => {
      const relative = path.relative(root, file).replaceAll(path.sep, "/");
      return !allowed.has(relative) && /\btaskEvents\b|\btask_events\b/.test(readFileSync(file, "utf8"));
    });
    expect(violations).toEqual([]);
  });
});
