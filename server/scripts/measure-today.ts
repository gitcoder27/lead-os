/**
 * One-off perf probe for docs/53 §8 move 3: run the Today build directly
 * against a database (default: the runtime DB; point DASHBOARD_DB_PATH at a
 * snapshot for repeatable numbers) and print the same timings the
 * Server-Timing header reports.
 *
 *   DASHBOARD_DB_PATH=data/dashboard.sandbox.db npx tsx scripts/measure-today.ts [managerAccountId] [date] [iterations]
 */
process.env.DASHBOARD_DB_PATH ??= "data/dashboard.db";

import { IssueService } from "../src/services/issue.service";
import { TeamTrackerService } from "../src/services/team-tracker.service";
import { ManagerDeskService } from "../src/services/manager-desk.service";
import { TodayService } from "../src/services/today.service";

const managerAccountId = process.argv[2] ?? "ayan";
const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const iterations = Math.max(1, Number(process.argv[4] ?? 5));

const todayService = new TodayService(
  new IssueService(),
  new TeamTrackerService(),
  new ManagerDeskService(),
  {
    getLastSyncLog: async () => undefined,
    getRuntimeStatus: () => ({ status: "idle" as const }),
    isAutoSyncEnabled: async () => false,
  },
);

async function run(): Promise<void> {
  const rows: Array<Record<string, number>> = [];
  for (let index = 0; index < iterations; index += 1) {
    todayService.clearTodayCache();
    const result = await todayService.getTodayWithMetadata(managerAccountId, date, "default");
    rows.push({
      issues: Math.round(result.sourceTimings.issues),
      team: Math.round(result.sourceTimings.team),
      desk: Math.round(result.sourceTimings.desk),
      sync: Math.round(result.sourceTimings.sync),
      drift: Math.round(result.sourceTimings.drift),
      one_on_one: Math.round(result.sourceTimings.one_on_one),
      build: Math.round(result.buildDurationMs),
    });
  }
  console.log(`date=${date} manager=${managerAccountId} iterations=${iterations}`);
  console.table(rows);
  const median = (key: string) => {
    const sorted = rows.map((row) => row[key]!).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  console.log("median:", Object.fromEntries(["issues", "team", "desk", "sync", "drift", "one_on_one", "build"].map((key) => [key, median(key)])));
}

void run();
