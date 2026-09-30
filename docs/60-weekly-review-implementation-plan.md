# 60 — Implementation plan: weekly review and proactive nudges

Spec: [docs/59-weekly-review-spec.md](59-weekly-review-spec.md) (design, copy, rules, decisions in §11). This doc is the execution plan and tracker, in the style of [docs/56](56-implementation-plan-solo-first.md). It replaces the parked items **P3-08** (weekly review), **P6-02** (weekly summary and exports) and **P6-03** (daily digest and reminders); docs/56 points here.

## Working rules

Same as docs/56 "Working rules (single checkout)":

- Work sequentially in `/home/ubuntu/Development/lead-os` on `main`. No worktrees, no branches. Start from a clean `git status`.
- **One commit per item**, message `type(scope): summary (WR-nn)`, so any item can be reverted alone. Tick the box and add a Progress log row in the same commit.
- Do not push or deploy unless asked. Never touch `/home/ubuntu/apps/lead-os-prod`.
- Never run against runtime data. Migrations are tested on **copies** of the dev sandbox DB and the prod DB. Never trigger a real Jira sync or write, and never call a real Teams or push endpoint from tests: mock the Jira client, `fetch` and `web-push`.
- Dates: the manager's zone through the local-date helpers (`toZonedIsoDay`, `zonedTimeToUtc`, `getLocalIsoDate`, `workingDaysBetween`), never `toISOString().slice(0, 10)` for "today".
- Routes stay thin (Zod in the route, logic in services). Contracts go in `shared/types.ts`; regenerate `shared/types.js` (command in AGENTS.md) when runtime exports are added.
- Definition of done for every item: code and tests for the acceptance criteria; `npm run typecheck`, `npm run build:check` and the targeted tests pass (`npm run test --workspace=server -- <file>`, `npm run test --workspace=client -- <file>`); service coverage thresholds in `server/vitest.config.ts` hold; manager-only and developer-only boundaries preserved (every new route has a developer-403 test).
- Re-read the cited files before editing: line numbers are from `d4c4819`.

## Ownership

**Opus** takes design-sensitive, data-model and security-sensitive items: WR-01, WR-02, WR-03, WR-09, WR-11, WR-12, WR-13, WR-15.
**Sonnet** takes the well-specified, mechanical items: WR-04, WR-05, WR-06, WR-07, WR-08, WR-10, WR-14, WR-16.

Review rules (as docs/56): Sonnet reviews Opus items for test coverage, role boundaries and AGENTS.md conventions; Opus reviews Sonnet items that touch migrations, outbound data, or the review/report design. Reviews happen at the checkpoints below, before any push or deploy.

## Run order

Each step is one agent session: implement, verify, commit, stop. Trigger them one at a time with the prompt in the last column (or the template below).

| Step | Owner | Item | Needs | Prompt to trigger |
|---|---|---|---|---|
| 1 | Opus | WR-01 Review read model | — | "Implement WR-01 from docs/60." |
| 2 | Opus | WR-02 `weekly_reviews` and save API | WR-01 | "Implement WR-02 from docs/60." |
| 3 | Opus | WR-03 Review mode shell and Look back | WR-02 | "Implement WR-03 from docs/60." |
| 4 | Sonnet | WR-04 Waiting and Loose ends decisions | WR-03 | "Implement WR-04 from docs/60." |
| 5 | Sonnet | WR-05 People and Next week | WR-03 | "Implement WR-05 from docs/60." |
| 6 | Sonnet | WR-06 Entry points and review day | WR-03 | "Implement WR-06 from docs/60." |
| **R1** | Review | Opus reviews WR-04..06; Sonnet reviews WR-01..03 | 1–6 | "Run checkpoint R1 from docs/60." Then **you** run one review on dev data. |
| 7 | Sonnet | WR-07 Report builder | R1 | "Implement WR-07 from docs/60." |
| 8 | Sonnet | WR-08 Send update step and Past updates | WR-07 | "Implement WR-08 from docs/60." |
| 9 | Opus | WR-09 Jira `resolved_at` and the Jira line | WR-07 | "Implement WR-09 from docs/60." |
| 10 | Sonnet | WR-10 CSV export | — | "Implement WR-10 from docs/60." |
| **R2** | Review | Opus reviews WR-07, 08, 10 (report privacy, design); Sonnet reviews WR-09 | 7–10 | "Run checkpoint R2 from docs/60." Phases A+B can ship here. |
| 11 | Opus | WR-11 Digest model and preview | R2 | "Implement WR-11 from docs/60." |
| 12 | Opus | WR-12 Prefs, deliveries and scheduler | WR-11 | "Implement WR-12 from docs/60." |
| 13 | Opus | WR-13 Teams channel and outbound guard | WR-12 | "Implement WR-13 from docs/60." |
| 14 | Sonnet | WR-14 Settings → Notifications | WR-13 | "Implement WR-14 from docs/60." |
| 15 | Opus | WR-15 Browser push | WR-14 | "Implement WR-15 from docs/60." |
| 16 | Sonnet | WR-16 Docs and ops | WR-15 | "Implement WR-16 from docs/60." |
| **R3** | Review | Opus security review of WR-12, 13, 15; Sonnet reviews 11, 14, 16 | 11–16 | "Run checkpoint R3 from docs/60." Then **you** create the Teams workflow and send a test from dev. |

**Prompt template** (for any step): *"Working in /home/ubuntu/Development/lead-os on main. Implement WR-nn from docs/60-weekly-review-implementation-plan.md, following docs/59 and the docs/56 working rules. Start from a clean git status, commit once with `type(scope): summary (WR-nn)`, tick the box and add a Progress log row in docs/60. Do not push."*

Prompts-needed steps: every row is a separate trigger. The three checkpoints need you: R1 (try a review), R2 (decide whether to ship A+B before C), R3 (Teams workflow URL and a test send). WR-15 adds a dependency (`web-push`), which needs `npm install` (network) at that step.

---

## Phase A: Weekly review

- [x] **WR-00** Spec and plan. (Opus; docs only: docs/59, docs/60, docs/56 pointer.)

- [ ] **WR-01** Review read model. (Opus)
  - Files: new `server/src/services/weekly-review.service.ts`, new `server/src/routes/review.ts`, `server/src/app.ts` (mount `/api/review` behind `requireManager`), `shared/types.ts` (`WeeklyReviewResponse`, `WeeklyReviewSection`, `WeeklyReviewRow`, `WeeklyReviewSectionId`).
  - Build on: `TaskViewsService.run` and `taskSignals` (`task-views.service.ts:133,420`), `builtinTaskViews` (`:41`), `taskRowLane` (`:113`), `taskPlanDate` (`:88`), `workingDaysBetween` (`tracker-freshness.ts:47`), `SettingsService.getAttentionRules` (`settings.service.ts:167`), `OneOnOneService.dueSignals` (`one-on-one.service.ts:686`), `toZonedIsoDay` (`today-clock.ts:108`), the `sourceStatus` pattern of `TodayResponse`.
  - Accept:
    - `GET /api/review/week?week=YYYY-MM-DD&tz=` returns the week range (Monday–Sunday in the manager's zone) and sections `closed`, `quiet`, `slipped`, `inbox`, `undated`, `laterNextWeek`, `oneOnOnes` (due next week, missed this week), `people` (blocked/at-risk status), and `checkIns` only when `teamMode === "collab"` (participating developers only).
    - Without `week`, Monday and Tuesday default to last week when last week is not completed (until WR-02 exists, "not completed" is always true); other days default to this week.
    - **Quiet** = check-by passed, or `workingDaysBetween(lastActivity, today) >= rules.managerTouchDays`, applied to rows the Waiting lens matches (`waitingMatch`, `:178`).
    - Closed rows are cut to the manager's calendar days with `toZonedIsoDay` (as `today-plan.service.ts:108-111`). **Undated** = lane `unscheduled` or `inbox`, created 14+ days ago.
    - A failing source (1:1s, team) marks its section `unavailable`; the rest still returns.
    - No schema change.
  - Tests: `server/tests/weekly-review.service.test.ts` (week edges in `Pacific/Auckland` and `Pacific/Honolulu`; Monday default to last week; quiet across a weekend is 5 working days, not 5 calendar days; passed check-by; delegated developer task; another manager's private waiting-on is not "waiting" for me; closed cut per zone; collab-only `checkIns`); `server/tests/review.routes.test.ts` (developer 403, bad `week` 400, bad `tz` falls back).

- [ ] **WR-02** `weekly_reviews` table and save API. (Opus)
  - Files: `server/src/db/schema.ts`, `server/src/db/migrate.ts` (new table, `CREATE TABLE IF NOT EXISTS`), `weekly-review.service.ts`, `routes/review.ts`, `shared/types.ts`.
  - Accept:
    - Table as docs/59 §9, unique `(workspace_id, manager_account_id, week_start)`, `week_start` must be a Monday (400 otherwise).
    - `PUT /api/review/week/:weekStart` upserts: `step`, `decisions` (merged by task key), `excluded`, `reportMarkdown` (≤ 20 000 chars), `completed: true` (sets `completed_at`), `dismissed: true` (sets `dismissed_at`).
    - `GET /api/review/week` includes the saved state; `GET /api/review/weeks?limit=12` lists completed weeks, newest first, with `reportMarkdown`.
    - WR-01's Monday default now uses `completed_at`/`dismissed_at`.
    - Rows are private to the manager: another manager in the same workspace cannot read or write them (404).
  - Tests: `db.migrate.test.ts` (table created, idempotent); routes (merge, complete, dismiss, other-manager isolation, developer 403); migration run on copies of the dev sandbox DB and the prod DB (integrity check ok, re-run is a no-op), recorded in the Progress log.

- [ ] **WR-03** Review mode shell and step 1 Look back. (Opus, design-sensitive)
  - Files: new `client/src/components/review/` (`WeeklyReviewMode.tsx`, `ReviewHeader.tsx`, `ReviewStepsRail.tsx`, `ReviewLookBackStep.tsx`, `review.css`), new `client/src/hooks/useWeeklyReview.ts`, `client/src/lib/api.ts`, `client/src/App.tsx` (`/?mode=review[&week=]`, as `/team?mode=standup` at `App.tsx:461,879`), `TodayPage.tsx` (render the mode in place of the page body).
  - Accept:
    - Layout, copy, states, keyboard, accessibility and phone layout exactly as docs/59 §5.2–§5.7, for the shell and step 1. Steps not built yet are left out of the rail; WR-04, WR-05 and WR-08 each add theirs, so every commit ships a working review.
    - Step 1: groups Mine / Delegated (Jira arrives in WR-09), **In update** checkboxes saved to `excluded` (debounced), `x` toggles, `o` opens the task drawer.
    - Step changes save `step`; reopening resumes. Focus moves to the step heading; `Esc` exits to Today; keys are ignored in fields (`shouldIgnoreTriageEvent`).
    - Tokens only; `--on-accent` on the accent button; no motion under `prefers-reduced-motion`.
  - Tests: `client/src/test/WeeklyReviewMode.test.tsx` (step navigation with `]`/`[`/digits, focus on heading, resume from saved step, `x` saves exclusion, keys ignored in an input, error state with Retry, partial source line); an App routing test for `/?mode=review` and Esc back to `/`.

- [ ] **WR-04** Steps 2 and 3: decisions. (Sonnet)
  - Files: `client/src/components/review/ReviewDecisionRow.tsx`, `ReviewWaitingStep.tsx`, `ReviewLooseEndsStep.tsx`; reuse the schedule and check-by menus (`TaskMenus.tsx:94-117,289-292`) and the Tasks bulk mutation with undo (`POST /api/tasks/bulk`, `UNDO_WINDOW_MS`).
  - Accept (exact writes; every one undoable with `z` or the row's Undo):

    | Action | Patch |
    |---|---|
    | Check Mon | `followUpAt` = next workday 09:00 in the manager's zone (`zonedTimeToUtc`, as `/f`) |
    | Still waiting | `followUpAt` = today + 7 days, 09:00 |
    | Got it / Done | `status: "done"` |
    | Stop waiting | clear waiting-on (`waitingOn: null`) |
    | Monday | `scheduledOn` = next workday |
    | Drop | `status: "dropped"` |
    | `s` menu | the existing schedule presets, Later included |

    - Each decision is also saved to `decisions` (WR-02). Decided rows collapse to one line and stay in place; the live region announces the change.
    - Grouping and chips as docs/59 §5.3; success empties.
  - Tests: `client/src/test/ReviewDecisions.test.tsx` (each action sends the patch above, undo sends the inverse, decision saved, next workday from a Friday is Monday, row stays in place, announcement text).

- [ ] **WR-05** Steps 4 and 5: People and Next week. (Sonnet)
  - Files: `ReviewPeopleStep.tsx`, `ReviewNextWeekStep.tsx`, `client/src/hooks/useTodayTop3.ts` (pin for a given date), a `nextWorkday` helper in `client/src/lib/utils.ts`.
  - Accept:
    - People: 1:1 rows only when `features.oneOnOne`; **Open 1:1** targets `/team?dev=<id>&panel=one-on-one`; **Skip** uses the existing session PATCH; status rows for blocked/at risk; the collab-only check-in line; the step is hidden when the roster is empty.
    - Next week: candidate order as docs/59 §5.3; **Pick** and `p` pin up to 3 through `PUT /api/today/top3` with the next workday's date; per-day counts; "Back from Later next week".
  - Tests: people step in solo vs collab (check-in line absent in solo), hidden with an empty roster, 1:1 rows hidden without the feature; pins sent with Monday's date on a Friday, limit 3 enforced.

- [ ] **WR-06** Entry points and review day. (Sonnet)
  - Files: `server/src/services/settings.service.ts` (`weekly_review_day`, default 5; `weekly_review_in_wrapup`, default on), `routes/today.ts` and `today.service.ts` (`/api/today/settings` accepts both as optional fields; `TodayResponse.weeklyReview: { due, completedAt?, catchUp? }`), `TodayWrapUp.tsx` (first row), the morning panel (`today-layout.ts:35-48`, `TodayPage.tsx`), `SettingsPanel.tsx` Day Rhythm, `components/palette/paletteItems.ts` (Weekly review, Copy weekly update → opens step 6), `TaskViewRail.tsx` (Review section link).
  - Accept: the wrap-up row shows only on the review day; the done state reads "Weekly review done · 15:42"; the Monday/Tuesday catch-up row with **Not this week** (sets `dismissed`); the palette entries; the rail link; Settings saves the day. The Today cache is cleared on settings writes.
  - Tests: `today-stage.test.ts` (row on the review day only, catch-up on Monday, not after completion or dismissal), `TodayWrapUp` test, palette test, settings route test (validation 0–6).

### Checkpoint R1

- Opus reviews WR-04..06; Sonnet reviews WR-01..03 (coverage, role boundaries, AGENTS.md conventions). Fix findings in their own commits.
- **You:** run one review on the dev sandbox (never prod data) and note anything that took too long or felt like a chore.

## Phase B: Update and export

- [ ] **WR-07** Report builder. (Sonnet)
  - Files: new `client/src/lib/weekly-report.ts` (`buildWeeklyReport(review, state) → WeeklyReportModel`, `toMarkdown`, `toHtml`).
  - Accept: sections and order, line caps and omissions exactly as docs/59 §6; delegated rows end "— Name"; no task keys; only titles, names, counts, dates and status notes; Markdown special characters in titles are escaped; every value is HTML-escaped in `toHtml`; the Jira line appears only when the review carries Jira data (WR-09).
  - Tests: `client/src/test/weekly-report.test.ts` (the docs/59 §6 example reproduced byte for byte from a fixture; `<script>` and `&` in a title; `*`/`_` in a title; empty sections left out; "Nothing to report" never copied; dropped rows excluded by default).

- [ ] **WR-08** Step 6 Send update and Past updates. (Sonnet; Opus design review at R2)
  - Files: `client/src/components/review/ReviewSendStep.tsx`, `ReviewPastUpdates.tsx`, new `client/src/lib/clipboard.ts`.
  - Accept: preview with per-line checkboxes (`x`); **Edit text** textarea (edits are kept in `reportMarkdown`); **Copy for Teams** writes `text/html` and `text/plain` through `ClipboardItem`, falling back to `writeText` with the toast "Copied as text"; **Copy Markdown**; `y` copies; **Finish review** saves `reportMarkdown` and `completed`, toasts "Review done · Monday is planned", and returns to Today; Past updates lists completed weeks with **Copy** and **Copy last 4 weeks**; the palette's **Copy weekly update** builds from defaults without completing the review.
  - Tests: clipboard payload types and fallback; finish saves and navigates; past updates copy order (newest first); palette command.

- [ ] **WR-09** Jira `resolved_at` and the Jira line. (Opus)
  - Files: `server/src/db/schema.ts` and `migrate.ts` (`ALTER TABLE issues ADD COLUMN resolved_at TEXT`, in the ALTER list at `migrate.ts:670-686`), `server/src/sync/engine.ts` (add `resolutiondate` to the field list at `:157-171`, map it near `:260-283`; if Jira sends none, set it when a row moves into the `done` category), `weekly-review.service.ts` (`jira` section: resolved, opened, critical open, top resolved, using `isVisibleWorkIssue`, `issue-rules.ts:29`), `shared/types.ts`, step 1 Jira group, and the report line in `weekly-report.ts`.
  - Accept: additive, nullable column; no backfill (it fills on the next scheduled sync); the section is absent when Jira is not configured; "Defects: 3 opened · 1 critical open" when no resolved data exists (never a misleading 0 resolved).
  - Tests: `sync.engine.test.ts` with a **mocked** Jira client (mapping, done-transition fallback, not overwritten once set); review Jira section tests; `db.migrate.test.ts`; migration on copies of the dev and prod DBs. No real sync.

- [ ] **WR-10** CSV export. (Sonnet)
  - Files: new `client/src/lib/csv.ts`; `client/src/components/tasks/TaskToolbar.tsx` (**Export CSV** in the toolbar's overflow); the Work dashboard toolbar (export the filtered rows `DefectTable.tsx` renders); review step 6 **Download CSV** (closed this week).
  - Accept: Tasks columns Key, Title, Status, Lane, Owner, Waiting on, Plan date, Deadline, Check by, Priority, Labels, Jira, Created, Closed; Work columns Key, Summary, Status, Priority, Assignee, Due, Dev due, Tags, Updated; exports exactly the rows of the current view and filters; formula-injection guard, UTF-8 BOM, CRLF; filename `leados-{tasks|work}-{view}-{YYYY-MM-DD}.csv` with the local date.
  - Tests: `client/src/test/csv.test.ts` (quotes, commas, newlines, `=`/`+`/`-`/`@` prefixing, BOM); Tasks toolbar export uses the current view's rows.

### Checkpoint R2

- Opus reviews WR-07, WR-08 and WR-10 (nothing private reaches the report or CSV beyond what docs/59 §6 and §10 allow; the step matches §5); Sonnet reviews WR-09.
- **You:** decide whether to deploy Phases A+B before starting C (the deploy itself is separate and only on request).

## Phase C: Digest and reminders

- [ ] **WR-11** Digest model and preview. (Opus)
  - Files: new `server/src/services/digest.service.ts` (pure `build(principal, localDate, tz) → DigestModel`), new `server/src/routes/notifications.ts` (`GET /api/notifications/digest/preview?tz=`), `shared/types.ts` (`DigestModel`, `DigestSection`), `today-plan.service.ts` (`returnedFromLaterCount`: Later tasks whose `hide_until` is today), `TodayPlanPanel.tsx` ("· 2 back from Later" on the Inbox row).
  - Accept: sections, order, caps ("+3 more") and the review/catch-up lines exactly as docs/59 §7.1, reusing `TodayPlanService` and the task views rather than new queries; `isEmpty` when every section is empty and it is neither the review day nor catch-up.
  - Tests: `server/tests/digest.service.test.ts` (each section; caps; Monday "from Friday's review" header; review-day and catch-up lines; empty; zone edges); preview route (developer 403).

- [ ] **WR-12** Prefs, deliveries and scheduler. (Opus)
  - Files: `schema.ts`, `migrate.ts` (`notification_prefs`, `notification_deliveries` with the partial unique index), new `server/src/services/notification-settings.service.ts`, new `server/src/notifications/scheduler.ts`, `server/src/index.ts` (start after `backupService.initialize()`), routes `GET/PUT /api/notifications/settings`, `GET /api/notifications/deliveries`.
  - Accept:
    - A 5-minute tick (the `BackupService.start` pattern, `backup.service.ts:57-73`; timer `unref`'d). For each manager with the digest on: local time from `AttentionRules.timeZone`; weekdays only when set; within `[digest_time, digest_time + 3 h)`; otherwise a missed day is recorded `skipped`.
    - **Claim, then send:** insert the delivery row (`sending`) first; a unique conflict means another tick has it. One retry after 15 minutes on failure (`attempts` ≤ 2).
    - With no channel configured nothing is sent. Channels plug in through one `DigestChannel` interface (`send(model, prefs)`).
    - `PUT` validates `HH:MM`, stores `app_url` from the request body's `appUrl` (HTTPS, or `http://localhost` in development) unless `APP_PUBLIC_URL` is set.
  - Tests: `server/tests/notification-scheduler.test.ts` with an injected clock (sends once at 08:30; two concurrent ticks send once; restart at 10:00 still sends; restart at 12:00 records skipped; weekend skipped; DST change week; skip-empty; retry once); routes (validation, developer 403); migration on copies of the dev and prod DBs.

- [ ] **WR-13** Teams channel and outbound guard. (Opus, security)
  - Files: new `server/src/notifications/teams.ts` (Adaptive Card 1.4 builder, titles and counts-only variants), new `server/src/notifications/outbound-guard.ts`, `notification-settings.service.ts` (encrypt with `secret-crypto`; GET returns only `hasTeamsWebhook` and `teamsHost`), `utils/logger.ts` (add the webhook fields to `redact`), `POST /api/notifications/test` (throttled, one per 30 s), `today.service.ts` (`digestFailing` when the latest digest delivery failed), a quiet Today row "Teams digest failed · Fix in Settings".
  - Accept: the guard rules in docs/59 §10 (HTTPS, 443, host suffix allowlist `.logic.azure.com` / `.powerplatform.com` plus `NOTIFY_WEBHOOK_EXTRA_HOSTS`, resolved address not private/loopback/link-local, no redirects, 10 s timeout); errors are stored as ≤ 200 redacted characters; the card matches docs/59 §7.2; counts-only carries no titles.
  - Tests: card snapshots (titles and counts-only); guard (http URL, other host, IP literal, host resolving to `127.0.0.1` and `10.x`, redirect refused, timeout); the URL never appears in GET responses or captured logs; `fetch` mocked, no network.

- [ ] **WR-14** Settings → Notifications. (Sonnet)
  - Files: `SettingsPanel.tsx` (section list at `:840-851`, id `notifications`), new `client/src/components/settings/NotificationsSection.tsx`, new `client/src/hooks/useNotificationSettings.ts`, `client/src/lib/api.ts`.
  - Accept: layout and copy exactly as docs/59 §7.3 (without the browser block, which WR-15 adds); the webhook field is write-only (shows host, **Replace**, **Remove**); **Send test** and **Preview today's digest** (a `Dialog` rendering the model); recent deliveries; the zone line links to Attention rules; sends `appUrl: window.location.origin` on save.
  - Tests: save flow, write-only webhook, test send success and error text, preview dialog, deep link `?section=notifications`.

- [ ] **WR-15** Browser push. (Opus, security)
  - Files: `server/package.json` (`web-push`), new `server/src/notifications/push.ts` (VAPID keys generated once and stored in config, private key encrypted; send; 404/410 removes the subscription), `schema.ts` / `migrate.ts` (`push_subscriptions`), routes `GET /push/key`, `POST` / `DELETE /push/subscriptions`, `auth-user-maintenance.service.ts` (delete a user's subscriptions), new `client/public/sw.js` (`push` and `notificationclick` only; no `fetch` handler, no caching), new `client/public/manifest.webmanifest` and its `<link>` in `client/index.html`, new `client/src/lib/push.ts`, the "This browser" block in `NotificationsSection.tsx`.
  - Accept: turning on asks permission only from the button; denied permission shows "Notifications are blocked in this browser's settings."; one push per digest with the docs/59 §7.2 title and body; the click opens `/` (or `/?mode=review` on the review day); `sw.js` is served with `Cache-Control: no-cache` and registered with `updateViaCache: 'none'`.
  - Tests: routes with a mocked `web-push` (subscribe, duplicate endpoint, 410 cleanup, developer 403, user deletion removes rows); `app.static.test.ts` (sw.js headers); client permission-denied state. No real push service.

- [ ] **WR-16** Docs and ops. (Sonnet)
  - Files: `AGENTS.md` (routes `/api/review`, `/api/notifications`; `/?mode=review`; Settings → Notifications; the new tables; the scheduler in Backend Map), `docs/23` (env `APP_PUBLIC_URL`, `NOTIFY_WEBHOOK_EXTRA_HOSTS`; Power Automate steps: Teams → Workflows → "Post to a chat when a webhook request is received" → copy URL → Settings → Notifications → Send test; push on iPhone needs Add to Home Screen), `.env.example`.
  - Accept: a new agent can find every new surface from AGENTS.md; the runbook works end to end on dev.

### Checkpoint R3

- Opus: security review of WR-12, WR-13 and WR-15 (secret handling, SSRF guard, data leaving the box, subscription cleanup). Sonnet reviews WR-11, WR-14 and WR-16.
- **You:** create the Teams workflow, paste it on **dev**, send a test, and turn on push on one device. Production deploy follows docs/23 when you ask for it (back up prod, test migrations on a copy of the prod DB first).

---

## Progress log

| Date | Item | Branch / PR | Agent | Notes |
|---|---|---|---|---|
| 2026-09-30 | WR-00 | main (single commit) | Opus | Spec docs/59 and this plan. Decisions from the user are in docs/59 §11: Teams (Power Automate) + browser push + in-app; boss update = Shipped · Next week · Blocked & risks; Friday ~10 min; quiet one-digest reminders; quiet = 5 working days or check-by passed; titles to Teams (capped, counts-only switch); Jira line with `resolved_at`; order review → report → digest; numbered 59/60 because docs/58 exists. |
