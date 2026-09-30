import path from "node:path";
import { getDbPath } from "../../src/db/paths";

/**
 * A path inside this run's private test directory (next to its test database, see vitest.config.ts),
 * so concurrent runs never share backup folders or other scratch files.
 */
export function runScratchPath(name: string): string {
  return path.join(path.dirname(getDbPath()), name);
}
