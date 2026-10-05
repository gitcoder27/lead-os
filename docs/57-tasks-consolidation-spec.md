# 57 — Tasks consolidation spec (P3-00)

Status: **signed off 2026-09-29** (decisions in §9). No code changes.
Inputs: [docs/55](55-solo-vs-collaborative-review.md) §3 (#8–#10) and §4, [docs/56](56-implementation-plan-solo-first.md) Decisions and P3, [docs/47](47-work-item-model-v2.md), [docs/49](49-tasks-workspace-redesign-spec.md), [docs/51](51-tasks-workspace-review.md).
Line numbers are from `main` at `aecc8a0`.

**Already decided (not reopened here):** the app is solo-first. Follow-ups and Meetings stop being pages and become built-in Tasks lenses, and `/follow-ups` and `/meetings` redirect. The nav becomes Today | Tasks | Team | Work | Notes. Team and Work are hidden by default in solo mode, and any page can be hidden in Settings.

## 1. Lifecycle

A task has one **lane**, derived from its fields and never stored. It is computed by a single pure function, `taskLane(row, today)`, in `shared/`. Both the server matcher (`task-views.service.ts:132`) and the client use it. When more than one rule applies, the first match wins:

| Lane | Rule (open = `open`/`active`/`blocked`) | How you get there |
|---|---|---|
| **Done** | status `done` or `dropped` | complete or drop |
| **Later** | open, `later = 1`, and (`hide_until` is null or `hide_until > today`) | `/later`, `/later !mon`, `s l` |
| **Waiting** | open and `waiting_on_*` is set | `/w @who !date`, `/f @who`, drawer "Waiting on" |
| **Planned** | open and has a plan date (docs/49 D1: the earlier of `scheduled_on` and `due_at`) | `!date`, `!due:date`, `s t/m/w`, the date picker |
| **Inbox** | open, and `needs_triage = 1` or `owner_type IS NULL`, or a Later task whose `hide_until` has arrived. Unowned tasks are Inbox **before** the Planned rule (P3-02 deviation, below). | capture with no date, no owner and no `/w` |
| *(Unscheduled)* | open, triaged, no date, not waiting | "Keep undated" in triage, and all existing undated tasks |

- **Later resurfaces on its own.** Once `hide_until` has passed, a Later task simply matches Inbox. No job runs and nothing is written. Triaging it clears `later` and `hide_until`.
- **Inbox means "untriaged", not "unowned".** Today, Inbox is `owner = inbox` (`task-views.service.ts:45,143`), and capture schedules every task for today (`capture.service.ts:159`, `task.service.ts:260`). That second rule is why undone captures become Overdue.
- **Why store a triage marker?** An inferred rule ("mine, no date") would pull hundreds of existing undated tasks into Inbox. That includes the manager-owned, undated 1:1 topics created by P0-S5. Any triage write clears it: a date, an owner, waiting, later, a status change, or an explicit "Keep undated" (the list's "clear date", or `triaged: true`). `triaged: false` puts a task back, which is what undo uses.
- **Deviation (P3-02): the marker is `needs_triage INTEGER NOT NULL DEFAULT 0`, not `triaged_at`.** With `triaged_at`, a NULL default would mark every row inserted outside capture as untriaged. That includes the legacy Phase 2 backfill, which can still run for a workspace that is not cut over (P3-00a). An opt-in flag that defaults to "triaged" needs no backfill and can't flood Inbox. Only a bare capture sets it (`TaskService.create(…, { untriaged: true })`).
- **Deviation (P3-02): an unowned task is Inbox even when it is dated.** Legacy Desk inbox rows and Inbox inline-adds are unowned but carry the Desk day as `scheduled_on`. All 4 open unowned tasks in a prod copy were dated, so strict Planned-before-Inbox ordering would have emptied the real Inbox.
- **Waiting outranks Planned.** A waiting task leaves "Planned today". Its check-by date brings it back on Today (§6).

## 2. Schema and migrations

Stage `2c` is on in prod and dev, and no workspace is at `2d` (docs/56 P0-V3). So:

- Every change is an **additive, nullable column on `tasks`**, or a new table, added to the ALTER list in `server/src/db/migrate.ts` (pattern: `:743`, `:755`).
- No legacy table (`manager_desk_items`, `team_tracker_items`) changes. The legacy Desk API keeps working through its projections: `manager-desk.service.ts:368-386` (`canonicalFields`) and `task-view-models.ts:79` (`kind`), plus `canonicalDeskItem` on the client (`useCanonicalTasks.ts:9-21`). Both projections map `waiting_on_*` to desk `kind: "waiting"`.
- `tasks:drop-legacy` and the `2d` contract (`task-contract.service.ts`) never touch the new columns.

| Field | Storage | Item | Notes |
|---|---|---|---|
| `due` | **existing** `tasks.due_at` (`schema.ts:505`) | P3-04 | No migration. It already drives the plan date and overdue tone (docs/49 D1/D2). It is only read-only in the drawer today (`TaskDetailFields.tsx:203`). `!due:fri` stores 23:59:59.999 local (`dueAtForDate`); `dayEnd` (`task.service.ts:55`) is next-day midnight and would read a day late. |
| `checkBy` | **existing** `tasks.follow_up_at` (`schema.ts:506`) | P3-03 | No migration. The column is already "when to chase", with an index and events (`task.service.ts:314`). The UI label becomes "Check by", and the API name stays `followUpAt` so the Desk and Copilot contracts keep working. |
| `waitingOn` | new `waiting_on_type` (`developer`\|`contact`\|`text`), `waiting_on_ref` (accountId or contact id), `waiting_on_label` (display snapshot or free text), `waiting_since` (ISO timestamp) | P3-03 | Setting it emits a `schedule`-style event (`field: "waiting_on"`). Clearing it keeps history. A partial index on `(workspace_id, waiting_on_type)` covers rows where it is not null. |
| External people | new table `contacts` (`id`, `workspace_id`, `manager_account_id`, `display_name`, `handle`, `note`, `created_at`, `archived_at`); unique on `(workspace_id, manager_account_id, handle)` | P3-03 | Manager-private and never a login. `task_links.kind` gains `contact` (`task.service.ts:47`). |
| `hideUntil` | new `tasks.hide_until` (date) | P3-02 | Only meaningful when `later = 1`. `validateShape` (`task.service.ts:203`) still forbids `later` together with `scheduled_on`. |
| Triage marker | new `tasks.needs_triage` (0/1, default 0), plus a partial index where it is 1 | P3-02 | No backfill: the default means triaged (see the §1 deviation). Verified on copies of the dev sandbox DB and the prod DB: every existing row stays `0`. |
| Recurrence | new `tasks.repeat_rule` (for example `weekly:mon`, `monthly:15`, `weekdays`) | P3-07 | Specified in §6. |

**Privacy.** `waiting_on_*`, contacts, `hide_until`, `triaged_at` and `repeat_rule` are manager-private. Each gets:

- a place in the private-field guard (`task.service.ts:280`);
- exclusion from `DeveloperTask`, `DeveloperSurfaceTask` and My Day;
- a route test asserting the developer DTO key allowlist, in the same style as P0-S1.

## 3. Capture grammar and one capture path

Changes to `shared/capture-grammar.ts`. The header comment at `:9-28` is updated to match.

| Token | Meaning | Today |
|---|---|---|
| `/w @who [!date]` | Waiting on `who`, a developer or a contact. The optional date is check-by. The owner stays **me**. | new |
| `/f [@who] [!date]` | With `@who`, the same as `/w`. Without it, a task of mine with a check-by date that is also scheduled on that date. Keeps `category:follow_up` for legacy predicates. | `/f [!date]` only (`:337`, `:470`) |
| `/later [!date] [@who]` | Park it. A date becomes `hide_until`, and `@who` becomes a person link, never the owner (developer tasks cannot be Later, `task.service.ts:205`). | date and person are errors (`:369-374`) |
| `!due:<date>` | Deadline (`due_at`), separate from the plan date. Built in P3-04: stored as the local end of day; it does not use up a `/w` or `/f` binding slot. | built |
| `~daily`, `~weekdays`, `~weekly`, `~biweekly`, `~monthly`, `~mon`…`~sun` | Recurrence (P3-07) | new |
| `@who` | Resolves against developers **and** contacts. An unknown name offers "Create contact 'who'" in the chooser, instead of only failing with `unknown-person` (`:406`). | developers only (`capture.service.ts:79-81`) |
| person ident | `PERSON_REF` also allows `:`, so Jira account ids like `557058:ab-12` parse. | fails (`:220`) |
| dates | Adds `eow`, `eom`, `nextweek`, `next-fri` (also written as two words, `!next fri`), `2w`/`3d` (without `+`), `oct12`/`12oct`, and `in2w`. Text without `!` is never parsed, so titles don't change by surprise. The preview chip shows the resolved date. | `today`/`tomorrow`/weekday/`+Nd`/ISO (`:202-213`) |

- **Defaults change.** A capture with no date, no owner and no `/w` goes to **Inbox** (unscheduled, untriaged, owned by me). `@dev` with no date keeps the current behaviour (scheduled today, with a focus row): delegating to a developer means putting it on their day.
- **Structured context instead of injected text.** `CaptureRequestBody` gains `defaults?: { ownerAccountId?, waitingOn?, scheduledOn?, later?, kind?, parentKey? }`. A token the user typed always wins, and `defaults` only fills fields with no token.
  - This replaces the assignee pill's `@${accountId}` injection (`CaptureBox.tsx:241-243`), the source of the colon-id bug.
  - It also lets the pill be cleared.
  - It replaces the Tasks inline-add `inlineAddDefaults` → `POST /tasks` path (`TasksPage.tsx:751`).
- **One path.** Every UI creation goes through `POST /api/capture`. The paths that move:
  - the global capture dialog;
  - Tasks inline add;
  - the "Add child" action in the drawer (`TaskDetailRelations.tsx:318`) → `defaults.parentKey`;
  - the Jira triage "Add to Desk" button (`DeskCaptureForm.tsx:257`), which becomes "Add task";
  - `DeskCaptureForm`, `ManagerDeskCaptureDialog` and the palette's `createDeskItem` (`CommandPalette.tsx:104`);
  - Notes follow-ups;
  - `MemoryComposer` (deleted in P3-06).

  `POST /api/tasks` stays for services, Copilot and 1:1s. It is not a UI path.

  **As built in P3-05:**
  - `defaults` is broader than the list above: it also carries `dueAt`, `followUpAt` (a timestamp, so a time of day survives), `startsAt`/`endsAt`, `participants`, `nextAction`, `status` (open, active or blocked), `priority`, `labels`, `contextNote` (the task's first private update), `links` (`jiraKeys`, `developerAccountIds`) and `source` (`{ type: "note", noteDate, noteKind }`, which writes the created-from reference the notes list reads).
  - Naming any triage field in `defaults` (owner, date, waiting, later, status, check-by, deadline) makes the capture triaged, so it skips Inbox. `scheduledOn: null` means "deliberately undated".
  - Typed tokens win over defaults; a default `later` gives way to a typed `!date` or `@owner`. `ownerAccountId` never applies to a Later task, and `null` leaves the task unowned (the Inbox lens).
  - Client: `useCaptureTask().create({ text, defaults })` is the one-shot path (inline add, child action items, the palette's quick add, the desk-style dialogs through `useCreateDeskTask`, and the notes hooks). A `T-n:` or `/note` text is refused there rather than posted as an update or a note.
  - Today's "Follow up" and a meeting's next action are made through `CaptureService` on the server, with a new `delete_task` restore for undo.
  - Without Phase 3, the legacy Desk create still runs, so nothing changes for a workspace that has not switched.
  - `useCaptureTypeahead` gives `@person` (developers, then contacts), `#JIRA-KEY` (synced issues, two characters minimum) and `+label`. It is on the capture box, the Tasks inline add and the child action-item input.
  - Note-derived text (the notes hooks) keeps an `@name` nobody matches as plain words and retries once, so it neither assigns guesswork nor blocks a wrap-up batch; an ambiguous name still rejects.
- **Keep-open mode.** Cmd/Ctrl+Enter submits and keeps the dialog open. Today the dialog always closes (`CaptureBox.tsx:273`).

## 4. Built-in lenses (`task-views.service.ts:41-57`)

| id | Name | Definition (new filter fields in bold) | Replaces |
|---|---|---|---|
| `inbox` | Inbox | `{ **lane: "inbox"** }`, sort `created` | `owner: "inbox"` |
| `today` | Planned today | adds **`waitingOn: false`** to today's definition (`:44`). P3-03 deviation: this is a new filter meaning "no explicit waiting-on party". `waiting: false` would also have dropped my own blocked tasks. | — |
| `waiting` | Waiting | `{ **lane: "waiting"**, later: false }` plus the legacy clause (below), sort **`checkBy`**, group **`party`** | the `waiting` view (`:47`) and the `/follow-ups` page |
| `meetings` | Meetings | `{ kind: "meeting", **withClosed: { from: today-13 }** }`, sort `scheduled`, group **`meeting`** | the `/meetings` page and the `my-tasks` + `kind` alias |
| `high-priority` | High priority | `{ priority: "high", status: ["open", "active", "blocked"] }`, sort `scheduled`; Review section, all visible owners/dates/lanes including Later | — |
| `my-tasks`, `later`, `attention`, `closed-week` | unchanged | — | — |

**Priority visibility (2026-10-05, TASKS-02).** View options offers All priorities / High priority / Normal priority. The server accepts `filters.priority: "high" | "normal"`, and saved views keep it. URL overrides use `priority=high|normal|all`; `all` removes an inherited filter, while Reset/Revert restores the view's definition. Inline capture inherits the effective priority through structured defaults; an explicit `!!` still wins. High priority has its own count and `g → h` shortcut; it neither schedules a task nor adds an attention exception. The flag stays visible and in the row's accessible name in every view, including Needs attention. Capture examples document `!!`.

**How Waiting differs from today's view** (`:186-193`, blocked OR `kind:waiting` OR a follow-up on someone else's task, grouped by owner, sorted by updated):

1. **Explicit.** `waitingOn` is the main rule. Tasks I own that wait on someone (`/w @legal`) are now included. Today they are excluded as `selfOwned`.
2. **Delegated tasks that go quiet** are included too. These are developer-owned tasks I track whose check-by is due, or that have been idle for `TASK_STALE_DAYS`. This is docs/55 #10. It reverses docs/51 F2 **for this lens only**: in solo mode nobody else updates those tasks, and Team may be hidden.
3. **Legacy clause, kept** so existing data doesn't disappear: `blocked`, `kind:waiting`, and a follow-up on someone else's task.
4. **Grouped by the party waited on**: the waiting-on person or contact, otherwise the owner, and "Blocked" last. Each group sorts by check-by, oldest first.
5. **Row chips:** `Waiting 6d` (from `waiting_since`, else the last assign or status event) and `Check Fri`, or `Check 2d late` in the danger colour. They come from `TaskSignals.checkDue`/`waitingDays` next to `followUpDue` (`:109`).
6. **Keys:** `w` sets or clears Waiting on (developers, my contacts, or free text typed in the picker). `c` sets check-by. Both are also in the row's More menu.

**As built in P3-03, differences from the text above:**
- `w` picks only the party. The date is its own key (`c`), which reuses the Schedule picker's accelerators.
- There is no drawer field yet: the drawer shows the waiting change in the timeline, but it does not edit it.
- A task added under a party group waits on that party. Under "Blocked" it is created blocked.
- A new sort `checkBy` and a new group `party` were added, and both are also offered in the toolbar.
- Contacts get `/api/contacts` (list, create, archive), with no Settings screen yet. The capture box's "Create contact @x" is the way in.
- Contact links (`task_links.kind = 'contact'`) and `waiting_on` / contact-link events are manager-private. Developers never see them.

The Follow-ups page's `overdue/today/upcoming/unscheduled` lanes (`lib/manager-memory.ts:35-44`) turn into this lens's sort and chips.

**Meetings lens.**
- **Groups:** `Today`, `Upcoming`, `Needs outcome` (past, open, no outcome), and `Recent` (closed or with an outcome, last 14 days). A past meeting is never laned "Upcoming", which fixes `getMeetingLane` falling through at `:54`.
- **`withClosed` filter** (new): open rows plus rows closed inside a bounded range. Closed rows otherwise only appear through `closed` or drift (`:162-171`).
- **Action items** are child tasks (`parent_id`). The row shows `2/3 actions`. The drawer lists the children, and "Add action" captures with `defaults.parentKey`. Each action item also sits in its own lane (Planned, Waiting, or a developer's day), so there is no separate container.
- The fake 90-minute/30-minute default times in `MemoryComposer.tsx:34` go away. A meeting without a time is simply undated.

## 5. Redirects, nav, palette, docs (P3-06, then P2-04)

- **Routes** (`App.tsx:135-137,158-160,1161`): `/follow-ups` and `/followups` go to `/tasks?view=waiting`, and `/meetings` and `/meeting` go to `/tasks?view=meetings`, through `replaceState` with the query string kept. `follow-ups` and `meetings` leave `CanonicalAppView` (`:41`). Update the client alias map in `lib/task-views.ts:64-65`: `meetings` resolves to the new built-in.
- **Today targets** (`today.service.ts:944,1277,1303,1492,1510,1563`) become `view: "tasks"` plus a `taskView` field (`waiting` or `meetings`), and still open the drawer when `taskKey` is set. `App.tsx:730` loses its follow-ups and meetings branches.
- **Server enums keep accepting the old values as aliases for one release.** Stale tabs and saved Copilot history still send them:
  - `routes/manager-actions.ts:36`
  - `routes/preferences.ts:6`
  - `routes/tasks.ts:42`
  - `assistant/tools.ts:998,1046`
  - `assistant/task-tools.ts:36`

  The server maps them to `tasks` plus the matching view.
- **Nav preferences** (`shared/types.ts:2396-2470`):
  - `follow-ups` and `meetings` leave `NAV_PAGE_IDS_TASKS`.
  - `sanitizeNavPreferences` already drops unknown ids on read (`:2456-2464`), so stored preferences migrate without a data migration.
  - `isCompleteNavPreferences` is strict, so it must drop legacy ids before counting, or a stale client's save returns 400.
  - P2-04 then adds `hidden: NavPageId[]` and the solo defaults (Today, Tasks, Notes; Team shows once the roster exists, and Work once `jiraConfigured`).
  - The final order is Today | Tasks | Team | Work | Notes.
- **Palette** (`paletteItems.ts:47-48`): "Go to Waiting" (keywords: follow-ups promises delegated) and "Go to Meetings", both opening Tasks lenses. The capture hint at `:95` reads "Tasks, waiting, notes".
- **Deleted:** `components/manager-memory/**`, `lib/manager-memory.ts`, `useCanonicalMemoryTasks` (`useCanonicalTasks.ts:23-53`), the non-canonical branch at `ManagerMemoryPage.tsx:56`, `TaskService.list`'s `follow-ups`/`meetings` filters (`task.service.ts:188-196`, kept as aliases), and `nav-pages.ts:54-80`.
- **AGENTS.md:**
  - Routes: add `/tasks?view=` as canonical; list `/follow-ups` and `/meetings` as redirects; `/desk` becomes a legacy alias.
  - Frontend map: remove `manager-memory/` and add `tasks/`.
  - Add a one-line capture grammar summary and the `contacts` table.

**As built in P3-06, differences from the text above:**
- The `waiting` view is named "Waiting / Delegated"; Meetings is a plan-section built-in right after it.
- `Go to Waiting` and `Go to Meetings` are palette commands with a `href`, not app views, and the two built-ins are left out of the generic "Tasks: …" list so nothing appears twice.
- Retired-view aliases: `follow-ups` still resolves to `waiting`; `meetings` is now a real view id, so its alias (`my-tasks` + `kind`) is gone.
- `LEGACY_NAV_PAGE_IDS` (`follow-ups`, `meetings`) are dropped on read and ignored on save; the nav route also accepts `tasks`.
- Without Phase 3 the two old paths land on `/desk`. P3-00a is what would make that case disappear for new workspaces; it was still open.

## 6. Today, deadlines, recurrence, weekly review

- **P3-01 Today plan and top 3.**
  - `focus.plan` is the Planned lane, filtered to me and a plan date on or before today, without Waiting. Today it misses same-day tasks: `projectTodayRows` only carries forward tasks dated before today (`task.service.ts:795-799`).
  - The top 3 reuses `day_focus` with `owner_type = 'manager'` and `source = 'top3'`. The table is already generic (`schema.ts:538-551`); only `focus()` limits it to developers (`task.service.ts:229`).
  - Waiting tasks whose check-by has arrived join the existing follow-up promises. `projectTodayRows` extends `isFollowUp` to cover `waiting_on_*`.
  - An Inbox count row appears ("3 to triage"). Inbox tasks are never overdue, because they have no date.
- **P3-04 deadlines.** Only the grammar token and an editable drawer row. The column and D1/D2 semantics already exist.
- **P3-07 recurrence.**
  - When a task with `repeat_rule` is marked done, the server creates the next instance in the same transaction. The new instance is a new key with the same title, owner, labels, links and waiting-on. Its `scheduled_on` (and `due_at`, if one was set) moves to the next occurrence, and it gets a `task` link with role `related` back to the previous one.
  - Dropping a task stops the series. Editing the rule changes only future instances.
  - A rule without a date anchors on today.
- **P3-08 weekly review.** A guided pass over lanes:
  1. Closed in the last 7 days;
  2. Waiting with a check that is due or older than 7 days;
  3. Inbox leftovers;
  4. Later tasks resurfacing next week;
  5. Unscheduled tasks older than 14 days.

  Each row offers carry, drop, or schedule, and every action goes through `/tasks/bulk` with undo. Copy as Markdown is part of P6.

## 7. Risks

1. **New workspaces are not canonical.** No code sets `tasks_phase2_stage` for a fresh workspace; only the cutover CLI does (`task-cutover.service.ts:85`). So a new solo user gets the legacy Desk model, and capture refuses to run (`capture.service.ts:40`). Removing the pages without fixing this breaks new installs. The plan: a new item, **P3-00a**, starts empty workspaces at `2c` with Phase 3 on (there is nothing to backfill). It must land before P3-06.
2. **Inbox flood.** Avoided by the opt-in `needs_triage` flag (§1). The migration was checked against copies of the dev and prod DBs.
3. **Adding delegated tasks back to Waiting** could bring back the noise docs/51 F1 removed. The mitigation is that a delegated task only qualifies when its check is due or it has been quiet for 5 or more days, and never simply because a developer owns it.
4. **Two names for one field** (`followUpAt` vs "Check by"). This is accepted to keep the Desk, Copilot and Today contracts stable. It can be renamed after `2d`.
5. **Today and the Waiting lens use different rules.** Both must go through `taskLane`, or they will disagree again (docs/55 P1, "Follow-ups … disagree with the Tasks Waiting view").

## 8. Implementation order and acceptance tests

| # | Item | Acceptance tests |
|---|---|---|
| 1 | **P3-00a** Canonical by default for new workspaces | A fresh DB with a new manager has stage `2c` and phase3 on; capture works; existing workspaces are untouched |
| 2 | **P3-02** `triaged_at` and `hide_until`, Inbox and Later semantics, the `/later` grammar, `taskLane` | Backfill leaves Inbox counts unchanged; a dateless capture lands in Inbox, not Overdue; `/later !mon` is hidden until Monday and then shows in Inbox; `/later @dev` links the developer and doesn't make them owner; `count(view) === run(view).length` still holds |
| 3 | **P3-03** `waiting_on_*`, `contacts`, `/w` and `/f @`, the Waiting lens, colon ids, contact create-from-chooser | Grammar unit tests (`/w @x !fri`, `@557058:ab`, an unknown person producing a contact offer); lens grouping and sort; a quiet delegated task appears and a fresh one doesn't; developer DTO allowlist excludes waiting and contact fields; legacy `kind:waiting` rows still match |
| 4 | **P3-01** Today plan and top 3 | A same-day planned task appears; top-3 pins survive a reload; Waiting tasks with a due check appear as promises |
| 5 | **P3-04** `!due:`, editable Due | The token sets `due_at` and not `scheduled_on`; the drawer edits and clears it |
| 6 | **P3-05** One capture path, `defaults`, keep-open, typeahead | Each listed entry point posts to `/api/capture` (client tests); the pill sends `defaults.ownerAccountId`, can be cleared, and works with a colon id |
| 7 | **P3-06** Meetings lens, redirects, nav/palette/AGENTS.md, deletions | Redirect tests for all 4 paths; nav migration tests (stored prefs containing `follow-ups`, a PUT from a stale client); past meetings are never "Upcoming"; actions show as `n/m`; old enums still accepted |
| 8 | **P2-04** Nav hiding and solo defaults | as in docs/56 |
| 9 | **P3-07** Date parsing and `~repeat` | Date table tests for each form; completing a repeating task creates exactly one successor and a retry doesn't duplicate it |
| 10 | **P3-08** Weekly review | Each section's query, and a carry/drop/schedule round-trip with undo |

## 9. Decisions (signed off 2026-09-29)

1. **Check-by storage:** reuse `follow_up_at`. No new column; the UI label is "Check by" and the API name stays `followUpAt`.
2. **External people:** a manager-private `contacts` table that `@` resolves, as specified in §2 and §3.
3. **Delegated tasks in Waiting:** only when the check is due or the task has been quiet for `TASK_STALE_DAYS` (5) or more days.
4. **`@dev` without a date:** keeps scheduling today on the developer's day, with a focus row.
5. **P3-00a:** added, and it is a prerequisite for P3-06. It runs first in the P3 order (§8), because P3-02 onward assumes capture works in every workspace.
6. **Old enum aliases:** `follow-ups` and `meetings` stay accepted for one release after P3-06 ships, then they are removed. The removal is tracked as a P7 cleanup.
