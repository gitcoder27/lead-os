import "../load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceRoot } from "../db/paths";
import { BackupService } from "../services/backup.service";
import { TaskPhase2BackfillService, type Phase2DecisionsFile, type TaskPhase2Report, type TaskPhase2VerifyResult } from "../services/task-phase2-backfill.service";

function renderMarkdown(reports: TaskPhase2Report[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`# Phase 2 backfill — ${report.workspaceId}`);
    lines.push("");
    lines.push(`- Generated: ${report.generatedAt}`);
    lines.push(`- Input hash: \`${report.inputHash}\``);
    lines.push(`- Applied: ${report.applied}`);
    lines.push(`- Legacy rows: ${report.counts.legacyDeskRows} desk / ${report.counts.legacyTrackerRows} tracker`);
    lines.push(`- Key groups: ${report.counts.keyGroups}`);
    lines.push(`- Task kinds: ${JSON.stringify(report.counts.tasksByKind)}`);
    lines.push(`- Task owners: ${JSON.stringify(report.counts.tasksByOwnerType)}`);
    lines.push(`- Task statuses: ${JSON.stringify(report.counts.tasksByStatus)}`);
    lines.push(`- Status mapping rules: ${JSON.stringify(report.statusMapping)}`);
    lines.push(`- Field loss: ${JSON.stringify(report.fieldLoss)}`);
    lines.push("");
    if (report.autoMerges.length) {
      lines.push("## Auto-merge proposals (applied by default)");
      for (const p of report.autoMerges) lines.push(`- ${p.proposalId}: ${p.mergedKey} → ${p.survivorKey} — ${p.codes.join(", ")}`);
      lines.push("");
    }
    if (report.ambiguous.length) {
      lines.push("## Ambiguous merges (require decisions)");
      for (const p of report.ambiguous) {
        lines.push(`- ${p.proposalId}: ${p.mergedKey} + ${p.survivorKey} — codes: ${p.codes.join(", ")}; default: ${p.default}`);
        for (const row of p.rows) lines.push(`  - row ${row.rowId} (${row.key}): "${row.title}" — ${row.developer} ${row.date} ${row.state}${row.jiraSet.length ? ` jira:${row.jiraSet.join("+")}` : ""}`);
        for (const [key, count] of Object.entries(p.eventCounts)) lines.push(`  - ${key}: ${count} events${p.referenced[key] ? " (referenced)" : ""} — ${(p.eventExcerpts[key] ?? []).join(" | ")}`);
      }
      lines.push("");
    }
    if (report.splits.length) {
      lines.push("## Split proposals (require decisions)");
      for (const p of report.splits) {
        lines.push(`- ${p.proposalId}: ${p.key} — ${p.code}; rows to move: ${p.moveRowIds.join(", ")}${p.oneKeyPerRow ? " (one new key per row)" : ""}`);
        for (const row of p.rows) lines.push(`  - row ${row.rowId}: "${row.title}" — ${row.developer} ${row.date} ${row.state}`);
        for (const event of p.events.slice(0, 10)) lines.push(`  - event ${event.id} (${event.type}): ${event.excerpt}`);
      }
      lines.push("");
    }
    const f = report.findings;
    lines.push("## Findings");
    lines.push(`- M6 violations: ${f.m6Violations.length}${f.m6Violations.length ? ` — ${f.m6Violations.map((v) => v.key).join(", ")}` : ""}`);
    lines.push(`- Assignee mismatches: ${f.assigneeMismatch.length}${f.assigneeMismatch.length ? ` — ${f.assigneeMismatch.map((v) => `${v.key} (${v.deskAssignee} vs ${v.trackerDeveloper})`).join(", ")}` : ""}`);
    lines.push(`- ownerId from assignee only: ${f.ownerFromAssigneeOnly.length}`);
    lines.push(`- Desk open but execution done: ${f.deskOpenExecutionDone.length}${f.deskOpenExecutionDone.length ? ` — ${f.deskOpenExecutionDone.join(", ")}` : ""}`);
    lines.push(`- Multi-active demotions: ${f.multiActiveDemotions.length}${f.multiActiveDemotions.length ? ` — ${f.multiActiveDemotions.map((v) => `${v.demotedKey} (kept ${v.keptKey})`).join(", ")}` : ""}`);
    lines.push(`- Orphans: ${f.orphans.length}${f.orphans.length ? ` — ${f.orphans.map((v) => `${v.kind}#${v.id}`).join(", ")}` : ""}`);
    lines.push(`- Cross-key mirrors: ${f.crossKeyMirrors.length}`);
    lines.push(`- Unkeyed rows: ${f.unkeyedRows.deskIds.length} desk / ${f.unkeyedRows.trackerIds.length} tracker`);
    lines.push(`- Tombstone keys (event-only): ${f.tombstoneKeys.length}${f.tombstoneKeys.length ? ` — ${f.tombstoneKeys.join(", ")}` : ""}`);
    lines.push(`- Deleted desk items preserved: ${f.deletedDeskItems.length}`);
    lines.push("");
    if (!report.applied && (report.ambiguous.length || report.splits.length)) {
      lines.push("## Next step");
      lines.push("Write a decisions JSON file covering the proposals above (see `decisionsTemplate` in the JSON report), then re-run with `--apply --decisions <path>`.");
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderVerify(result: TaskPhase2VerifyResult): string {
  const lines = [`workspace ${result.workspaceId}: ${result.ok ? "OK" : "FAILED"}`];
  if (result.missingLegacyMap.length) lines.push(`  missing legacy map entries: ${result.missingLegacyMap.length} (${result.missingLegacyMap.slice(0, 5).map((m) => `${m.sourceTable}#${m.sourceId}`).join(", ")}…)`);
  if (result.unrepointedEvents) lines.push(`  events with NULL task_id: ${result.unrepointedEvents}`);
  if (result.multiActiveViolations.length) lines.push(`  multi-active developers: ${result.multiActiveViolations.join(", ")}`);
  const refs = result.unfilledRefs;
  if (refs.checkin || refs.noteTask || refs.noteFollowUp) lines.push(`  unfilled refs: checkin=${refs.checkin} noteTask=${refs.noteTask} noteFollowUp=${refs.noteFollowUp}`);
  if (result.parityDiffs.length) {
    lines.push(`  parity diffs: ${result.parityDiffs.length}`);
    for (const d of result.parityDiffs.slice(0, 20)) lines.push(`    ${d.surface} ${d.owner} ${d.date} ${d.field}: legacy=${JSON.stringify(d.legacy)} tasks=${JSON.stringify(d.tasks)}`);
    if (result.parityDiffs.length > 20) lines.push(`    … and ${result.parityDiffs.length - 20} more`);
  }
  if (result.explainedDrift?.length) {
    lines.push(`  explained drift (event-replay divergences, informational): ${result.explainedDrift.length}`);
    for (const d of result.explainedDrift.slice(0, 10)) lines.push(`    ${d.surface} ${d.owner} ${d.date} ${d.field}: legacy=${JSON.stringify(d.legacy)} tasks=${JSON.stringify(d.tasks)}`);
    if (result.explainedDrift.length > 10) lines.push(`    … and ${result.explainedDrift.length - 10} more`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let apply = false;
  let verify = false;
  let strict = false;
  let resume = false;
  let workspace: string | undefined;
  let decisionsPath: string | undefined;
  let reportDir = path.resolve(workspaceRoot, "data", "manual-snapshots");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") continue;
    else if (arg === "--verify") verify = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--resume") resume = true;
    else if (arg === "--workspace" && args[i + 1]) workspace = args[++i];
    else if (arg === "--decisions" && args[i + 1]) decisionsPath = args[++i];
    else if (arg === "--report-dir" && args[i + 1]) reportDir = path.resolve(args[++i]!);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (apply && verify) throw new Error("--apply and --verify are mutually exclusive");

  const service = new TaskPhase2BackfillService();
  const workspaces = workspace ? [workspace] : await service.workspaceIds();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (verify) {
    let ok = true;
    for (const id of workspaces) {
      const result = await service.verify(id, { strict });
      process.stdout.write(`${renderVerify(result)}\n`);
      if (!result.ok) ok = false;
    }
    if (!ok) process.exitCode = 1;
    return;
  }

  if (apply) {
    if (!decisionsPath) throw new Error("--apply requires --decisions <path> (a decisions file, even if only the dry-run template)");
    const decisionsFile = JSON.parse(await readFile(decisionsPath, "utf8")) as Phase2DecisionsFile;
    if (!Array.isArray(decisionsFile.decisions) || typeof decisionsFile.inputHash !== "string") {
      throw new Error("Decisions file must contain { inputHash, decisions[] }");
    }
    await new BackupService().createManualBackup("pre-task-phase2");
    const reports: TaskPhase2Report[] = [];
    for (const id of workspaces) reports.push(await service.apply(id, decisionsFile, { resume }));
    const output = JSON.stringify({ applied: true, workspaces: reports }, null, 2);
    process.stdout.write(`${output}\n`);
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, `task-phase2-report-${stamp}.json`), output, { encoding: "utf8", flag: "w" });
    await writeFile(path.join(reportDir, `task-phase2-report-${stamp}.md`), renderMarkdown(reports), { encoding: "utf8", flag: "w" });
    return;
  }

  const reports: TaskPhase2Report[] = [];
  for (const id of workspaces) reports.push(await service.plan(id));
  const output = JSON.stringify({ applied: false, workspaces: reports }, null, 2);
  process.stdout.write(`${output}\n`);
  await mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, `task-phase2-report-${stamp}.json`);
  const mdPath = path.join(reportDir, `task-phase2-report-${stamp}.md`);
  await writeFile(jsonPath, output, { encoding: "utf8", flag: "w" });
  await writeFile(mdPath, renderMarkdown(reports), { encoding: "utf8", flag: "w" });
  process.stdout.write(`Report written to ${jsonPath}\n${mdPath}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
