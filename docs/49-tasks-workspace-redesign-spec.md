# 49 — Tasks Workspace Redesign (Phase 1)

Status: implemented (Phase 1). Phase 2 items are documented only (§12).

## 0. Principle

`/tasks` is where the manager **builds and maintains** the plan: capture,
triage, schedule, delegate, close. The Today page (`/`) **runs** the day
(rhythm metrics, action queue, people pulse, carry-forward). `/tasks` must not
grow progress bars, day lanes, or a wrap-up ritual.

Design targets: dense, keyboard-first, every common mutation one keystroke or
one click away, optimistic with undo, no confirm dialogs.

## 1. Resolved decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Plan date** = the earlier of `scheduledOn` and the local date of `dueAt` (either may be null). All date bucketing, the Today/Upcoming horizons and the overdue signal use the plan date. | `dueAt` is rarely set (only meetings/Copilot today), but when set it is a hard deadline and must pull a task forward. One derived date keeps grouping, filtering and counts consistent. |
| D2 | **Overdue** = status ∈ {open, active, blocked} and plan date < today. The row's date turns `--danger` when the overdue date comes from `dueAt`, `--warning` when it is only a slipped `scheduledOn`. | A slipped plan date is a nudge; a missed deadline is a problem. Both belong in the Overdue bucket. |
| D3 | `today` is supplied by the client (`?today=YYYY-MM-DD`) on every view/count request; the server falls back to its own date. | Fixes client/server timezone skew and makes midnight rollover a pure client concern (new date → new query key → refetch). |
| D4 | The in-memory matcher (`matchesTaskViewFilters`) is the single source of truth for view membership. SQL still bounds the candidate set for `run()` (no all-history scans), then the matcher is applied. `view-counts` evaluates every view against one shared candidate universe with the same matcher. | Badge counts can never disagree with the list, and counts cost one universe query + one signal batch rather than N view runs. |
| D5 | **Follow-ups** and **Meetings** built-ins are retired from the rail. `?view=follow-ups` → Waiting on others; `?view=meetings` → My tasks + `kind=meeting`. The `/follow-ups` and `/meetings` routes are untouched and remain the dedicated workflows. | A follow-up is by definition waiting on someone; meetings already have a dedicated route. Fewer, broader views beat eleven overlapping ones. |
| D6 | Retired ids resolve client-side through `RETIRED_TASK_VIEWS` (view id + overrides) and the URL is rewritten with `replaceState`. The server no longer lists them. | Old links keep working without the server carrying dead definitions. |
| D7 | Search (`?q=`) is a transient client-side filter over the loaded view (title, key, nextAction, labels, Jira refs). It is never saved into a view definition and does not make a view dirty. | Views are SQL-bounded and small; server text search already lives in the palette (`/api/search`). |
| D8 | Bulk updates are a list of per-task patches (`items[].changes`), not action verbs. | Undo of a bulk action must restore *different* previous values per task; the same endpoint serves both. |
| D9 | Stale threshold is `TASK_STALE_DAYS = 5` (shared constant). | Matches the previous Stale built-in. |
| D10 | Lingering rows are a client-only overlay, cleared on focus move or view change (§8.1). | Keeps server semantics exact while preventing rows from vanishing under the cursor. |

## 2. View engine contract changes (`shared/types.ts`)

New `TaskViewFilters` fields (all optional, validated by `taskViewDefinitionSchema`):

```ts
/** "today": plan date <= today. "upcoming": plan date > today (needs at least one date). */
horizon?: "today" | "upcoming";
/** Waiting on others: developer-owned OR blocked OR follow-up predicate OR label kind:waiting. */
waiting?: boolean;
/** Needs attention: any of the listed signals (OR). */
attention?: ("overdue" | "stale" | "drift")[];
```

Each row returned by a view run carries computed signals:

```ts
export interface TaskSignals {
  overdue: boolean; overdueDays: number | null;   // days since plan date (D1/D2)
  overdueSource: "due" | "scheduled" | null;
  stale: boolean; staleDays: number | null;        // days since last event (updatedAt fallback); open statuses only
  drift: boolean;                                  // JiraDriftService semantics (§8.1 of docs/47)
  followUpDue: boolean;                            // followUpAt local date <= today
}
export type TaskViewTask = ManagerTask & { signals: TaskSignals };
```

`TaskViewMeta` gains `section?: "plan" | "review"` (built-ins only).

Closed-task reachability is unchanged: closed rows only match via an explicit
`closed` range, `jiraDrift: true`, or `attention` containing `"drift"` (7-day
drift window).

## 3. Built-in views

All resolve against the request's `today`. Order below is rail order.

| id | Name | Section | Definition |
|---|---|---|---|
| `today` | Today | plan | `{"filters":{"owner":"me","status":["open","active","blocked"],"later":false,"horizon":"today"},"sort":"scheduled","group":"scheduled"}` |
| `inbox` | Inbox | plan | `{"filters":{"owner":"inbox","status":["open"]},"sort":"created"}` |
| `my-tasks` | My tasks | plan | `{"filters":{"owner":"me","later":false},"sort":"scheduled","group":"scheduled"}` |
| `waiting` | Waiting on others | plan | `{"filters":{"waiting":true,"later":false,"status":["open","active","blocked"]},"sort":"updated","group":"owner"}` |
| `upcoming` | Upcoming | plan | `{"filters":{"owner":"me","status":["open","active","blocked"],"later":false,"horizon":"upcoming"},"sort":"scheduled","group":"scheduled"}` |
| `later` | Later | plan | `{"filters":{"later":true},"sort":"created"}` |
| `attention` | Needs attention | review | `{"filters":{"attention":["overdue","stale","drift"]},"sort":"scheduled"}` |
| `closed-week` | Closed this week | review | `{"filters":{"closed":{"from":"<monday>","to":"<today>"}},"sort":"updated"}` |

Meetings scheduled today are `kind: "meeting"` tasks with `scheduledOn = today`
and are therefore included in Today; they render with their start time (§5).

### Retired ids (client alias map `RETIRED_TASK_VIEWS`)

| Old id | Resolves to |
|---|---|
| `today-plan` | `today` |
| `watching` | `waiting` + `owner=team` |
| `blocked` | `waiting` + `status=blocked` |
| `follow-ups` | `waiting` |
| `meetings` | `my-tasks` + `kind=meeting` |
| `stale` | `attention` + `signal=stale` |
| `jira-drift` | `attention` + `signal=drift` |

Default view when `?view=` is absent or unknown: `today`.

### Scheduled grouping buckets (by plan date, in order)

`Overdue` (< today) · `Today` · `Tomorrow` · `Next 7 days` (≤ today+7) ·
`Beyond` · `Unscheduled` (no plan date). Empty buckets are omitted.
Owner grouping: `Me` first, then developers A→Z, then `Inbox`.

## 4. Rail

- Sections: unlabeled **plan** group → **Review** → **My views** (saved) →
  "Save current view".
- Each item shows a count from `GET /api/tasks/view-counts`, right-aligned,
  `tabular-nums`:
  - **Actionable badges** (tinted pill): Inbox (`--accent`, when > 0),
    Today (`--danger` when `overdue > 0`, else `--accent`), Needs attention
    (`--warning`, when > 0).
  - All other views: dim numeral (`--text-muted`), hidden when 0.
- Counts are for base definitions (URL overrides are not applied).
- Saved views: hover shows rename/delete (unchanged).
- Below `md` the rail is hidden and the toolbar shows a compact view picker.

## 5. Row anatomy

One row = one `role="option"` inside a `role="listbox"`, divided by
`divide-y` borders, full width, min-height 38px. Left → right:

1. **Selection box** — visible on hover, when focused, or whenever any row is
   selected. Click (or ⌘/Ctrl-click on the row) toggles selection;
   shift-click selects a range from the last toggled row.
2. **Status glyph** — open ○, active ◐ (accent), blocked ⊘ (danger),
   done ✓ (success), dropped ⊗ (muted). Click opens the status menu (§6).
3. **Task key** — mono 11px `--text-disabled`; hidden below `md`.
4. **Meeting time** — `HH:mm` when `kind = meeting` and `startsAt` is set.
5. **Title** — 13px, truncates. Done/dropped: line-through, dimmed.
6. **Labels** — first 2 chips with registry colors, then `+n`.
7. *(right-aligned)* **Signals** — icons with tooltips: priority high (flag,
   danger), follow-up (bell; danger when `followUpDue`), stale (hourglass,
   warning, "No activity for Nd"), drift (git-compare, warning). In the
   attention view signals render as text reason chips instead
   (`Overdue 3d`, `Stale 6d`, `Jira drift`).
8. **Jira ref** — mono chip, hidden below `lg`.
9. **Owner avatar** — initials disc with name tooltip; `Inbox` for unowned.
10. **Date** — relative, `tabular-nums`, fixed width 84px (§5.1).
11. **Hover actions** (on hover or row focus, overlaying the right edge):
    schedule, done/reopen, ⋯ — max 3.

Second line (only when `nextAction` is non-empty): `→ nextAction`, 12px
`--text-muted`, aligned with the title.

### 5.1 Relative date rules (`relativeTaskDate`)

Date source: plan date (D1); closed rows use `closedAt` ("Closed Tue").

| Case | Label | Tone |
|---|---|---|
| plan date < today | `Nd overdue` | danger if `overdueSource = due`, else warning |
| = today | `Today` (`Due today` if from dueAt) | default |
| = today+1 | `Tomorrow` | default |
| ≤ today+6 | weekday `Thu` | muted |
| same year | `Oct 12` | muted |
| other year | `Oct 12, 2027` | muted |
| none | empty | — |

### 5.2 Implied-meta suppression

- Owner avatar hidden when the effective filter is `owner: "me"` or
  `"inbox"`, or the list is grouped by owner.
- Date hidden when grouped by schedule and the row sits in a single-day bucket
  (`Today`, `Tomorrow`) and is not overdue.
- Status glyph always shown (it is the primary action target).

## 6. Actions

| Action | Mouse | Key | Mutation |
|---|---|---|---|
| Change status | glyph → menu (5 statuses) | — | `PATCH {status}` |
| Toggle done | hover ✓ | `Space` / `e` | open-ish → `done`; done/dropped → `open` |
| Schedule | hover calendar → menu | `s` then `t`/`m`/`w`/`l`/`c` | Today / Tomorrow / next Monday / Later / clear date |
| Assign | ⋯ → Assign | `a` | owner = me or developer (type-ahead) |
| Labels | ⋯ → Labels | `l` | toggle label in registry list |
| Drop | ⋯ → Drop | `#` | `status: dropped` |
| Open | row click | `Enter` / `o` | opens TaskDrawer |

Every mutation: optimistic cache patch → server → invalidate. Success shows a
toast with **Undo** (6s) that re-applies the previous values via the bulk
endpoint. Exception: label toggles show no toast — the label menu stays open
and is itself the undo. No confirm dialogs anywhere on this page.

Scheduling to a date sends `{scheduledOn, later:false}`; Later sends
`{later:true}` (server clears the date). Developer-owned tasks cannot be Later
and closed tasks cannot be reassigned — the client skips those rows in bulk
actions and reports "skipped n".

### 6.1 Inline add

Each group is a rounded card whose header band shows the group (owner
groups: initials avatar + name in normal case; schedule groups: a tone dot —
Overdue danger, Today accent, Tomorrow info) and a `+` button that opens the
add row at the end of that group. Ungrouped lists end with a `+ Add task`
row; empty plan views show one under the empty state. The list is capped at
1180px wide so the date stays close to the title. Enter submits via `POST /api/tasks`, Esc cancels, the input stays open
for the next entry. Context inheritance:

| Grouping / view | Inherited fields |
|---|---|
| Schedule group Today / Overdue | `scheduledOn = today` |
| Tomorrow | `scheduledOn = today+1` |
| Next 7 days / Beyond | `scheduledOn = today+2` / `today+8` (first date in the bucket) |
| Unscheduled | `scheduledOn = null` |
| Owner group (developer) | `ownerType = developer, ownerId` |
| Owner group Me / Inbox | manager / `ownerType = null` |
| Status group | `status` of the group |
| View `later` | `later = true` |
| View `inbox` | `ownerType = null` |
| `kind=meeting` override | `kind = meeting` |

## 7. Keyboard

Handled by one `keydown` listener on `document`, active only when: focus is on
`body` or inside the Tasks `<main>`; the target is not an input, textarea,
select or contenteditable; no Meta/Ctrl/Alt modifier; the drawer is closed.
This guarantees no collision with ⌘K / ⌘I / ⌘J.

| Key | Action |
|---|---|
| `j` / `↓`, `k` / `↑` | Move focus (wraps at ends: no) |
| `Enter` / `o` | Open drawer for focused row |
| `x` | Toggle selection of focused row |
| `Shift+j` / `Shift+k` | Extend selection while moving |
| `Space` / `e` | Toggle done (focused row, or all selected) |
| `s` | Schedule menu (focused or selected); `t` `m` `w` `l` `c` inside |
| `a` | Assign menu (focused or selected) |
| `l` | Label menu (focused or selected) |
| `#` | Drop (focused or selected) |
| `n` | Inline add in focused row's group |
| `/` | Focus search |
| `?` | Shortcut cheat sheet |
| `Esc` | Close menu → clear selection → clear search (first that applies) |

Focus model: roving tabindex (focused row `tabIndex=0`, others `-1`),
`aria-selected` reflects multi-select, visible 2px `--accent` focus ring. When
the drawer closes, focus returns to the row that opened it. When the focused
row leaves the list, focus moves to the row now at the same index (or the
last row).

## 8. Correctness rules (testable)

### 8.1 Lingering rows

- R1: When a list-initiated mutation causes task K to stop matching the view,
  K remains rendered in its **original group at its original index**, showing
  its new state (struck through when closed; `Moved → Tomorrow` hint when
  rescheduled out).
- R2: Lingering rows are removed when (a) focus moves to a different row,
  (b) the view, overrides or search change, or (c) the mutation is undone
  (the row then matches again naturally).
- R3: A lingering row stays interactive (undo, reopen, open drawer).
- R4: Lingering never adds rows the user did not act on.

### 8.2 Data freshness

- R5: View switches keep the previous list on screen
  (`placeholderData: keepPreviousData`) with a subtle "Updating…" hint;
  skeleton rows appear only when no data has ever loaded for the page.
- R6: `today` is recomputed at local midnight and on `visibilitychange`/focus;
  a changed date re-keys the view, count and view-list queries.
- R7: All mutations are optimistic: cached rows patched in `onMutate`, rolled
  back in `onError` with an error toast, invalidated in `onSettled`
  (`tasks`, `task-view-counts`, and the Today/Desk/Tracker surfaces).
- R8: Counts come from the same matcher as lists (D4); a test asserts
  `count(view) === run(view).length` for every built-in.

## 9. Toolbar

Row 1: view title, dirty dot (saved view with overrides), task count,
`Updating…` hint. Row 2:

- **Search** input (`/`), `?q=`.
- **Filter buttons**, each a popover with checkable options; when active the
  button becomes a chip `Status: Blocked +1` with an `×` to clear:
  Owner (Me · Team · Inbox exclusive tokens, or multi-select developers),
  Status (multi), Label (multi, "has all"), Type (Tasks / Meetings), and
  Signal (attention view only: Overdue / Stale / Drift).
- **Display** popover: Sort (Schedule, Updated, Created, Priority) and Group
  (None, Schedule, Owner, Status, Label).
- Right side: saved view with overrides → `Update view` + `Revert`;
  built-in with overrides → `Reset`.

URL contract (`taskViewParamsFromState`, extended — all existing params keep
their meaning): `view`, `owner` (token or comma list of account ids),
`status`, `label`, `group` (+ new value `none`), `sort`, and new `kind`,
`signal`, `q`.

## 10. Endpoints

All under `requireManager`, gated by the Phase 3 flag like existing view routes.

### `GET /api/tasks?viewDef=<b64url>&today=YYYY-MM-DD`
Unchanged shape plus `signals` on each task: `{ tasks: TaskViewTask[] }`.

### `GET /api/task-views?today=YYYY-MM-DD`
Built-ins (with `section`) + saved views.

### `GET /api/tasks/view-counts?today=YYYY-MM-DD`
```json
{ "today": "2026-09-26",
  "counts": { "today": { "count": 4, "overdue": 1 }, "inbox": { "count": 2, "overdue": 0 },
              "saved:7": { "count": 9, "overdue": 3 } } }
```
One entry per built-in and saved view id. `overdue` = rows in that view with
`signals.overdue`.

### `POST /api/tasks/bulk`
```json
{ "items": [ { "key": "T-12", "changes": { "scheduledOn": "2026-09-26", "later": false } },
             { "key": "T-14", "changes": { "status": "done" } } ] }
```
- 1–200 items, unique keys, `changes` is `UpdateTaskRequest` (non-empty).
- One transaction: every item runs `TaskService.update`; any failure rolls back
  all and returns `{ error: "T-14: <message>", status }` with that item's HTTP
  status.
- 200 → `{ tasks: ManagerTask[] }` in request order.

## 11. States

| View | Empty copy | CTA |
|---|---|---|
| Today | "Nothing planned for today" / "N open tasks could be pulled in." (N = my-tasks − today + inbox counts) | "Plan your day" → My tasks |
| Inbox | "Inbox zero" (success tone, check icon) / "Everything captured has an owner." | — |
| My tasks | "No open tasks" | inline add |
| Waiting on others | "Nobody owes you anything right now." | — |
| Upcoming | "Nothing scheduled ahead." | — |
| Later | "Nothing parked for later." | — |
| Needs attention | "All clear — nothing overdue, stale, or drifting." (`signal=drift`: "Jira and tasks agree.") | — |
| Closed this week | "Nothing closed yet this week." | — |
| Any, filters/search active | "No tasks match these filters." | "Clear filters" |

- Loading: 6 skeleton rows (first load only, R5).
- Error: inline banner above the list with the message and **Retry**; the
  previous list (if any) stays visible.
- Counts failing: rail renders without counts (no error UI).

Motion: framer-motion for status-glyph toggle (scale/opacity) and row exit
(opacity/height, 150ms) only. **No layout animations on reorder.** All motion
disabled under `prefers-reduced-motion` (`useReducedMotion`).

## 12. Accessibility

- Rail: `nav` with `aria-current="page"` on the selected view; counts have
  `aria-label` ("Inbox, 3 tasks").
- List: `role="listbox"` + `aria-multiselectable="true"`, rows `role="option"`
  with `aria-selected`, roving tabindex, focus ring on `:focus-visible`.
- Menus: `role="menu"`/`menuitemradio`/`menuitemcheckbox`, arrow-key
  navigation, Esc closes and restores focus to the trigger.
- Icon-only buttons and signals have `aria-label` / `title`.
- Bulk bar is a `role="toolbar"` announced via `aria-live="polite"` count.
- Colors are CSS variables only; contrast inherits the theme tokens.

## 13. Out of scope

Drag-and-drop between groups; pinned master-detail pane; progress bars, day
lanes, wrap-up ritual; suggestion engine; reorderable saved views; inbox
one-at-a-time triage mode; any change to `/meetings`, `/follow-ups`, the Today
page, or `/api/my-day`.

## 14. Phase 2 (future — not implemented)

1. **Jira drift resolve-in-place**: drift rows get "Close task" / "Open Jira"
   buttons.
2. **Stale nudge**: stale rows offer "Create follow-up with <owner>".
3. **Person lens** in Waiting on others: per-person split "I owe them / they
   owe me", header link to `/team?dev=<id>&panel=one-on-one`.
4. **Snooze until Jira resolves**: hide a task until its linked issue changes
   state, resurfaced by the sync engine.

## 15. Implementation map

- Server: `task-views.service.ts` (built-ins, matcher, signals, counts),
  `task.service.ts` (`bulkUpdate`), `routes/tasks.ts` (`/view-counts`,
  `/bulk`, `today`), `routes/task-views.ts` (`today`).
- Shared: `TaskSignals`, `TaskViewTask`, `TaskViewCount(s)Response`,
  `BulkUpdateTasksRequest/Response`, `TASK_STALE_DAYS`, filter schema.
- Client lib: `lib/task-views.ts` (URL contract, aliases, grouping),
  `lib/task-list.ts` (relative dates, suppression, lingering, inline-add
  context, keyboard targets).
- Client hooks: `useTaskViews.ts` (+counts, keepPreviousData, today),
  `useTaskListMutations.ts` (optimistic single + bulk + undo),
  `useLocalDate.ts` (midnight rollover).
- Client components (`components/tasks/`): `TasksPage`, `TaskViewRail`,
  `TaskToolbar`, `TaskList`, `TaskListRow`, `TaskMenus`, `TaskPopover`
  (portal menu primitive), `TaskBulkBar`, `TaskListStates` (skeleton, empty,
  error, shortcut cheat sheet).
- Tests: `server/tests/task-workspace.routes.test.ts`,
  `client/src/test/task-list.test.ts`, `client/src/test/TasksPage.test.tsx`,
  `client/src/test/useTaskListMutations.test.tsx`.
