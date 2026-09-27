# 53 — Today Screen Review (`/`)

Status: review only. Nothing here is implemented.
Date: 2026-09-27 · Scope: `client/src/components/today/*`, `client/src/hooks/useToday.ts`, `useTodayActions.ts`, `useManagerActions.ts`, `useAlerts.ts`, `client/src/lib/today-snapshot-cache.ts`, `client/src/lib/manager-attention.ts` (+ `useManagerAttention.ts`), the Today deep-link handler in `client/src/App.tsx`, the header inbox (`components/actions/ManagerActionInbox.tsx`), `server/src/routes/today.ts`, `server/src/services/today.service.ts`, and the sources it reads (`issue.service.ts#getTodaySnapshot`, `team-tracker.service.ts#getBoard`, `manager-desk.service.ts#getTodayItems`, `task.service.ts#projectTodayItems`).
Method: I read the code and audited it against `docs/40-today-v2-actionable-manager-cockpit.md`. **I did not run the app and have no screenshots.** I tried to start an isolated dev server on a scratch copy of the sandbox DB, but the session's permission policy blocked the login setup. Every layout, timing and runtime claim below is therefore inferred from the code and marked *(code-inferred)*. The server already emits `Server-Timing` and a "Slow Today snapshot build" warning (`routes/today.ts:24-32`, `today.service.ts:320-333`). Use those to confirm §4.1 before changing anything.

Severity: **S1 must fix** (wrong or broken for the core job) · **S2 should fix** (friction you hit weekly) · **S3 polish**.

---

## 0. Verdict

**Plumbing is done; the day isn't in it yet.** Today V2 mostly shipped. There's a server read model, exact deep links, seven inline write actions, partial-source resilience and a first-load cache, so this is no longer a summary page. But it shows the same screen at 08:45 and at 17:30. The rhythm stage is computed on the server and never used by the client. Standup, the main event of the morning, has no entry point: the footer "Standup" button opens Work's *blocked* filter. The same items appear two or three times (priority band, featured first row, rail, header inbox). On a phone the primary actions are hidden, and fixed chrome takes up most of the viewport. There are also three correctness bugs:

- **"Snooze → Later today" does nothing.**
- **Opening a person opens a task drawer on top of them.**
- **A follow-up captured from Today shows up as due right away.**

Load time is better than its reputation: one request, no client waterfall. The real costs are server-side fan-out, a second poller for the same payload, and a navigation path that cancels the destination page's fetch.

---

## Docs/40 phase audit: what shipped

| Phase | Status | Evidence |
|---|---|---|
| 0 Trust fixes | Out of scope, not re-verified | — |
| 1 Component split | **Shipped** | 13 files in `components/today/`; `TodayPage.tsx` is 434 lines of orchestration |
| 2 Exact targets / deep links | **Shipped**, with one overloaded target (F2) | `App.tsx:570-676`; Work opens the issue panel (`DashboardLayout.tsx:455-459`); Team opens the drawer (`TeamTrackerPage.tsx:379-403`); Desk opens the item; drift → task page; 1:1 → `/team?dev&panel=one-on-one` |
| 3 Server read model | **Shipped** | `GET /api/today` (`routes/today.ts`), `TodayService.buildToday` (`today.service.ts:212-336`), 10 s promise cache, `sourceStatus`/`isPartial` |
| 4 Inline actions | **Shipped except "Assign owner"** | Done, Snooze ×3, Add check-in (+ task picker), Capture follow-up, Set current, Carry forward, Capture outcome → `POST /api/manager-actions/commands` (`today.service.ts:360-486`). `assign_owner` only navigates (F8) |
| 5 Standup drawer | **Not shipped on Today** | Standup Mode shipped separately at `/team?mode=standup` (docs/50), but Today doesn't link to it (F4) |
| 6 Polish | **Partial** | Header inbox badge ✓ (`ManagerActionInbox`), freshness line ✓, calm state ✓. No row transitions, no undo, no nav badges beyond the inbox |
| Load optimisation (`optimize-today-page-load-time`) | **Shipped, not abandoned** | Commit `da1ae4b` (Aug 27) is an ancestor of `main`: sessionStorage snapshot, server cache, `Server-Timing`, sync coordinator off on Today (`App.tsx:504`). Only the worktree was left behind (`lead-os.worktrees/optimize-today-page-load-time`, clean). Remove it |

None of the recommendations below re-propose shipped work. Where a shipped piece is wrong, I say so.

---

## 1. Functionality

### 1.1 Correctness

**F1 — "Snooze → Later today" is a no-op. S1.**
`buildSnoozeIso` sets `followUpAt` to *today 17:00* (`today.service.ts:1380-1384`). "Due" is decided by comparing **days**, not timestamps: `getDueFollowUps` uses `!isAfterDay(followUpAt, date)` (`:1074`), and the sources use the same rule (`manager-desk.service.ts:472`, `task.service.ts:779`). An item snoozed to later today is therefore still due today. `useTodayActions` removes the row optimistically (`useTodayActions.ts:69-92`), then `invalidateToday()` refetches it straight back. The toast says "Snoozed", but the row reappears within a second. After 17:00, "Later today" also writes a time in the past.
*Fix:* treat follow-ups as due when `followUpAt <= now`, compared as timestamps, in all three places. Make "Later today" mean `now + 3h`, rounded to the half hour, and hide it after ~18:00. Add a service test: snooze later_today → not in `promises` until that time.

**F2 — "Open developer" lands on a task drawer stacked over the person. S1** *(code-inferred)*.
Developer targets also carry the developer's *current task* (`trackerItemId`, `taskKey`, `issueKey`; `today.service.ts:631-638`, `692-699`, `947-954`). `handleOpenTodayTarget` forwards all of it and writes `?task=<key>` (`App.tsx:617-627`). `TeamTrackerPage` then opens the developer drawer *and* `setSelectedTask` (`TeamTrackerPage.tsx:383-392`), and `useTaskResolution` re-opens the task from the URL (`:405-423`). The task drawer renders `stacked` on top (`:747-750`). So clicking the avatar, the name or "Open developer" shows Deepak's *task*, and his check-ins, status and plan sit underneath it. The one target is being used for two jobs: which person, and what to prefill.
*Fix:* for `type: "developer"`, the target holds only `developerAccountId`. Put task context in a separate `context` field that the check-in and follow-up dialogs read, which `open` ignores. Write `?dev=<id>` (not `?task=`) so reload and back restore the person. Add an App-level test: developer target → drawer open, no task drawer.

**F3 — A follow-up captured from Today is due immediately. S2.**
`buildFollowUpCreateParams` sets no `followUpAt` (`today.service.ts:1394-1418`). `getDueFollowUps` treats "no followUpAt" as due now (`:1074`), and so does the canonical projection (`task.service.ts:779`). "Capture follow-up" on Deepak's row therefore adds a *new* due follow-up to the queue you're trying to empty.
*Fix:* default `followUpAt` to tomorrow 09:00 (local), and add three chips in the dialog: Later today · Tomorrow · Next week.

**F4 — The partial-data notice drops the 1:1 source and prints `undefined`. S3.**
The `labels` map in `TodayPartialDataNotice` (`TodayPage.tsx:234`) has no `one_on_one` key. The `as` cast hides the gap. When the 1:1 source fails, `unavailable` contains `undefined`, and the banner reads ", Work data is temporarily unavailable". Type the map as `Record<TodaySourceName, string>`.

**F5 — Day and time use the server clock and UTC slicing. S3** *(code-inferred; masked today because the VPS runs in IST)*.
- The rhythm stage uses `new Date().getHours()` on the server (`today.service.ts:1179-1191`).
- Snooze times are built in server-local time (`:1381`).
- `toIsoDay` slices the UTC ISO string (`:1250-1255`).

A manager outside the server's timezone gets the wrong stage, and wrong due/overdue for anything within a few hours of midnight.
*Fix:* send `tz` with the request (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and compute the stage and day boundaries in that timezone.

### 1.2 Exact targets: does a row open the exact thing with an obvious next action?

| Row | Opens | Exact? | Next action on arrival |
|---|---|---|---|
| Developer attention (queue / pulse) | `/team` + dev drawer **+ stacked task drawer** | Person ✗ (covered, F2) | Inline Set current / Add check-in on Today ✓ |
| Overdue / due issue | `/work?filter=…` + issue panel | ✓ | "Open issue" only |
| Unassigned issue | same | ✓ | "Assign owner" doesn't assign (F8) |
| Follow-up | `/desk?date=<originDate>` + item drawer (`App.tsx:630-646`) | ✓ item, but Desk shows the **origin day** (can be weeks old) | Done / Snooze inline ✓ |
| Meeting outcome | Desk item (the `managerDeskItemId` branch wins over `view: 'meetings'`) | ✓ | Outcome inline ✓ |
| Carry-forward | Desk item | ✓ | Carry inline ✓ |
| Jira drift | `/tasks/<key>` | ✓ | — |
| 1:1 | `/team?dev&panel=one-on-one` | ✓ | — |
| Sync error | `/settings` (no `section`, `today.service.ts:927`) | ✗ broad | — |
| "Stale check-ins" metric | `/team`, unfiltered (`:535`) | ✗ broad | — |
| "Follow-ups" metric | `/follow-ups` | ✓ list | — |
| Calm | `/team` | n/a | — |

Phase 2 largely delivered. Fix F2, give the sync action `section: 'sync'`, send the stale metric to `/team?filter=stale`, and open Desk items on *today's* date with the drawer instead of their origin day.

### 1.3 Day rhythm: does the screen change as the day progresses?

**F6 — No. The stage is decorative. S1 (for the use case).**
`getRhythmState` returns `morning_plan / standup_window / midday_check / wrap_up`. The hours are hard-coded (<10 / <12 / <16) and the value is never read by the client: nothing outside the header consumes `rhythm.stage`. The only visible trace is a label in the header's last cell, hidden below `lg` (`TodayRhythmHeader.tsx:82-90`). Ranking ignores the stage (`rankActionItems`, `today.service.ts:1148-1155`). The rail always opens on "Promises" (`TodayRhythmRail.tsx:21`). Nothing is added for the morning (overnight changes, standup) or for EOD (missing check-ins, open promises, what carries to tomorrow).
*Fix:* see §5 for the stage behaviour. Mechanically: the server adds a stage-specific `focus` block (e.g. `standup: {status, startedAt, flaggedCount}`, `wrapUp: {missingCheckIns, openPromises, carryCandidates}`), and the client orders sections by stage. Make the stage boundaries a setting (standup time is team-specific), defaulting to the current hours.

**F7 — Standup has no entry point from Today. S1.**
The footer's "Standup · Blocked work" calls `onSelectWorkFilter('blocked')` (`TodayCommandFooter.tsx:25-36`). That opens the Work dashboard, not Standup Mode (`/team?mode=standup`, `App.tsx handleStandupModeChange`). The rail's "Standup" tab is a three-row list of people, issues and promises that are already in the queue (`today.service.ts:1012-1059`). Today also can't tell whether standup has happened: `standup_sessions` exists and Notes already reads it for its context strip (`daily-notes.service.ts:821-825`).
*Fix:* before and during the standup window, show a single **Start standup** row at the top of the queue, going to `/team?mode=standup`. Once a session has ended, replace it with a quiet status line: "Standup ✓ 9:40 · 2 flagged", where "flagged" opens those people. Drop the rail's Standup tab.

### 1.4 Queue content and actions

**F8 — "Assign owner" doesn't assign. S2.**
`assign_owner` is handled as navigation (`useTodayActions.ts:160-163`; `today.service.ts:394-397`). The label promises a write that Today can't do.
*Fix:* rename it "Open to assign" now. If Jira assignee writes are supported later, add an inline picker.

**F9 — Dialogs close before the save lands, and errors throw away what you typed. S2.**
`onSave` calls `actions.runAction(...)` and then sets the draft to `null` in the same tick (`TodayPage.tsx:185-188`, `201-207`, `215-218`). So `isSaving` never renders ("Saving" is dead UI). On a 400/500, the check-in text or outcome is gone, and all that's left is a toast.
*Fix:* use `mutateAsync`, close on success, and keep the dialog (with an inline error) on failure.

**F10 — The whole "Start" band is a write button. S2.**
`TodayCurrentPriority` renders the entire band as one `<button>` that runs `primaryAction` (`TodayCurrentPriority.tsx:20-23`, `TodayPage.tsx:149`). When the top item is `set_current_work`, which has no confirm (`today.service.ts:1116`), clicking the band to read the person's name changes their current work.
*Fix:* the band body opens the target; only the right-hand button runs the action.

**F11 — Confirm modals on reversible one-click actions. S2.**
`mark_done` and `carry_forward` always confirm (`today.service.ts:1116`, `TodayConfirmDialog`). Clearing five promises takes ten clicks and five modal round-trips.
*Fix:* apply optimistically and show a 6 s **Undo** toast (re-open via `updateItem`). Keep a confirm only where the write can't be undone.

**F12 — High-priority defects flood the queue. S2** *(code-inferred; depends on backlog shape)*.
`buildIssueActions` includes *every* open High/Highest issue, even when assigned and not due (`today.service.ts:745`). It types them `manual_work` with a Target icon (`:752`) and ranks them at 66, above meetings (62) and carry-forward (58). With a real defect backlog, the eight visible rows fill with defects that already have owners, and the manager's own promises drop out of view.
*Fix:*
- Include high-priority issues only if unassigned, not started, or stale.
- Cap issue rows at ~3 of the visible 8 and fold the rest into one aggregate row: "9 high-priority defects → Work".
- Give them their own type.

**F13 — Queue overflow is a dead end, and the counts are capped. S2.**
The server slices to 20 (`today.service.ts:282`), so the "Attention" metric can never exceed 20, and it has no target (`:527`). The queue shows 8, then prints `+N more in the source workflows` as plain text (`TodayActionQueue.tsx:40-44`).
*Fix:* return `totalCount`, and make "+N more" expand the queue in place, grouped by Now/Next/Later. The `group` field already exists and isn't used.

**F14 — The meeting outcome can't produce the next action. S2.**
"Capture outcome" saves one textarea and marks the meeting done (`today.service.ts:471-480`). Docs/40 asked for outcome + decision + optional next action → follow-up in one step.
*Fix:* add an optional "Next action" line and owner to the same dialog. When it's filled, create the follow-up linked to the meeting.

**F15 — The check-in defaults are system text, and there's no way to ask for one. S2.**
The check-in textarea is pre-filled with `Manager check-in: Stale / No current work` (`TodayPage.tsx:385-396`), which the manager has to delete. `ask_check_in` exists in the contract but nothing emits it. The manager's real move is usually *ask Deepak for an update*, not *type one on his behalf*.
*Fix:* make the signal a placeholder, not a value. Add **Ask for update**: it posts a nudge to the developer's My Day and records "asked 9:12" on the pulse row.

**F16 — The generic follow-up title ignores the name Today already has. S3.** `defaultFollowUpTitle` returns "Follow up with developer" (`TodayPage.tsx:398-406`). Use `getDeveloperName` (already in the file): "Follow up with Deepak on AM-123".

**F17 — The footer's "Capture" navigates away. S2.** `TodayCommandFooter.tsx:21` calls `onViewChange('desk')`. Global capture exists (`useQuickActions().openCapture`, used by the header). "Capture" and "Open Desk" (`:24`) currently do the same thing. Wire it to `openCapture` with Today's context.

**F18 — Dead paths. S3.** `TodayActionQueue`'s `isLoading` branch and `TodayQueueSkeleton` can never render, because the queue only mounts once `snapshot` exists (`TodayPage.tsx:132-156`). The `ask_check_in` handling in `useTodayActions.ts:160` has no producer (until F15). `date` is recomputed per render (`TodayPage.tsx:26`) instead of using the existing `useLocalDate` hook, so an overnight tab only rolls over on the next poll.

---

## 2. UI / UX

**U1 — The same thing shown three times. S2.**
- `currentPriority` is always `actionItems[0]` (`today.service.ts:300-301`). It renders as the "Start" band *and* as the featured first queue row (`TodayActionQueue.tsx:35`).
- Follow-ups appear in the queue, the Promises rail and the Standup rail (`:779`, `:303`, `:1046`).
- Developers appear in the queue, People pulse and the Standup rail.
- In the calm state, the band and the only queue row both say "Team is calm".
- On `/`, the header inbox (`ManagerActionInbox`) shows the same top 8 again.

*Fix:* the queue owns actions, and the first row *is* "Start here", so drop the separate band. The pulse shows only people *not* already in the queue, plus a compact avatar strip for the rest. The rail shows only items not in the queue. Hide the header inbox trigger on `/`.

**U2 — There's no sense of progress or of being done. S2.** Nothing says "3 of 7 cleared". The calm state is the same whether you cleared the queue or there was nothing to do. Add a thin cleared-count in the queue header (session-local) and a real done state: "Clear for now · next: 1:1 with Ana at 15:00".

**U3 — Two of the six metrics don't change a decision. S2.** "People: 7 on team" and "Active defects: N in Work" (`today.service.ts:529-533`) are inventory, not attention. Docs/40 said "no more counters unless they change a decision". Keep Attention, Stale check-ins, Due today and Follow-ups (+ Sync when broken).

**U4 — No keyboard triage. S2.** Docs/40's accessibility section requires it. The only route is Tab through five stops per row (A2). Add `j/k` to move, `Enter` to open, `Space`/`e` for the primary action, `s` for snooze (tomorrow), `f` for follow-up, `c` for check-in, and `z` for undo. Show them in the `?` sheet, not in copy.

**U5 — The compact signal hides the second reason. S3.** `getCompactSignal` keeps only the text before the first ` / ` (`TodayActionRow.tsx:125-132`). "Overdue / Unassigned" shows "Overdue", and the second, more actionable reason only appears in a tooltip. Show up to two short chips.

**U6 — Explanatory and internal copy. S3.** Docs/40 banned this. Examples: "Exact targets, ranked for today" (`TodayActionQueue.tsx:22`); "Quick actions / Capture or jump" (`TodayCommandFooter.tsx:17-18`); "Retry the cockpit read model." (`TodayPage.tsx:275`); "Save a Manager Desk follow-up without leaving Today." (`:91`); "Saves to Team / {name} / Check-ins for today." (`TodayCheckInDialog.tsx:108`). Cut or shorten all of them.

**U7 — Rail tabs forget your choice and hide zero counts. S3.** The tab resets to Promises on every mount (`TodayRhythmRail.tsx:21`). "Meetings" without a count looks the same as "not loaded". Once U1 removes the duplicated rail content, the rail can become a single "Promises & meetings" list with no tabs.

**U8 — Stale data looks current after a failed refetch. S3.** `isError` is only shown when there's no snapshot at all (`TodayPage.tsx:173-175`). After a failed poll, the header still reads "Updated 6 min ago" in muted text. Tint it warning after two failed polls, and add "Retry".

---

## 3. Visual design

**D1 — Five page-local colour tokens and layered gradients in inline styles. S2.** `--today-line`, `--today-line-strong`, `--today-hover`, `--today-muted-panel` and `--today-soft-panel`, plus an accent-tinted page gradient (`TodayPage.tsx:124-130`). There are more gradients in the header band (`TodayRhythmHeader.tsx:24, 28`), the priority band (`TodayCurrentPriority.tsx:25-26`) and the featured row (`TodayActionRow.tsx:49-50`). Nearly every element is styled inline. The result is a slightly different surface from the rest of LeadOS, and theming is hard to audit.
*Fix:* add a `today.css` with classes built on global tokens, and remove the page gradient and featured-row gradient. Keep a single tint on the one "Start here" row.

**D2 — The header band is the heaviest element, and the stage is the least visible. S2.** Eight columns of 58 px tiles: a date tile, six metrics of three lines each, and the rhythm cell (`TodayRhythmHeader.tsx:22`). The metric detail lines ("in Work", "on team", "need update", "due now") repeat the label.
*Fix:* use one 40 px line: `Sun 27 Sep · Standup window · updated 1m ↻`, then four inline metrics (`3 attention · 2 stale · 1 due · 4 follow-ups`). Each metric is a text button. Put the stage *first*, not last.

**D3 — Double emphasis at the top. S3.** The tinted "Start" band sits directly above a tinted, outlined featured row showing the same item (U1). Once U1 is done, keep one.

**D4 — The queue row grid is crowded on laptops. S3** *(code-inferred)*. Six columns with fixed 112 px signal and 154 px action (`TodayActionRow.tsx:47`) inside a `1.08fr / min 360px` split. At 1280 px, the context column truncates first, and that's the column that says *why*. Put context under the title (two-line row) and drop the separate column.

**D5 — Three bespoke modal shells. S3.** `TodayCheckInDialog`, `TodayConfirmDialog` and `TodayTextCaptureDialog` each repeat the same backdrop, gradient card and hand-rolled focus trap (`getFocusableElements` ×3). `useModalFocus` already exists in `hooks/`. Build one `TodayDialog` shell on the shared primitive.

What already works: the calm dark palette, list-first density, severity carried by label *and* colour, restrained chips, and Lucide icons used consistently by type (`TodayActionRow.tsx:17-31`). This needs subtraction, not a redesign.

---

## 4. PABR

### 4.1 Performance (initial load)

The client side is *not* a waterfall. A cold load of `/` makes one Today request (`useToday.ts:13-21`), plus the header inbox's `/manager-actions` and `/alerts`, all in parallel. The cost sits on the server and in the pollers.

**P1 — One slow source gates the whole payload, and two sources are unbounded or N+1. S2** *(code-inferred; confirm with `Server-Timing: today-team/today-desk`)*.
`buildToday` awaits six sources with `Promise.all` (`today.service.ts:214-231`). Nothing renders until the slowest one returns.
- **Team:** the full `getBoard` (`team-tracker.service.ts:1007-1088`). All developers' days, decorated events, groups and visible summary, when Today uses only `attentionQueue`, `developers` and `summary`.
- **Desk, canonical mode (this sandbox is Phase 3):** `projectTodayItems`, then per item `getByKey` + `surfaceDto` + a name-map query (`manager-desk.service.ts:434-436`, `391-396`). That's an N+1, although a batch helper `deskItemsFromSurfaces` sits right below it (`:398-404`). Every open task scheduled before today counts as a carry-forward candidate (`task.service.ts:781-785`), so N grows over time.
- **Desk, legacy mode:** loads *every* desk day and item the manager has ever had, then filters in JS (`manager-desk.service.ts:439-480`).

*Fix:* batch the canonical path with `deskItemsFromSurfaces`. Add a `getAttentionSnapshot` on TeamTrackerService that skips groups and decorations. Push the legacy date and status filter into SQL.

**P2 — The same payload is polled twice, and the cache TTL is shorter than the poll. S2** *(code-inferred)*.
`useToday` polls every 30 s (`useToday.ts:18-19`). The header inbox polls `/manager-actions` every 30 s (`useManagerActions.ts:31`), which calls `getToday` (`today.service.ts:338-358`). The server cache TTL is 10 s (`:85`). The two timers drift apart, so the second poller usually misses the cache: roughly two full builds per 30 s per open tab. `/alerts` (30 s, `useAlerts.ts:24`) adds a third periodic request.
*Fix:* on `/`, derive the header inbox from the `['today']` query cache (or disable its query). Raise the server TTL to ~25 s. `executeCommand` already clears the cache on writes, and `clearTodayCache` should also run on check-in and desk mutations from other routes.

**P3 — The first open of the day is always cold. S2.**
The snapshot cache lives in `sessionStorage` with a 15-minute limit (`today-snapshot-cache.ts:3-4, 22`). The first visit of the morning, in a new tab, is guaranteed to miss the cache and wait for the full build, and that's the moment that matters most.
*Fix:* after each sync, and at the configured start of day, pre-warm the server cache for managers with a session. Optionally return a fast `core` section (summary + queue) and stream or defer pulse and rail.

**P4 — Navigating from a row cancels the destination page's fetch. S2** *(code-inferred)*.
`open` runs through `useMutation` (`useTodayActions.ts:160-163`). `mutationFn` navigates synchronously, and then `onSuccess` invalidates `today`, `manager-actions`, `manager-desk`, `team-tracker` and `workload` (`:61-67`, `:222-223`). By then the Team or Desk page has mounted and started its query. `invalidateQueries` (with the default `cancelRefetch: true`) cancels that fetch and restarts it, so every "Open" from Today pays for its destination's load twice. The row also flashes "Working" while the navigation counts as pending.
*Fix:* handle `open`, `assign_owner` and `ask_check_in` outside the mutation, as plain function calls with no invalidation.

**P5 — Optimistic rows can reappear. S3.** `cancelQueries` runs only for `add_check_in` (`useTodayActions.ts:206-208`). A poll already in flight can overwrite an optimistic removal, and there's no rollback context. Cancel `['today', date]` for every optimistic kind.

**P6 — Already good.** Promise-coalesced server cache, `Server-Timing` per source, the slow-build warning, the sessionStorage snapshot for reloads within a session, the check-in board fetched only while its dialog is open (`TodayPage.tsx:49`), and the sync coordinator disabled on Today.

### 4.2 Accessibility

- **A1 — The row menu is a `<details>` element. S2.** No menu semantics, no Escape, no outside-click close, and it stays open after an action that doesn't unmount the row (`TodayActionMenu.tsx:15-42`). Use a real menu primitive (`role="menu"`, roving focus).
- **A2 — Five tab stops per row, three of them the same "Open". S2.** The icon, title and context are separate buttons that all open the target (`TodayActionRow.tsx:54-98`). The screen reader hears three differently-named buttons for one destination. Use one row link, the primary action and the menu.
- **A3 — The rail tabs aren't tabs. S2.** No `role="tablist"`/`tab`/`aria-selected` (`TodayRhythmRail.tsx:35-50`). This goes away if U7 removes the tabs.
- **A4 — Heading order. S3.** The page's `h1` is "Action queue" (`TodayActionQueue.tsx:21`), and "Today" is a `<p>` (`TodayRhythmHeader.tsx:32`). Make "Today" the `h1` and the sections `h2`.
- **A5 — Focus is lost after optimistic removal. S3.** Dialogs restore focus to the trigger (`TodayCheckInDialog.tsx:32-39`), which may have been unmounted by the optimistic update. Fall back to the next row, or to the queue heading.
- **A6 — Colour isn't the only signal.** Chips carry text labels. The pulse avatar's dot (`TodayPeoplePulse.tsx:75`) is decorative and should get `aria-hidden`.

### 4.3 Behaviour and resilience

Strong:
- Per-source `sourceStatus` with a partial banner, and a hard failure only if issues, team and desk all fail (`today.service.ts:232-258`).
- The server cache is cleared on every command.
- Optimistic check-in completion reshapes the queue, pulse and standup rows consistently (`useTodayActions.ts:95-154`).
- Auth-scoped snapshot keys, cleared per scope.

Gaps: F1 (snooze), F9 (dialogs lose input), F10 (write on band click), P5 (optimistic flicker), U8 (silent staleness). A single mutation instance also means `pendingTarget` tracks only the most recent action (`useTodayActions.ts:242-248`). Two quick Dones lose the first row's pending state. That's harmless today because of optimism, but it'll matter once undo exists.

### 4.4 Responsiveness (~390 px)

**R1 — Primary actions can't be reached on a phone. S1** *(code-inferred)*.
The row's primary button is `hidden md:flex` (`TodayActionRow.tsx:114`), and so is the pulse action (`TodayPeoplePulse.tsx:101`). The `…` menu only lists `secondaryActions` (`TodayActionRow.tsx:120`). Below 768 px you can't mark a follow-up Done, Set current, Add check-in, Carry forward or Capture outcome from the queue. Tapping the row just navigates away. Only the "Start" band (whole-band click, F10) and the rail's mini-list still expose actions.
*Fix:* on mobile, render the primary as the first menu item *and* as a trailing compact button. Consider swipe-right for primary and swipe-left for snooze.

**R2 — Fixed chrome takes up the phone viewport. S1** *(code-inferred)*.
`main` is `overflow-hidden` (`TodayPage.tsx:122`). Below `lg` the header band is a single column: date tile + 6 metric tiles × 58 px ≈ 440 px (`TodayRhythmHeader.tsx:22`). Below `md` the footer stacks 4 buttons, about 160 px (`TodayCommandFooter.tsx:13`). Both are `shrink-0`. Add the priority band (~70 px) and the app header, and a 390×844 screen has roughly 100–150 px left, split between *two* scroll containers (queue and aside).
*Fix:* below `lg`, make the header a horizontally scrolling chip row (one line), drop the footer (nav + ⌘K + capture FAB already exist), and let the page own a single scroll: queue, then pulse, then rail.

**R3 — The stage is hidden below `lg`. S2.** The one element that should change through the day (`TodayRhythmHeader.tsx:82`) isn't shown on tablets or phones. Fixed by D2.

---

## 5. Use-case fit: an engineering manager's first 10–15 minutes

The first minutes of the day, walked through the current screen:

| Minute | Manager's question | Today now | Gap |
|---|---|---|---|
| 0 | "Load me in." | Cold build every morning (P3) | Pre-warm |
| 0–1 | "What changed since I left?" | Nothing. There's no delta: new blockers, overnight check-ins, defects that went overdue, follow-ups that came due | **Since-last-visit strip** |
| 1–3 | "Who's stuck or silent?" | Queue + pulse, good content (F12 flood aside) | De-dupe (U1) |
| 3–5 | "Get ready for standup / run it." | No link; the "Standup" button opens Work › blocked (F7) | **Start standup / standup status** |
| 5–8 | "Which promises are due?" | Inline Done / Snooze, good | Snooze bug (F1), confirm friction (F11), no undo |
| 8–10 | "What's *my* day: meetings, 1:1s, my own planned work?" | 1:1s appear as queue rows. The manager's **own planned Desk items for today don't appear on Today at all**: `buildDeskCarryForwardActions` only takes items from *before* today (`today.service.ts:834`) | **My plan today** |
| 10–15 | "Capture what came up." | Footer "Capture" navigates away (F17); follow-ups become due at once (F3) | Fix both |

Midday and EOD aren't served at all (F6). The day should drive the page, one ordering per stage, using the same components:

- **Morning plan / standup window:** since-last-visit strip → Start standup (or its status) → queue → my plan today.
- **Midday check:** queue first (blocked, unanswered asks, follow-ups due in the next 2 h) → pulse limited to people who haven't updated since standup.
- **Wrap-up:** an EOD block with missing check-ins (one-tap "Ask for update", F15), open promises (Done / Tomorrow), carry candidates (Carry / Drop), and "Write EOD note" linking to `/notes?date=today`. That ties into the Notes wrap-up proposed in docs/52 §5, so the two screens share one ritual instead of building two.

What already serves the manager: exact deep links, one-tap Done / Snooze / Set current / check-in, calm state, honest partial-data handling.

---

## 6. Must-haves for a world-class manager command view (currently missing)

1. **Stage-driven layout**: the page reorders and adds a morning, midday or EOD block based on the (configurable, timezone-correct) stage (F5, F6).
2. **Standup integration**: Start standup → `/team?mode=standup`, then "done 9:40 · 2 flagged" from `standup_sessions` (F7).
3. **Since-last-visit delta**: new or changed signals since the manager last opened Today, stored per manager.
4. **My plan today**: the manager's own planned Desk items, time blocks and 1:1s for today in one compact timeline (currently absent).
5. **Ask for update**: a real nudge that lands in the developer's My Day, with "asked at" shown on the pulse row (F15).
6. **Keyboard triage with undo**: `j/k/Enter/e/s/f/c/z`, and optimistic writes with an Undo toast instead of confirm modals (U4, F11).
7. **One place per item**: no duplicates across band, queue, rail and header (U1); honest totals and "show all" (F13).
8. **Usable on a phone**: primary actions reachable, one scroller, compact header (R1–R3).
9. **Fast first open**: a pre-warmed server snapshot, one poller, no N+1 (P1–P3).
10. **EOD wrap-up shared with Notes**: close loops and carry to tomorrow in one pass (§5).

## 7. Remove or simplify

- **The separate "Start" band**: the first queue row *is* the priority (U1, F10).
- **The "People" and "Active defects" metric tiles** (U3) and the metric detail lines (D2).
- **The rail's "Standup" tab**: replace with a standup CTA or status (F7). Collapse the remaining tabs into one list (U7).
- **The command footer**: Open Work / Team / Desk duplicate the nav, "Capture" duplicates Desk (F17) and "Standup" is mislabelled (F7). Keep at most one capture affordance, and drop the footer on mobile (R2).
- **The header inbox on `/`**: it duplicates the page and doubles polling (P2).
- **Confirm modals** for Done and Carry (F11).
- **Explanatory copy** (U6).
- **Duplicate orchestration**: `ManagerActionInbox` re-implements `TodayPage`'s drafts, dialogs and `runCommand` almost line for line. Extract a `useTodayCommandRunner` + `TodayDialog` shell and share them (D5).
- **`lib/manager-attention.ts` (594 lines) + `useManagerAttention`**: Today no longer uses them. Their only consumer is `WorkFocusStrip.tsx:25`, which fires overview, all-issues, team-board and desk queries for three metrics, a second attention model that can disagree with Today. Feed the strip from `/api/today`'s summary or `/api/overview`, then delete them.
- **Dead code** (F18): `TodayQueueSkeleton` and the `isLoading` prop, and the `ask_check_in` stub until F15 gives it a producer.
- **The stale worktree** `lead-os.worktrees/optimize-today-page-load-time`: fully merged (`da1ae4b`), safe to `git worktree remove`.
- **Page-local gradients and tokens** (D1).

## 8. Recommended moves, in order

1. **Correctness (F1, F2, F3, F4, F9, F10)**: timestamp-based follow-up due checks and a sane "Later today"; a developer-only target with `?dev=`; a default `followUpAt` on capture; the typed source-label map; close dialogs on success; the band body opens instead of writing. All small and isolated. Tests: snooze later_today leaves `promises`; developer target → no task drawer; captured follow-up not in today's queue; dialog keeps its text on 500.
2. **Mobile rescue (R1, R2, R3)**: primary actions in the menu and as a compact button, a one-line chip header, no footer on mobile, a single scroll owner. CSS and JSX only.
3. **Load (P4, P2, P1, then P3)**: take navigation out of the mutation; one poller on `/`; batch the canonical desk path and add a lean team attention snapshot; read `Server-Timing` in prod before and after; then pre-warm after sync or at the start of day.
4. **Subtract (U1, U3, F12, F13, F17, §7)**: one place per item, four metrics, issue-row cap + aggregate row, expandable overflow with real totals, footer removed or Capture wired to `openCapture`.
5. **Standup + rhythm (F5, F6, F7)**: a timezone-aware configurable stage, a stage-specific `focus` block from the server, Start standup / standup status, stage-ordered sections.
6. **Faster triage (F11, U4, A1–A3, P5)**: undo instead of confirm, keyboard triage, a real menu primitive, one link per row, cancel in-flight polls on every optimistic write.
7. **Use-case blocks (§5, F14, F15)**: My plan today, the since-last-visit delta, Ask for update, outcome → next action, and the EOD wrap-up shared with Notes (docs/52 §5).
8. **Cleanup and polish (D1–D5, U5–U8, F16, F18, A4–A6)**: shared dialog shell and command runner, delete `manager-attention.ts`, `today.css`, copy pass, heading order.

Verification to capture when the app can be run: desktop (1440 and 1280) and 390×844 screenshots of morning and wrap-up states; `Server-Timing` for a cold and a warm `/api/today`; a network waterfall of a cold `/` load, and of Today → Open developer, to confirm P4.
