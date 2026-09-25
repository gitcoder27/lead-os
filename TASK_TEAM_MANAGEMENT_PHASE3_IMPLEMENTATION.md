# Task & Team Management V2 — Phase 3 Implementation Plan

Interaction redesign on top of the canonical task model. This answers the
Phase 3 outline in `TASK_TEAM_MANAGEMENT_V2_IMPLEMENTATION.md` Part IV.

Status: **planned, not started.**

---

## 0. Prerequisites and gating

- Phase 3 builds only on canonical tasks. A workspace needs `tasks_phase2_stage` of `2c` or `2d`.
- There is one per-workspace flag, `tasks_phase3_enabled`. It can only be set through `npm run tasks:phase3 --workspace=server -- --workspace <id> --enable`, which refuses unless the stage is `2c`/`2d`. Disabling it restores the Phase 2 UI (no data changes).
- Every wave ships behind this flag. With the flag off, routes, nav and components behave exactly as in Phase 2.
- The legacy-table drop (3f) also needs stage `2d` + 30 days.

---

## 1. Decision record

| # | Question (Part IV ref) | Decision |
|---|---|---|
| P3-D1 | Desk fate (A1) | **Desk becomes "Tasks"** (`/tasks`): a general task list driven by saved views. Today stays the lean daily command view. `/desk` → `/tasks` alias. |
| P3-D2 | Task view (A3, A4) | **One shared `TaskDrawer` everywhere + full-page `/t/:key`**, which can be bookmarked and linked. |
| P3-D3 | Meetings (A5, D14) | **Meetings stay tasks** (`kind='meeting'`). Action items are child tasks via `parent_id`. No new entity. |
| P3-D4 | 1:1 notes location (A6) | `developer_notes` gets a tab in the Team developer drawer. The full 1:1 workspace is deferred (§9). |
| P3-D5 | Standup entry (B1) | **A mode of the Team page**: `/team?mode=standup`. Developer order follows the active board sort/saved view. |
| P3-D6 | Since last standup (B3) | **Rolling window**: last 24h, or last 72h on Mondays. No stored state. |
| P3-D7 | Capture default owner (C3) | **The manager (me)**, `status=open`, `scheduled_on=today`. `@person` makes a developer the owner, with me as tracking manager. |
| P3-D8 | Parser location (C6) | **Shared pure parser** in `shared/capture-grammar.ts`. The client uses it for a live preview; the server re-parses on submit and is authoritative. |
| P3-D9 | Saved views (D1) | **New `task_saved_views` only.** Team and Work saved views are untouched. |
| P3-D10 | View sharing (D4) | **Per manager** (private). |
| P3-D11 | Person-day status (E1, D26) | **Hybrid.** Status stays manual; a suggestion badge appears when the current task is `blocked`. Accept with one key/click. |
| P3-D12 | Capacity (E2) | **Remove `capacityUnits`** from the UI and DTOs, and remove the `overCapacity` signal. The DB column stays inert. |
| P3-D13 | Kind/category (E3, D13) | **Remove from every UI** and add a **label manager** (add / rename / color). |
| P3-D14 | Developer Later (E4, D31) | **No.** Later stays manager/inbox only. |
| P3-D15 | Former-owner access (E5, D8) | **Read own events.** A former owner can read the task title and their own shared events, and nothing else. |
| P3-D16 | Backlog scope | **In scope:** Jira reconciliation signals, the legacy-table drop CLI. **Deferred:** 1:1 workspace, event-body FTS5, timeline analytics (§9). |

---

## 2. Waves

Each wave ships independently behind the flag, with its own tests.

| Wave | Theme | Depends on |
|---|---|---|
| 3a | Shared TaskDrawer, `/t/:key` page, labels, kind/category removal | — |
| 3b | Capture grammar + single capture box | 3a (labels) |
| 3c | Tasks screen + saved views; meetings action items | 3a |
| 3d | Standup mode + hybrid person status | 3a |
| 3e | Cross-cutting: capacity removal, former-owner access | — |
| 3f | Jira reconciliation signals, legacy-table drop | 3c (signals surface), stage 2d |

---

## 3. Wave 3a — Task drawer, task page, labels

### 3.1 Shared `TaskDrawer`

- New `client/src/components/tasks/TaskDrawer.tsx`. It replaces `manager-desk/ItemDetailDrawer.tsx` and `team-tracker/TrackerTaskDetailDrawer.tsx` (both retired once flag-on paths are verified).
- It is driven by `useCanonicalTasks` + `GET /api/tasks/:key/detail`, and knows nothing about which surface opened it.
- Section order: **Header** (key chip, title, status pill) → **Owner & tracking** → **Schedule** (`scheduled_on`, `follow_up_at`, later) → **Links** (Jira, people, external, tasks) → **Children** (action items; meetings, plus any parent) → **Timeline** (`TaskTimeline`) → **Composer** → **Properties** (labels, priority, created by/at).
- For meetings, `follow_up_at`/later are hidden. The drawer shows `starts_at`/`ends_at`/`participants`/`outcome` and an "Add action item" composer.
- Developer principals get the developer DTO (no private fields, already enforced server-side). The drawer hides tracking, labels and private-event controls for them.

### 3.2 Full-page `/t/:key`

- `App.tsx` renders `TaskPage` (the drawer body in page layout) for `/t/:key` when the flag is on. The drawer's "Open full page" goes there. Aliased keys redirect to the survivor key (`TaskKeysService.resolve`).
- Deleted tasks render a read-only tombstone with their timeline (manager only).

### 3.3 Labels as the only taxonomy

- New table `task_labels(workspace_id, name, color, system INTEGER, created_at)`, unique on `(workspace_id, name)`. Existing label strings in `tasks.labels_json` are seeded idempotently on enable.
- **System labels** (`category:follow_up`, `kind:decision`, `kind:waiting`, `priority:*`) cannot be renamed or deleted, because `category:follow_up` feeds the Follow-ups predicate. They display without their prefixes.
- Routes: `GET/POST /api/task-labels` and `PATCH/DELETE /api/task-labels/:name`. A rename rewrites `labels_json` on every task in one transaction and emits an `update` event per task (`meta.labelRenamed`).
- The label manager is in Settings → Labels. The drawer and capture use a label chip picker with typeahead.
- The kind/category pickers are removed from `DeskCaptureForm`, `QuickCapture`, `DrawerPrimaryFields`, `DrawerProperties` and `ManagerDeskCommandBar`. `ManagerDeskItemKind`/`ManagerDeskCategory` are kept only for legacy DTO types until the Phase 2 DTOs retire.

---

## 4. Wave 3b — Capture grammar

### 4.1 Grammar (canonical implementation: `shared/capture-grammar.ts`)

```ebnf
capture   = update | note | create ;
update    = taskref , ":" , ws , text ;            (* "T-142: said X" → event on T-142 *)
note      = "/note" , ws , text ;                   (* → today's daily note *)
create    = { token | word } ;                      (* remaining words form the title *)
token     = person | jira | parent | taskref | date | priority | later | kind | followup | label ;
person    = "@" , ident ;                           (* owner; first @ wins, later @s become person links *)
jira      = "#" , project , "-" , digits ;          (* jira link, primary if first *)
parent    = "^" , taskref ;                          (* parent_id *)
taskref   = "T-" , digits ;                          (* bare ref inside a title → task link *)
date      = "!" , ( "today" | "tomorrow" | weekday | offset | iso ) ;   (* scheduled_on *)
weekday   = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" ;       (* next occurrence, today included *)
offset    = "+" , digits , ( "d" | "w" ) ;
iso       = digit4 , "-" , digit2 , "-" , digit2 ;
priority  = "!!" ;                                  (* priority high *)
later     = "/later" | "/l" ;
kind      = "/meeting" | "/m" ;
followup  = "/followup" | "/f" , [ ws , date ] ;    (* follow_up_at + category:follow_up *)
label     = "+" , ident ;
```

- The parser is pure and deterministic, with no I/O. It returns `{ intent, title, tokens[], diagnostics[] }`. Resolving tokens (people, Jira, task keys) is a separate step against caller-supplied lookups, so client and server share the logic.
- Dates are resolved with `todayIsoDate()` semantics in the workspace timezone (D29). The client passes its "today"; the server re-resolves with its own date and rejects mismatches of more than one day.

### 4.2 Ambiguity rules

| Case | Behavior |
|---|---|
| `@al` matches two or more developers | The preview shows a chooser; submit is blocked until one is picked. |
| `@name` matches nobody | An error diagnostic; submit is blocked. |
| `#KEY` not synced | A warning: "not synced — kept as text". Not linked (links require a synced issue). |
| Date in the past | A warning plus a confirm step on submit. |
| `T-n:` targets a deleted/unknown task | An error; submit is blocked. |
| Both `/later` and a `!date` | An error: "Later tasks have no date". |
| `/later` with `@person` | An error (P3-D14). |

### 4.3 UI

- `GlobalCaptureDialog` becomes one `CaptureBox` input with a live token-highlight preview and a structured summary (owner, date, links, labels) underneath. `DeskCaptureForm` and `TrackerCaptureForm` are retired. `NoteCaptureForm` stays reachable via `/note`.
- The server exposes `POST /api/capture { text, clientToday }`, which re-parses, resolves, then calls `TaskService.create` or `TaskEventsService.add`, and returns the created task or event. Copilot gets a matching `capture` tool (confirm-gated).

---

## 5. Wave 3c — Tasks screen, saved views, action items

### 5.1 Route and nav

- `NavPageId` changes `"desk"` → `"tasks"` (`shared/types.ts:1363-1373`). Persisted nav preferences containing `desk` are rewritten on read. `/desk` and `/manager-desk` normalize to `/tasks` in `App.tsx`.
- `ManagerDeskPage` becomes `TasksPage`: a view rail (built-ins + mine), a filter bar, a grouped list, and the `TaskDrawer`. Desk rhythm grouping survives as the "Today plan" view.

### 5.2 Saved views

- New table `task_saved_views(id, workspace_id, manager_account_id, name, definition_json, position, created_at, updated_at)`, unique on `(workspace_id, manager_account_id, name)`.
- The definition schema (Zod, in `shared/types.ts`):
  `{ filters: { owner?: "me"|"team"|"inbox"|accountId[], status?: TaskStatus[], labels?: string[], linkedJira?: bool, kind?: "task"|"meeting", later?: bool, scheduled?: DateRange, closed?: DateRange, staleDays?: number }, sort: "scheduled"|"updated"|"created"|"priority", group?: "owner"|"status"|"label"|"scheduled" }`.
- The server exposes `GET /api/tasks?viewDef=<base64url json>` (validated), which extends the existing `view` enum handler in `routes/tasks.ts`. The query is batched and indexed, with no all-history scans; `closed` ranges are required for closed tasks.
- Built-in views (code, not rows): **My tasks, Watching** (tracked by me, owned by developers), **Inbox, Follow-ups** (D13 predicate), **Meetings, Blocked, Stale** (no event in 5 days), **Later, Closed this week**.
- URL: `/tasks?view=<builtin-id|saved-id>` plus overrides (`owner, status, label, group, sort`), following the `view-params.ts` pattern. Each view is also listed in the Cmd+K palette.
- `/follow-ups` and `/meetings` keep their specialized layouts but are fed by the same view definitions.

### 5.3 Meeting action items

- The meeting drawer's "Add action item" creates a child task (`parent_id` = meeting, owner from `@person` via the capture grammar) and records a `created` event with `meta.parentKey`.
- Children are listed in the drawer's Children section. Closing a meeting does not close its children.

---

## 6. Wave 3d — Standup mode

### 6.1 Entry and layout

- `/team?mode=standup` (toggle in `TrackerBoardToolbar`, plus a palette command "Start standup"). One developer at a time: current task, planned tasks, blockers, and an events feed for the rolling window (24h, or 72h on Mondays, computed with `todayIsoDate()`).
- Feed event types: `status`, `blocker`, `update` (shared), `assign`, `created`, check-ins.

### 6.2 Key map

These are plain keys, active only when focus is not in a text field. There are no Cmd/Ctrl bindings, so there is no conflict with ⌘K/⌘J/⌘I (`App.tsx:762-770`).

| Key | Action |
|---|---|
| `→` / `n`, `←` / `p` | Next / previous developer |
| `j` / `k` | Next / previous task |
| `u` | Log a task update (composer opens on the focused task) |
| `c` | General remark → check-in for this developer |
| `v` | Toggle the composer between shared and private ("told them" vs. note to self) |
| `s` | Set as current |
| `d` | Done |
| `b` | Blocked (rationale required, reuses `StatusRationaleDialog`) |
| `a` | Add a task for this developer (capture box pre-filled with `@dev`) |
| `r` | Reassign |
| `y` | Accept the status suggestion (P3-D11) |
| `Enter` | Open the `TaskDrawer` |
| `?` | Key help overlay |
| `Esc` | Close the top layer; from the root, exit standup mode |

- Task updates (`u`) versus remarks (`c`) are distinct keys. Updates write task events; remarks write check-ins.
- Accessibility: roving tabindex over tasks, an `aria-live="polite"` announcement on developer switch, focus returns to the originating row when a drawer or dialog closes, and stacked layers form a focus-trap stack where only the top layer traps.

### 6.3 Hybrid person-day status

- The board DTO gains `statusSuggestion?: { status: "blocked"; reasonTaskKey: string }` when the developer's current task is `blocked` and their manual status is not.
- A badge appears on the roster card and in standup mode. Accepting it (click or `y`) sets the manual status with `reason` linking the task, as a `blocker` event. Attention signals are unchanged.

---

## 7. Wave 3e — Cross-cutting

### 7.1 Remove capacity

- Remove `capacityUnits` from tracker/workload DTOs and from `DeveloperCard`, `TrackerRosterBoard`, `DeveloperTrackerDrawer`, `DeveloperDrawerSections` and `utils.ts`. Remove the `overCapacity` signal (`team-tracker.service.ts:661`) and its mutation path.
- The DB column is left inert (dropped with the next routine schema cleanup). There are about 18 files to update, and the affected tests flip to assert absence.

### 7.2 Former-owner read access (revises D8)

- A developer can `GET /api/tasks/:key` and `/events` when they are the current owner **or** they authored at least one event on the task.
- The former-owner projection returns key, title, status, their own **shared** events, and nothing else: no other people's events, no private fields, no links, no children. Writes are rejected with 403.
- Reachable through deep links and the developer's own event references. My Day does not list these tasks.
- Privacy tests cover private events by the new owner or manager, links, and labels, all absent.

---

## 8. Wave 3f — Jira reconciliation and legacy drop

### 8.1 Jira reconciliation signals

- A read-only signal over linked tasks, computed from the synced `issues.status_category`:
  - **Resolved in Jira, open in LeadOS**: `status_category = 'done'` and the task is `open|active|blocked`.
  - **Closed in LeadOS, open in Jira**: the task is `done` and the primary Jira link is not `done` (7-day window).
- It appears as a "Jira drift" built-in view in Tasks, and as an attention item on Today. The signal never writes; the manager resolves it manually.

### 8.2 Drop `legacy_*` tables

- `npm run tasks:drop-legacy --workspace=server -- --workspace <id> [--apply]` is dry-run by default.
- It requires stage `2d`, `tasks_phase2_contracted_at` at least 30 days old, and a `p2_contract` marker. It creates a `pre-legacy-drop` backup, then drops `legacy_team_tracker_items`, `legacy_manager_desk_items` and `legacy_manager_desk_links`, and records a `p3_legacy_drop` marker.
- The contract tests are extended: startup migrations stay safe after the drop.

---

## 9. Deferred (not Phase 3)

| Item | Why deferred | Trigger to revisit |
|---|---|---|
| 1:1 workspace | Needs its own UX spec (agenda, recurrence). Phase 3 only surfaces `developer_notes` in the drawer. | After standup mode ships |
| Event-body FTS5 (D32) | `LIKE` search is adequate at current volume. | Search p95 above 300 ms |
| Timeline analytics | Depends on standup/event usage data. | Three months of Phase 3 event data |
| Developer Later | Decided no (P3-D14). | Developer requests |

---

## 10. Data model summary

| Change | Type | Destructive |
|---|---|---|
| `task_labels` | new table | no |
| `task_saved_views` | new table | no |
| `tasks_phase3_enabled` | config key | no |
| `capacity_units` | column left inert | no |
| `legacy_*` drop (3f) | CLI, gated | **yes** (backup first) |

There are no changes to `tasks` or `task_events`.

---

## 11. Testing

- **Parser:** a table-driven suite in `shared/capture-grammar.test.ts`, run from both workspaces. Covers every token, every ambiguity row in §4.2, timezone edges, and the `T-n:` update form.
- **Server:** routes for capture, labels (rename transaction and events, system-label protection), saved-view validation and query, former-owner projection, reconciliation signal, and drop-legacy gates and idempotency.
- **Client:** TaskDrawer section rendering (task vs. meeting, manager vs. developer), CaptureBox preview and diagnostics, TasksPage view switching and URL sync, a standup key map test per binding and focus return, and status suggestion accept.
- **Flag-off parity:** existing Phase 2 suites run unchanged with the flag off.
- **Validation per wave:** `npm run typecheck`, `npm run build:check`, `npm run test`.

---

## 12. Rollout

1. Merge the waves in order (3a → 3f), each behind `tasks_phase3_enabled`.
2. Enable on the sandbox and validate manually in the browser.
3. On prod (stage `2c`/`2d`): `npm run tasks:phase3 --workspace=server -- --workspace default --enable`.
4. Rollback means `--disable`. No data changes, so it is fully reversible.
5. The legacy drop (3f) is run separately, at least 30 days after the 2d contract.
