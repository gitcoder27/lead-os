# LeadOS review: solo manager vs. two-way (manager + developers)

Date: 2026-09-29. Method: seven parallel read-only code reviews (solo-mode noise, Today/shell, Team/Standup/1:1, Tasks/Desk/Notes/Capture, Work/Jira, developer My Day and the two-way loop, Copilot and cross-cutting UX). Findings are from reading the working tree. **The app was not run**, and citations were not independently re-verified by a second pass.

## 1. Verdict

Your hypothesis holds. LeadOS has **no concept of solo use**. Every "participation" signal is derived from `lastCheckInAt`, which is null for anyone who never checks in. A solo manager therefore sees the whole team as permanently stale. Stale, check-in, "ask for update", "no current work" and "silent since standup" are noise for that manager. The same signals are correct in collaborative mode.

Two other problems cut across both modes:

1. **Jira-first defaults.** New workspaces land on Work, and Work says "Your project is clean" when Jira was never connected.
2. **Too many containers.** Tasks, Desk, Follow-ups, Meetings and Notes overlap, and capture and triage are disconnected.

## 2. Solo-mode noise (your point)

Root cause: `staleByTime` is true when there is no check-in ever, or the last one is 4h old or more (`server/src/services/team-tracker.service.ts:385-387`). The thresholds are 4h, 2h and 2h (`settings.service.ts:17-19`). No UI or config route sets them, and there are wall-clock hours with no workday or weekend awareness (`team-tracker.service.ts:355-362`).

| Noise source | Citation |
|---|---|
| Stale chip and board summary counts | `team-tracker.service.ts:2538-2543`, `TrackerSummaryStrip.tsx:20-21` |
| Roster Check-in column, amber dot, "Stale"/"No current follow-up" badges | `rosterSignals.ts:134-145`, `TrackerRosterBoard.tsx:218-236`, `TrackerSignalBadges.tsx:38-43` |
| Today header metric "Stale check-ins" and a grouped "Ask all" queue row | `today.service.ts:401,894,954`, `today-layout.ts:75-119,401-416` |
| "Ask for update" creates a task on a My Day nobody sees. The ask never closes, because only a developer-authored check-in resolves it. | `today.service.ts:749-790,1925-1937` |
| "Quiet since standup", wrap-up "No check-in today" and "Ask all" | `today.service.ts:2085-2098`, `TodayWrapUp.tsx:113-123` |
| The manager's own status change triggers a "no follow-up" flag 2h later, because it sets `statusUpdatedAt` but not `lastCheckInAt` (for status only; see the note on check-ins below) | `team-tracker.service.ts:405-410,1645`; row rail at `rosterSignals.ts:52-59` |
| `staleWithoutCurrentWork` demands a "current task" pick for every person, every day | `team-tracker.service.ts:391-394` |
| A second attention model on Work that disagrees with Today | `manager-attention.ts:174,338-344,461-466`, consumed at `WorkFocusStrip.tsx:6` |
| Workload has its own hardcoded 4h stale rule, and the `idle_developer` alert fires for anyone with no tracker plan | `workload.service.ts:20,28-34,147`, `alert.service.ts:121-129` |
| 1:1 suggestion "no check-in for 3 days" | `one-on-one.service.ts:552-558` |

The agents disagreed on one detail: one said a manager status change doesn't set `lastCheckInAt`, another said `recordStatusUpdate` synthesizes a check-in (`team-tracker.service.ts:2225`). Either way the root problem is the same, but confirm the exact behavior before fixing.

**Already good, so keep it:** task staleness is activity-based (5 days without any task event, manager-owned tasks only; `shared/types.ts:944-952`, `task-views.service.ts:100`). Jira issue staleness measures Jira activity, not participation.

### Recommended design: `team_mode` plus per-developer `tracking_mode`

- **Workspace flag `team_mode`: `solo | collab`.** Reuse the `one_on_one_enabled` pattern: a config key, `SessionFeatures` (`shared/types.ts:725-731`), a client hook (`useOneOnOne.ts:20-22`) and a CLI toggle. Default new workspaces to `solo` unless a developer login is created in the wizard. Migrate existing workspaces that have an active developer login to `collab`.
- **Per-developer `participates` / `tracking_mode: self | managed`.** It is true only if an active `app_users` row with `role=developer` maps to that developer (`schema.ts:56-65`). This fixes mixed teams. Effective rule: `mode === collab && participates`.
- **For solo or managed developers:**
  - Hide the stale chip and metric, the freshness dot, the `stale_*` and `no_current` reasons, "Quiet since standup", "Ask all" and the `ask_check_in` command.
  - Reword: "Add check-in" becomes "Add note", and "Last check-in" becomes "Last touched".
  - Replace freshness with **manager touch**: the last manager-authored note, task event, status change, standup review or 1:1. Flag it only after N working days untouched (default 5, matching `TASK_STALE_DAYS`), as a quiet "last reviewed" column and not a header metric.
  - Keep blocked, at_risk, waiting, overdue Jira, follow-ups due, 1:1 due and task staleness.
- **Regardless of mode:**
  - Move all thresholds into one "Attention rules" settings block, with working-hours and day-start awareness. Today they are duplicated in `settings.service.ts:16-19`, `workload.service.ts:20`, `utils.ts:66` and `today.service.ts:358`.
  - Delete the second attention model (`manager-attention.ts`).
  - Make manager-authored check-ins not reset developer staleness in collab mode (`team-tracker.service.ts:2145`).

## 3. Findings by priority

### P0: fix first

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | No solo mode: everyone is 100% stale (§2). | `team-tracker.service.ts:385-387` | `team_mode` design above. |
| 2 | **`/api/my-day/issues` returns raw manager triage data to developers** (`localTags`, `analysisNotes`, other developers' names). | `routes/my-day.ts:145-153`, `issue.service.ts:546-549` | Return a `DeveloperIssue` allowlist projection and add a route test. |
| 3 | **Removing a team member does not revoke their login.** `DELETE /team/developers/:id` only sets `isActive=0`, and auth never checks it. | `routes/team.ts:338-350`, `auth.service.ts:185-196,221-243` | Delete their sessions and users, or fail auth when the mapped developer is inactive. |
| 4 | Default Jira sync scope never brings in unassigned or new defects (empty roster matches nothing), then says "project is clean". | `jira/jql.ts:165`, `SettingsPanel.tsx:1299-1301`, `DefectTable.tsx:927` | Include `assignee IS EMPTY` by default, and show a diagnostic empty state. |
| 5 | Suggestions "Apply All" overwrites Jira priority, due date and assignee with no confirmation or diff. `suggestPriority` falls back to "Medium". | `SuggestionBar.tsx:77-87`, `automation.service.ts:17`, `routes/suggestions.ts:53` | Show a diff with per-field apply, and hide default-only or unchanged suggestions. |
| 6 | No "Jira not connected" state. Sync fails with a red banner, and Work is the default first page. | `sync/engine.ts:124-127`, `ErrorBanner.tsx:19`, `shared/types.ts:2222` | Add a `jiraConfigured` flag, hide sync and Work when it is off, and show "Connect Jira". |
| 7 | First-run for a solo manager: left on `/work`, no getting-started state, and the wizard's "Skip" runs a mandatory Jira sync. That sync can trap the user if Jira fails. | `App.tsx:938-941,1013-1015`, `SetupWizard.tsx:497-508,1255-1256` | Add a solo/team choice in step 1, go to Today after setup, and let Skip finish without a sync. |
| 8 | Today has no "my plan" or top 3. A solo manager's own scheduled tasks never appear, so the morning ritual is missing. | `task.service.ts:795-796`, `today.service.ts:1288`, `shared/types.ts:386` | Add `focus.plan`, a "Pick up to 3" affordance, and a "Done today" recap in wrap-up. |
| 9 | Capture lands everything on today's plan, and Inbox is nearly unreachable. Anything undone becomes Overdue and feeds Needs attention. | `capture.service.ts:159`, `task.service.ts:257-260`, `task-views.service.ts:45,143` | No date means untriaged. Let `/later` accept a resurface date. |
| 10 | No real "waiting on X" or delegation tracking. Capture can't name non-developers, and delegated developer tasks that go quiet never surface. | `capture-grammar.ts:223`, `capture.service.ts:81`, `task-views.service.ts:190,197` | Add `waitingOn` and `checkBy` fields and a Delegated/Waiting lens. |
| 11 | Nothing reaches the manager unprompted (no digest, push, email or Slack), and there is no export. The Copilot `morning_brief` promised in docs/46 is unbuilt. | `sync/engine.ts:40`, `backup.service.ts:64`, `docs/46-copilot-v2.md:64,185` | Weekly review page with Copy-as-Markdown and CSV, a daily digest, and the morning brief. |

### P1: high friction or risk

- **Privacy and auth**
  - Reassigning a task exposes its whole shared history to the new owner (`task-events.service.ts:101-102,141-149`). Manager check-in `rationale` and `nextFollowUpAt` reach the developer verbatim (`team-tracker.service.ts:472-487`).
  - The login throttle keys on `req.ip:username` with no `trust proxy` set, so behind the tunnel it is probably a global lockout (`routes/auth.ts:82-84`). There is no admin password reset.
  - 1:1 agenda topics and actions are created as developer-owned tasks while the UI says "Private to you" (`one-on-one.service.ts:634-639,927`, `OneOnOneWorkspace.tsx:159`). This needs confirming, and it may leak to My Day and inflate Load.
  - Copilot "full access" is a single toggle that auto-runs Jira-mutating and delete tools (`AssistantSection.tsx:399-412`, `assistant/service.ts:749`). Confirm cards hide the parameters that will change (`ActionConfirmCard.tsx:34,102`).
- **The two-way loop is thin**
  - No push or inbox: both sides poll every 30s (`useMyDay.ts:19`, `useToday.ts:27`).
  - Developers can't tell what changed. Priority, due date and details edits emit no events (`task.service.ts:308-318`), and there is no seen cursor.
  - Canonical mode never renders the "From your lead" badge (`MyDayTaskParts.tsx:15-17,252-262`).
  - There is no ack or reply on instructions (`my-day.service.ts:57-58`), and developers can drop tasks with no reason.
  - Developer-raised blockers don't reach Today (`my-day.service.ts:62-65`, `today.service.ts:486-497`).
  - A developer can set blocked or waiting with no rationale (`my-day.ts:22-31`).
- **Team board**
  - Updating "who's doing what" is heavy. The board is read-only, and setting current work takes three steps (`TrackerItemRowActions.tsx:54-68`). Add an inline pick-current and a bulk morning-planning flow.
  - Status, check-in and task state overlap, and the drawer has four separate text-entry places (`DeveloperTrackerDrawer.tsx:445-455`).
  - Standup "review" changes nothing for freshness (`standup.ts:125-128`), and the `f` flag has no reason or developer link (`StandupMode.tsx:393-397`, `team-tracker.service.ts:1434-1437`).
  - The uncommitted assignee pill injects `@accountId` text at submit (`CaptureBox.tsx:227,241-243`). Colon ids, which the Jira account ids in `team-tracker.ts:98` can contain, fail to parse and the task is created owned by the manager (`capture-grammar.ts:220`). The pill also has no clear control.
- **Tasks and capture**
  - There are about seven creation paths with different grammars, and the dialog closes after each capture (`CaptureBox.tsx:273`, `TasksPage.tsx:751`, `TriageDeskSection.tsx:50`).
  - Follow-ups and Meetings are a third, shimmed model (`useCanonicalTasks.ts:11`, `manager-memory.ts`), and they disagree with the Tasks Waiting view.
  - A deadline can't be set (`TaskDetailFields.tsx:202-204`).
  - Legacy and canonical branches are still live: 73 `canonicalEnabled` sites, three CLI-only flags (`task-keys.service.ts:12-45`).
- **Work/Jira**
  - Sync status is misleading. `lastSyncedAt` includes failed runs, and there is no "last good sync" (`routes/sync.ts:31`, `engine.ts:199`).
  - Triage can't unassign or clear dates (`issues.ts:39-46`), and the date input commits on the first valid keystroke (`InlineEditDueDate.tsx:116`).
  - Comment write-back is blind, with no error toast (`CommentForm.tsx:386-393`).
  - Alerts are noisy: stale is 48h regardless of status, "High not started" is hardcoded to "To Do", and there is no snooze (`alert.service.ts:99,107-108`).
  - Local writes reset staleness (`issue.service.ts:193,246`).
  - Exclude is a dead end with no restore list (`DefectTable.tsx:36-75`).
  - `GET /issues` is unpaginated and refetches every 30s (`issue.service.ts:65-92`, `useIssues.ts:41`).
- **Shell**
  - Nav is fragmented and Jira-first: Today, Work, Team and Tasks are the defaults, with Follow-ups, Notes and Meetings under More (`shared/types.ts:2221-2224`). Pages can't be hidden.
  - Stage times (10:00, 12:00 and 16:00) have no Settings UI, though `PUT /api/today/settings` exists (`shared/types.ts:328-332`, `routes/today.ts:67`).
  - **Backups have no UI** (`routes/backups.ts`). The API is also mounted behind `requireAdmin` (`app.ts:169`), a role the normal flow doesn't create. Restore is CLI-only.
  - There is no React error boundary and no `vite:preloadError` handler, so a deploy leaves an open tab blank (`main.tsx:15-19`, `App.tsx:51-74`).
  - Phone nav is likely clipped (`WorkspaceNavLink.tsx:44`, inferred).
- **Copilot**
  - The rate limit blocks confirm and cancel (`assistant/service.ts:38,142,201`).
  - Its read tools are day-scoped, so there is no week summary, 1:1 prep or boss-update flow, and answers have no copy button (`tools.ts:249-318`).

### P2: polish (selected)

- **Consistency and accessibility**
  - The Team sort default differs by entry path (`useBoardQueryState.ts:43` vs `team-tracker-board-query.ts:12`), so reloaded links reorder the board.
  - Toasts all auto-dismiss at 5s, errors aren't assertive, and they don't pause on hover (`ToastContext.tsx:49-60`).
  - The palette lacks listbox ARIA and has no error state or recents (`CommandPalette.tsx:277-302`).
  - Global `?` shortcut help covers only queue keys (`TodayRhythmHeader.tsx:104`).
  - Leftover `#fff` on accent in five places (`App.tsx:387` and others), two `<h1>` per page (`Header.tsx:139`), and hover-only delete (`AssistantHeader.tsx:137`).
  - The More menu has no Escape or arrow-key handling (`HeaderNav.tsx:123-128`).
  - Availability has no date range, so future PTO is impossible (`developer-availability.service.ts:164`).
  - Load is a plain count with no over-capacity signal (`TrackerRosterBoard.tsx:190-216`).
  - Dead code: `AttentionCard.tsx`, `QuickAddTaskModal.tsx` and the carry-forward hooks have no consumers.
- **Product gaps**
  - No recurrence or weekly review (`TodayWrapUp.tsx` is daily only).
  - No decisions or promises lens.
  - No meeting prep from person history (`daily-notes.service.ts:72-81`).
  - Dates accept only tokens (`capture-grammar.ts:154-165`).
  - Hardcoded Jira tenant fields (`customfield_10021`, `customfield_10128`; `engine.ts:150`, `config.ts:12`).
  - Server-local timezone for overdue (`utils/date.ts:20-22`).
  - Reset configuration under-warns and also wipes Copilot config (`SettingsPanel.tsx:408`, `routes/config.ts:615`).
  - Password minimum is 6 (`SetupWizard.tsx:1227`).
  - Theme ignores `prefers-color-scheme` (`ThemeContext.tsx:24-30`).

## 4. Simplifying the mental model

- **Three nouns.** A Task is anything with an owner and a next step. Follow-up, waiting, meeting action and decision become attributes (`waitingOn`, `checkBy`, `due`, `repeat`, `kind`), not containers. A Note is private free text that converts into Tasks. People and Jira are links and lenses.
- **Nav becomes Today | Tasks | Team | Work | Notes.** Follow-ups and Meetings become built-in Tasks lenses with redirects. Hide Work and Team by default in solo mode until Jira or a team exists, and allow hiding pages in Settings.
- **One capture grammar** everywhere: `@who`, natural-language `!date`, `/w`, `/f`, `/d`, `~repeat`, `#JIRA`. It always lands in Inbox unless dated, with a keep-open mode.
- **Lifecycle:** Inbox (untriaged), Planned (dated), Waiting (`waitingOn` plus `checkBy`), Done. "Later" is a `hideUntil` date.

## 5. Suggested sequencing

1. **Safety, small diffs.** Findings 2 and 3 (privacy and revoked login), plus the login throttle `trust proxy`.
2. **Solo foundation.** Add the `team_mode` and `participates` signal. The server suppresses stale, ask and no-current for solo or managed developers, and the client relabels. Add the wizard solo/team choice, go to Today after setup, and the `jiraConfigured` state. Ship P0 findings 1, 4, 6 and 7 together.
3. **Daily ritual.** Today "my plan" and top 3, capture-to-Inbox semantics, and the Delegated/Waiting lens with `waitingOn` and `checkBy`.
4. **Attention rules settings.** One config block, working-hours aware, with the second attention model deleted.
5. **Collab loop.** In-app inbox, field-change events, a seen cursor, acks, blocker propagation to Today, and per-developer sharing.
6. **Reporting and data safety.** Weekly review with export, a digest and morning brief, a backups UI, and an error boundary.
7. **Consolidation.** Fold Follow-ups and Meetings into Tasks, finish the legacy drop, and update AGENTS.md (it doesn't mention `/tasks`).

## 6. Caveats

- Nothing was executed, so runtime layout, phone behavior and actual data flow marked "inferred" need a live check.
- Two claims need a targeted check before acting: the 1:1 privacy leak into My Day, and the `lastCheckInAt` vs status-update behavior (§2).
- The dev DB predates the tasks tables, so which feature flags are on in dev or production was not visible.
