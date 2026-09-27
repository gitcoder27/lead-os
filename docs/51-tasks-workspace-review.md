# 51 — Tasks Workspace Review (`/tasks`)

Status: review only. Nothing here is implemented.
Date: 2026-09-27 · Scope: `client/src/components/tasks/` (TasksPage, rail, toolbar, list, row, menus, bulk bar, states), `client/src/lib/task-list.ts`, `client/src/lib/task-views.ts`, `client/src/hooks/useTaskViews.ts`, `useTaskListMutations.ts`, `useLocalDate.ts`, `server/src/services/task-views.service.ts`, measured against `docs/49-tasks-workspace-redesign-spec.md`.
Method: a code read of the client and server, plus two production-like screenshots (the Today view and Waiting on others at about 1000 CSS px, dark theme). I did not run the app. Where a finding depends on runtime behaviour, it is inferred from the code and marked *(code-inferred)*.

Severity scale:

- **S1 — must fix.** Wrong, misleading, or broken for the core job. Ship-blocking for a "daily driver" claim.
- **S2 — should fix.** Real friction or inconsistency that a daily user will hit weekly.
- **S3 — polish.** Craft issues. Worth doing when the file is next touched.

---

## 0. Verdict

**Good engineering, mediocre product.** The machinery under `/tasks` is better than most internal tools. One matcher decides both view membership and badge counts, so they cannot disagree (D4). Every mutation is optimistic, and undo works by applying inverse patches (D8). Rows stay put after you act on them ("lingering rows"). The URL fully describes the view, and old view links still resolve. The date rolls over correctly at midnight. The test suite is real. Read as a spec implementation, it's roughly 85% faithful.

As a product, it falls short where it counts. It imitates the shape of Linear without committing to the manager's actual job:

1. **The views don't mean what their names say.** "Waiting on others" opens with a **Me** group. "Needs attention" fills up with things you deliberately parked.
2. **It can't really build a plan.** You can't order Today. You can't pick a specific date from the list. Finished work vanishes from Today, so the day never shows progress.
3. **The keyboard model has holes where it matters most.** On the focused row, the date is covered by the hover actions. Label grouping breaks j/k navigation. `n` does nothing on an empty view. The drawer can't step to the next task.
4. **It spends heavy chrome and loud colour on small facts.** Two cards and two headers wrap four tasks. A task one day late shows red in three places.
5. **It sits in a confusing information architecture.** The app has a **Today** page and `/tasks` defaults to a **Today** view, one click apart, and they mean different things.

None of this is hard to fix. Most of the "must fix" list is changes to definitions and removals, not new features.

What to keep as-is: the view engine and counts contract, the bulk endpoint and undo, lingering rows, the URL contract, `useLocalDate`, the portal popover with accelerators, "Move all to today", and the g-chords (cheap and harmless).

---

## 1. Functionality

### 1.1 View semantics

**F1 — "Waiting on others" contains me and the whole team's day plan. S1.**
`server/src/services/task-views.service.ts:53` and `:178-180`: `waiting` is `ownerType = developer` OR `blocked` OR a follow-up predicate OR `kind:waiting`. There is no owner exclusion. Two consequences:

- Every manager-owned task with `followUpAt` or `category:follow_up` lands in a group literally titled **Me**. Screenshot 2 shows T-71 and T-72 there. A follow-up *I* must send is something I owe, not something I'm waiting on.
- Every open developer task the manager tracks is included, whether or not anyone is waiting on it. Screenshot 2 shows "working corticon" and "Validate System logs", which are day-plan items. This view has become a second, weaker Team page.

*Why it matters:* this is the view a manager opens before a 1:1 or standup to ask "who owes me what". Today it answers "what's everyone doing", which `/team` already answers better.
*Fix:* make Waiting explicit. Include `kind:waiting` / `blocked` / a manager-tracked follow-up **on someone else's task** / an explicit "waiting on <person>" field. Exclude owner = me unless the task is blocked. Retire the blanket `ownerType = developer` clause. Rename the manager's own follow-ups to what they are: tasks in My tasks with a bell.

**F2 — "Needs attention" flags parked (Later) work and idle dev tasks as stale. S1.**
`task-views.service.ts:57` has no `later:false`. `:103` marks any open task idle for 5 days as stale. So everything parked in Later becomes "stale" after 5 days and shows up in the review queue. That's the opposite of why you park things. Tracked developer tasks idle for 5 days also land here, even though the Team page already shows them. In screenshot 1 the rail reads 7 for attention, the same as Waiting, and most of those are 1–2 day slipped plan dates.
*Why it matters:* a review queue that is mostly noise trains the manager to ignore the amber badge. That's the only badge meant to demand action.
*Fix:* add `later:false` to `attention`. Scope stale to manager-owned and Inbox tasks, or raise the developer threshold. Consider counting a plan date slipped by only a day or two as *not* attention-worthy on its own (see D1).

**F3 — Manager identity splits into "Me" and a developer called "Ayan Saha". S2.**
In screenshot 2, the Waiting groups include both **Me** and **Ayan Saha**. The manager also has a developer record (`ayan.dev`). The owner matcher (`task-views.service.ts:131-137`) and `ownerName` (`TasksPage.tsx:176-184`) treat these as different people, so "assign work to devs" (clearly the manager's own task) is filed under someone else.
*Fix:* resolve the manager's linked developer account to "Me" in `owner:"me"`, in grouping, and in the assign menu. At minimum, don't list self in the Assign menu twice.

**F4 — Three views over one set: Today ⊂ My tasks ⊃ Upcoming. S2 (simplify).**
`my-tasks` is grouped by schedule, so it already shows Overdue / Today / Tomorrow / Next 7 days / Beyond / Unscheduled. `upcoming` is exactly the "Tomorrow and later" part of it (`:54`). `today` is the "Overdue + Today" part. Three rail entries show slices of one list. Upcoming doesn't earn its slot (its count is even hidden when 0; see screenshot 1).
*Fix:* remove **Upcoming** (keep the id as a retired alias → `my-tasks`). Keep Today, because it's the focus lens.

**F5 — Finished work disappears from Today. S2.**
Today filters `status ∈ open/active/blocked` (`:50`). A completed task lingers only until focus moves, then it's gone. The only place to see today's progress is "Closed this week", which is split at Monday. For a daily planning surface, "what did I get done" is half the ritual. Spec §0 bans progress bars, fine, but it doesn't require hiding completions.
*Fix:* append a collapsed "Done today (n)" group to Today, filtered by `closedAt` = today. This costs one filter clause and zero chrome when collapsed.

**F6 — "Closed this week" resets on Monday. S3.**
`weekStart()` (`:38-41`). On Monday morning, which is exactly when you prep the week, the view is empty. A rolling "Closed · last 7 days" is more useful. The closed date is also `closedAt.slice(0,10)` (`:158`), a UTC date compared with the client's local `today`. For IST, anything closed between 00:00 and 05:30 is filed under the previous day.

### 1.2 Planning primitives

**F7 — No manual order within a day. S2.**
Sort is `planDate → startsAt → createdAt → id` (`task-views.service.ts:189-205`). The manager can't say "this first". Spec §13 puts drag-and-drop out of scope, which is fair. But ordering doesn't need drag: `Alt+↑/↓` (or `Shift+Alt+j/k`) on a per-day `position` would do.
*Why it matters:* a daily plan without order is a list, not a plan. This is the single biggest gap for "builds and maintains the daily plan".

**F8 — The schedule menu has presets only, no date picker. S1.**
`TaskMenus.tsx:82-88` offers Today, Tomorrow, Next Monday, Later, and Clear. There is no way to schedule "Thursday" from the list. You have to open the drawer, whose `DatePickerPopover` (`TaskDetailPrimitives.tsx:160`) already supports presets plus a picked date.
*Fix:* reuse `DatePickerPopover` as the list's schedule menu, keeping the `t/m/w/l/c` accelerators and adding a date field. Consider adding weekday accelerators (`1`–`7`).

**F9 — No priority action on the list. S3.**
You can sort by priority and the row shows a high-priority flag, but you can only set priority in the drawer (`p`). Add `p` to the list keyboard map and the ⋯ menu for parity.

### 1.3 Actions, undo, lingering

What works well: every list mutation goes through `/tasks/bulk` with an inverse-patch undo (`useTaskListMutations.ts:61-90`, `task-list.ts:202-211`). The code skips rows it can't change and reports "skipped n" (`TasksPage.tsx:265-286`). "Move all to today" on the Overdue header (`TaskList.tsx:156-165`) is the best single affordance on the page.

**F10 — Deleting a saved view is irreversible, with no undo and no confirmation. Renaming uses `window.prompt`. S2.**
`TasksPage.tsx:525-543`. The page's own rule is "undo instead of confirm", and this is the one destructive action that has neither. `window.prompt` is also the only native dialog in the app.
*Fix:* rename inline in the rail (the save-view form already exists at `TaskViewRail.tsx:100-128`), and make delete undoable via a toast that re-creates the view.

**F11 — "Link copied" shows even when copying failed. S3.**
`TasksPage.tsx:723-727`: `navigator.clipboard?.writeText` is neither awaited nor checked. On a non-secure origin, or when permission is denied, you get a success toast and an empty clipboard.

**F12 — Toast copy and noise. S3.**
- `setStatus` produces "1 task → blocked" (`:302`), a raw lowercase enum. Use the status labels from `TASK_STATUS_META`.
- Choosing the status a task already has fires an info toast, "Nothing to change — skipped 1 task" (`:272`). Silence is correct there.

**F13 — The lingering hint is vaguer than the spec, and lingering rows lose contrast. S3.**
The spec's R1 says "Moved → Tomorrow". The code renders an italic "moved" (`TaskListRow.tsx:143-145`). The whole lingering row, including its actions, drops to `opacity: 0.55` (`:94`), which pushes muted text below legible contrast. Dim only the title and metadata, and name the destination.

### 1.4 Inline add

**F14 — `n` does nothing on an empty view. S2.**
When `flatRows` is empty, the page renders a second `TaskList` whose only group is keyed `'empty'` (`TasksPage.tsx:620-639`). But `n` sets `addingGroup` to `groups[0].key`, which is `'all'` for ungrouped views, and is undefined for grouped ones, because an empty grouped list has no groups (`:459-463`). An empty Today is exactly when you want `n` ("Nothing planned for today" → add). The second-`TaskList` pattern is itself a hack; it passes a no-op `onMoveOverdueToToday` and an empty `selected`.
*Fix:* render a standalone `InlineAddRow` under the empty state, keyed so that `n` opens it.

**F15 — Inline-add inheritance is sound.** `inlineAddDefaults` (`task-list.ts:214-253`) plus the server default `ownerType = manager` (`task.service.ts:248`) correctly land a task typed into Today in Today. One quirk: adding into a **Done** status group creates a task that is already done. Hide the `+` on closed status groups.

### 1.5 Filters, search, display

**F16 — Label grouping duplicates rows and breaks navigation. S1 (while the option is exposed).**
`task-views.ts:196-199` pushes a multi-label task into every label group. Downstream, `flatRows` holds duplicate keys (`TasksPage.tsx:194`), which causes four problems:

- The toolbar count double-counts.
- j/k navigation jumps back to the first copy (`findIndex`, `:414`).
- `rowElement()` always focuses the first `data-task-row` match (`:96-98`).
- Both copies render as focused and selected.

Group headers also show the raw label name, e.g. `category:follow_up`, instead of `taskLabelDisplayName`.
*Fix:* either remove Label from the Group options (see §7) or make grouping use the first/primary label only.

**F17 — Search ignores display names and owners. S3.**
`searchTasks` (`task-list.ts:95-102`) matches raw label names (`category:follow_up`, not "follow up") and doesn't match owner names. "Search this view" for "deepak" returns nothing in Waiting, where Deepak is a group header.

**F18 — The Type filter is dead weight. S3 (remove).**
Tasks/Meetings has its own toolbar chip, but meetings have their own route and the dataset has zero meeting tasks. Keep the `kind` URL param (the `?view=meetings` alias needs it) but take the chip off the toolbar.

### 1.6 Drawer integration

**F19 — The drawer can't step to the next task. S2.**
The drawer is a modal with a scrim (`TaskDrawer.tsx:100-125`). The list's key handler is disabled while it's open (`TasksPage.tsx:411`), and the drawer's shortcuts are `e s a p l u` only (`TaskDrawer.tsx:279-284`). Reviewing Inbox one task at a time costs Esc → j → Enter per item.
*Fix:* add `j/k` (or `[`/`]`) to the drawer when it's opened from the list, passing the list order in. This is the cheapest way to get "triage mode" (spec §13 punts a dedicated one).

**F20 — Shortcut vocabulary differs between list and drawer. S3.**
- The list uses Space / `e` for done. The drawer uses `E`.
- In the list, `s` opens a preset menu. In the drawer, `s` opens a date picker.
- `p` works only in the drawer.

Unify on one map and one legend component (`ShortcutLegend` already exists).

---

## 2. UI / UX

**U1 — Two "Today"s. S1 (information architecture).**
The top nav's **Today** is `/`, the command view. `/tasks` then lands on a rail view also called **Today** (`DEFAULT_TASK_VIEW_ID = 'today'`, `task-views.ts:19`), and both are visible in screenshot 1. Spec §0 says `/` *runs* the day and `/tasks` *builds* the plan. Landing the builder on a view with the runner's name blurs exactly that distinction.
*Fix:* rename the rail view **Planned today** (or **Today's plan**), or default `/tasks` to **Inbox** when it's non-empty and to **My tasks** otherwise. Either way, the two surfaces should never share a label.

**U2 — The focused row's date is hidden. S1.**
The hover-action cluster is absolutely positioned over the right edge and is forced visible on the focused row (`TaskListRow.tsx:199-212`: `focused ? 'opacity-100' : …`). It covers the 92px date column (`:186`) and often the owner avatar. As you j/k through a list, the one row you're looking at is the one whose date you can't see. That's the field you most need when deciding between `s`, `Space`, and `#`. *(code-inferred)*
*Fix:* show actions on hover only (the keyboard user has keys for all three), or reserve a real column for them so they never overlay the metadata.

**U3 — Keyboard discoverability depends on one small icon. S2.**
The only entry points to the keyboard model are the `?` key and a 14px keyboard icon at the far top-right, away from the list (screenshot 1). The hints on the bulk bar are `title` tooltips only. A first-time manager won't find j/k, `x`, or g-chords.
*Fix:* add a one-line, dismissible footer hint ("j/k to move · x select · s schedule · ? all shortcuts"), and show kbd hints in the ⋯ menu for every item. Status, Later, and Copy link currently have none (`TaskMenus.tsx:217-224`).

**U4 — Selection affordance is invisible until hover. S2.**
The checkbox is `opacity-0` until hover or focus (`TaskListRow.tsx:103`), yet it keeps its gutter. Screenshot 1 shows an unexplained ~24px indent before every status glyph. Mouse users don't know multi-select exists. Touch users have no hover, so selection is effectively undiscoverable.

**U5 — Empty, loading, and error states are good, with one mismatch. S3.**
The empty copy per view (`TaskListStates.tsx:44-70`) is well written. "Inbox zero" as a success state is right. The skeleton (`:5-19`) renders flat full-width rows, while loaded content is centred cards capped at 1180px, so the page jumps when data lands.

**U6 — Mouse lingering never ends until you click something. S3.**
Lingering clears on focus move (`TasksPage.tsx:226-232`). A mouse user who marks a row done by hover and then scrolls keeps seeing ghost rows. Hovering another row doesn't move focus. Consider clearing on the next pointer action outside the row, or after a timeout matching the undo toast (6s).

**U7 — Row click always opens the drawer. S3 (acceptable).**
Click opens the drawer. Selection needs ⌘/Ctrl-click, the hidden checkbox, or `x`. That's standard (Linear), and fine once U4 is fixed.

---

## 3. Visual design

The page reads as calm and mostly considered: restrained dark palette, tabular numerals, sensible 13px row type, and consistent tokens (the screenshots confirm this). It falls short in three ways.

**D1 — Alarm colour on routine slippage. S2.**
A task one day past its *scheduled* (not due) date:

- the rail badge turns red (`TaskViewRail.tsx:10`, `overdue > 0` → danger)
- the group header gets a red dot and red text (`TaskList.tsx:108`, `:145`)
- the row pill turns amber (`task-list.ts:58`)

That's three signals, two of them red, for what spec D2 explicitly calls "a nudge". Meanwhile 15 days overdue looks identical to 1 day (screenshot 2, T-49 vs T-68). Severity doesn't scale, but it's maximal from the start.
*Fix:* reserve red for missed `dueAt` deadlines only, everywhere. Scheduled slips are amber at most, with the header and badge matching the worst row. Add a quiet escalation (e.g. bolder amber at ≥ 7d).

**D2 — Chrome outweighs content at real-world volumes. S2.**
Each group is a bordered, rounded card with a 40px header band, dot, title, count pill, and `+` (`TaskList.tsx:51-64`, `:128-176`). Screenshot 1 has 4 tasks in 2 cards: 2 header bands, 4 borders, and ~50% of the vertical space spent on framing. The count is stated four times: rail badge, "4 tasks" in the title, and one pill per group.
*Fix:* flat list with light sticky section labels (text plus count, no card). Drop the title count or the group pills (pick one).

**D3 — Unbalanced row geometry. S3.**
When the date is suppressed (the Today bucket, `task-list.ts:88-90`), the 92px date column still reserves space, so signal icons float orphaned about 150px from the right edge (the bells in screenshot 1). With the reserved checkbox gutter (U4) and the key column, the title starts ~120px in.
*Fix:* collapse empty meta columns. Make the checkbox overlay the status glyph area on hover rather than reserve its own column.

**D4 — Double encoding. S3.**
A follow-up shows both a `follow up` label chip and a bell icon (`TaskListRow.tsx:159-161` triggers on `category:follow_up`). Pick one. The bell is the better one because it carries the "due" state.

**D5 — Alignment at wide widths. S3.**
The list is `mx-auto max-w-[1180px] px-4` (`TaskList.tsx:49`), but the toolbar is full width, `px-5`, and left-aligned (`TaskToolbar.tsx:83`). Above ~1400px of content width, the list's left edge drifts right of the search box and title. Put the toolbar in the same centred container.

**D6 — Raw data in titles. S2 (upstream, but visible here).**
Screenshot 1, T-70: "working trading @712020:ef2911ef-332c-4493-b05a-1b1916fcff50". A Jira account id leaked from a mention into the title, and the row renders it raw (no mention handling in `components/tasks/`). T-71 and T-72 are also identical "Standup follow-up: Harsha Nallaiahgari" tasks created on the same day. Standup follow-up creation isn't idempotent. Neither bug originates in `/tasks`, but `/tasks` is where they become visible every day. Fix at the source (capture/notes mention serialisation; standup follow-up dedupe on person + day).

**D7 — Consistency with the rest of the app. S3.**
The new TaskDrawer uses the same tokens and a `TaskPopover` / `MenuItem` vocabulary, which is good. Two divergences: the rail's rename/delete pencils are 10px icons in 20px targets (`TaskViewRail.tsx:73-78`), and the empty-state CTA styles are hand-rolled rather than shared with Today and standup buttons. These are minor.

---

## 4. PABR

### 4.1 Performance

The design is fine at current scale (tens to low hundreds of rows). There is no S1 here.

- **P1 — Every mutation invalidates nine query roots.** `useTaskListMutations.ts:24-28` invalidates `tasks`, `task-view-counts`, `task-detail`, `task-events`, `today`, `manager-desk`, `team-tracker`, `my-day`, and `workload`. On `/tasks`, that means a view refetch plus a counts refetch. The counts call is one universe query, one drift list, one latest-activity batch, and the saved-view list (`task-views.service.ts:326-351`). Triaging 20 items with `Space` makes ~40 server round-trips. Acceptable, but debounce the counts invalidation (e.g. 500ms trailing) or patch counts optimistically. **S3.**
- **P2 — Invalidating `['tasks']` marks every cached view stale.** Switching views after a mutation always refetches. `keepPreviousData` hides it. Fine. **S3.**
- **P3 — No virtualisation, and there's a motion wrapper per row.** Every row sits inside a `motion.div` under `AnimatePresence` (`TaskList.tsx:66-89`), and every status glyph is a spring-animated `motion.span` keyed by status with an `initial` scale of 0.6 (`TaskMenus.tsx:38-53`). Newly mounted rows after a view switch will pop their glyphs *(code-inferred)*, which the spec reserved for the toggle only. "Closed this week" or a saved "all team" view with several hundred rows will feel it. Drop the glyph `initial` unless the status changed, and virtualise above ~200 rows. **S3.**
- **P4 — Good:** `TaskListRow` is memoised with ref-stable handlers (`TasksPage.tsx:391-405`), and the popover is portalled. Row re-renders on selection are bounded.

### 4.2 Accessibility

- **A1 — The listbox structure is invalid. S2.** `role="listbox"` (`TaskList.tsx:49`) directly contains `<section>`, `<header>`, `<h2>`, and buttons ("Move all to today", "+", inline add). A listbox may only own `option` / `group`. Each `role="option"` row (`TaskListRow.tsx:83`) contains buttons, and option children are presentational, so assistive tech may not expose them at all. *Fix:* sections → `role="group"` with `aria-labelledby`, and move header controls outside the listbox. Or switch to `role="grid"` with rows and cells, which is the right pattern for rows with actions.
- **A2 — Row names omit what sighted users scan for. S2.** The row's `aria-label` is `"T-12 title, Open"` (`TaskListRow.tsx:86`). The date or overdue state, owner, and signals are absent, and because it's an `aria-label` it overrides the inner text. Build it from the same parts as the visual row ("…, Open, 2 days overdue, Deepak, follow-up due").
- **A3 — Contrast failures. S2.**
  - Task keys and the dropped glyph use `--text-disabled`: `#5F687A` on the dark background ≈ 3.4:1, and `#94A3B8` on white ≈ 2.6:1 (`index.css:23`, `:60`). Both are below 4.5:1 for 11px text.
  - Lingering rows at 0.55 opacity push muted text lower still.
  - The rail's zero-state numerals and `--text-muted` 10.5px headings should be checked too.
- **A4 — Actions are not reachable from the keyboard via Tab. S3 (mitigated).** Every row button is `tabIndex={-1}`. The key map covers all actions, so keyboard users are fine, but screen-reader users navigating by Tab or virtual cursor can't reach status/schedule/⋯. A grid pattern (A1) fixes this.
- **A5 — Focus management gaps. S3.**
  - The toolbar filter popovers close on outside mousedown without restoring focus (`TaskPopover.tsx:62-70` calls `onClose`, not `close`).
  - The shortcuts dialog is `aria-modal` but doesn't trap Tab (`TaskListStates.tsx:132-167`). `useModalFocus` exists; use it.
- **A6 — Reduced motion is handled** for rows, the bulk bar, the glyph, and the drawer. Good.

### 4.3 Behaviour and resilience

- **B1 — Midnight rollover is correct.** `useLocalDate` re-keys the view, counts, and view-list queries (`useLocalDate.ts`, `useTaskViews.ts`). Good.
- **B2 — Server/client date skew.** The server buckets `dueAt` with `isoDatePart` in *server* local time (`utils/date.ts:24-36`). The client uses browser local time (`task-list.ts:19-24`), and `closedAt` is sliced as UTC (`task-views.service.ts:158`). This is harmless while the server and every user are in IST. It breaks D3's "the client supplies today" promise for any other timezone, because a row can be a member (server) of a bucket it doesn't render in (client). Pass the client's IANA zone alongside `today`. **S3 today, S2 if the team spans zones.**
- **B3 — The error state keeps stale data visible**, per spec. Good. Counts fail silently, per spec. Acceptable.
- **B4 — Selection survives on lingering rows.** After "Mark 5 done", the bar still says "5 selected" and Space reopens them. That's defensible as a second undo, but surprising. Clear the selection after a bulk action that removes rows from the view.
- **B5 — The g-chord timer isn't cleared on unmount** (`TasksPage.tsx:443-444`). Trivial.

### 4.4 Responsiveness

- **R1 — Below `md` the rail becomes an unlabeled `<select>` without counts** (`TaskToolbar.tsx:85-93`). On a phone you lose the Inbox and Needs-attention badges, the main reasons to open the page. **S2.**
- **R2 — The bulk bar overflows on phones.** It's five labelled buttons plus a count and a close, with no wrap (`TaskBulkBar.tsx:15-38`), about 480px wide, centred in an `overflow-hidden` section. On a 375px screen it's clipped *(code-inferred)*. Go icon-only below `sm`. **S2.**
- **R3 — The toolbar wraps to 2–3 lines on phones** (search min 180px, plus four chips and Display). Collapse the filters behind one "Filter" button below `sm`. **S3.**
- **R4 — There's no touch path to selection or hover actions** (U4). Mobile is effectively read, open, and status-menu only. Given the persona (a desk-bound manager), it's acceptable to *declare* mobile read-mostly, but then do it on purpose: larger row targets and a long-press to select. **S3.**

---

## 5. Use-case fit (engineering manager, daily)

| Need | Served? | Notes |
|---|---|---|
| Empty the inbox fast | **Mostly** | Assign/schedule/drop by key is excellent. Missing: step through items in the drawer (F19). |
| Build today's plan | **Partly** | Pull-in via "Move all to today" and `s t` is good. There's no order (F7) and no specific-date pick (F8). |
| See today's progress | **No** | Done work disappears (F5). |
| Know who owes me what | **No** | Waiting is polluted by Me and by team day plans (F1, F3). |
| Catch things slipping | **Noisy** | Needs attention includes parked and idle-dev work (F2), and colour is alarmist (D1). |
| Weekly review | **Partly** | Closed this week resets Monday (F6). |
| Share a view | **Yes** | URL contract and saved views are solid. |

**Noise that doesn't pull its weight:** Upcoming (F4), the Type filter (F18), Label grouping (F16), the duplicate counts (D2), the double-encoded follow-up (D4), and Waiting's Me group (F1).

---

## 6. Must fix (S1) — in suggested order

1. **F1** Redefine *Waiting on others*. Exclude my own tasks except blocked ones. Drop the blanket developer-owned clause. *(server matcher + test)*
2. **F2** *Needs attention*: `later:false`, and scope stale to manager-owned and Inbox tasks.
3. **U1** Resolve the two-"Today" collision (rename the rail view, or default `/tasks` to Inbox / My tasks).
4. **U2** Stop the action cluster covering the focused row's date.
5. **F8** Schedule menu with a date picker (reuse `DatePickerPopover`).
6. **F16** Remove Label grouping, or dedupe it (it breaks navigation, counts, and selection).

## 7. Should fix (S2)

- **F5** "Done today" collapsed group in Today.
- **F7** Keyboard reordering within a day.
- **F19** Next/prev task inside the drawer.
- **F14** `n` on empty views; delete the second-`TaskList` hack.
- **F10** Inline rename and undoable delete for saved views.
- **F3** Treat the manager's linked developer id as Me.
- **D1** Colour discipline: red only for missed deadlines, with header and badge matching the rows.
- **D2** Flatten group chrome and state counts once.
- **D6** Fix mention serialisation and standup follow-up dedupe upstream.
- **A1–A3** Listbox/grid semantics, full row names, contrast of `--text-disabled`.
- **U3/U4** A keyboard-hint footer, and a visible selection affordance.
- **R1/R2** Counts in the mobile view picker; an icon-only bulk bar on phones.

## 8. Nice to have (S3)

F6 (rolling 7-day closed), F9 (`p` on the list), F11 (clipboard result), F12 (toast copy), F13 (lingering hint names its destination), F17 (search display names and owners), F20 (one shortcut vocabulary), U5 (skeleton matches layout), U6 (mouse lingering timeout), D3 (collapse empty columns), D5 (toolbar alignment), P1 (debounce counts), P3 (glyph animation, virtualisation), A5 (focus return, dialog trap), B2 (pass the timezone), B4 (clear selection after bulk), R3/R4 (mobile toolbar, long-press).

## 9. Remove or simplify

| Remove / simplify | Why | Cost to remove |
|---|---|---|
| **Upcoming** view | A strict subset of My tasks' schedule groups (F4) | Add `upcoming → my-tasks` to `RETIRED_TASK_VIEWS` |
| **Type** filter chip | Meetings have a route; 0 meeting tasks in practice | Delete the chip; keep the `kind` param for the alias |
| **Label** grouping | Broken semantics for multi-label tasks (F16); rarely the right lens | Drop from `GROUPS` in `TaskToolbar.tsx` |
| Group **cards** | Chrome > content at typical volumes (D2) | Style-only change in `TaskList.tsx` |
| Per-group **count pills** *or* the title count | Same number stated 3–4 times | One-line removal |
| Follow-up **label chip** (keep the bell) | Double encoding (D4) | Filter the `category:follow_up` chip in the row |
| Second empty-state `TaskList` | Hack; breaks `n` (F14) | Replace with `InlineAddRow` |
| "Nothing to change — skipped" toast | Noise on a no-op | Delete the branch |
| `window.prompt` rename | Only native dialog in the app | Inline edit |

**Keep** (they earn their place): g-chords, "Move all to today", lingering rows, undo-everything, saved views, the Signal chip on the attention view, and the URL contract.

---

## 10. Test gaps worth adding with the fixes

- Server: Waiting excludes manager-owned non-blocked tasks. Attention excludes `later`. `count(view) === run(view).length` for every built-in, including after F1/F2.
- Client: label grouping doesn't duplicate keys (or the option is gone). `n` opens add on an empty Today. The focused row's date stays visible (row snapshot). Drawer `j/k` stepping.
- A11y: an axe run over `TasksPage` in jsdom would have caught A1 and A3.

## 11. Housekeeping noticed

- `AGENTS.md` "Canonical routes" doesn't mention `/tasks` (it is `/desk`'s flag-scoped path when `tasksPhase3` is on; see `App.tsx:131-156`). Worth one line.
- `docs/49` line 3 points Phase 2 at "§12"; Phase 2 is §14 (§12 is Accessibility). Cosmetic.
