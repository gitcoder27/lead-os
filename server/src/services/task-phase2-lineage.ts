import type { managerDeskItems, teamTrackerDays, teamTrackerItems } from "../db/schema";

export type DeskRow = typeof managerDeskItems.$inferSelect;
export type TrackerRow = typeof teamTrackerItems.$inferSelect;
export type TrackerDayRow = typeof teamTrackerDays.$inferSelect;

/** One key group's worth of legacy rows after alias resolution. */
export interface KeyGroup {
  key: string;
  desk?: DeskRow;
  deskLineage: DeskRow[];
  tracker: TrackerRow[]; // ascending by compareTrackerRowsByRecency
}

export interface ProposalRowEvidence {
  rowId: number;
  key: string;
  date: string;
  developer: string;
  title: string;
  jiraSet: string[];
  state: string;
  noteExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  batch: boolean;
  batchSize: number;
}

export interface MergeProposal {
  proposalId: string;
  kind: "merge";
  classification: "auto" | "ambiguous";
  codes: string[]; // primary ambiguity code first; A7 may be appended
  survivorKey: string;
  mergedKey: string;
  default: "merge" | "keep";
  rows: ProposalRowEvidence[];
  eventCounts: Record<string, number>;
  eventExcerpts: Record<string, string[]>;
  referenced: Record<string, boolean>;
}

export interface SplitProposal {
  proposalId: string;
  kind: "split";
  code: "S1" | "S2";
  key: string;
  /** Rows that move to a freshly allocated key when the decision is "split". */
  moveRowIds: number[];
  /** S2: the whole tail shares one new key; S1: each moved row gets its own. */
  oneKeyPerRow: boolean;
  default: "split";
  rows: ProposalRowEvidence[];
  events: { id: number; type: string; excerpt: string }[];
}

export type Proposal = MergeProposal | SplitProposal;

export interface ProposalContext {
  dayById: Map<number, TrackerDayRow>;
  /** Original note text per row id, recovered from Phase 1 note-import events. */
  originalNoteByRowId: Map<number, string>;
  /** Rows sharing (day_id, created_at) counts, for the carry-batch fingerprint. */
  batchSizeAt: (row: TrackerRow) => number;
  eventCountByKey: Map<string, number>;
  eventExcerptsByKey: Map<string, string[]>;
  referencedKeys: Set<string>;
}

export function compareTrackerRecency(
  left: TrackerRow,
  right: TrackerRow,
  dayById: Map<number, TrackerDayRow>
): number {
  const leftDate = dayById.get(left.dayId)?.date ?? "";
  const rightDate = dayById.get(right.dayId)?.date ?? "";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const updatedDiff = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;
  return left.id - right.id;
}

export function normTitle(title: string): string {
  return title.trim();
}

function casefoldTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeJira(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

export function issueSet(row: TrackerRow): string[] {
  const set = new Set<string>();
  const primary = normalizeJira(row.jiraKey);
  if (primary) set.add(primary);
  if (row.relatedJiraKeys) {
    try {
      const parsed = JSON.parse(row.relatedJiraKeys) as unknown;
      if (Array.isArray(parsed)) for (const key of parsed) {
        const normalized = normalizeJira(typeof key === "string" ? key : undefined);
        if (normalized) set.add(normalized);
      }
    } catch { /* malformed JSON → treat as empty */ }
  }
  return [...set].sort();
}

function sameIssueSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** closedAt(row): completed_at for done, updated_at for dropped, +∞ for open. */
function closedAtOf(row: TrackerRow): string {
  if (row.state === "done") return row.completedAt ?? row.updatedAt;
  if (row.state === "dropped") return row.updatedAt;
  return "9999-12-31T23:59:59.999Z";
}

function firstRow(group: KeyGroup): TrackerRow {
  return group.tracker[0]!;
}

function evidence(row: TrackerRow, ctx: ProposalContext): ProposalRowEvidence {
  const batchSize = ctx.batchSizeAt(row);
  return {
    rowId: row.id,
    key: row.taskKey ?? "",
    date: ctx.dayById.get(row.dayId)?.date ?? "",
    developer: ctx.dayById.get(row.dayId)?.developerAccountId ?? "",
    title: row.title,
    jiraSet: issueSet(row),
    state: row.state,
    noteExcerpt: row.note?.slice(0, 120) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    batch: batchSize > 1,
    batchSize,
  };
}

interface CandidateEdge {
  g1: KeyGroup;
  g2: KeyGroup;
  kind: "full" | "rename";
  /** The G1 row that satisfied R2/R3/R4 (used for the R5 note comparison). */
  matched: TrackerRow;
  r5: boolean;
}

/**
 * §2.2.5 merge proposals. Tracker-only key groups of one developer are compared
 * pairwise (later group vs earlier groups) under R1–R5; results classify as
 * AUTO-MERGE or one of the ambiguous codes A1–A7.
 */
export function proposeMerges(trackerOnlyGroups: KeyGroup[], ctx: ProposalContext): MergeProposal[] {
  const proposals: MergeProposal[] = [];
  const byDeveloper = new Map<string, KeyGroup[]>();
  for (const group of trackerOnlyGroups) {
    const dev = ctx.dayById.get(firstRow(group).dayId)?.developerAccountId ?? "";
    byDeveloper.set(dev, [...(byDeveloper.get(dev) ?? []), group]);
  }

  const titleGroupCount = (dev: string, title: string): number =>
    (byDeveloper.get(dev) ?? []).filter((group) => normTitle(firstRow(group).title) === title).length;

  for (const groups of byDeveloper.values()) {
    groups.sort((a, b) => {
      const fa = firstRow(a); const fb = firstRow(b);
      const da = ctx.dayById.get(fa.dayId)?.date ?? "";
      const db_ = ctx.dayById.get(fb.dayId)?.date ?? "";
      return da.localeCompare(db_) || fa.createdAt.localeCompare(fb.createdAt) || fa.id - fb.id;
    });

    // Collect every candidate edge first so successor counts (A3) are known.
    const edges: CandidateEdge[] = [];
    const casefoldOnly: { g1: KeyGroup; g2: KeyGroup }[] = [];
    for (let i = 1; i < groups.length; i++) {
      const g2 = groups[i]!;
      const g2First = firstRow(g2);
      const g2Date = ctx.dayById.get(g2First.dayId)?.date ?? "";
      for (let j = 0; j < i; j++) {
        const g1 = groups[j]!;
        for (const r of g1.tracker) {
          // R4: G1's row was not finished before G2 appeared.
          if (!((ctx.dayById.get(r.dayId)?.date ?? "") < g2Date && closedAtOf(r) >= g2First.createdAt)) continue;
          // R3: identical Jira issue sets.
          if (!sameIssueSet(issueSet(g2First), issueSet(r))) continue;
          const strictTitle = normTitle(g2First.title) === normTitle(r.title);
          const rename = !strictTitle
            && issueSet(g2First).length > 0
            && g2First.updatedAt > g2First.createdAt; // R2′ rename after copying
          if (!strictTitle && !rename) {
            if (casefoldTitle(g2First.title) === casefoldTitle(r.title)) casefoldOnly.push({ g1, g2 });
            continue;
          }
          // R5: carry-batch fingerprint, or the copy kept the source note.
          // A null↔null match is not a signature (F6: manual re-adds → A1).
          const original = ctx.originalNoteByRowId.get(g2First.id) ?? g2First.note;
          const r5 = ctx.batchSizeAt(g2First) > 1 || (original != null && original === r.note);
          edges.push({ g1, g2, kind: strictTitle ? "full" : "rename", matched: r, r5 });
          break; // one matched row per G1 is enough
        }
      }
    }

    const successorsOf = new Map<KeyGroup, Set<KeyGroup>>();
    for (const edge of edges) {
      successorsOf.set(edge.g1, new Set([...(successorsOf.get(edge.g1) ?? []), edge.g2]));
    }

    const byG2 = new Map<KeyGroup, CandidateEdge[]>();
    for (const edge of edges) byG2.set(edge.g2, [...(byG2.get(edge.g2) ?? []), edge]);
    const casefoldByG2 = new Map<KeyGroup, KeyGroup[]>();
    for (const item of casefoldOnly) casefoldByG2.set(item.g2, [...(casefoldByG2.get(item.g2) ?? []), item.g1]);

    let auto = 0;
    let ambiguous = 0;
    const emitted = new Set<KeyGroup>();
    for (const g2 of groups) {
      const candidates = byG2.get(g2) ?? [];
      const r5Pass = candidates.filter((edge) => edge.r5);
      const dev = ctx.dayById.get(firstRow(g2).dayId)?.developerAccountId ?? "";
      const recurring = titleGroupCount(dev, normTitle(firstRow(g2).title)) >= 3;

      let classification: "auto" | "ambiguous" | null = null;
      let codes: string[] = [];
      if (r5Pass.length === 1 && (successorsOf.get(r5Pass[0]!.g1)?.size ?? 0) <= 1) {
        const edge = r5Pass[0]!;
        const g2First = firstRow(g2);
        const ghost = g1HasInProgress(edge.g1) && g2First.state === "planned"
          && ctx.batchSizeAt(g2First) <= 1 && g2First.updatedAt > g2First.createdAt;
        if (edge.kind === "rename") { classification = "ambiguous"; codes = ["A4"]; }
        else if (ghost) { classification = "ambiguous"; codes = ["A6"]; }
        else { classification = "auto"; codes = ["AUTO"]; }
      } else if (r5Pass.length > 1) {
        classification = "ambiguous"; codes = ["A2"];
      } else if (candidates.length === 1 && (successorsOf.get(candidates[0]!.g1)?.size ?? 0) > 1) {
        classification = "ambiguous"; codes = ["A3"];
      } else if (candidates.length > 0) {
        classification = "ambiguous"; codes = ["A1"]; // R1–R4 hold, R5 fails
      } else if (casefoldByG2.has(g2)) {
        classification = "ambiguous"; codes = ["A5"];
      }
      if (!classification) continue;
      if (classification === "ambiguous" && recurring) codes = [...codes, "A7"];
      if (emitted.has(g2)) continue;
      emitted.add(g2);

      const reference = r5Pass[0]?.g1 ?? candidates[0]?.g1 ?? casefoldByG2.get(g2)?.[0];
      if (!reference) continue;
      const idPrefix = classification === "auto" ? "M" : codes[0];
      const proposalId = `${idPrefix}-${String(classification === "auto" ? ++auto : ++ambiguous).padStart(4, "0")}`;
      const survivor = minKey(reference.key, g2.key);
      const merged = survivor === g2.key ? reference.key : g2.key;
      proposals.push({
        proposalId,
        kind: "merge",
        classification,
        codes,
        survivorKey: survivor,
        mergedKey: merged,
        default: classification === "auto" || codes[0] === "A4" || codes[0] === "A6" ? "merge" : "keep",
        rows: [...new Set([reference, ...candidates.map((edge) => edge.g1)])].flatMap((g) => g.tracker).concat(g2.tracker).map((row) => evidence(row, ctx)),
        eventCounts: {
          [reference.key]: ctx.eventCountByKey.get(reference.key) ?? 0,
          [g2.key]: ctx.eventCountByKey.get(g2.key) ?? 0,
        },
        eventExcerpts: {
          [reference.key]: ctx.eventExcerptsByKey.get(reference.key) ?? [],
          [g2.key]: ctx.eventExcerptsByKey.get(g2.key) ?? [],
        },
        referenced: {
          [reference.key]: ctx.referencedKeys.has(reference.key),
          [g2.key]: ctx.referencedKeys.has(g2.key),
        },
      });
    }
  }
  return proposals;
}

function g1HasInProgress(group: KeyGroup): boolean {
  return group.tracker.some((row) => row.state === "in_progress");
}

function minKey(a: string, b: string): string {
  return keyNumber(a) <= keyNumber(b) ? a : b;
}

export function keyNumber(key: string): number {
  return Number(key.slice(2)) || 0;
}

/**
 * §2.2.5 split proposals: same-day duplicate rows inside one key (S1), and a
 * closed row followed by a later-created row in the same key (S2 sanity check).
 */
export function proposeSplits(groups: KeyGroup[], ctx: ProposalContext, eventRowsByKey: Map<string, { id: number; type: string; excerpt: string }[]>): SplitProposal[] {
  const proposals: SplitProposal[] = [];
  let counter = 0;
  for (const group of groups) {
    const byDate = new Map<string, TrackerRow[]>();
    for (const row of group.tracker) {
      const date = ctx.dayById.get(row.dayId)?.date ?? "";
      byDate.set(date, [...(byDate.get(date) ?? []), row]);
    }
    const moveRowIds: number[] = [];
    for (const rows of byDate.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      moveRowIds.push(...rows.slice(1).map((row) => row.id)); // earliest same-day row keeps the key
    }
    if (moveRowIds.length) {
      proposals.push({
        proposalId: `S1-${String(++counter).padStart(4, "0")}`,
        kind: "split",
        code: "S1",
        key: group.key,
        moveRowIds,
        oneKeyPerRow: true,
        default: "split",
        rows: group.tracker.map((row) => evidence(row, ctx)),
        events: eventRowsByKey.get(group.key) ?? [],
      });
      continue; // S1 already covers the anomaly; skip the S2 sanity scan
    }

    const ordered = [...group.tracker].sort((a, b) => compareTrackerRecency(a, b, ctx.dayById));
    const boundary = ordered.findIndex((row, index) =>
      index > 0 && ordered.slice(0, index).some((earlier) =>
        (earlier.state === "done" || earlier.state === "dropped") && closedAtOf(earlier) < row.createdAt
      )
    );
    if (boundary > 0) {
      proposals.push({
        proposalId: `S2-${String(++counter).padStart(4, "0")}`,
        kind: "split",
        code: "S2",
        key: group.key,
        moveRowIds: ordered.slice(boundary).map((row) => row.id),
        oneKeyPerRow: false,
        default: "split",
        rows: group.tracker.map((row) => evidence(row, ctx)),
        events: eventRowsByKey.get(group.key) ?? [],
      });
    }
  }
  return proposals;
}
