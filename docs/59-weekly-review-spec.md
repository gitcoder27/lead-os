# 59 — Weekly review and proactive nudges (spec)

Status: **draft for sign-off** (decisions in §11). No code changes.
Inputs: [docs/55](55-solo-vs-collaborative-review.md) P0 #11 ("Nothing reaches the manager unprompted"), [docs/56](56-implementation-plan-solo-first.md) P3-08, P6-02, P6-03, [docs/57](57-tasks-consolidation-spec.md) (lanes, waiting-on, check-by, Later), [docs/58](58-manager-one-stop-review.md) findings 2 and 3, [docs/40](40-today-v2-actionable-manager-cockpit.md) and [docs/53](53-today-screen-review.md) (Today design language).
Line numbers are from `main` at `d4c4819`. Execution plan: [docs/60](60-weekly-review-implementation-plan.md).

## 1. Problem and goals

LeadOS only helps while it is open. A solo manager has nobody else prompting them, so anything that isn't on screen gets forgotten: a Later task that came back, a check-by date on a delegated item, a 1:1 that slipped. At the end of the week there is no single moment to close the week, and the manager still assembles the boss update by hand.

Three moments, and what each one needs:

| Moment | The question | What LeadOS gives |
|---|---|---|
| **Friday ~15:30** | "What actually got done, what's slipping, what do I owe, and what's Monday?" | A 10-minute guided **weekly review** that ends with Monday's top 3 and a ready-to-paste **update for my boss**. |
| **Monday 08:30** (and every workday) | "What will I forget today?" | One quiet **morning digest** in Teams and/or a browser notification: top 3, due, overdue, check-bys that arrived, items back from Later, 1:1s today. |
| **Before a skip-level** | "What have we done this month?" | The saved weekly updates, and CSV of any Tasks view. |

**Goals**
1. Finish a Friday review and produce a credible update in **≤ 10 minutes**, without another tool.
2. Monday starts planned: Friday's decisions show up as Monday's plan and top 3.
3. At most **one** outbound message a day. Nothing important depends on having the app open.
4. Works fully in solo mode (no developer logins); collab mode gains only read-only extras.

### Where this spec pushes back on the framing

- **"Reminders" are not a second system.** Later items already resurface on their own date through the lane rule (docs/57 §1: no job runs, nothing is written), and check-by dates already bring waiting items back on Today. What is missing is *reach*, not state. So a reminder becomes a line in the one morning digest. There is no reminder table and no per-item timer.
- **The review is exception-based, not a per-item chore.** Closed items need no decision. A row you skip is simply kept. Only the items that went quiet or slipped ask for a decision, and every decision is one key or one click with Undo.
- **The report is a by-product of the review.** Its last step writes the update from what you just reviewed. "Copy weekly update" also works on its own (palette) for weeks you skip the review.
- **The digest does not duplicate Today.** It is a pointer plus the handful of things you would otherwise forget. Opening Today still shows the full picture.
- **CSV everywhere adds little.** CSV (a new `client/src/lib/csv.ts`, created by WR-10) comes from Tasks (any view, so also "Closed · last 7 days") and from Work. Team is not exported.

## 2. Non-goals

- Sending the update to the boss directly (it is copied; you paste it into Teams or Outlook).
- Email/SMTP, Slack or generic webhooks (the channel code has one interface, so they can follow).
- Per-item reminder messages at a time of day. Quiet mode is the only mode in v1.
- Copilot-written narrative. The report is deterministic. Copilot `morning_brief` and `get_week_summary` (P6-04) stay parked, and will read the same builders later.
- Developer-facing notifications or digests. Developer surfaces are unchanged.
- Recurrence (P3-07) and monthly roll-ups beyond "copy past updates".

## 3. User stories

1. On Friday afternoon, Today's wrap-up offers **Weekly review · ~10 min**. I open it, see what closed, and untick anything not worth reporting.
2. I see delegated and waiting items that went quiet (check-by passed, or no activity for 5 working days) and decide per item: check Monday, got it, drop.
3. I see my own slipped tasks, Inbox leftovers and old undated tasks, and move them to Monday, pick a date, park them, or drop them.
4. I see 1:1s due next week or missed this week, and people I marked blocked or at risk.
5. I pick Monday's top 3.
6. I get a short update (Shipped · Next week · Blocked & risks), edit it if I want, and **Copy for Teams**. It pastes as formatted bullets.
7. On Monday at 08:30 a Teams message tells me Monday's top 3, what's due, and which check-bys arrived. If I skipped Friday, it says so and Today offers **Review last week**.
8. Before a skip-level I open past updates and copy the last four weeks.
9. From any Tasks view I download a CSV.

## 4. Data the feature draws on (no new sources)

| Need | Built on |
|---|---|
| Closed this week | the `closed` filter and `closed-week` built-in (`task-views.service.ts:41-68`), cut to the manager's calendar days with `toZonedIsoDay` as `TodayPlanService` does (`today-plan.service.ts:108-111`) |
| Waiting and delegated, gone quiet | the Waiting lens rule `waitingMatch` (`task-views.service.ts:178`) plus `TaskSignals.followUpDue` / `waitingDays` (`:133`). **Quiet** = check-by passed, or `workingDaysBetween(lastActivity, today) >= AttentionRules.managerTouchDays` (`tracker-freshness.ts:47`, default 5 working days) |
| Slipped, Inbox, undated | `taskRowLane` / `taskLane` (`task-views.service.ts:113`, `shared/types.ts:1197`) and `taskPlanDate` (`:88`) |
| Later coming back next week | `later = 1` and `hide_until` inside next week (`isTaskHidden`, `shared/types.ts:1193`) |
| 1:1s due and missed | `OneOnOneService.dueSignals` (`one-on-one.service.ts:686`) for due, sessions `scheduled` in the week and now past or `skipped` for missed (`shared/types.ts:2401`) |
| People at risk | tracker status `blocked` / `at_risk` (`TrackerDeveloperStatus`, `shared/types.ts:911`), manager-set in solo |
| Check-in cadence (collab only) | the check-in clock in `buildSignals` (`tracker-freshness.ts:80`), only when `collab && participates` |
| Monday's top 3 | `PUT /api/today/top3` with the next workday's date (`routes/today.ts:88`, `task.service.ts:950`; any date is accepted) |
| Decisions | `POST /api/tasks/bulk` (`routes/tasks.ts:70`, `task.service.ts:401`), undo as on Tasks (`UNDO_WINDOW_MS`, `lib/undo.ts:5`) |
| Jira numbers | `issues` rows filtered by `isVisibleWorkIssue` (`issue-rules.ts:29`) plus a new `resolved_at` (§9) |
| Manager's time zone (server side) | `AttentionRules.timeZone` (`shared/types.ts:1230`, `settings.service.ts:167`); the client sends `tz` for interactive reads as Today does (`routes/today.ts:13`) |
| Scheduler | the `setInterval` service pattern of `BackupService.start` (`backup.service.ts:57-73`) and `SyncEngine.start` (`sync/engine.ts:33-44`), started from `index.ts` |
| Secrets at rest | `secret-crypto.ts` (`enc:v1:` prefix), as the Copilot key and Jira token use |
| 1:1 exclusion | `one_on_one_agenda_items.task_id` (`schema.ts:715`), scoped by `workspace_id` (see "1:1 tasks are never in the review" below) |

**1:1 tasks are never in the review.** Since P0-S5, 1:1 agenda topics are ordinary manager-owned, undated tasks. The only marker on the task itself is `meta.source = "one_on_one"` on its creation event, which is not a reliable filter (it is an event, and tasks attached later carry no such marker). The reliable join is `one_on_one_agenda_items.task_id`. **Every section of the review, the report builder, the CSV export and the digest exclude every task referenced by `one_on_one_agenda_items` for the workspace.** Why: a done topic such as "discuss performance concerns with Sam" would otherwise land under **Shipped** in the boss update, and an open one under Loose ends or Next week. The exclusion is one shared helper (a set of task ids, read once per request) applied in `WeeklyReviewService` and `DigestService`; the client-side report builder only sees the review rows the server returned, so it adds no filter of its own. The Tasks CSV exports the rows the Tasks list holds, so the Tasks list response marks agenda-linked rows (`oneOnOne: true`, from the same helper) and WR-10's export drops them (§9).

**Session action items** (`OneOnOneService.createSessionAction`) are manager-owned normal tasks (or developer-assigned when the manager chose that) that are attached to the same agenda through `attachTask`, so they are in `one_on_one_agenda_items` too and are covered by the same exclusion. Decision: they are **excluded everywhere the agenda topics are** (review, report, CSV, digest), not shown-but-unticked. Justification: their titles are as sensitive as topics ("Put Sam on a PIP timeline"), the data cannot tell a topic from an action item (both are agenda rows), and a "default off" that still lists them in the review invites one stray tick to leak them. They stay fully visible on Tasks, Today and in the 1:1 workspace. Known trade-off: an ordinary task the manager attached to a 1:1 with "Add to agenda…" is hidden from the review as well; the manager can still report it by editing the update text. This is deliberately conservative and can be relaxed later by adding an explicit marker.

**Week.** Monday to Sunday in the manager's zone. "This week" in the review means Monday to now. On Monday and Tuesday, if last week has no completed review, the review opens on **last week** (with a "This week" switch). Dates always come from the local-date helpers (`toZonedIsoDay`, `getLocalIsoDate`), never `toISOString().slice(0, 10)`.

## 5. Design

The visual rules are docs/40's: list rows and dividers, not cards; one primary action per row; accent, warning, danger and success only for meaning; no explanatory copy. All colours are tokens (`--accent`, `--on-accent`, `--success`, `--warning`, `--danger`, `--text-*`, `--bg-*`, `--border`), so dark and light work with no extra rules.

### 5.1 Where it lives

Weekly review is a **mode of Today**, not a new page (docs/58 guardrail: no new top-level pages). URL: `/?mode=review` (optional `&week=2026-09-28`), following the Standup precedent `/team?mode=standup` (`App.tsx:461`, `:879`). Entry points:

- Today's wrap-up on the review day (default Friday): the first row of the wrap-up panel (`TodayWrapUp.tsx:51`).
- Today on Monday and Tuesday when last week is not reviewed: a row in the morning panel.
- Palette: **Weekly review** (Phase A), **Copy weekly update** (added with step 6).
- Tasks rail, Review section: **Weekly review** under "Closed · last 7 days".
- The Friday digest line (Phase C).

**Wrap-up row** (review day, not yet done):

```
 ◎  Weekly review                     ~10 min        [ Start review ]
```

Done: `✓  Weekly review done · 15:42          [ Copy update ]` (neutral tone).
Monday catch-up: `◎  Review last week · ~10 min   [ Start ]  [ Not this week ]`. "Not this week" records a dismissal for that week only.

### 5.2 The review screen (desktop)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Weekly review · 28 Sep – 2 Oct                  Step 2 of 6    [ Exit  Esc ]│
│ ━━━━━━━━━━━━━━━━━━━━━━━━──────────────────────────────────────────────────  │
├──────────────────┬─────────────────────────────────────────────────────────┤
│ ✓ Look back   12 │  Waiting & delegated                        4 went quiet │
│ ● Waiting      4 │                                                          │
│ ○ Loose ends   7 │  Legal · 1                                               │
│ ○ People       2 │  ◷ Vendor DPA signed        Waiting 9d · Check was Wed   │
│ ○ Next week      │                             [ Check Mon ]  Got it  ⋯      │
│ ○ Send update    │  Priya · 2                                               │
│                  │  ◷ Search re-index          Quiet 6 working days          │
│                  │                             [ Check Mon ]  Got it  ⋯      │
│                  │  ✓ Alerting runbook  → Check Mon          Undo            │
│                  │                                                          │
│                  │                          [ ← Look back ]  [ Loose ends → ]│
└──────────────────┴─────────────────────────────────────────────────────────┘
```

- **Header:** `h2` "Weekly review · {range}", a thin progress bar (accent fill on `--bg-tertiary`), "Step n of 6", Exit. `~10 min` shows only before the first step is left.
- **Steps rail:** `<nav aria-label="Review steps"><ol>` with `aria-current="step"`. Each step shows its count; a finished step shows a check in `--success`. Any step can be opened; nothing is locked.
- **Rows:** docs/40 row anatomy `[icon] title · context · chip · primary · ⋯`, grouped under quiet sub-heads (`today-subhead`). A decided row collapses to one line with the decision ("→ Mon", "Dropped", "Done") and an inline Undo for the undo window. Rows are never removed while the step is open, so focus never jumps.
- **Footer:** Back and Next buttons naming the neighbouring step. Next is the accent button.
- Progress (current step, decisions, report exclusions) is saved server-side, so leaving and returning resumes (§9).

### 5.3 Steps and exact copy

| # | Step (rail label) | Heading · count | Rows and primary action | Other actions (⋯ and keys) | Empty state |
|---|---|---|---|---|---|
| 1 | Look back | "What closed this week" · "12 done · 2 dropped · 3 slipped" | Groups **Mine**, **Delegated**, **Jira** (when connected: "7 resolved · 3 opened · 1 critical open"). Each row has an **In update** checkbox, on for done, off for dropped. | `x` toggle In update · `o` open | "Nothing closed this week" |
| 2 | Waiting | "Waiting & delegated" · "4 went quiet" | Grouped by party (the Waiting lens `party` group). Chips: `Waiting 9d`, `Check was Wed` (danger), `Quiet 6 working days`. Primary **Check Mon** (check-by → next workday 09:00). | **Got it** (done) · **Still waiting** (check-by +1 week) · **Stop waiting** (clear waiting-on) · Drop · `c` check-by menu | "Nothing has gone quiet" (success) |
| 3 | Loose ends | "Loose ends" · "7 to decide" | Groups **Slipped** (my planned tasks whose plan date passed), **Inbox**, **Undated for 2+ weeks**. Primary **Monday** (plan date → next workday). | `s` schedule menu (includes Later, `s l`) · `e` done · `#` drop | "No loose ends" (success) |
| 4 | People | "People" · "2 need you" | **1:1s**: "Due next week" and "Missed this week" rows, primary **Open 1:1**. **Status**: people marked blocked or at risk, primary **Open**. Collab only: **Check-ins this week**, a read-only line per participating developer ("3 of 5 days"). | Skip session · open person | "Nothing needs you here" (success). Hidden when the roster is empty. |
| 5 | Next week | "Monday's top 3" · "1 of 3" | Candidates: tasks moved to Monday in steps 2–3, then high priority tasks planned next week, then other planned tasks. Primary **Pick**; picked rows show a pin and **Remove**. Below: "Planned next week", a compact count per day (Mon 4 · Tue 2 …), and "Back from Later next week · 2". | `p` pick/unpick | "Nothing planned next week" with **Capture a task** |
| 6 | Send update | "Update for your manager" | Preview (§6) with per-line checkboxes (lines that name a person are unticked by default and carry the hint "Names a person"); **Edit text** switches to a textarea. Primary **Copy for Teams**; secondary **Copy Markdown**, **Download CSV** (closed this week). Then **Finish review**. | `y` copy for Teams · `x` toggle a line | never empty: sections with nothing say "Nothing to report" and are left out of the copy |

Finishing shows the toast "Review done · Monday is planned" and returns to Today. The step-6 disclosure **Past updates** lists earlier weeks (date, first line) with **Copy** each and **Copy last 4 weeks**.

### 5.4 States

- **Loading:** the header and rail render at once; the step body shows three skeleton rows (`TaskListSkeleton`, `TaskListStates.tsx:20`). No spinner-only screens.
- **Partial:** each section carries its source status, as Today does (`TodayResponse.sourceStatus`). A failed source shows an inline line in its group: "Couldn't load Jira · Retry". The rest works.
- **Error:** `EmptyState` "Couldn't load your week" with **Retry** and **Back to Today**.
- **Write failure:** the row returns to undecided, and the error toast persists (`role="alert"`, P7-01 behaviour).
- **Already completed:** opening the review again shows it read-only at step 6, with **Review again** (re-opens the same week's record).
- **No data at all** (new workspace): step 1 empty state, and steps 2–5 show their success empties. Step 6 says "Nothing to report yet".

### 5.5 Keyboard

The Tasks keymap (`TasksPage.tsx:655-677`), so nothing has to be relearned: `j`/`k` move, `o`/`Enter` open drawer, `e` done, `#` drop, `s` schedule menu (`t`, `m`, `w` next Monday, `l` Later, digits for weekdays), `c` check-by menu, `z` undo, `?` shortcut sheet (`ShortcutSheet`). Review-only keys: `x` toggle **In update**, `p` pick for Monday, `]` / `[` next and previous step, `1`–`6` jump to a step, `y` copy for Teams, `Esc` exit. Keys are ignored while typing in a field (`shouldIgnoreTriageEvent`, `lib/today-triage.ts:67`).

### 5.6 Accessibility

- One `h2` per step; on step change, focus moves to the step heading (`tabIndex={-1}`). The rail is a real ordered list with `aria-current="step"`.
- Each row group is a `role="list"`; decisions are announced in one polite live region ("Moved to Monday. Press z to undo.").
- **In update** is a real `<input type="checkbox">` with the row title as its label.
- Chips carry text, never colour alone ("Check was Wed", not only red).
- Motion: rows collapse with a 120 ms opacity/height change (`--dur-fast`); none under `prefers-reduced-motion`, following `today.css:183`.
- Contrast: existing tokens only. `--on-accent` on the accent button, never white.

### 5.7 Phone (≈390 px)

```
┌──────────────────────────────┐
│ Weekly review        ✕       │
│ Waiting · 2 of 6  ━━━──────  │
├──────────────────────────────┤
│ Legal · 1                    │
│ ◷ Vendor DPA signed          │
│   Waiting 9d · Check was Wed │
│   [ Check Mon ]  Got it  ⋯   │
│ …                            │
├──────────────────────────────┤
│ [ ← ]        [ Loose ends → ]│  sticky, safe-area inset
└──────────────────────────────┘
```

The rail becomes the one-line "Step · n of 6" label (tap opens the step list as a `Popover`). Rows use docs/40's mobile anatomy. The footer is sticky with `env(safe-area-inset-bottom)`. One scroller. Menus are the existing popovers; dialogs are already bottom sheets.

## 6. The update (report format)

Short bullets for the manager's boss, pasted into Teams or Outlook. Three sections, in this order, each left out when empty. Target: 10–20 lines.

- **Shipped:** checked closed tasks (mine and delegated, done only), then one Jira line when connected: "Defects: 7 resolved, 3 opened · 1 critical open (PAY-412)", then up to 3 resolved high-priority issues.
- **Next week:** Monday's top 3, then high-priority tasks planned next week (up to 5 lines in total).
- **Blocked & risks:** blocked tasks; waiting items whose check-by passed ("Waiting on Legal · 9 days"); people marked blocked or at risk, with their status note when there is one (**unticked by default**, see below); open critical defects. 1:1 tasks never appear (§4).

**Defaults and what is saved.** Done tasks start in the update; dropped tasks and meetings start out (a meeting is attendance, not an outcome). `excluded` stores only what the manager changed: `T-12` for a line unticked, `+T-12` for a default-out line ticked in, so a task that closes after the first save still gets its own default (`isLineIncluded` in `client/src/lib/weekly-review.ts`, shared with the report builder).

**People-related lines default to unticked.** Any "Blocked & risks" line about a named person and their status note ("Search re-index at risk — Priya (capacity…)") starts **unticked** in step 6, with a visible hint "Names a person" beside its checkbox, because a status note about a colleague is the most likely thing a manager does not want their boss to read by accident. The manager ticks it in on purpose. Tasks delegated to a person ("— Priya" in Shipped) are ordinary work and stay ticked (they name an owner, not a status). Because the copy contains only ticked lines, an untouched review never sends a person-status line.

Delegated rows name the owner ("— Priya"). Task keys are left out (they mean nothing to the boss). Private notes and update bodies are never included; only titles, names, counts and dates.

**Copy for Teams** writes both `text/html` (headings as bold paragraphs, `<ul>` bullets, every value HTML-escaped) and `text/plain` (the Markdown) through `ClipboardItem`, so Teams and Outlook paste formatted bullets. Where `ClipboardItem` is missing it falls back to Markdown through `writeText`, and the toast says "Copied as text".

Example (Friday 2 October 2026):

```markdown
**Weekly update · 28 Sep – 2 Oct**

**Shipped**
- Payments retry flow signed off with Product
- SRE hiring loop closed, offer accepted
- On-call runbook for alerting v2 — Priya
- Defects: 7 resolved, 3 opened · 1 critical open (PAY-412)

**Next week**
- Q4 roadmap draft to Product
- Migrate paging to the new on-call rotation
- Calibration prep for mid-year reviews

**Blocked & risks**
- Vendor DPA: waiting on Legal · 9 days
- Search re-index at risk — Priya (capacity, needs a second pair of hands)
- PAY-412 checkout timeout (critical) · open 4 days
```

The text shown in step 6 is saved on the week's review record when it is copied or the review is finished (`report_markdown`), which is what **Past updates** reads.

## 7. Digest and reminders

### 7.1 Rules

- **One digest per manager per local day**, at the digest time (default **08:30**) in `AttentionRules.timeZone`. Weekdays only by default. It is skipped when it would be empty, unless it is the review day or Monday catch-up.
- Sections, each capped at **5 titles** plus a count ("+3 more"), in this order:
  1. **Top 3** (the day's pins; on Monday headed "Top 3 · from Friday's review").
  2. **Due today** and **Overdue** (my planned tasks and deadlines, `taskPlanDate`).
  3. **Check-bys today**: waiting items whose check-by is today or passed (`followUpDue`), with the party and age.
  4. **Back from Later**: tasks whose `hide_until` is today. This is the "snoozed item resurfaces" reminder.
  5. **1:1s today**, with time when set.
  6. On the review day: "Weekly review today · ~10 min". Monday or Tuesday with last week unreviewed: "Last week isn't reviewed yet".
- Buttons: **Open Today** (`{appUrl}/`) and, on the review day, **Start review** (`{appUrl}/?mode=review`).
- **Missed window:** a digest not sent by digest time + 3 h (server down, laptop asleep) is recorded as `skipped` and not sent late.
- **Idempotent:** a delivery row is claimed (unique per manager, local day, channel) before sending, so restarts or overlapping ticks never double-send. One retry after 15 minutes on failure.
- **In-app:** nothing new is pushed in the app, because Today already shows all of this. Two small additions: Today's plan panel Inbox row adds "· 2 back from Later" (`TodayPlanFocus.inboxCount` sibling), and when the latest delivery failed, Today shows one quiet row, "Teams digest failed · Fix in Settings".

### 7.2 Channels

**Microsoft Teams (Power Automate Workflows).** The manager creates a "Post to a chat when a webhook request is received" workflow and pastes its URL. LeadOS posts an Adaptive Card (version 1.4, which Teams desktop and mobile both render):

```json
{ "type": "message", "attachments": [{ "contentType": "application/vnd.microsoft.card.adaptive",
  "content": { "type": "AdaptiveCard", "version": "1.4", "body": [
    { "type": "TextBlock", "text": "LeadOS · Mon 5 Oct", "weight": "Bolder", "size": "Medium" },
    { "type": "TextBlock", "text": "Top 3 · from Friday's review", "weight": "Bolder", "spacing": "Medium" },
    { "type": "TextBlock", "text": "1. Q4 roadmap draft to Product\n2. …", "wrap": true },
    { "type": "FactSet", "facts": [{ "title": "Due today", "value": "4" }, { "title": "Overdue", "value": "1" }] } ],
  "actions": [{ "type": "Action.OpenUrl", "title": "Open Today", "url": "https://lead.daycommand.online/" }] } }] }
```

Detail level (decided): **titles, capped, with links**. A **Counts only** switch sends the numbers and buttons with no titles.

**Browser push (Web Push).** Per device, opt-in from Settings. One notification a day: title "LeadOS · Mon 5 Oct", body "Top 3 set · 4 due · 1 overdue · 2 check-bys", click opens Today. The payload is encrypted to the device (RFC 8291); the push service only relays ciphertext. It works while the browser runs. On iPhone it needs the app added to the Home Screen (a minimal web manifest is added). The service worker only handles `push` and `notificationclick`; it caches nothing, so it cannot serve stale builds (P0-S4's chunk-reload logic is unaffected).

### 7.3 Settings → Notifications (new section `?section=notifications`)

```
Notifications
  Morning digest                                   [on]
    Time            [08:30]   Europe/London · change in Attention rules
    [x] Weekdays only     [x] Skip days with nothing to report
    [ Preview today's digest ]

  Microsoft Teams
    Workflow URL   Connected · prod-12.westeurope.logic.azure.com   [Replace] [Remove]
    Detail         (•) Titles, up to 5 per section   ( ) Counts only
    [ Send test ]   Last sent Mon 08:30 ✓

  This browser
    Notifications  Off                                   [ Turn on ]
    Other devices  Pixel · Chrome · added 2 Oct          [ Remove ]

  Recent deliveries   Mon 08:30 Teams ✓ · Push ✓   Fri 08:30 Teams ✗ "404 from Teams" …
```

Copy: section title "Notifications"; toggles "Send a morning digest", "Weekdays only", "Skip days with nothing to report"; buttons "Send test", "Turn on", "Turn off", "Replace", "Remove", "Preview today's digest"; errors "That isn't a Teams workflow URL", "Teams didn't accept the message (404). Check the workflow is on.", "Notifications are blocked in this browser's settings." The Weekly review day sits in **Day Rhythm** (Phase A): "Weekly review day" (Mon–Fri, default Friday) and "Show it in wrap-up" (on).

## 8. Solo and collab

| | Solo | Collab |
|---|---|---|
| Review steps 1–3, 5, 6 | identical | identical |
| Step 4 People | 1:1s and manager-set status | plus read-only "Check-ins this week" for participating developers (check-in clock) |
| "Quiet" rule | manager-touch rule: 5 working days or check-by passed | same rule (it reads task activity, not check-ins) |
| Digest | as §7 | as §7; no check-in nags are added |
| Developer surfaces | unchanged | unchanged: nothing here is visible to developers |

Nothing depends on developer check-ins. No existing collab signal, flow or surface changes.

## 9. Data model and API

All migrations are additive (new tables, one nullable column), added to `server/src/db/migrate.ts` in the existing style, and tested on copies of the dev and prod DBs only.

| Table / column | Columns | Item |
|---|---|---|
| `weekly_reviews` | `id`, `workspace_id`, `manager_account_id`, `week_start` (Monday, manager zone), `step`, `decisions_json` (`{ taskKey: action }`), `excluded_json` (report lines the manager changed: `T-12` unticked, `+T-12` ticked in although it starts out; see §6), `report_markdown`, `started_at`, `completed_at`, `dismissed_at`, `updated_at`; unique `(workspace_id, manager_account_id, week_start)` | WR-02 |
| config `weekly_review_day` (0–6, default 5), `weekly_review_in_wrapup` (default 1) | workspace keys through `SettingsService` | WR-06 |
| `issues.resolved_at` | from Jira `resolutiondate` (added to the sync field list, `sync/engine.ts:157-171`); also set when a sync sees a row move into the `done` category | WR-09 |
| `notification_prefs` | PK `(workspace_id, manager_account_id)`; `digest_enabled` (0), `digest_time` ("08:30"), `weekdays_only` (1), `skip_empty` (1), `teams_webhook_enc`, `teams_detail` (`titles`\|`counts`), `app_url`, `updated_at` | WR-12 (webhook: WR-13) |
| `notification_deliveries` | `id`, `workspace_id`, `manager_account_id`, `kind` (`digest`\|`test`), `local_date`, `channel` (`teams`\|`push`), `status` (`sending`\|`sent`\|`failed`\|`skipped`), `attempts`, `error` (≤ 200 chars, redacted), `created_at`, `updated_at`; unique `(workspace_id, manager_account_id, local_date, channel)` where `kind = 'digest'` | WR-12 |
| `push_subscriptions` | `id`, `workspace_id`, `account_id`, `endpoint` (unique), `p256dh`, `auth`, `label`, `created_at`, `last_success_at`, `failure_count` | WR-15 |
| config `push_vapid_public_key`, `push_vapid_private_key` (encrypted) | generated on first use | WR-15 |

API (all manager-only, Zod-validated, thin routes; services hold the logic; contracts in `shared/types.ts`):

| Route | Purpose |
|---|---|
| `GET /api/review/week?week=&tz=` | `WeeklyReviewResponse`: range, sections with rows and `TaskSignals`, `sourceStatus`, saved state |
| `PUT /api/review/week/:weekStart` | save `step`, merge `decisions`, set `excluded`, `reportMarkdown`, `completed`, `dismissed` |
| `GET /api/review/weeks?limit=12` | completed weeks with `report_markdown` (Past updates) |
| `GET/PUT /api/notifications/settings` | prefs; the webhook URL is write-only (`hasTeamsWebhook`, `teamsHost` returned) |
| `POST /api/notifications/test` | send a test to one channel (throttled like "Back up now", `backup.service.ts:28`) |
| `GET /api/notifications/digest/preview?tz=` | the digest model for today, never sent |
| `GET /api/notifications/deliveries?limit=7` | recent deliveries |
| `GET /api/notifications/push/key`, `POST` / `DELETE /api/notifications/push/subscriptions` | Web Push |

The Tasks list rows gain `oneOnOne?: true` (set from `one_on_one_agenda_items`; used only by the CSV export to leave 1:1 tasks out, WR-10).

`GET /api/today` gains `focus.plan.returnedFromLaterCount`, `weeklyReview?: { due: boolean; completedAt?: string; catchUp?: boolean }` and `digestFailing?: boolean`. CSV needs no route: Tasks and Work export the rows they already hold, through a new `client/src/lib/csv.ts` that WR-10 creates (it does not exist yet).

Server layout: `services/weekly-review.service.ts`, `services/digest.service.ts` (pure build), `services/notification-settings.service.ts`, and `server/src/notifications/` (`scheduler.ts`, `teams.ts`, `push.ts`, `outbound-guard.ts`), mirroring `sync/`. The scheduler ticks every 5 minutes and starts from `index.ts` after `backupService.initialize()`.

## 10. Privacy and security

- **Manager-private end to end.** Every new route sits behind `requireManager`; developers get 403 (route tests). Nothing is added to `DeveloperTask`, My Day or developer DTOs. Rows are scoped by `workspace_id` and `manager_account_id`; the review reads through `TaskViewsService`, so the private waiting-on rule (`ownsPrivateFields`, `task-views.service.ts:101`) still applies.
- **1:1 tasks stay out of everything that leaves the review.** The review, the report, the CSV export and the digest exclude every task in `one_on_one_agenda_items` for the workspace (§4), so a 1:1 topic or session action item is never in a Teams message, push, clipboard update or downloaded file. People-status lines in the update default to unticked (§6).
- **Leaving the box.** Teams receives titles, names and counts (the manager's decision; **Counts only** is available). No update bodies, notes, Jira descriptions or check-in text are ever sent. Push payloads are end-to-end encrypted.
- **Webhook URL is a secret** (it carries a `sig=`): encrypted at rest with `secret-crypto`, never returned or logged (added to the pino `redact` list, `utils/logger.ts:6`); the UI only shows the host.
- **Outbound guard (SSRF):** HTTPS on port 443 only; host must end in `.logic.azure.com` or `.powerplatform.com` (Teams workflow hosts; an env allowlist can extend it); the resolved address must not be private, loopback, link-local or otherwise non-public (IPv4-mapped IPv6 included); **the connection is made to the address that was validated**: the hostname is resolved once, every returned address is checked, and the request connects to that pinned IP (a custom `lookup` on the `https.Agent`/`undici` dispatcher, so TLS SNI and the `Host` header keep the original hostname and the certificate is still verified against it). There is no second DNS lookup between check and connect, so DNS rebinding cannot swap in a private address; no redirects; 10 s timeout; response bodies are not stored beyond a 200-character redacted error.
- **Links** use `app_url`, taken from the saving browser's origin (HTTPS, or `http://localhost` in development) or `APP_PUBLIC_URL` when set.
- **CSV:** cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (formula injection); UTF-8 with BOM for Excel; the file is built in the browser from data the manager can already see.
- **Clipboard HTML** is built from escaped text only; no user text is ever inserted as markup.
- **Push subscriptions** are per account; deleting a user or a 404/410 from the push service removes them.

## 11. Decisions (made by the user, 2026-09-30)

1. **Channels:** Microsoft Teams via a Power Automate Workflows webhook, **and** browser push, plus in-app. No email or Slack in v1.
2. **Report audience:** the manager's boss; short bullets pasted into Teams or email.
3. **Report contents:** Shipped · Next week · Blocked & risks. No typed "Asks" section (edit the text if needed).
4. **Review:** Friday afternoon, about 10 minutes. The day is configurable (default Friday).
5. **Invitation:** a Today wrap-up row on the review day plus one line in that morning's digest; Monday/Tuesday catch-up row if skipped.
6. **Reminder tone:** quiet. One morning digest; no per-item messages.
7. **"Gone quiet":** reuse the 5-working-day rule (`managerTouchDays`) or a passed check-by.
8. **Digest detail sent to Teams:** titles, capped at 5 per section, with links; a Counts-only switch exists.
9. **Jira in the report:** yes, a count line plus top items, using a new `resolved_at` from Jira's `resolutiondate`.
10. **Order:** review → report → digest (Phase A, B, C in docs/60).
11. **Numbering:** this spec is docs/59 and the plan docs/60, because docs/58 already exists.

## 12. Risks and open questions

**Risks**
1. **Teams webhook churn.** Microsoft retired Office 365 connectors in favour of Workflows and has changed workflow hosts before. Mitigation: host allowlist in one place, clear error text, and **Send test**.
2. **Server clock vs manager zone.** The scheduler has no browser; it uses `AttentionRules.timeZone`. If that zone was never set it is the server's. The Notifications section shows the zone and links to Attention rules.
3. **Push reach.** Push needs the browser running, and on iPhone a Home Screen install. It is a second channel, not the only one.
4. **`resolved_at` coverage.** If a workspace's sync JQL excludes resolved issues, `resolutiondate` never arrives; the done-transition fallback covers only issues seen before and after. The Jira line reads "Defects: 3 opened · 1 critical open" when resolved data is missing, rather than a misleading 0.
5. **Tasks list at scale (P3-09 parked).** Client-side CSV exports the loaded rows. If Tasks gains pagination, export must move to a server route.
6. **Review fatigue.** Mitigated by exception-only rows, no forced decisions, skip empties, and a visible 6-step bound.

**Open questions (not blocking Phase A)**
- Should a second Teams workflow let the update be posted straight to the boss's chat? (Non-goal for v1.)
- Should Copilot later offer "Polish this update"? (With P6-04.)
- Monthly roll-up beyond "Copy last 4 weeks"?
