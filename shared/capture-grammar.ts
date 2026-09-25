/**
 * Phase 3 (P3-D8, §4.1): the shared capture grammar.
 *
 * Pure and deterministic, with no I/O. `parseCapture` turns raw text into an
 * intent + tokens + structural diagnostics; `resolveCapture` applies
 * caller-supplied lookups (people, Jira sync state, task existence) so the
 * client preview and the authoritative server path share identical logic.
 *
 * Grammar:
 *   capture   = update | note | create
 *   update    = taskref ":" ws text                 — "T-142: said X" → event
 *   note      = "/note" ws text                     — today's daily note
 *   create    = { token | word }
 *   token     = person | jira | parent | taskref | date | priority | later
 *             | meeting | followup | label
 *   person    = "@" ident                           — first @ owns; later @s link
 *   jira      = "#" project "-" digits              — primary if first
 *   parent    = "^" taskref
 *   taskref   = "T-" digits                         — bare ref → task link
 *   date      = "!" ("today"|"tomorrow"|weekday|offset|iso)
 *   weekday   = "mon".."sun"                        — next occurrence incl. today
 *   offset    = "+" digits ("d"|"w")
 *   iso       = yyyy "-" mm "-" dd
 *   priority  = "!!"
 *   later     = "/later" | "/l"
 *   meeting   = "/meeting" | "/m"
 *   followup  = ("/followup" | "/f") [ ws date ]
 *   label     = "+" ident
 *
 * Dates are resolved against a caller-supplied `today` (todayIsoDate
 * semantics, D29); the client passes its local today, the server re-resolves
 * with its own and rejects a drift of more than one day.
 */

import type { DailyNoteResponse, ManagerTask, TaskEvent } from "./types";

export type CaptureIntent = "create" | "update" | "note";

export type CaptureTokenKind =
  | "person"
  | "jira"
  | "parent"
  | "taskref"
  | "date"
  | "priority"
  | "later"
  | "meeting"
  | "followup"
  | "label"
  /** The leading `T-n:` / `/note` marker for update and note intents. */
  | "command";

export interface CaptureToken {
  kind: CaptureTokenKind;
  /** Exact source text — the preview highlighter spans [start, end). */
  raw: string;
  start: number;
  end: number;
  /** Normalized payload: person ident, label name, jira/task key, ISO date. */
  value?: string;
  /** A `!date` consumed by a preceding `/f` sets followUpAt, not scheduledOn. */
  forFollowup?: boolean;
  /** Resolution demoted the token back into the title text ("kept as text"). */
  dropped?: boolean;
}

export interface CapturePersonCandidate {
  accountId: string;
  displayName: string;
}

export type CaptureDiagnosticCode =
  | "empty-title"
  | "empty-update"
  | "empty-note"
  | "later-with-date"
  | "later-with-person"
  | "past-date"
  | "unparsed-date"
  | "unparsed-token"
  | "unknown-person"
  | "ambiguous-person"
  | "jira-not-synced"
  | "bad-update-target"
  | "bad-parent"
  | "bad-task-ref";

export interface CaptureDiagnostic {
  severity: "error" | "warning" | "info";
  code: CaptureDiagnosticCode;
  message: string;
  /** Raw token text that produced the diagnostic. */
  token?: string;
  /** Index into `tokens[]` — the ambiguous-person chooser targets this token. */
  tokenIndex?: number;
  candidates?: CapturePersonCandidate[];
}

/** Every whitespace-delimited word, tagged when a token consumed it. */
export interface CaptureWord {
  raw: string;
  start: number;
  end: number;
  tokenIndex?: number;
}

export interface ParsedCapture {
  intent: CaptureIntent;
  /** Create: the title (words not consumed by tokens). Update/note: the body. */
  title: string;
  tokens: CaptureToken[];
  diagnostics: CaptureDiagnostic[];
  words: CaptureWord[];
}

/**
 * Caller-supplied resolution data. Returning `null` from a lookup means "can't
 * determine here" — the client preview stays silent and the authoritative
 * server pass applies the real diagnostic.
 */
export interface CaptureLookups {
  people?: readonly CapturePersonCandidate[];
  jiraSynced?: (key: string) => boolean | null;
  taskState?: (key: string) => "ok" | "deleted" | "unknown" | null;
}

export interface ResolvedCapture {
  intent: CaptureIntent;
  /** Final title (or update/note body) after demoted tokens return as text. */
  title: string;
  tokens: CaptureToken[];
  diagnostics: CaptureDiagnostic[];
  /** Error diagnostics present — submit is blocked. */
  blocked: boolean;
  /** A past-date submit needs an explicit confirm step. */
  confirmRequired: boolean;
  /** The `T-n:` update target (normalized). */
  updateTargetKey?: string;
  /** First `@person` — the owner. */
  owner: CapturePersonCandidate | null;
  /** Additional `@person`s — person links. */
  peopleLinks: CapturePersonCandidate[];
  /** Jira links in order; the first is primary. */
  jiraLinks: { key: string; primary: boolean }[];
  /** Bare `T-n` references — task links. */
  taskLinks: string[];
  parentKey?: string;
  labels: string[];
  scheduledOn: string | null;
  followUp: boolean;
  /** `/f` optionally followed by `!date`; null → caller defaults to today. */
  followUpAt: string | null;
  later: boolean;
  meeting: boolean;
  priority: "normal" | "high";
}

export interface CaptureRequestBody {
  text: string;
  /** The client's local ISO date — rejected when it drifts >1 day (§4.1). */
  clientToday?: string;
  /** Second submit confirming warning diagnostics (e.g. past dates). */
  confirm?: boolean;
  requestId?: string;
}

export interface CaptureResponseBody {
  intent: CaptureIntent;
  diagnostics: CaptureDiagnostic[];
  /** Diagnostics blocked the write; nothing was created. */
  blocked?: boolean;
  /** Warnings need a `confirm: true` resubmit. */
  confirmRequired?: boolean;
  task?: ManagerTask;
  event?: TaskEvent;
  note?: DailyNoteResponse;
}

// ── Date helpers (pure ISO math on the caller's today) ────────────

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addIsoDays(iso: string, days: number): string {
  const shifted = new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function isoWeekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** `!x` → ISO date, or null when `x` is not a date ident. */
function resolveDateIdent(ident: string, today: string): string | null {
  const lower = ident.toLowerCase();
  if (lower === "today") return today;
  if (lower === "tomorrow") return addIsoDays(today, 1);
  if (lower in WEEKDAYS) {
    // Next occurrence, today included.
    return addIsoDays(today, (WEEKDAYS[lower]! - isoWeekday(today) + 7) % 7);
  }
  const offset = /^\+(\d{1,3})([dw])$/.exec(lower);
  if (offset) return addIsoDays(today, Number(offset[1]) * (offset[2] === "w" ? 7 : 1));
  return isIsoDate(ident) ? ident : null;
}

// ── Token regexes ─────────────────────────────────────────────────

const UPDATE_PREFIX = /^\s*([Tt]-\d{1,9})\s*:\s*/;
const NOTE_PREFIX = /^\s*\/note(?:\s+|$)/i;
const TASK_REF = /^[Tt]-\d{1,9}$/;
const PERSON_REF = /^@([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const JIRA_REF = /^#([A-Za-z][A-Za-z0-9]*-\d{1,7})$/;
const PARENT_REF = /^\^([Tt]-\d{1,9})$/;
const LABEL_REF = /^\+([A-Za-z0-9][A-Za-z0-9_-]{0,49})$/;

export function normalizeCaptureTaskKey(raw: string): string {
  const match = /^[Tt]-(\d{1,9})$/.exec(raw);
  return match ? `T-${Number(match[1])}` : raw;
}

function splitWords(text: string): CaptureWord[] {
  const words: CaptureWord[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    words.push({ raw: match[0], start: match.index!, end: match.index! + match[0].length });
  }
  return words;
}

function pushDiagnostic(list: CaptureDiagnostic[], severity: CaptureDiagnostic["severity"], code: CaptureDiagnosticCode, message: string, token?: CaptureToken, tokenIndex?: number): void {
  list.push({ severity, code, message, ...(token && { token: token.raw }), ...(tokenIndex !== undefined && { tokenIndex }) });
}

/**
 * `@alias` → candidate people. An exact accountId or full display-name match
 * short-circuits; otherwise any whitespace/punctuation-separated name part —
 * or the concatenated name — prefix-matches (so `@dev` hits "Dev One").
 */
export function matchCapturePeople(alias: string, people: readonly CapturePersonCandidate[]): CapturePersonCandidate[] {
  const needle = alias.toLowerCase();
  if (!needle) return [];
  const exact = people.filter((person) =>
    person.accountId.toLowerCase() === needle || person.displayName.trim().toLowerCase() === needle
  );
  if (exact.length) return exact;
  return people.filter((person) => {
    const parts = person.displayName.toLowerCase().split(/[\s._-]+/).filter(Boolean);
    return parts.some((part) => part.startsWith(needle)) || parts.join("").startsWith(needle);
  });
}

/** Parse raw capture text. `today` is the caller's ISO date (D29). */
export function parseCapture(text: string, today: string): ParsedCapture {
  const diagnostics: CaptureDiagnostic[] = [];

  // update = taskref ":" ws text
  const updateMatch = UPDATE_PREFIX.exec(text);
  if (updateMatch) {
    const key = normalizeCaptureTaskKey(updateMatch[1]!);
    const title = text.slice(updateMatch[0].length).trim();
    if (!title) {
      pushDiagnostic(diagnostics, "error", "empty-update", "Add update text after the colon");
    }
    return {
      intent: "update",
      title,
      tokens: [{ kind: "command", raw: updateMatch[1]!, start: text.indexOf(updateMatch[1]!), end: text.indexOf(updateMatch[1]!) + updateMatch[1]!.length, value: key }],
      diagnostics,
      words: [],
    };
  }

  // note = "/note" ws text
  const noteMatch = NOTE_PREFIX.exec(text);
  if (noteMatch) {
    const title = text.slice(noteMatch[0].length).trim();
    if (!title) {
      pushDiagnostic(diagnostics, "error", "empty-note", "Add note text after /note");
    }
    return {
      intent: "note",
      title,
      tokens: [{ kind: "command", raw: noteMatch[0].trim(), start: noteMatch[0].search(/\S/), end: noteMatch[0].length }],
      diagnostics,
      words: [],
    };
  }

  // create = { token | word }
  const words = splitWords(text);
  const tokens: CaptureToken[] = [];
  let expectFollowupDate = false;

  const consume = (word: CaptureWord, token: CaptureToken): void => {
    word.tokenIndex = tokens.length;
    tokens.push(token);
  };

  for (const word of words) {
    let token: CaptureToken | null = null;
    const base = { raw: word.raw, start: word.start, end: word.end };

    const person = PERSON_REF.exec(word.raw);
    const jira = JIRA_REF.exec(word.raw);
    const parent = PARENT_REF.exec(word.raw);
    const label = LABEL_REF.exec(word.raw);

    if (person) {
      token = { ...base, kind: "person", value: person[1] };
    } else if (jira) {
      token = { ...base, kind: "jira", value: jira[1]!.toUpperCase() };
    } else if (parent) {
      token = { ...base, kind: "parent", value: normalizeCaptureTaskKey(parent[1]!) };
    } else if (TASK_REF.test(word.raw)) {
      token = { ...base, kind: "taskref", value: normalizeCaptureTaskKey(word.raw) };
    } else if (word.raw === "!!") {
      token = { ...base, kind: "priority" };
    } else if (word.raw.startsWith("!")) {
      const date = resolveDateIdent(word.raw.slice(1), today);
      if (date) {
        token = { ...base, kind: "date", value: date, ...(expectFollowupDate ? { forFollowup: true } : {}) };
      } else {
        pushDiagnostic(diagnostics, "warning", "unparsed-date", `"${word.raw}" isn't a date — kept as text`, undefined);
      }
    } else if (/^\/(later|l)$/i.test(word.raw)) {
      token = { ...base, kind: "later" };
    } else if (/^\/(meeting|m)$/i.test(word.raw)) {
      token = { ...base, kind: "meeting" };
    } else if (/^\/(followup|f)$/i.test(word.raw)) {
      token = { ...base, kind: "followup" };
    } else if (label) {
      token = { ...base, kind: "label", value: label[1]!.toLowerCase() };
    } else if (/^[@^+#]/.test(word.raw)) {
      // Looks like a token but doesn't parse — keep it as title text.
      pushDiagnostic(diagnostics, "warning", "unparsed-token", `"${word.raw}" isn't recognized — kept as text`, undefined);
    }

    if (token) consume(word, token);
    // `/f`'s optional [ws date] binds only to the very next word.
    expectFollowupDate = token?.kind === "followup";
  }

  // ── Structural diagnostics (no lookups needed) ──
  const title = buildTitle(words, tokens);
  const scheduled = tokens.find((entry) => entry.kind === "date" && !entry.forFollowup)?.value;
  const hasLater = tokens.some((entry) => entry.kind === "later");
  const hasPerson = tokens.some((entry) => entry.kind === "person");

  if (!title) {
    pushDiagnostic(diagnostics, "error", "empty-title", "Add a title for the task");
  }
  if (hasLater && scheduled) {
    pushDiagnostic(diagnostics, "error", "later-with-date", "Later tasks have no date", tokens.find((entry) => entry.kind === "date" && !entry.forFollowup));
  }
  if (hasLater && hasPerson) {
    pushDiagnostic(diagnostics, "error", "later-with-person", "Later stays on manager-owned tasks — remove /later or @person", tokens.find((entry) => entry.kind === "person"));
  }
  for (const entry of tokens) {
    if (entry.kind === "date" && entry.value && entry.value < today) {
      pushDiagnostic(diagnostics, "warning", "past-date", `${entry.value} is in the past`, entry, tokens.indexOf(entry));
    }
  }

  return { intent: "create", title, tokens, diagnostics, words };
}

function buildTitle(words: CaptureWord[], tokens: CaptureToken[]): string {
  return words
    .filter((word) => word.tokenIndex === undefined || tokens[word.tokenIndex]!.dropped)
    .map((word) => word.raw)
    .join(" ")
    .trim();
}

/** Apply caller lookups; deterministic given the same inputs. */
export function resolveCapture(parsed: ParsedCapture, lookups: CaptureLookups = {}): ResolvedCapture {
  const tokens = parsed.tokens.map((token) => ({ ...token }));
  const diagnostics: CaptureDiagnostic[] = [...parsed.diagnostics];
  const people = lookups.people ?? [];

  // People — first @ owns the task, the rest become person links.
  const personTokens = tokens.filter((token) => token.kind === "person");
  let owner: CapturePersonCandidate | null = null;
  const peopleLinks: CapturePersonCandidate[] = [];
  for (const token of personTokens) {
    const index = tokens.indexOf(token);
    const matches = matchCapturePeople(token.value ?? "", people);
    if (matches.length === 0) {
      pushDiagnostic(diagnostics, "error", "unknown-person", `Nobody matches @${token.value}`, token, index);
    } else if (matches.length > 1) {
      diagnostics.push({ severity: "error", code: "ambiguous-person", message: `@${token.value} is ambiguous — pick someone`, token: token.raw, tokenIndex: index, candidates: matches });
    } else if (token === personTokens[0]) {
      owner = matches[0]!;
    } else {
      peopleLinks.push(matches[0]!);
    }
  }

  // Jira — unsynced keys demote back into the title text.
  const jiraLinks: { key: string; primary: boolean }[] = [];
  for (const token of tokens.filter((entry) => entry.kind === "jira")) {
    const synced = lookups.jiraSynced?.(token.value ?? "");
    if (synced === false) {
      token.dropped = true;
      pushDiagnostic(diagnostics, "warning", "jira-not-synced", `${token.value} isn't synced — kept as text`, token, tokens.indexOf(token));
    } else {
      jiraLinks.push({ key: token.value!, primary: jiraLinks.length === 0 });
    }
  }

  // Task references — update target and parent are errors; title refs warn.
  let updateTargetKey: string | undefined;
  let parentKey: string | undefined;
  const taskLinks: string[] = [];
  if (parsed.intent === "update") {
    const target = tokens[0];
    if (target?.kind === "command" && target.value) {
      const state = lookups.taskState?.(target.value);
      if (state === "unknown" || state === "deleted") {
        pushDiagnostic(diagnostics, "error", "bad-update-target", `${target.value} ${state === "deleted" ? "was deleted" : "doesn't exist"}`, target, 0);
      } else {
        // `null` means the caller can't determine — the server is authoritative.
        updateTargetKey = target.value;
      }
    }
  }
  for (const token of tokens) {
    if (!["taskref", "parent"].includes(token.kind)) continue;
    const index = tokens.indexOf(token);
    const state = token.value ? lookups.taskState?.(token.value) : undefined;
    if (token.kind === "parent") {
      if (state === "unknown" || state === "deleted") {
        pushDiagnostic(diagnostics, "error", "bad-parent", `Parent ${token.value} ${state === "deleted" ? "was deleted" : "doesn't exist"}`, token, index);
      } else {
        parentKey = token.value;
      }
      continue;
    }
    if (state === "unknown" || state === "deleted") {
      token.dropped = true;
      pushDiagnostic(diagnostics, "warning", "bad-task-ref", `${token.value} ${state === "deleted" ? "was deleted" : "doesn't exist"} — kept as text`, token, index);
    } else {
      taskLinks.push(token.value!);
    }
  }

  const title = parsed.intent === "create" ? buildTitle(parsed.words, tokens) : parsed.title;

  const scheduledOn = tokens.find((entry) => entry.kind === "date" && !entry.forFollowup)?.value ?? null;
  const followUpAt = tokens.find((entry) => entry.kind === "date" && entry.forFollowup)?.value ?? null;
  const followUp = tokens.some((entry) => entry.kind === "followup");
  const labels = tokens.filter((entry) => entry.kind === "label").map((entry) => entry.value!);
  if (followUp) labels.unshift("category:follow_up");

  const blocked = diagnostics.some((entry) => entry.severity === "error");
  const confirmRequired = !blocked && diagnostics.some((entry) => entry.code === "past-date");

  return {
    intent: parsed.intent,
    title,
    tokens,
    diagnostics,
    blocked,
    confirmRequired,
    updateTargetKey,
    owner,
    peopleLinks,
    jiraLinks,
    taskLinks,
    parentKey,
    labels,
    scheduledOn,
    followUp,
    followUpAt,
    later: tokens.some((entry) => entry.kind === "later"),
    meeting: tokens.some((entry) => entry.kind === "meeting"),
    priority: tokens.some((entry) => entry.kind === "priority") ? "high" : "normal",
  };
}
