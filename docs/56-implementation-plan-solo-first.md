# Implementation plan: solo-first LeadOS

Source: [docs/55-solo-vs-collaborative-review.md](55-solo-vs-collaborative-review.md) (findings and citations). This doc is the execution plan and tracker. Agents should work from it.

## Decisions (locked)

1. **Default mode is `solo`.**
   - New workspaces start `solo`. If the setup wizard creates a developer login, the workspace becomes `collab`.
   - Migration: an existing workspace with at least one active developer `app_users` row becomes `collab`. Every other existing workspace becomes `solo`.
   - A developer is `participates` only if an active developer `app_users` row maps to them. Effective rule for any developer-participation signal: `mode === collab && participates`.
2. **Follow-ups and Meetings are not separate pages.**
   - They become built-in Tasks views/lenses: Follow-ups is the "Waiting / Delegated" lens, and Meetings is the `kind=meeting` lens. `/follow-ups` and `/meetings` redirect into Tasks.
   - Nav target: **Today | Tasks | Team | Work | Notes**. Team and Work are hidden by default in solo mode until a team or Jira exists, and pages can be hidden in Settings.

## How agents use this doc

- **Working rules (single checkout).** This is a solo project, so all work happens sequentially in `/home/ubuntu/Development/lead-os` directly on `main`. No worktrees and no task branches. Start with a clean `git status`. Make **one commit per item** (message `type(scope): summary (ITEM-ID)`), so any item can be undone with `git revert`. Do not push, and do not deploy, unless the user asks. Never run against runtime data, and never trigger Jira sync or write-back against the real Jira account: use test DBs, or copies of databases.
- Pick the **first unchecked item whose dependencies are done**, following the run order below. Ignore `parallel-ok` labels; everything runs one item at a time. Do not broaden scope.
- Before editing, re-read the cited files. Line numbers come from the 2026-09-29 review and may have drifted.
- Definition of done for every item:
  - Code and tests for the acceptance criteria.
  - `npm run typecheck` and `npm run build:check` pass, plus targeted tests (`npm run test --workspace=server -- <file>` / `npm run test --workspace=client -- <file>`).
  - If runtime exports were added to `shared/types.ts`, regenerate `shared/types.js` (command in AGENTS.md).
  - Route or behavior changes include route-level and service tests. Server services keep the coverage thresholds in `server/vitest.config.ts`.
  - Manager-only vs developer-only role boundaries are preserved.
- Track progress **in the same commit that finishes the item**: tick the box, and add a row to the Progress log.
- Status legend: `[ ]` todo, `[~]` in progress, `[x]` done (add the commit hash in the Progress log), `[!]` blocked (add reason).
- Never deploy to production from the development checkout. Production is `/home/ubuntu/apps/lead-os-prod` via `scripts/deploy.sh prod`.
- Do not commit secrets. `.env` files are git-ignored: never add them.

## Ownership: who does what

Opus (expert model) takes the small set of items that need judgment or have a wide blast radius. Sonnet takes everything else. **Default owner is Sonnet unless listed under Opus.**

**Opus owns:**

| Item | Why |
|---|---|
| P1-01 `team_mode` + `participates` | Foundation; every later phase reads it. Owns the `shared/types.ts` change. |
| P1-02 mode-aware freshness in `buildSignals` | Core signal logic; subtle and duplicated across services. |
| P1-03 suppress participation flows on the server | Same logic, spread across `today`, `workload`, `alert`, 1:1. |
| P1-05 central "Attention rules" + working-hours logic | Replaces four hardcoded copies of the thresholds. |
| P3-00 Tasks consolidation spec, P3-02 capture semantics, P3-03 `waitingOn`/`checkBy` | Data model, migrations, capture grammar. |
| P4-01 inbox, P4-02 field-change events, P4-06 visibility on shared history | New tables and visibility rules; wrong visibility leaks private data. |
| P6-05 Copilot safety | Confirmation and permission logic. |
| **Review only:** P0-S1, P0-S2, P0-S3 (implemented by Sonnet) | Security-sensitive. Opus reviews the PR before merge. |

**Sonnet owns (everything else), including:** P0-V1..V3, P0-S1..S4 and S6, P1-04, P1-06, P1-07, all of P2, P3-01 and P3-04..P3-10, P4-03, P4-04, P4-05, P4-07, all of P5, P6-01..P6-04 and P6-06, and all of P7.

**Review rules**
- Opus PRs: a Sonnet agent reviews for test coverage, role boundaries (manager-only vs developer-only) and AGENTS.md conventions before merge.
- Sonnet PRs that touch auth, sessions, developer-visible data, or migrations: Opus reviews before merge.

## Run order (sequential, on `main`)

Run these one at a time. Each step is one agent session; finish, verify and commit before starting the next. "Review" steps are batched and only need to happen before deploying or pushing.

| Step | Owner | Items | Notes |
|---|---|---|---|
| 1 | Sonnet | P0-S5 | Close the live 1:1 topic leak. |
| 2 | Sonnet | P0-S6 | Visibility of manager check-ins to developers. |
| 3 | Opus | P1-02 | Mode-aware freshness. Needs P0-V2 (recorded). |
| 4 | Opus | P1-03 | Suppress participation flows on the server. |
| 5 | Sonnet | P1-04, P1-06, P1-07 | Client relabeling, delete second attention model, standup follow-through. Needs steps 3-4. |
| 6 | Sonnet | P2-01, P2-02, P2-03, P2-05 | Solo onboarding and Jira-optional. (P2-04 waits for the Tasks consolidation.) |
| 7 | Opus | P1-05 | Central attention rules and working-hours logic. |
| 8 | Review | S1-S3, S5, S6 by Opus; P1-01..P1-03, P1-05 by Sonnet | One batch. Fix findings before pushing or deploying. |
| 9 | Opus | P3-00 spec | User signs off before step 10. |
| 10 | Opus then Sonnet | P3-02, P3-03 (Opus); P3-01, P3-04, P3-05, then P3-06 (Sonnet) | Then P2-04. |
| 11 | Sonnet | P5-01..P5-10 | Jira fixes. Can go before step 9 if preferred. |
| 12 | Opus then Sonnet | P4-01, P4-02, P4-06 (Opus); P4-03..05, P4-07 (Sonnet) | Collaborative loop. |
| 13 | Opus then Sonnet | P6-05 (Opus); rest of P6 and all of P7 (Sonnet) | Reporting, safety, polish. |
| 14 | Review | Anything after step 8 | Second batch before deploy. |

## Phase overview

| Phase | Goal | Depends on |
|---|---|---|
| P0 | Safety fixes and verify open questions | none |
| P1 | Solo foundation: `team_mode`, signals, relabeling | P0-V items |
| P2 | Solo onboarding and Jira-optional | P1-01 |
| P3 | Daily workflow and Tasks consolidation (Follow-ups/Meetings folded in) | P1 |
| P4 | Collaborative loop | P1 |
| P5 | Work/Jira fixes | P2-03 |
| P6 | Reporting and data safety | P1 |
| P7 | Polish, accessibility, cleanup | any |

P0 → P1 is the critical path. Everything runs sequentially per the run order above.

---

## P0: Safety fixes and verification

### Verify first (answers change later items)

- [x] **P0-V1** Confirm whether 1:1 agenda topics and session actions are visible to developers or count in Load and Up next.
  - Look at: `server/src/services/one-on-one.service.ts:634-639,927`, `my-day.service.ts:124-128`, `task.service.ts` (`meta.source` on the created event).
  - Output: one paragraph appended under "Findings from verification" at the end of this doc. If leaking, add a fix item to P0 as **P0-S5**.
- [x] **P0-V2** Confirm whether a manager-authored status change resets `lastCheckInAt`, and whether a manager-authored check-in resets developer staleness.
  - Look at: `team-tracker.service.ts:405-410,1645,2143-2148,2225`.
  - Output: paragraph under "Findings from verification". This shapes P1-02.
- [x] **P0-V3** Record which task flags are on in dev and prod (canonical tasks, `tasksPhase3`), from `task-keys.service.ts:12-45`.
  - This gates P3-06 (removing the Follow-ups/Meetings pages). They must be backed by the canonical Tasks model first. Record findings under "Findings from verification".

### Safety fixes (`parallel-ok`)

- [x] **P0-S1** (`task/p0-s1-my-day-issues-projection`) Restrict `/api/my-day/issues` to a developer-safe projection.
  - Files: `server/src/routes/my-day.ts:145-153`, `issue.service.ts:546-549`, `shared/types.ts`.
  - Accept: response has only key, summary, priority, status, due dates. No `localTags`, `analysisNotes`, `trackerAssignmentsToday`, `excluded`.
  - Test: route test asserting the field allowlist.
- [x] **P0-S2** (`task/p0-s2-revoke-on-removal`) Removing a team member revokes their login.
  - Files: `server/src/routes/team.ts:338-350`, `auth.service.ts:185-196,221-243`, `team-tracker.service.ts:2596-2608`.
  - Accept: after removal, existing sessions fail auth and the user cannot log in. Decide between deleting `app_users`/`app_sessions` and failing auth on an inactive mapped developer. Prefer failing auth in `getUserForSession` too, so it holds even if sessions survive.
  - Test: removed developer's cookie returns 401 on `/api/my-day`.
- [x] **P0-S3** (`task/p0-s3-throttle-and-reset`) Fix the login throttle behind the tunnel and add an admin password reset.
  - Files: `server/src/routes/auth.ts:82-84`, `server/src/app.ts`, `auth.service.ts:300-324`, `docs/42-auth-admin-cli.md`.
  - Accept: `trust proxy` configured from env (default safe for local dev), throttle keys on the real client IP, and a manager can reset a developer's password (Settings action, plus CLI command in `server/src/scripts/`).
- [x] **P0-S4** (`task/p0-s4-error-boundary`) Add a root error boundary and reload on chunk-load failure.
  - Files: `client/src/main.tsx:15-19`, `client/src/App.tsx:51-74`, `client/src/index.css:117-121`.
  - Accept: a render exception shows a recovery screen ("Reload / Go to Today"). `vite:preloadError` triggers one reload. Test with a throwing child.
- [ ] **P0-S5** Stop 1:1 agenda topics (and default session actions) from becoming developer-visible tasks. Found by P0-V1. Sonnet implements; Opus reviews (developer-visible data).
  - Files: `server/src/services/one-on-one.service.ts:634-644` (`createSessionAction`) and `:923-931` (`resolveOrCreateAgendaTask`), `task.service.ts:246-269` (`create`), plus a cleanup script under `server/src/scripts/`.
  - Do:
    - Agenda topics created from the agenda (`attachAgenda` with `title`, `quickAttach`) are manager-owned (`ownerType: "manager"`, `trackedByManagerId` = the manager) with a `person` link to the developer, not `ownerType: "developer"`.
    - Session actions default to manager-owned. Assigning one to the developer stays possible but is an explicit choice, and the UI says "Visible to {name}" (same wording as P0-S6). Confirm this default change with the user before merging.
    - Existing rows: a dry-run-by-default CLI that lists open developer-owned tasks attached to a 1:1 agenda (`one_on_one_agenda_items`) whose `created` event has `meta.source = "one_on_one"` and that have no developer-authored events. The manager picks which to move to manager ownership. Do not auto-reassign: a session action may have been assigned to the developer on purpose, and the agenda table cannot tell topics from actions.
  - Accept:
    - A newly created agenda topic is absent from the developer's `/api/my-day` (`tasks`, `plannedItems`, `currentItem`), and `/api/my-day/tasks/:key` returns 404 for it.
    - It is not counted in `assignedTodayCount` / `plannedCount` (Team workload, Load) or shown as the developer's "Up next".
    - The developer cannot read its events (`getTaskEvents` returns 404), and no `created` event for it is visible to the developer.
    - It still appears in the manager's 1:1 panel, Tasks and the person's linked work.
    - A session action explicitly assigned to the developer is still visible to them.
  - Test: route-level test that creates a topic via `POST /api/one-on-ones/:id/agenda` as a manager, then asserts the above as a developer (`/api/my-day`, task events) and as a manager. Add a service test for the workload counts and a test for the cleanup script's dry run.
- [ ] **P0-S6** Warn when a manager-authored check-in or status rationale will be visible to the developer.
  - Files: `team-tracker.service.ts:472-487`, `StatusRationaleDialog.tsx`, `my-day.service.ts:82`.
  - Accept: the dialog says "Visible to {name}" in collab mode, and offers a private variant. Otherwise strip `rationale` and `nextFollowUpAt` from developer responses.
  - Depends on P1-01 for mode awareness, but the strip-or-warn part can ship first.

---

## P1: Solo foundation

Critical path. Server changes first, then client relabeling.

- [x] **P1-01** Add `team_mode` (`solo | collab`) and per-developer `participates`. (`task/p1-01-team-mode`, uncommitted)
  - Pattern to copy: `one_on_one_enabled` (`one-on-one.service.ts:46,150-156`, `routes/auth.ts:90-97`, `shared/types.ts:725-731`, `useOneOnOne.ts:20-22`, `server/src/scripts/one-on-one.ts`).
  - Do:
    - Config key `team_mode` with `getTeamMode()` in `settings.service.ts`.
    - Migration per Decisions #1 (existing workspaces with a developer login become `collab`, the rest `solo`).
    - `SessionFeatures.teamMode`, and `participates: boolean` on `Developer`, `TrackerDeveloperDay`, `TodayTeamPulseItem`.
    - A Settings toggle (manager-only) and a CLI toggle.
    - A client hook `useTeamMode()`.
  - Accept: mode is readable on the client, `participates` is computed server-side from active developer `app_users`, and the migration is tested.
  - Note: regenerate `shared/types.js` if runtime constants are added.
- [ ] **P1-02** Make freshness mode-aware in `buildSignals`.
  - Files: `team-tracker.service.ts:355-425,3099-3115`.
  - Do:
    - If `mode === collab && participates`, keep the check-in rule.
    - Otherwise compute **manager touch** = max of the last manager-authored note, task event, status change, standup review/seal, and 1:1 for that person. Flag only after N working days untouched (default 5, matching `TASK_STALE_DAYS`, `shared/types.ts:952`).
    - Skip `statusChangeWithoutFollowUp` for manager-authored changes on non-participating developers.
    - Make `no_current` optional and off by default in solo.
    - Per P0-V2, stop manager check-ins from resetting developer staleness in collab.
  - Test: unit tests per mode (solo, collab participating, collab non-participating).
- [ ] **P1-03** Suppress developer-participation flows on the server for non-participating developers.
  - Files: `today.service.ts:749-790,954,1024-1039,1090-1102,1715-1727,1925-1937,2012-2019,2085-2098`, `workload.service.ts:20,28-34,147,182`, `alert.service.ts:121-129`, `one-on-one.service.ts:552-558`.
  - Accept:
    - `/api/today` emits no `stale_check_in` rows and no `ask_check_in` command, no "Quiet since standup", and no "No check-in today" for those developers.
    - The `idle_developer` alert fires only for participating developers.
    - The 1:1 suggestion becomes "no touch in N days" in solo.
    - Standup "N stale" context is dropped.
  - Test: route-level `/api/today` tests asserting each.
- [ ] **P1-04** Client relabeling and hiding.
  - Files: `TrackerSummaryStrip.tsx:20-21`, `rosterSignals.ts:39-145`, `TrackerRosterBoard.tsx:218-236`, `TrackerSignalBadges.tsx:38-43`, `AttentionCard.tsx` (delete, dead code), `DeveloperDrawerSections.tsx:201,228`, `TodayPage.tsx:375`, `TodayWrapUp.tsx:35,113-123`, `today-layout.ts:75-119,401-416`, `StandupPersonHeader.tsx:145-161`, `standup.ts:246-248`.
  - Accept: in solo, no stale chip or metric; the Check-in column becomes a quiet "Last touched" column; "Add check-in" reads "Add note"; the wrap-up block can reach "all closed". Collab is unchanged.
- [ ] **P1-05** Centralize attention thresholds into one settings block ("Attention rules").
  - Files: `settings.service.ts:16-19`, `workload.service.ts:20`, `client/src/lib/utils.ts:66`, `today.service.ts:358`, `routes/config.ts`.
  - Do: one shared config (stale hours, no-current hours, manager-touch days, Jira stale hours, day-start and working hours) exposed via config route and editable in Settings. Remove the hardcoded 4h and 48h copies. Make hour-based rules working-hours aware (fixes the morning-noise item from docs/44 §5).
- [ ] **P1-06** Delete the second attention model.
  - Files: `client/src/lib/manager-attention.ts`, `useManagerAttention.ts:6`, `WorkFocusStrip.tsx:6`.
  - Accept: Work's focus strip reads from the same server signals as Today. `manager-attention.ts` removed.
- [ ] **P1-07** Manager-owned standup follow-through in solo.
  - Files: `standup.ts:125-128`, `StandupMode.tsx:393-397`, `team-tracker.service.ts:1381-1447,1434-1437`.
  - Accept:
    - Reviewing a person in standup counts as a manager touch.
    - The `f` flag takes an optional one-line reason.
    - The sealed follow-up task links to the developer.
    - The right-hand feed can collapse.

---

## P2: Solo onboarding and Jira-optional

`parallel-ok` with P4 after P1-01.

- [ ] **P2-01** Setup wizard: solo/team choice in step 1.
  - Files: `client/src/components/setup/SetupWizard.tsx:132-138,150,497-508,938,1227,1255-1256`.
  - Accept: solo needs only the manager account; Jira, roster and developer access are offered as later optional steps. Creating a developer login in the wizard sets `collab`. "Skip for now" completes the wizard without a sync. Update stale copy ("Team, Desk, Follow-ups…"). Raise the minimum password length above 6 (client and `routes/auth.ts:23`).
- [ ] **P2-02** After setup, land on Today, and add a first-run Today state.
  - Files: `App.tsx:938-941,1013-1015`, `today.service.ts:369-370`, `TodayPage.tsx:405`.
  - Accept: `replaceView('today')` on completion; a getting-started card (add people, capture a task, connect Jira, set the day rhythm); the standup card is guarded on team size.
- [ ] **P2-03** Expose `jiraConfigured` and add a "Jira not connected" state.
  - Files: `server/src/sync/engine.ts:124-127`, `client/src/components/layout/Header.tsx:33`, `DashboardLayout.tsx:116-119`, `DefectTable.tsx:926-927`, `ErrorBanner.tsx:19`, `shared/types.ts:2222`.
  - Accept: with no Jira, sync controls and Jira-only signals are hidden; Work shows "Connect Jira, or add tasks manually"; the `r` shortcut is inert; there is no red error state.
- [ ] **P2-04** Nav defaults and hiding.
  - Files: `shared/types.ts:2221-2224`, `useNavPreferences.ts`, `nav-pages.ts:54-80`, `nav-preferences.service.ts`, Settings > Navigation.
  - Accept: solo default is Today, Tasks, Notes, with Team and Work hidden until a team or Jira exists. Pages can be hidden (not only moved between the bar and More). Existing saved preferences migrate cleanly.
- [ ] **P2-05** Day rhythm settings.
  - Files: `shared/types.ts:328-332`, `routes/today.ts:67`, `today-state.service.ts:18`, Settings.
  - Accept: a Settings card for stage times and start/end of day using the existing `PUT /api/today/settings`.

---

## P3: Daily workflow and Tasks consolidation

Serialize these among themselves. Spec first (P3-00).

- [ ] **P3-00** Write a short spec (`docs/57-tasks-consolidation-spec.md`) covering: the lifecycle (Inbox untriaged → Planned → Waiting → Done, with "later" as a `hideUntil` date), the `waitingOn` / `checkBy` / `due` fields, the capture grammar additions, and the migration of Follow-ups/Meetings views. Get user sign-off before P3-03 onward.
- [ ] **P3-01** Today "my plan" and top 3.
  - Files: `task.service.ts:795-796`, `today.service.ts:1288`, `shared/types.ts:386`, `TodayPage.tsx`, `TodayWrapUp.tsx`, `today-progress.ts`.
  - Accept: `focus.plan` shows today's scheduled and active manager tasks; a "Plan your day" row when empty; "Pick up to 3" pins to the top of the queue; wrap-up shows "Done today (N)" from real completions plus "Tomorrow's top 3". The cleared count is no longer session-only.
- [ ] **P3-02** Capture semantics: no date means untriaged.
  - Files: `capture.service.ts:159`, `task.service.ts:257-260,295`, `task-views.service.ts:45,143`, `shared/capture-grammar.ts`.
  - Accept: a capture with no date and no owner token lands in Inbox (owner me, unscheduled); Inbox is "untriaged", not "unowned"; `/later` accepts a resurface date (`/later !mon`) and allows `@person`.
- [ ] **P3-03** `waitingOn` and `checkBy` fields plus a Delegated/Waiting lens.
  - Files: `schema.ts`, `task.service.ts`, `task-views.service.ts:190,197`, `shared/types.ts`, `capture-grammar.ts:220-223`, `capture.service.ts:81`, `TasksPage.tsx:635-639`.
  - Accept:
    - `waitingOn` takes a person or free text; external stakeholders are allowed.
    - Capture tokens `/w @who !date` and `/f`.
    - A lens grouped by person with aging.
    - Stale detection extends to delegated tasks.
    - A list keybinding.
- [ ] **P3-04** Editable deadline.
  - Files: `TaskDetailFields.tsx:202-204`, `task.service.ts:41`, `capture-grammar.ts`.
  - Accept: an editable Due field in the drawer and a `!due:fri` token, kept separate from plan date.
- [ ] **P3-05** Unify capture paths.
  - Files: `CaptureBox.tsx:172-187,227,241-243,273,311-326`, `TasksPage.tsx:751`, `TriageDeskSection.tsx:50`, `TaskDetailRelations.tsx:329`, `MemoryComposer.tsx:33,51`, Notes dialogs.
  - Accept:
    - All creation routes go through one grammar and endpoint.
    - "Keep open" mode (Cmd/Ctrl+Enter).
    - `@` and `#` typeahead.
    - The assignee pill sends a structured `ownerAccountId` instead of injecting `@id` text, allows clearing, and has a colon-id test. Or allow `:` in `PERSON_REF`.
    - The Jira triage button no longer says "Add to Desk".
- [ ] **P3-06** Fold Follow-ups and Meetings into Tasks and remove the pages. **Blocked by P0-V3, P3-00, P3-03.**
  - Files: `client/src/components/manager-memory/**`, `useCanonicalTasks.ts:11`, `App.tsx` (legacy aliases and routes), `nav-pages.ts:54-80`, `paletteItems.ts`, `shared/types.ts:2221-2224`, `nav-preferences.service.ts`, `task-views.ts:64-65`.
  - Accept:
    - Tasks has built-in "Waiting / Delegated" and "Meetings" views.
    - `/follow-ups`, `/followups`, `/meetings`, `/meeting` redirect to the matching Tasks view.
    - Saved nav preferences that reference the removed pages are migrated.
    - The palette entries point at the Tasks views.
    - Meetings show child action items; past meetings are no longer laned "Upcoming".
    - `manager-memory/` components are deleted, and the fake 90-minute due time is gone.
    - AGENTS.md is updated (routes, `/tasks`, nav).
  - Test: route redirect tests and a nav-preference migration test.
- [ ] **P3-07** Date parsing and recurrence.
  - Files: `capture-grammar.ts:154-165`, `task.service.ts`.
  - Accept: natural-language dates ("next Friday", "in 2 weeks", "eow") with a chip preview, and `~weekly`/`~monthly` recurrence on tasks.
- [ ] **P3-08** Weekly review flow.
  - Files: new under `client/src/components/today/` or Tasks; `today.service.ts`.
  - Accept: closed last 7 days, stale delegated tasks, open follow-ups, and a "carry / drop / schedule" action per item.
- [ ] **P3-09** Tasks list at scale.
  - Files: `task-views.service.ts` (`run`), `TaskBulkBar.tsx:29-33`, `TasksPage.tsx:635-639`, `today-triage.ts:18`.
  - Accept: pagination or virtualization; bulk priority and follow-up; a unified keymap between Today and Tasks (`s` means the same thing).
- [ ] **P3-10** Decisions lens and person-linked notes (stretch).
  - Files: `TaskUpdateComposer.tsx:7`, `daily-notes.service.ts:72-81`, `TaskDetailFields.tsx:179-186`.
  - Accept: `/d` token and a Decisions lens; `@person` in notes creates refs; a "history with X" panel for meeting prep.

---

## P4: Collaborative loop

`parallel-ok` with P2, P3 after P1-01. All of this applies only when `mode === collab`.

- [ ] **P4-01** In-app inbox with unread counts (per user).
  - Files: `schema.ts` (new table), `task-events.service.ts`, new route, `useMyDay.ts:19`, `useToday.ts:27`.
  - Accept: assignments, manager instructions, developer blockers and updates create inbox rows; unread badge on both sides. (Email/Slack digest is P6-03.)
- [ ] **P4-02** Field-change events and a seen cursor.
  - Files: `task.service.ts:308-318`, `surface-tasks.ts:71-99`, `MyDayTaskParts.tsx:212,274-283`, `schema.ts`.
  - Accept: edits to priority, due date, details, outcome and participants emit `field_change` (from/to); a per-developer `task_seen` cursor drives a "New from lead" badge; concurrent edits to `details` are protected by a version check.
- [ ] **P4-03** Provenance badge in canonical mode.
  - Files: `MyDayTaskParts.tsx:15-17,252-262`.
  - Accept: the badge is based on `createdBy.type === 'manager'` or assign provenance.
- [ ] **P4-04** Acknowledge, reply, and reason-on-drop.
  - Files: `my-day.service.ts:57-58`, `task.service.ts:281-284`, `TaskTimeline.tsx:38`.
  - Accept: developers can ack an `instruction` (`meta.replyTo`); dropping an assigned task prompts a reason; timeline labels are role-aware.
- [ ] **P4-05** Developer blockers reach the manager.
  - Files: `my-day.service.ts:62-65`, `my-day.ts:22-31`, `today.service.ts:486-497`, `today-state.service.ts:145+`, `QuickUpdates.tsx:62`.
  - Accept: a raised blocker sets or suggests `blocked`/`waiting`, shows in Today's since-last-visit strip and queue, and blocked/waiting status from a developer requires a reason.
- [ ] **P4-06** Visibility controls on shared history.
  - Files: `task-events.service.ts:101-149`, `TaskUpdateComposer.tsx:62`.
  - Accept: reassigning warns "N earlier shared events will become visible" or applies a `visibleToOwnerFrom` cutoff.
- [ ] **P4-07** Per-developer `tracking_mode` UI and "no login" label.
  - Files: Settings team members, `TrackerRosterBoard.tsx`.
  - Accept: the board labels non-login developers; Settings can link or unlink a login; a last-active time comes from `app_sessions.lastSeenAt` (`schema.ts:69-75`) for participating developers.

---

## P5: Work/Jira fixes

Depends on P2-03. `parallel-ok` with P3.

- [ ] **P5-01** Default sync scope includes unassigned issues; diagnostic empty state.
  - Files: `server/src/jira/jql.ts:165`, `SettingsPanel.tsx:1299-1301`, `DefectTable.tsx:927`.
  - Accept: unassigned defects sync by default; the empty state shows synced count, scope and roster size.
- [ ] **P5-02** Suggestions "Apply All" safety.
  - Files: `SuggestionBar.tsx:70-87`, `automation.service.ts:17`, `routes/suggestions.ts:53`, `issue-rules.ts:19`.
  - Accept: diff view with per-field apply; hide default-only or unchanged suggestions; errors surface; SLA targets are configurable; "from creation" is computed from creation.
- [ ] **P5-03** Sync freshness and failure visibility.
  - Files: `routes/sync.ts:31`, `engine.ts:199-202`, `issue.service.ts:334`, `Header.tsx:33`, `ErrorBanner.tsx:12-20`, `jira/client.ts:74-92`, `TriagePanel.tsx:72-79`.
  - Accept: `lastSuccessAt` stored separately; "Jira synced 12m ago" chip on Today and Work; banner has Retry and a Settings link; retries for 5xx; no raw Jira JSON in toasts.
- [ ] **P5-04** Triage edit correctness.
  - Files: `TriageQuickActions.tsx:263,301`, `InlineEditAssignee.tsx:37`, `InlineEditDueDate.tsx:116`, `routes/issues.ts:8,39-46`, `issue.service.ts:204-208`, `config.ts:12`.
  - Accept: can unassign and clear dates (accept `null`); date commits on blur or Enter; standard `duedate` is used when no dev-due field is configured; the issue-key regex accepts digits in project keys.
- [ ] **P5-05** Comment write-back feedback.
  - Files: `CommentForm.tsx:386-393`, `engine.ts:138-153`.
  - Accept: success and error toasts, the last few comments shown, and a graceful local-only mode when Jira is read-only.
- [ ] **P5-06** Alert quality.
  - Files: `alert.service.ts:99-144`, `issue.service.ts:403-405,428`, `DefectTable.tsx:1021`, `utils.ts:66`, `manager-attention.ts` (deleted in P1-06).
  - Accept: status-aware stale (skip To Do and waiting states); Jira status-category check instead of the "To Do" name; server threshold passed to the client; `detectedAt` is stable; alert snooze until a date.
- [ ] **P5-07** Local writes must not reset Jira staleness.
  - Files: `issue.service.ts:193,246`.
  - Accept: a separate `localUpdatedAt`.
- [ ] **P5-08** Excluded/snoozed list and restore.
  - Files: `DefectTable.tsx:36-75`.
  - Accept: an "Excluded / snoozed" filter, row-level snooze (tomorrow, next week, custom), and restore.
- [ ] **P5-09** Scale.
  - Files: `issue.service.ts:65-92,481,525`, `useIssues.ts:41`, `DefectTable.tsx:1013-1068`, `InlineEditTags.tsx:18`, `alert.service.ts:121`, `workload.service.ts:103,183`.
  - Accept: descriptions omitted from list responses; server limit or virtualized rows; history filtered by date in SQL; alerts computation cached; theme change does not remount every row.
- [ ] **P5-10** Configurable Jira tenant fields and timezone.
  - Files: `engine.ts:150,236,440`, `issue.service.ts:208`, `routes/config.ts:388`, `server/src/utils/date.ts:20-22`.
  - Accept: the Flagged field and dev-due field come from field discovery; a workspace timezone setting drives overdue and due-today.

---

## P6: Reporting and data safety

Depends on P1. Items are independent (`parallel-ok`).

- [ ] **P6-01** Backups UI and access.
  - Files: `server/src/app.ts:169`, `routes/backups.ts:17,26`, `routes/config.ts:33-40`, `SettingsMaintenanceSection.tsx:147-150`, `paletteItems.ts:50`.
  - Accept: `/api/backups` under `requireManager`; a Settings > Data card with schedule, "Back up now", snapshot list and download; restore documented as CLI-only; optional off-box hook (rsync/S3) documented or implemented.
- [ ] **P6-02** Weekly summary and exports.
  - Accept: a Weekly review report (follow-ups closed, carry-forward rate, blocked items, and in collab, check-in cadence) with Copy-as-Markdown and CSV export on that report and on Tasks, Team and Work.
- [ ] **P6-03** Daily digest and reminders.
  - Files: scheduler pattern at `backup.service.ts:64`, `sync/engine.ts:40`.
  - Accept: an opt-in daily digest (email or webhook) and reminders for snooze expiry and due follow-ups. Browser push is an acceptable first step.
- [ ] **P6-04** Copilot: morning brief and reporting tools.
  - Files: `docs/46-copilot-v2.md:64,185`, `server/src/assistant/tools.ts:249-318`, `SuggestionChips.tsx:9-24`.
  - Accept: `morning_brief` opt-in; `get_week_summary(from, to)` and `get_person_history(accountId, days)` read tools; templates for weekly summary, 1:1 prep and boss update; Copy and "Save to Notes" on answers; per-turn token usage.
- [ ] **P6-05** Copilot safety.
  - Files: `AssistantSection.tsx:399-412`, `assistant/service.ts:38,142,156,201,749`, `ActionConfirmCard.tsx:34,102`, `useAssistant.ts:43`, `tools.ts:1263,1295,1418-1426`, `AssistantDock.tsx:50,65`, `AssistantHeader.tsx:137`.
  - Accept:
    - Full-access mode still confirms `jiraMutating` and `delete_*` tools.
    - Persistent "Full access" badge and an action log.
    - Confirm cards show key fields inline and old vs new values.
    - The client's own Jira-mutating tool set is removed, so the server flag is the only source.
    - Confirm and cancel are exempt from the rate limit, and the dock shows remaining quota and a retry time on 429.
    - Delete-conversation asks for confirmation or offers undo.
- [ ] **P6-06** Safer "Reset configuration".
  - Files: `SettingsPanel.tsx:408`, `routes/config.ts:615`.
  - Accept: typed confirmation that lists what is lost (Copilot key, backup and rhythm settings, issues and developers).

---

## P7: Polish, accessibility, cleanup

`parallel-ok`. Small, independent items.

- [ ] **P7-01** Toasts: errors persist and use `role="alert"`/assertive; timers pause on hover and focus (`ToastContext.tsx:49-100`, `lib/undo.ts:5`).
- [ ] **P7-02** Command palette: combobox/listbox ARIA, error state with retry, recents on empty query, ranked search, "show more", limited issue query (`CommandPalette.tsx:143-146,277-302`, `search.service.ts:159-186`).
- [ ] **P7-03** Global `?` shortcut sheet that lists global plus page shortcuts; platform-aware key glyphs; keyboard button visible below `md` (`App.tsx:984-999`, `TodayRhythmHeader.tsx:94,104`, `Header.tsx:212,231,254`).
- [ ] **P7-04** Header/nav: More menu Escape and arrow keys and no hover/click double toggle (`HeaderNav.tsx:123-128`); one `<h1>` per page (`Header.tsx:139`); phone nav that does not clip (`WorkspaceNavLink.tsx:44`, `Header.tsx:135-148`).
- [ ] **P7-05** Replace remaining `#fff`-on-accent with `var(--on-accent)` (`App.tsx:387`, `ManagerMemoryPage.tsx:47` (deleted with P3-06), `SettingsPanel.tsx:1330`, `TagManagementSection.tsx:82`, `TaskDrawer.tsx:632`); use `var(--overlay-shadow)` in `AssistantDock.tsx:65`.
- [ ] **P7-06** Theme respects `prefers-color-scheme` and guards `localStorage` writes (`ThemeContext.tsx:24-30`).
- [ ] **P7-07** Settings information architecture: Workspace, People, Integrations, Data (`SettingsPanel.tsx:802-815`).
- [ ] **P7-08** Team board fixes: consistent default sort between client and server (`useBoardQueryState.ts:43`, `team-tracker-board-query.ts:12`, `view-params.ts:108`, `App.tsx:439-443`, `TrackerBoardToolbar.tsx:77`); inline "pick current" on empty cells; bulk morning planning (`TrackerRosterBoard.tsx:90-94,375`, `TrackerItemRowActions.tsx:54-68`).
- [ ] **P7-09** Availability date ranges with auto-return (`developer-availability.service.ts:164`, `AvailabilityDialog.tsx:39`, `TeamTrackerPage.tsx:944`) and an over-capacity signal (`TrackerRosterBoard.tsx:190-216`, `team-tracker.service.ts:878-889`).
- [ ] **P7-10** 1:1: a Settings toggle for `one_on_one_enabled`, "start series for all", and drawer-side discoverability (`scripts/one-on-one.ts`, `TeamTrackerPage.tsx:601-604`, `OneOnOneSeriesPanel.tsx:60-73`).
- [ ] **P7-11** Remove dead code and finish the legacy cutover: `QuickAddTaskModal.tsx`, unused carry-forward hooks (`useTeamTracker.ts:79-105`), the `ManagerDeskPage` fallback (`App.tsx:1109-1127`), and `canonicalEnabled` branches (73 sites), then `npm run tasks:drop-legacy` per its 30-day soak rule. Update docs/33 and docs/50 where they have drifted.
- [ ] **P7-12** Keep AGENTS.md current: `/tasks`, the new nav, `team_mode`, removed pages, and the new scripts.

---

## Progress log

| Date | Item | Branch / PR | Agent | Notes |
|---|---|---|---|---|
| 2026-09-29 | P0-V1, P0-V2, P0-V3 | (read-only, no branch) | Sonnet | V1 found a leak: added P0-S5. V2 shapes P1-02. V3: stage 2c and phase 3 on in dev and prod. |
| 2026-09-29 | P0-S4 | task/p0-s4-error-boundary | Sonnet | Root error boundary, guarded reload on `vite:preloadError` and lazy-chunk errors (30s sessionStorage guard). |
| 2026-09-29 | P0-S1 | task/p0-s1-my-day-issues-projection | Sonnet | `DeveloperIssue` allowlist projection for `GET /api/my-day/issues` (`IssueService.getForDeveloper`), route tests incl. exact-key allowlist. Needs Opus review (developer-visible data). |
| 2026-09-29 | P0-S2 | task/p0-s2-revoke-on-removal | Sonnet | Removal (DELETE and PATCH isActive:false) deletes the developer's sessions and login rows; `getUserForSession` and login reject developer logins with a missing/inactive team member. Needs Opus review (auth/sessions). |
| 2026-09-29 | P0-S3 | task/p0-s3-throttle-and-reset | Sonnet | `TRUST_PROXY` env (validated; blanket `true` rejected) applied in `createApp`; manager-only developer password reset (route, Settings action, `auth:reset-password` CLI). Needs Opus review (auth). |
| 2026-09-29 | P1-01 | `task/p1-01-team-mode` (uncommitted) | Opus | `SettingsService.getTeamMode()/setTeamMode()` (missing key → `solo`); one-shot `team_mode_v1` backfill in `migrate()` (active developer login → `collab`, else `solo`; explicit values kept; report in `data_migrations`). `participates` from `getParticipatingDeveloperIds()` (`developer-participation.service.ts`) on `Developer`, `TrackerDeveloperDay`, `TodayTeamPulseItem`. `SessionFeatures.teamMode` on every session; manager-only `GET/PUT /api/config/team-mode`; Settings → Team Members toggle; `npm run team-mode -- --workspace <id> [--status\|--set solo\|collab]`; `useTeamMode()`/`useSetTeamMode()`. Migration verified on snapshot copies of dev `dashboard.sandbox.db` and legacy `dashboard.db` (both → `collab`, integrity ok, idempotent). Signals untouched (P1-02/P1-03). Pre-existing failures on `HEAD`, unrelated: `one-on-ones.test.ts` (agenda suggestions), `task-views.routes.test.ts` (closed range). |

## Findings from verification

### P0-V1: 1:1 agenda topics and session actions (2026-09-29): LEAK, developers see them and they count in Load and Up next

Static read, the app was not run. Every 1:1 agenda topic and, by default, every session action is a real canonical task **owned by the developer**, and nothing downstream tells it apart from ordinary developer work.

- Topics: `resolveOrCreateAgendaTask` calls `taskService.create({ title, ownerType: "developer", ownerId: series.developerAccountId }, principal, { source: "one_on_one" })` (`one-on-one.service.ts:919-931`). This is the path for `attachAgenda` (`:397-409`) and `quickAttach` (`:414-460`).
- Session actions: `createSessionAction` does the same, with `ownerType = input.ownerType ?? "developer"` and `ownerId` defaulting to the series developer (`one-on-one.service.ts:626-645`).
- `TaskService.create` sets `scheduledOn` to today when none is given (`task.service.ts:260`), writes a `day_focus` row (`:267`) and emits a `created` event (`:269`). `meta.source` (`"one_on_one"`) is only recorded in that event's metadata. No code reads it as a filter: `grep` finds `one_on_one` as a task source only at `task.service.ts:246`, `task-events.service.ts:16` (enum) and the two call sites.
- Developer visibility: the topic is a normal row for `TaskService.list` when the principal is a developer (`task.service.ts:176-185`, owner filter only), and `developerBoardRows` returns all open developer-owned tasks with no source filter (`task.service.ts:677-693`). `MyDayService.getMyDay` builds from that board (`my-day.service.ts:69-72`, `team-tracker.service.ts:3035,3094`) and `nativeTasks` uses `list` directly (`my-day.service.ts:124-129`), so the topic title appears in My Day as planned work.
- Events: the `created` event is `shared` (`task-events.service.ts:101-102`: non-update types are always shared), and the developer visibility rule returns shared events on tasks they own (`task-events.service.ts:132-147`). `getTaskEvents` (`my-day.service.ts:51-53`, route `GET /tasks/:key/events` at `routes/my-day.ts:135`) therefore shows the topic's history to the developer.
- Load and Up next: `workload.service.ts:140-147` takes `plannedCount`, `currentCount` and `assignedTodayCount` from the canonical day, which includes these tasks. They also feed `idle`, `noCurrentItem` and `backlogTrackerMismatch` (`:145-167`), and the "Up next" list is the same `plannedItems`.
- Not leaking: the agenda rows and sessions themselves (`one_on_one_agenda_items`, sessions, private notes) are only served by `/api/one-on-ones`, which is `requireManager` (`app.ts:197`), and the router does not mount under `/api/my-day`. Only the materialised task is exposed. A session action created with `ownerType: "manager"` is not exposed.
- Reach: `one_on_one_enabled` is `true` in the prod default and workspace `workspace_317591b1-…` rows and in the dev sandbox DB (see P0-V3), so this is live in prod, not theoretical. `server/tests/one-on-ones.test.ts` has no developer-side assertion.
- Consequence: a private agenda topic such as "performance concerns" would appear on the developer's board once attached. The developer cannot rename it (creator rule, `task.service.ts:284`) but can see it and its history. Fix item added as **P0-S5**.

### P0-V2: manager status changes and check-ins vs `lastCheckInAt` (2026-09-29)

Static read. Short answers: a status change through `updateDay` does **not** reset `lastCheckInAt`; a manager-authored check-in **does**, and so does every other author, because the reset ignores who wrote it.

- `updateDay` (`team-tracker.service.ts:1619-1653`) sets `status`, `statusUpdatedAt` (only when the status changed) and `updatedAt`. It never writes `lastCheckInAt`. It has no actor parameter, so a developer's own status change from My Day (`my-day.service.ts:113-122`), a manager's PATCH (`routes/team-tracker.ts:452-468`) and the Copilot `update_day` tool (`assistant/tools.ts:1465`) behave the same.
- `addCheckIn` unconditionally writes `lastCheckInAt: now` and `nextFollowUpAt` on the day row (`team-tracker.service.ts:2143-2148`) and, when the status changes, also `statusUpdatedAt` (`:2149-2153`). The actor only sets `authorType` / `authorAccountId` on the check-in row (`:2135-2136`); it does not gate the reset. Manager callers: `POST /:accountId/checkins` (`routes/team-tracker.ts:562-578`, actor is the logged-in role), Today's `add_check_in` command (`today.service.ts:619-625`), and the status-update flow `submitStatusUpdate` (`team-tracker.service.ts:2225`).
- Effect on signals (`buildSignals`, `:355-425`): `staleByTime` and `staleWithoutCurrentWork` read `hoursSinceCheckIn` from `lastCheckInAt` (`:380-394`), so a manager check-in makes the developer look fresh even if the developer has not said anything. `statusChangeWithoutFollowUp` (`:399-412`) compares `lastCheckInAt` with `statusUpdatedAt`. A plain manager status change to blocked / at_risk / waiting leaves `lastCheckInAt` older than `statusUpdatedAt`, so it flags after the threshold unless a check-in follows. Any check-in, by anyone, clears it.
- Staleness carries across days: the board uses the latest day row at or before the date (`effectiveDay`, `:2809`, `:2951`), and `lastCheckInAt` is only ever written at `:2145`.
- Data needed for P1-02: `team_tracker_check_ins.author_type` already exists (`schema.ts:205`, default `manager`), so "developer-authored check-in" and "manager touch" can be derived without a schema change. `lastCheckInAt` on the day row cannot distinguish them and should be split or recomputed from check-in rows filtered by author.
- Shapes P1-02: in collab, only developer-authored check-ins may reset developer staleness (manager check-ins become manager touches); in solo, manager touch is the only clock. `updateDay` needs an actor so the developer's own status change and a manager's can be told apart for the `statusChangeWithoutFollowUp` skip on non-participating developers.

### P0-V3: task flags in dev and prod (2026-09-29)

Read the `config` table read-only (SQLite `mode=ro`, only the four flag keys; no secrets were read). Flag logic: `canonicalEnabled` is true for `tasks_phase2_stage` in `2b`/`2c`/`2d` (`task-keys.service.ts:10-15`); `phase3Enabled` needs stage `2c`/`2d` **and** `tasks_phase3_enabled = "true"` (`:40-45`); `contracted` is stage `2d` only (`:69-71`).

| Where | DB | `tasks_phase1_enabled` | `tasks_phase2_stage` | `tasks_phase3_enabled` | `one_on_one_enabled` |
|---|---|---|---|---|---|
| Prod, `default` workspace | `/home/ubuntu/apps/lead-os-prod/data/dashboard.db` | true | **2c** | true | true |
| Prod, `workspace_317591b1-5cb2-4ecd-a46d-7542ffe6c725` | same file | true | **2c** | true | true |
| Dev, `default` workspace | `data/dashboard.sandbox.db` (selected by `DASHBOARD_DB_PATH` in the dev checkout `.env`) | true | **2c** | true | true |

- Canonical tasks and Phase 3 are on everywhere that matters, so P3-06's precondition ("Follow-ups and Meetings backed by the canonical Tasks model") holds in prod and dev. `useCanonicalMemoryTasks` (`useCanonicalTasks.ts:24-40`) already feeds `/follow-ups` and `/meetings` from canonical view definitions.
- Nobody is at `2d` yet, so the contract has not run: legacy fields are still accepted (`assertLegacyFieldsAllowed`), `npm run tasks:drop-legacy` is not eligible, and P7-11's `canonicalEnabled` branch removal must wait until `2d` plus the 30-day soak. Check the stage again before P3-06 and P7-11; it is a moving target.
- `ManagerMemoryPage.tsx:56` still has a non-canonical branch (`day.data?.taskModel === 'canonical'`). It is dead in prod and dev today but P3-06 should delete it with the page.
- Caveat: `/home/ubuntu/Development/lead-os/data/dashboard.db` is a stale pre-workspace file (config has no `workspace_id`, no `tasks` table, last modified 2026-06-01). It is not the dev runtime DB (`.env` points at the sandbox DB). Other worktrees may set their own `DASHBOARD_DB_PATH`; check that worktree's `.env` before assuming these values.

## Open risks

- The review did not run the app. Items marked "inferred" in docs/55 (phone nav clipping, standup card with zero developers) need a live check before or during their item.
- Removing the Follow-ups and Meetings pages (P3-06) depends on the canonical Tasks model being on wherever the app runs. Do not start it until P0-V3 is recorded.
- The `team_mode` migration must be tested against a copy of the production database before deploy. Do not run it against production data directly.
