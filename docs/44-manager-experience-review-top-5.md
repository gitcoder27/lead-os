# LeadOS Manager-Experience Review — Top 5

**Date:** 2026-09-12
**Method:** Five parallel deep-dive reviews of the running codebase (Today cockpit, Team management, Work/Jira triage, Desk/Follow-ups/Meetings, cross-cutting infrastructure + prior review docs 28–43), synthesized from the perspective of an engineering manager running a project and leading a team day-to-day.
**Scope:** Product gaps and improvements only. No files were changed.

---

## Where the product stands

LeadOS has successfully become a daily operating workspace: Today ranks exceptions, Team shows who is doing what right now, Work triages the Jira defect queue, and Desk persists open loops across days. Nearly every recommendation from docs 28–43 has been shipped — the palette exists, URLs are shareable, alerts are mounted in the header inbox (`Header.tsx:190`), carry-forward rebases times, and delegated lifecycle sync works.

The remaining problems are structural, not cosmetic. Read across all five review areas, the same five gaps kept surfacing:

1. The app knows **days and items**, but not **people**.
2. It **only speaks when opened** — nothing reaches the manager.
3. It **can't look back or report up** — history is captured and thrown away.
4. Work is a **defect queue**, not project execution.
5. Today is an **exception list**, not a cockpit that runs the day.

The top five below map to these in priority order.

---

## 1. The People Spine — person profile, open loops per person, 1:1s, real leave tracking

**Why first:** A manager's #1 job is people, yet the app has no person entity. `developers` is six columns; everything about a human hangs off day rows and link rows. As a result the two most fundamental manager queries — *"what do I owe Sarah?"* and *"what did Sarah and I decide last month?"* — are unanswerable.

**What exists today:**

- Per-person surface is a single-day drawer (`DeveloperTrackerDrawer.tsx`) plus a link-only "Manager follow-up" section (`DeveloperTrackerDrawer.tsx:570-589`).
- A "person" on a desk item means three different things: `assigneeDeveloperAccountId` (which **silently delegates** the item onto their board via `syncTrackerAssignment`, `manager-desk.service.ts:2054-2075`), a `developer` link, or free-text `participants`. The Follow-ups composer labels the delegating field "Person" (`MemoryComposer.tsx:119`) — so "follow up with Sarah" quietly creates work on Sarah's board and doesn't appear in her drawer section.
- Availability is an open-ended inactive switch — no end date in the dialog, no leave type, no "who's out this week" view, even though `developerAvailabilityPeriods` already stores `endDate`.
- No 1:1 entity, no meeting series, no commitment direction (I-owe vs. owes-me), no waiting-on field — `waiting` status is nearly unreachable and renders as "Planned" (`types/manager-desk.ts:59`).

**What to build:**

1. **Person view** — `/people/:id` (or a person selector on Follow-ups) aggregating what already exists: check-ins, tracker history, linked/assigned desk items, meetings, availability periods. All the data is already stored; this is a new range query + page.
2. **Commitment direction on desk items** — a relationship edge (`owed_by_manager` / `owed_by_person` / `waiting_on` / `subject_of`), so open loops group into "I owe them / they owe me / delegated / waiting on."
3. **Meeting series + running notes** — a `seriesId` on meeting items so a weekly 1:1 is one series with occurrences, not N disconnected items bounced by carry-forward (which also erases per-occurrence identity).
4. **Leave booking** — start+end pickers on `AvailabilityDialog`, optional type (pto/holiday/sick), and an "Out this week" strip on Team/Today.

**Effort:** Large (can stage: person view and waiting-on fixes are independently shippable). **Impact:** Very high — this is the difference between a task tracker and a tool that runs the people side of the job.

---

## 2. The Proactive Layer — reminders, a real inbox, and notifications

**Why:** LeadOS is pull-only. Verified: no notification table, scheduler, browser push, email, or digest anywhere in `server/src` or `client/src`. `followUpAt`, snooze presets, and `nextFollowUpAt` (stored but **rendered nowhere**) only change what a future page-load shows. If the manager doesn't open the app, a due follow-up, an expiring snooze, or a developer gone blocked stays silent. A productivity tool that never taps you on the shoulder is half a tool — and it undermines the trust the whole app is built on.

**What exists today:**

- `ManagerActionInbox` in the header is a *computed* queue + dismissible alerts — no unread state, no persistence, no history.
- The scheduler pattern already exists (`SyncEngine.setInterval`, backup service) — the plumbing template is in-repo.
- `ask_check_in` is a defined Today command that is a **navigation no-op** (`today.service.ts:350-355`) — the "ask" never reaches the developer.

**What to build:**

1. **A `reminders`/`notifications` table + scheduler pass** at boot (same pattern as Jira sync): fires on due `followUpAt`, expiring snoozes, `nextFollowUpAt`, stale check-ins, sync errors.
2. **Turn `ManagerActionInbox` into a true inbox** — unread badge, mark-read, history — reusing the existing `alertDismissals` pattern for acknowledgement.
3. **Delivery channels, staged:** in-app first; browser Notification API on the existing 30s poll diff (cheap); optional email/Slack webhook digest later.
4. **Make `ask_check_in` real** — a nudge that lands in the developer's My Day.

**Effort:** Medium for in-app; delivery channels stage incrementally. **Impact:** Very high — converts the app from reference to assistant.

---

## 3. Hindsight & Upward Reporting — weekly review, trends, and exportable status

**Why:** A manager's week ends in reporting: standup summaries, stakeholder updates, "are we winning or losing?" Today the app **captures history it never uses** — `issue_scope_history` (created/resolved/assigned/reopened events) feeds only the 24h `recentlyAssigned` filter; `manager_desk_item_history` powers only per-day snapshots; past days are read-only single dates. There is no weekly summary, no trend line, no export, nothing to paste into a status update.

**What to build:**

1. **Weekly review / report generator** — `GET /api/reports/weekly?week=` aggregating: issues created vs. resolved, carry-forward rate, per-person completed/dropped, check-in freshness, open-loop age. Render a report dialog with **"Copy as Markdown"** — no external delivery needed for v1.
2. **Trend strip** on Work/Today from `issue_scope_history` — "is this week better than last," aging buckets (24h/3d/1w+) replacing the single flat `staleThresholdHours` (which the client ignores anyway — `lib/utils.ts:57` hardcodes 48h).
3. **Data export** — `GET /api/export?scope=desk|tracker|issues&format=csv|json` behind `requireManager`.
4. **Fix the backups surface** while there: `/api/backups` is mounted behind `requireAdmin` on a role **no code path can create** (`app.ts:134`, `middleware/auth.ts:97`) — the entire backups API is dead for real users, with no Settings UI. Remount behind `requireManager` and add a Backups section.

**Effort:** Medium (backups fix is Small). **Impact:** High — this is how the app pays back the data it collects, and it directly serves the manager's obligation to report up.

---

## 4. Project Execution on Work — richer Jira model, status transitions, bulk triage

**Why:** `/work` answers "which defects need triage" but not "how is the project going." The sync pulls no issue type, sprint, epic, fixVersion, issue links, resolution, or comments (`engine.ts:138-153`; default JQL is `issuetype = Bug`). There is no status write-back — the single most common triage action (To Do → In Progress → Done) forces a Jira round-trip. There is no multi-select or bulk action for high-volume intake. Blocked is a bare flag — it can't say blocked-on-what or waiting-on-whom.

**What to build:**

1. **Jira status transitions** — fetch valid transitions per issue, add `POST /issues/:key/transition`, render them in `TriageQuickActions`/`StatusBadge`. `JiraClient` currently has no transitions call at all.
2. **Richer synced fields** — `issuetype`, sprint, fixVersions, epic link, issue links, comment count/last comment; enables type-aware views ("stories vs bugs"), a sprint/milestone lens, and blocker *relationships*.
3. **Bulk triage** — row selection + action bar (assign, priority, due date, flag, tag) over a `POST /issues/bulk` endpoint.
4. **Blocker model** — blocked-since, blocker reason, waiting-on owner, and a one-step "escalate" that posts a Jira comment + creates a linked desk follow-up.

**Effort:** Medium–Large (stages cleanly; transitions alone is Medium). **Impact:** High for a project-running EM — turns Work from a queue into a steering surface. Also fixes real inconsistencies found en route: two parallel due dates where `SuggestionBar` writes the *native* Jira field while everything else uses `developmentDueDate` (`SuggestionBar.tsx:80`), and comments being write-only.

---

## 5. Today as a Real Cockpit — my plan, stage-aware queue, guided standup, one attention model

**Why:** Today is the landing page, but it answers only *"what is on fire"* — never *"what did I commit to today."* `getTodayItems` returns exceptions only; the manager's own planned desk items are invisible. The rhythm stages (morning plan / standup / midday / wrap-up) change a label and nothing else — and the stage is computed on **server-local time** while `date` is client-local, so it's wrong for non-UTC servers. Meanwhile a **second attention engine** (`lib/manager-attention.ts`, ~600 lines) feeds `WorkFocusStrip`, so the header badge and the Today queue can disagree — the exact trust hazard doc 40 warned about.

**What to build:**

1. **"My plan today" strip** — today's `planned`/`in_progress` desk items in the cockpit; morning planning becomes real.
2. **Stage-aware queue on the client clock** — pass tz/date in the query; morning weighs "who lacks a plan," wrap-up weighs unclosed loops and meetings missing outcomes. Add a carry-age signal ("carried 3 days") — the chronic-skip indicator an EM most needs.
3. **Guided standup drawer** — doc-40 Phase 5, never built; `standupPrompts` contract already exists (`shared/types.ts:326-333`). Step through prompts with per-step actions.
4. **Merge the two attention models** — point `WorkFocusStrip` at the server model and delete `manager-attention.ts`; fold stale/flagged-issue alerts into the Today queue so one number is trustworthy. Fix the inverted noise while there: Today flags *every* high-priority open issue vs. alerts' stricter not-started rule.
5. **Time-of-day correctness + morning-noise guard** — honor `followUpAt`/`plannedStartAt` hours (a 17:00 follow-up currently shows "due" at 9am; overdue granularity already differs between desk cards and Today); suppress `stale_by_time`/`no_current` before a configurable day-start so the whole team isn't "stale" at 8:30am; fix `buildSnoozeIso` to compute "tomorrow" in the user's tz.

**Effort:** Medium (several independently shippable Small/Medium pieces). **Impact:** High — makes the home page run the day instead of listing alarms.

---

## Quick wins worth shipping alongside

Independent, low-effort fixes found during the review — each is hours-to-a-day:

| Fix | Where |
|---|---|
| Wire the existing `/status-update` contract into the drawer + My Day status select — blocked/at_risk currently capture no reason even though the backend requires and stores `rationale` + `nextFollowUpAt` | `DeveloperDrawerSections.tsx` status select, `useStatusUpdate` (unused outside tests) |
| Follow-ups → "Open in Desk" navigates to `originDate`, which renders a **read-only history** view for carried items; navigate with today's date | `ManagerMemoryPage.tsx:79`, `today.service.ts:732-735` |
| Remount `/api/backups` behind `requireManager` + add Settings UI (see #3) | `app.ts:134`, `SettingsPanel.tsx` |
| Footer "Capture" on Today navigates to Desk instead of opening `GlobalCaptureDialog`; row-level follow-up capture creates items with no `followUpAt` so they're instantly "due" | `TodayCommandFooter.tsx:21`, `today.service.ts:1284` |
| Fix `waiting` semantics: uniform kind options across the three capture forms, a real "Mark waiting" drawer action, correct `STATUS_LABELS.waiting`, count pending from a `waitingSince` timestamp not `updatedAt` | `QuickCapture.tsx:14`, `DeskCaptureForm.tsx:10`, `types/manager-desk.ts:40,59`, `DrawerWorkflowActions.tsx` |
| Palette verbs ("Mark done…", "Snooze…", "Ask for check-in…") bound to `/api/manager-actions/commands`; nav badges for attention counts (doc 39, still open) | `paletteItems.ts`, `HeaderNav.tsx` |
| Meeting-outcome prompts can't be dismissed without fabricating an outcome — add "No outcome needed" | `today.service.ts:953-960` |
| Suggestion quality: anchor due-date suggestion to `issue.createdAt` (currently `new Date()` — drifts on every open) and write `developmentDueDate` consistently | `routes/suggestions.ts:53`, `SuggestionBar.tsx:80` |
| Excluded issues are unrestorable after the Undo toast — add an "Excluded" management view | `DismissCell`, `useExcludeIssue.ts` |
| Delete dead code: four unwired carry-forward context/preview hooks, `DeskSection.tsx`, unreachable `admin` role path, `component_map` table | `useManagerDesk.ts:199-231`, `useTeamTrackerMutations.ts` |

## Suggested sequencing

1. **Quick wins first** — they're cheap trust repairs that need no schema work.
2. **#5 (Today cockpit)** — highest daily-touch frequency; several pieces are Small.
3. **#2 (proactive layer)** — in-app inbox first; it makes every other feature more trustworthy.
4. **#1 (people spine)** — biggest investment; the person view unlocks 1:1s, per-person loops, and future growth notes cheaply.
5. **#3 and #4** — report/trend layer and project execution can run in parallel; both depend on data the app already collects or a bounded sync-schema extension.
