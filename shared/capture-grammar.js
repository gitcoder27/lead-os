"use strict";
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
 *             | meeting | followup | waiting | label
 *   person    = "@" ident                           — first @ owns; later @s link;
 *                                                   ident may contain ":" (Jira ids)
 *                                                   and matches developers or contacts
 *                                                   (a contact never owns — it links)
 *   jira      = "#" project "-" digits              — primary if first
 *   parent    = "^" taskref
 *   taskref   = "T-" digits                         — bare ref → task link
 *   date      = "!" ("today"|"tomorrow"|weekday|offset|iso)
 *   weekday   = "mon".."sun"                        — next occurrence incl. today
 *   offset    = "+" digits ("d"|"w")
 *   iso       = yyyy "-" mm "-" dd
 *   priority  = "!!"
 *   later     = "/later" | "/l"                    — a !date with /later is the resurface
 *                                                   date (hideUntil); @people become links
 *   meeting   = "/meeting" | "/m"
 *   followup  = ("/followup" | "/f") [ ws person ] [ ws date ]
 *                                                   — with @who it means waiting on them
 *   waiting   = ("/waiting" | "/w") ws person [ ws date ]
 *                                                   — waiting on who; date = check-by
 *   label     = "+" ident
 *
 *   `/w` and `/f` bind the first @person and first !date within the next two
 *   words, in either order (docs/57 §3).
 *
 * Dates are resolved against a caller-supplied `today` (todayIsoDate
 * semantics, D29); the client passes its local today, the server re-resolves
 * with its own and rejects a drift of more than one day.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCaptureTaskKey = normalizeCaptureTaskKey;
exports.matchCapturePeople = matchCapturePeople;
exports.parseCapture = parseCapture;
exports.resolveCapture = resolveCapture;
// ── Date helpers (pure ISO math on the caller's today) ────────────
function isIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function addIsoDays(iso, days) {
    const shifted = new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);
    return shifted.toISOString().slice(0, 10);
}
function isoWeekday(iso) {
    return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** `!x` → ISO date, or null when `x` is not a date ident. */
function resolveDateIdent(ident, today) {
    const lower = ident.toLowerCase();
    if (lower === "today")
        return today;
    if (lower === "tomorrow")
        return addIsoDays(today, 1);
    if (lower in WEEKDAYS) {
        // Next occurrence, today included.
        return addIsoDays(today, (WEEKDAYS[lower] - isoWeekday(today) + 7) % 7);
    }
    const offset = /^\+(\d{1,3})([dw])$/.exec(lower);
    if (offset)
        return addIsoDays(today, Number(offset[1]) * (offset[2] === "w" ? 7 : 1));
    return isIsoDate(ident) ? ident : null;
}
// ── Token regexes ─────────────────────────────────────────────────
const UPDATE_PREFIX = /^\s*([Tt]-\d{1,9})\s*:\s*/;
const NOTE_PREFIX = /^\s*\/note(?:\s+|$)/i;
const TASK_REF = /^[Tt]-\d{1,9}$/;
// docs/57 §3: ":" allowed so Jira account ids like `557058:ab-12` parse.
const PERSON_REF = /^@([A-Za-z0-9][A-Za-z0-9._:-]*)$/;
const JIRA_REF = /^#([A-Za-z][A-Za-z0-9]*-\d{1,7})$/;
const PARENT_REF = /^\^([Tt]-\d{1,9})$/;
const LABEL_REF = /^\+([A-Za-z0-9][A-Za-z0-9_-]{0,49})$/;
function normalizeCaptureTaskKey(raw) {
    const match = /^[Tt]-(\d{1,9})$/.exec(raw);
    return match ? `T-${Number(match[1])}` : raw;
}
function splitWords(text) {
    const words = [];
    for (const match of text.matchAll(/\S+/g)) {
        words.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
    }
    return words;
}
function pushDiagnostic(list, severity, code, message, token, tokenIndex) {
    list.push({ severity, code, message, ...(token && { token: token.raw }), ...(tokenIndex !== undefined && { tokenIndex }) });
}
/**
 * `@alias` → candidate people. An exact accountId or full display-name match
 * short-circuits; otherwise any whitespace/punctuation-separated name part —
 * or the concatenated name — prefix-matches (so `@dev` hits "Dev One").
 */
function matchCapturePeople(alias, people) {
    const needle = alias.toLowerCase();
    if (!needle)
        return [];
    const exact = people.filter((person) => person.accountId.toLowerCase() === needle || person.displayName.trim().toLowerCase() === needle);
    if (exact.length)
        return exact;
    return people.filter((person) => {
        const parts = person.displayName.toLowerCase().split(/[\s._-]+/).filter(Boolean);
        return parts.some((part) => part.startsWith(needle)) || parts.join("").startsWith(needle);
    });
}
/** Parse raw capture text. `today` is the caller's ISO date (D29). */
function parseCapture(text, today) {
    const diagnostics = [];
    // update = taskref ":" ws text
    const updateMatch = UPDATE_PREFIX.exec(text);
    if (updateMatch) {
        const key = normalizeCaptureTaskKey(updateMatch[1]);
        const title = text.slice(updateMatch[0].length).trim();
        if (!title) {
            pushDiagnostic(diagnostics, "error", "empty-update", "Add update text after the colon");
        }
        return {
            intent: "update",
            title,
            tokens: [{ kind: "command", raw: updateMatch[1], start: text.indexOf(updateMatch[1]), end: text.indexOf(updateMatch[1]) + updateMatch[1].length, value: key }],
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
    const tokens = [];
    // `/f` and `/w` bind the first @person and !date within the next two words.
    let bindWindow = 0;
    let bindPerson = false;
    let bindDate = false;
    const consume = (word, token) => {
        word.tokenIndex = tokens.length;
        tokens.push(token);
    };
    for (const word of words) {
        let token = null;
        const base = { raw: word.raw, start: word.start, end: word.end };
        const person = PERSON_REF.exec(word.raw);
        const jira = JIRA_REF.exec(word.raw);
        const parent = PARENT_REF.exec(word.raw);
        const label = LABEL_REF.exec(word.raw);
        if (person) {
            token = { ...base, kind: "person", value: person[1], ...(bindWindow > 0 && bindPerson ? { forWaiting: true } : {}) };
            if (token.forWaiting)
                bindPerson = false;
        }
        else if (jira) {
            token = { ...base, kind: "jira", value: jira[1].toUpperCase() };
        }
        else if (parent) {
            token = { ...base, kind: "parent", value: normalizeCaptureTaskKey(parent[1]) };
        }
        else if (TASK_REF.test(word.raw)) {
            token = { ...base, kind: "taskref", value: normalizeCaptureTaskKey(word.raw) };
        }
        else if (word.raw === "!!") {
            token = { ...base, kind: "priority" };
        }
        else if (word.raw.startsWith("!")) {
            const date = resolveDateIdent(word.raw.slice(1), today);
            if (date) {
                token = { ...base, kind: "date", value: date, ...(bindWindow > 0 && bindDate ? { forFollowup: true } : {}) };
                if (token.forFollowup)
                    bindDate = false;
            }
            else {
                pushDiagnostic(diagnostics, "warning", "unparsed-date", `"${word.raw}" isn't a date — kept as text`, undefined);
            }
        }
        else if (/^\/(later|l)$/i.test(word.raw)) {
            token = { ...base, kind: "later" };
        }
        else if (/^\/(meeting|m)$/i.test(word.raw)) {
            token = { ...base, kind: "meeting" };
        }
        else if (/^\/(followup|f)$/i.test(word.raw)) {
            token = { ...base, kind: "followup" };
        }
        else if (/^\/(waiting|w)$/i.test(word.raw)) {
            token = { ...base, kind: "waiting" };
        }
        else if (label) {
            token = { ...base, kind: "label", value: label[1].toLowerCase() };
        }
        else if (/^[@^+#]/.test(word.raw)) {
            // Looks like a token but doesn't parse — keep it as title text.
            pushDiagnostic(diagnostics, "warning", "unparsed-token", `"${word.raw}" isn't recognized — kept as text`, undefined);
        }
        if (token)
            consume(word, token);
        if (token?.kind === "followup" || token?.kind === "waiting") {
            bindWindow = 2;
            bindPerson = true;
            bindDate = true;
        }
        else if (bindWindow > 0) {
            bindWindow -= 1;
        }
    }
    // ── Structural diagnostics (no lookups needed) ──
    const title = buildTitle(words, tokens);
    if (!title) {
        pushDiagnostic(diagnostics, "error", "empty-title", "Add a title for the task");
    }
    if (title.length > 500) {
        pushDiagnostic(diagnostics, "error", "title-too-long", "Title is too long — keep it under 500 characters");
    }
    // Only the first non-followup !date schedules; extra dates are consumed but
    // ignored — warn instead of silently discarding them.
    const dateTokens = tokens.filter((entry) => entry.kind === "date" && !entry.forFollowup);
    for (const extra of dateTokens.slice(1)) {
        pushDiagnostic(diagnostics, "warning", "extra-date", `Only the first !date applies — "${extra.raw}" is ignored`, extra, tokens.indexOf(extra));
    }
    // docs/57 §3 (P3-02): with /later the date is the resurface date and every
    // @person is a link — parked work stays mine, so neither is an error.
    const waitingToken = tokens.find((entry) => entry.kind === "waiting");
    if (waitingToken && !tokens.some((entry) => entry.kind === "person" && entry.forWaiting)) {
        pushDiagnostic(diagnostics, "error", "waiting-needs-person", "Add @who right after /w", waitingToken, tokens.indexOf(waitingToken));
    }
    for (const entry of tokens) {
        if (entry.kind === "date" && entry.value && entry.value < today) {
            pushDiagnostic(diagnostics, "warning", "past-date", `${entry.value} is in the past`, entry, tokens.indexOf(entry));
        }
    }
    return { intent: "create", title, tokens, diagnostics, words };
}
function buildTitle(words, tokens) {
    return words
        .filter((word) => word.tokenIndex === undefined || tokens[word.tokenIndex].dropped)
        .map((word) => word.raw)
        .join(" ")
        .trim();
}
/** Apply caller lookups; deterministic given the same inputs. */
function resolveCapture(parsed, lookups = {}) {
    const tokens = parsed.tokens.map((token) => ({ ...token }));
    const diagnostics = [...parsed.diagnostics];
    const people = lookups.people ?? [];
    // People — the @ bound by /w or /f is the waiting-on party; the first other
    // developer @ owns the task (never under /later); every other match links.
    // Contacts can be waited on or linked, never own (docs/57 §3).
    const personTokens = tokens.filter((token) => token.kind === "person");
    // docs/57 §3: developer tasks cannot be Later, so /later keeps me as owner.
    const later = tokens.some((token) => token.kind === "later");
    let owner = null;
    let waitingOn = null;
    const peopleLinks = [];
    const ownerToken = personTokens.find((token) => !token.forWaiting);
    for (const token of personTokens) {
        const index = tokens.indexOf(token);
        const matches = matchCapturePeople(token.value ?? "", people);
        if (matches.length === 0) {
            diagnostics.push({ severity: "error", code: "unknown-person", message: `Nobody matches @${token.value}`, token: token.raw, tokenIndex: index, suggestContact: token.value });
        }
        else if (matches.length > 1) {
            diagnostics.push({ severity: "error", code: "ambiguous-person", message: `@${token.value} is ambiguous — pick someone`, token: token.raw, tokenIndex: index, candidates: matches });
        }
        else if (token.forWaiting && !waitingOn) {
            waitingOn = matches[0];
        }
        else if (token === ownerToken && !later && matches[0].kind !== "contact") {
            owner = matches[0];
        }
        else if (!peopleLinks.some((person) => person.accountId === matches[0].accountId && person.kind === matches[0].kind)) {
            peopleLinks.push(matches[0]);
        }
    }
    // Jira — unsynced keys demote back into the title text.
    const jiraLinks = [];
    for (const token of tokens.filter((entry) => entry.kind === "jira")) {
        const synced = lookups.jiraSynced?.(token.value ?? "");
        if (synced === false) {
            token.dropped = true;
            pushDiagnostic(diagnostics, "warning", "jira-not-synced", `${token.value} isn't synced — kept as text`, token, tokens.indexOf(token));
        }
        else {
            jiraLinks.push({ key: token.value, primary: jiraLinks.length === 0 });
        }
    }
    // Task references — update target and parent are errors; title refs warn.
    let updateTargetKey;
    let parentKey;
    const taskLinks = [];
    if (parsed.intent === "update") {
        const target = tokens[0];
        if (target?.kind === "command" && target.value) {
            const state = lookups.taskState?.(target.value);
            if (state === "unknown" || state === "deleted") {
                pushDiagnostic(diagnostics, "error", "bad-update-target", `${target.value} ${state === "deleted" ? "was deleted" : "doesn't exist"}`, target, 0);
            }
            else {
                // `null` means the caller can't determine — the server is authoritative.
                updateTargetKey = target.value;
            }
        }
    }
    for (const token of tokens) {
        if (!["taskref", "parent"].includes(token.kind))
            continue;
        const index = tokens.indexOf(token);
        const state = token.value ? lookups.taskState?.(token.value) : undefined;
        if (token.kind === "parent") {
            if (state === "unknown" || state === "deleted") {
                pushDiagnostic(diagnostics, "error", "bad-parent", `Parent ${token.value} ${state === "deleted" ? "was deleted" : "doesn't exist"}`, token, index);
            }
            else {
                parentKey = token.value;
            }
            continue;
        }
        if (state === "unknown" || state === "deleted") {
            token.dropped = true;
            pushDiagnostic(diagnostics, "warning", "bad-task-ref", `${token.value} ${state === "deleted" ? "was deleted" : "doesn't exist"} — kept as text`, token, index);
        }
        else {
            taskLinks.push(token.value);
        }
    }
    const title = parsed.intent === "create" ? buildTitle(parsed.words, tokens) : parsed.title;
    const firstDate = tokens.find((entry) => entry.kind === "date" && !entry.forFollowup)?.value ?? null;
    const followUpAt = tokens.find((entry) => entry.kind === "date" && entry.forFollowup)?.value ?? null;
    const followUp = tokens.some((entry) => entry.kind === "followup");
    // docs/57 §3: `/f !date` with nobody to wait on is my own reminder, so it is
    // also planned on that date.
    const scheduledOn = later ? null : firstDate ?? (followUp && !waitingOn && followUpAt ? followUpAt : null);
    const hideUntil = later ? firstDate : null;
    const labels = tokens.filter((entry) => entry.kind === "label").map((entry) => entry.value);
    if (followUp)
        labels.unshift("category:follow_up");
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
        waitingOn,
        peopleLinks,
        jiraLinks,
        taskLinks,
        parentKey,
        labels,
        scheduledOn,
        hideUntil,
        followUp,
        followUpAt,
        later,
        meeting: tokens.some((entry) => entry.kind === "meeting"),
        priority: tokens.some((entry) => entry.kind === "priority") ? "high" : "normal",
    };
}
