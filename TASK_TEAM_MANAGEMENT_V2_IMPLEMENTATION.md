# LeadOS Task & Team Management v2: Implementation Spec (Phase 1) and Migration Plan (Phase 2)

_Companion to `TASK_TEAM_MANAGEMENT_REVIEW.md`, which is now the agreed direction. Covers Phase 1 (a buildable spec) and Phase 2 (a migration plan). Phase 0 is out of scope. Grounded in the code at commit `9e83b0b`. No files were modified to produce this document._

---

## 0. Conventions, preconditions, glossary

**Citations.** `path:line` or `path:start-end`, relative to the repo root.

**Precondition: Phase 0 items 1–9 (review §7) are merged.** Phase 1 does not depend on *how* Phase 0 was implemented, with two exceptions:
- **Phase 0 #2** (`syncManagerDeskItem` moves the Tracker row instead of deleting and re-creating it). Phase 1 key inheritance works whether or not this landed. If Tracker rows are still re-created, the new row inherits the Desk item's key (§1.2.3).
- **Phase 0 #4** (carry-forward moves rows instead of copying them). If copying still exists, copies inherit the source key (§1.2.3).

**Glossary.**

| Term | Meaning |
|---|---|
| Legacy row | A row in `team_tracker_items` (`server/src/db/schema.ts:177-192`) or `manager_desk_items` (`schema.ts:250-271`). |
| Task key | The human handle `T-<n>` introduced in Phase 1. It is the stable identity across all legacy rows of one task. |
| Key group | All legacy rows sharing one task key: a Desk row, its mirrored Tracker row, and legacy carry copies. |
| Viewer | The principal reading events: `{ kind: "manager", accountId }` or `{ kind: "developer", accountId }`. |
| Surface | A UI area plus its API: Team board, My Day, Today, Desk, Follow-ups/Meetings, search, palette, Copilot. |

**Existing mechanisms this spec reuses:**
- **Schema changes:** idempotent `ddl` plus the `alterStatements` array in `server/src/db/migrate.ts:6-481`, run at startup by `migrate()` (`migrate.ts:1060-1077`, called from `server/src/index.ts:44`).
- **Data migrations:** explicit CLIs in the style of `server/src/scripts/cleanup-manager-desk-carry-forward.ts` (dry-run by default, `--apply` to write), registered in `server/package.json:11`.
- **Backups:** `BackupService.createManualBackup(reason)` (`server/src/services/backup.service.ts:88-90`). It copies the whole SQLite file, so new tables are included automatically.
- **Idempotent client writes:** the `requestId` plus payload-hash pattern from notes (`server/src/services/daily-notes.service.ts:338-358`).
- **Local-date bucketing:** `todayIsoDate(date)` in `server/src/utils/date.ts:20-22`. All new server code MUST use it. Do not use `value.slice(0,10)` (the cause of B8).

---

# PART I: PHASE 1 SPEC

## 1.1 Scope and non-goals

**In scope (review items 10–15):**
- Task keys, including `/t/:key` resolution and Cmd+K search.
- An append-only `task_events` timeline with enforced visibility.
- Automatic event emission from the existing services.
- Import of legacy `note` and `context_note` content into events.
- Inline standup updates.
- Check-in ↔ task references.
- `created_by` provenance and Tracker reassignment.
- Notes → task actions.
- Status updates with a rationale.

**Not in scope:**
- The `tasks` table, unified statuses, and removing the Desk↔Tracker mirror (all Phase 2).
- Capture redesign (Phase 3).

Phase 1 is purely additive. No legacy column is dropped, and no legacy semantics change except the two listed in §1.2.4 and §1.3.8.

**Feature flag.** A config key `tasks_phase1_enabled` (`config` table, `schema.ts:105-111`), default absent (= off).
- **While off:** no keys are allocated, no events are emitted, and the new endpoints return `404`.
- **Turned on:** by the Phase 1 migration CLI (§1.6) after key assignment succeeds.

This avoids the ordering problem where new rows would take low key numbers before legacy rows are numbered.

---

## 1.2 Task identity: task keys (item 10)

### 1.2.1 DDL (append to the `ddl` string in `server/src/db/migrate.ts`, after `user_nav_preferences`, around `migrate.ts:333`)

```sql
CREATE TABLE IF NOT EXISTS task_key_sequences (
  workspace_id TEXT PRIMARY KEY,
  next_value   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_key_aliases (
  workspace_id TEXT NOT NULL,
  alias_key    TEXT NOT NULL,
  task_key     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, alias_key)
);

CREATE TABLE IF NOT EXISTS data_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL,
  report_json TEXT
);
```

**Append to `alterStatements` (`migrate.ts:429-481`).** `ADD COLUMN` duplicates are tolerated by `isExpectedMigrationError`, `migrate.ts:586-589`.

```ts
"ALTER TABLE team_tracker_items ADD COLUMN task_key TEXT",
"ALTER TABLE team_tracker_items ADD COLUMN created_by_type TEXT",
"ALTER TABLE team_tracker_items ADD COLUMN created_by_id TEXT",
"ALTER TABLE manager_desk_items ADD COLUMN task_key TEXT",
"ALTER TABLE manager_desk_items ADD COLUMN created_by_type TEXT",
"ALTER TABLE manager_desk_items ADD COLUMN created_by_id TEXT",
"CREATE INDEX IF NOT EXISTS idx_tracker_items_workspace_task_key ON team_tracker_items(workspace_id, task_key)",
"CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_desk_items_workspace_task_key ON manager_desk_items(workspace_id, task_key) WHERE task_key IS NOT NULL",
```

Why the two indexes differ:
- **Tracker `task_key` is not unique**, because legacy carry copies share a key.
- **Desk `task_key` is unique.** Legacy Desk lineage copies (`source_item_id` chains, `manager-desk.service.ts:1381-1428`) receive a key only on the canonical row (§1.6.2).

Also update:
- `workspaceOwnedTables` (`migrate.ts:591-616`): add `task_key_aliases`. The other new tables are created with `workspace_id`.
- Drizzle `server/src/db/schema.ts`: mirror all new columns and tables.
- `server/tests/helpers/db.ts:4-43`: add `DELETE FROM` for each new table and `sqlite_sequence` entries.

### 1.2.2 Key format and allocation

| Rule | Value |
|---|---|
| Format | `T-` followed by a decimal integer, no zero padding: `T-7`, `T-142`. Canonical form is uppercase. Input is accepted case-insensitively and trimmed (regex `^[Tt]-(\d{1,9})$`). |
| Scope | Per workspace. The same key may exist in two workspaces. |
| Allocation | New `server/src/services/task-keys.service.ts` → `allocate(workspaceId): string`. It runs inside the caller's `runInTransaction` (`server/src/db/transaction.ts:5-29`). |
| Monotonic, never reused | Deleting rows never frees a key. |

Allocation SQL (SQLite ≥ 3.35 RETURNING is already relied on via Drizzle `.returning()`, e.g. `team-tracker.service.ts:1394`):

```sql
INSERT INTO task_key_sequences (workspace_id, next_value) VALUES (?, 2)
ON CONFLICT(workspace_id) DO UPDATE SET next_value = next_value + 1
RETURNING next_value - 1 AS value;
```

`resolve(workspaceId, rawKey)` normalises the key, follows `task_key_aliases` at most one hop, and returns the canonical key or `null`.

### 1.2.3 Key assignment rules (exhaustive)

| Event | Code site | Key rule |
|---|---|---|
| Desk item created | `ManagerDeskService.createItem` `server/src/services/manager-desk.service.ts:452-534` | `allocate()`. Set `created_by_*` from the actor (§1.8, item 13). |
| Tracker item created directly (drawer, global capture, My Day, Copilot `assign_tracker_task`) | `TeamTrackerService.addItem` `server/src/services/team-tracker.service.ts:1346-1397` | If `params.managerDeskItemId` is set, **inherit the Desk item's key**. Otherwise `allocate()`. |
| Mirror re-created or updated from Desk | `syncManagerDeskItem` `team-tracker.service.ts:1399-1456` (the update branch 1432-1441 and the re-add branch 1448-1454) | Always set to the Desk item's key. |
| Legacy carry copy (if Phase 0 #4 kept copying) | `carryForwardTrackerOnlyItems` `team-tracker.service.ts:3080-3092` | Copy the source row's `task_key`. |
| Promote Tracker → Desk | `createManagerDeskItemFromTrackerItem` `manager-desk.service.ts:2151-2214` | The new Desk row **adopts the Tracker row's key**. It does NOT allocate. One task, one key. |
| Desk item deleted while delegated (Tracker row unlinked) | `unlinkManagerDeskItem` `team-tracker.service.ts:1458-1472` | The Tracker row keeps the key. |
| Notes → Create follow-up | `daily-notes.service.ts:527-535` (calls `createItem`) | Via `createItem`: `allocate()`. `created_by_type = 'note'`. |
| Today `capture_follow_up` | `today.service.ts:401-409` | Via `createItem`: `allocate()`. `created_by_type = 'today'`. Also replace the context string `Tracker item ${id}` / `Source Manager Desk item ${id}` (`today.service.ts:1305-1309`) with `Follow-up for T-<n>`, using the target's `taskKey`. |

### 1.2.4 Behaviour change 1: live grouping uses the key

`buildLiveWorkspaceItemKey` (`team-tracker.service.ts:503-514`) becomes:

```ts
if (item.taskKey) return `task:${item.taskKey}`;
if (item.managerDeskItemId !== null) return `manager_desk:${item.managerDeskItemId}`;
return `tracker:${buildCarryForwardKey(item)}`;
```

This takes note and title edits out of identity for every keyed row, which fixes B6 and B10 for new work. Legacy rows are keyed so that the displayed grouping does not change on day one (§1.6.2).

`buildRemainingCarryForwardMap` (`team-tracker.service.ts:2807-2842`) switches to counting by `task_key` when present, for the same reason.

### 1.2.5 DTO additions (`shared/types.ts`)

```ts
// TrackerWorkItem (shared/types.ts:558-577) gains:
taskKey: string | null;            // null only while tasks_phase1_enabled is off / before migration
createdBy?: TaskActorRef;          // item 13
latestEvent?: TaskEventSummary;    // item 12 (viewer-filtered, see §1.3.6)
ageDays?: number;                  // item 12

// ManagerDeskItem (shared/types.ts:867-890) gains:
taskKey: string | null;
createdBy?: TaskActorRef;

// TodayActionTarget (shared/types.ts:251-263) gains:
taskKey?: string;

export interface TaskActorRef {
  type: "manager" | "developer" | "copilot" | "note" | "today" | "system" | "unknown";
  id?: string;
}
```

`shared/types.ts` gains runtime constants (`TASK_EVENT_TYPES`, `TASK_KEY_PATTERN`). Per AGENTS.md, regenerate `shared/types.js` with the documented `npx tsc …` command.

---

## 1.3 The `task_event` contract (item 11)

### 1.3.1 DDL (append to `ddl`)

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  task_key     TEXT NOT NULL,
  type         TEXT NOT NULL,
  body         TEXT,
  visibility   TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
  author_type  TEXT NOT NULL CHECK (author_type IN ('manager', 'developer', 'copilot', 'system')),
  author_id    TEXT,
  meta_json    TEXT,
  source_table TEXT,
  source_id    INTEGER,
  dedupe_key   TEXT,
  occurred_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  redacted_at  TEXT,
  redacted_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_events_workspace_key_time ON task_events(workspace_id, task_key, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace_author ON task_events(workspace_id, author_type, author_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_workspace_dedupe ON task_events(workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
```

**Style note.** Existing DDL has no `CHECK` constraints. Validation normally lives in Zod and services. The two `CHECK`s here are deliberate defence in depth on the privacy-relevant columns (decision D7).

**Column semantics:**
- `occurred_at` is when the thing happened (approximate for imports).
- `created_at` is the insert time.
- `source_table` / `source_id` record the legacy row that produced a system or imported event, for audit only. Reads never join on them.
- `dedupe_key` holds either `req:<clientRequestId>` for client writes or `imp:<…>` / `p2:<…>` for migrations.

### 1.3.2 Event types (final)

```ts
export const TASK_EVENT_TYPES = [
  "created", "update", "instruction", "decision", "blocker",
  "status", "assign", "focus", "title", "schedule", "link",
  "checkin_ref", "note_ref", "merged",
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];
```

The review's `close` / `reopen` are folded into `status` (decision D5). `merged` is emitted only by migration tooling.

### 1.3.3 `meta` shape per type (`meta_json` is `JSON.stringify` of the listed type; `null` means the column is NULL)

```ts
type ImportRef = {
  field: "tracker_note" | "desk_context_note";
  sourceTable: "team_tracker_items" | "manager_desk_items";
  sourceId: number;
  sectionDate: string | null;   // YYYY-MM-DD for dated sections, null for legacy body / tracker note
  approximateTime: true;
};

type TaskEventMeta = {
  created:     { source: "desk" | "tracker" | "my_day" | "note" | "copilot" | "today" | "promote" | "import";
                 ownerType: "manager" | "developer" | null; ownerId: string | null;
                 title: string; jiraKeys?: string[] };
  update:      { via?: "standup" | "task_drawer" | "my_day" | "notes_page" | "copilot" | "note_field" | "context_note_field";
                 imported?: ImportRef; checkInId?: number } | null;
  instruction: { via?: "standup" | "task_drawer" | "notes_page" | "copilot" } | null;
  decision:    { via?: "standup" | "task_drawer" | "notes_page" | "copilot" } | null;
  blocker:     { action: "raised" | "cleared"; developerDayStatus?: TrackerDeveloperStatus; checkInId?: number };
  status:      { domain: "tracker_state" | "desk_status"; from: string | null; to: string;
                 reason?: "user" | "desk_sync" | "reassigned" | "single_current" | "migration"; outcome?: string };
  assign:      { fromType: "manager" | "developer" | null; fromId: string | null;
                 toType: "manager" | "developer" | null; toId: string | null;
                 stateReset?: { from: string; to: string } };
  focus:       { action: "set_current" | "unset_current"; date: string };
  title:       { from: string; to: string };
  schedule:    { field: "day" | "follow_up_at" | "planned_start_at" | "planned_end_at";
                 from: string | null; to: string | null;
                 via: "carry_forward" | "reschedule" | "snooze" | "edit" | "reassign" };
  link:        { action: "added" | "removed"; kind: "jira" | "person" | "external"; ref: string;
                 role?: "primary" | "related" };
  checkin_ref: { checkInId: number; date: string; developerAccountId: string; excerpt: string /* ≤200 chars */ };
  note_ref:    { noteId: number; noteDate: string; relation: "mentioned" | "created_from" | "update_from"; excerpt?: string };
  merged:      { survivorKey: string; mergedKey: string; decisionRef: string };
};
```

**Body rules:**

| Type | `body` |
|---|---|
| `update`, `instruction`, `decision` | Required, 1–4000 characters after trim. The limit is larger than the Tracker note's 2000 (`routes/team-tracker.ts:170`). |
| `blocker` | Required when `action = raised`. Optional when `cleared`. |
| All other types | Must be `NULL`. |

Server validation lives in one Zod discriminated union in `task-events.service.ts`. Invalid meta → `400`.

### 1.3.4 Authorship rules

| Actor | `author_type` | `author_id` | Allowed types when user-initiated |
|---|---|---|---|
| Manager (UI or API) | `manager` | `req.auth.user.accountId`, which is the username for managers (`server/src/services/auth.service.ts:73`) | `update`, `instruction`, `decision`, `blocker` |
| Developer (My Day) | `developer` | `req.auth.user.developerAccountId` | `update`, `blocker` only |
| Copilot write tool | `copilot` | the manager's account id (`server/src/assistant/tools.ts:49`, `assistant/service.ts:384`) | `update`, `instruction`, `decision`, `blocker` |
| Service side effects | `system` | NULL (or the acting user id when known, for audit) | `created`, `status`, `assign`, `focus`, `title`, `schedule`, `link`, `checkin_ref`, `note_ref`, `merged` |

System events carry the *initiating* principal in `author_id` when one exists. For example, a manager changing state yields `author_type='system', author_id='<manager>'`.

### 1.3.5 Visibility rules

| Type | Default visibility | Who may override |
|---|---|---|
| `update`, `instruction`, `decision`, `blocker` (manager or Copilot) | `shared` | Manager or Copilot may pass `private`. |
| `update`, `blocker` (developer) | `shared`, **forced** | Nobody. |
| `created`, `status`, `assign`, `focus`, `title`, `link` | `shared` | Nobody. |
| `schedule` with `field = follow_up_at` | `private`, forced (manager reminders) | Nobody. |
| `schedule`, any other field | `shared` | Nobody. |
| `checkin_ref` | `shared` (check-ins are already visible on My Day via `MyDayResponse.checkIns`, `shared/types.ts:753`) | Nobody. |
| `note_ref` | `private`, **forced** (notes are manager-private, AGENTS.md) | Nobody. |
| Imported `desk_context_note` | `private` (the Desk is manager-only, `routes/manager-desk.ts:245`) | Nobody. |
| Imported `tracker_note` | `shared` (it was already visible to and editable by the developer, `my-day.service.ts:75-86`) | Nobody. |
| `merged` | `shared` | Nobody. |

**Read predicate (normative).**

A **manager** viewer M sees an event E when:
```
E.visibility = 'shared' OR E.author_id = M.accountId
```

So private means **author-only** (decision D34), not "all managers". Imported Desk notes get `author_id` = the Desk day's `manager_account_id` (`schema.ts:243`). `note_ref` events get `author_id` = the note owner.

A **developer** viewer D sees an event E when:
```
E.visibility = 'shared' AND task(E.task_key) is currently owned by D
```

**"Currently owned by D"** means: the key group's latest Tracker row (by day date, then `updated_at`, then `id`, i.e. the order of `compareTrackerRowsByRecency`, `team-tracker.service.ts:516-540`) sits on a `team_tracker_days` row with `developer_account_id = D`. Former owners lose access (decision D8). When the task is not owned by D, the service returns `404`, not `403`, so keys cannot be probed.

Redaction does not change visibility. A redacted event that passes the predicate is returned as `{ id, type, redacted: true, occurredAt, authorType }`, with `body` and `meta` stripped, for both viewer kinds.

### 1.3.6 Where visibility is enforced (normative)

1. **One module owns the table.** Only `server/src/services/task-events.service.ts` may import `taskEvents` from `schema.ts` or issue SQL against `task_events`. The Phase 2 migration CLI is the single allow-listed exception.

   This is enforced by a new architecture test, `server/tests/task-events.boundary.test.ts`. It reads every file under `server/src/` and fails if `taskEvents` or `task_events` appears outside the allow-list.

2. **Write path.** `TaskEventsService.append(input, actor)` computes the final visibility from §1.3.5 and ignores any client-supplied visibility for forced cases. For developers:
   - It **rejects** `visibility: "private"` with `400`, so the client learns its expectation was wrong.
   - It rejects `instruction` / `decision` with `403`.

3. **Read path.** Every read takes a `viewer`:
   - `list(taskKey, viewer, {cursor, limit})`
   - `latestForKeys(keys, viewer)`
   - `get(eventId, viewer)`

   The predicate from §1.3.5 is applied **in SQL** in this service. There is no unfiltered read method.

4. **Viewer construction lives in the caller service, never in the route or client:**
   - `MyDayService` always builds `{kind:"developer", accountId}` from its `accountId` argument (`server/src/services/my-day.service.ts:29-52`).
   - `TeamTrackerService.getDeveloperDayView` (`team-tracker.service.ts:1194-1234`) and `getBoard` gain a required `viewer` option. The existing `includeManagerNotes: false` flag used by My Day (`my-day.service.ts:30-32`) is replaced by `viewer.kind === "developer"`, which also strips `managerNotes`.
   - Routes do not choose the viewer. The manager router `/api/tasks` is mounted behind `requireManager` (`server/src/middleware/auth.ts:73-88`). The developer endpoints live under `/api/my-day` behind `requireDeveloper` (`auth.ts:56-71`, `routes/my-day.ts:102`).

5. **Aggregates.** Board and My Day payloads use `latestForKeys` with the viewer from point 4. `/api/search` is manager-only (`server/src/app.ts:160`) and uses the manager viewer.

6. **Copilot.** Tool context carries the manager id. Read tools call the service with `{kind:"manager", accountId: ctx.managerAccountId}`.

7. **Client.** The UI renders a visibility badge but is **not** trusted for enforcement.

### 1.3.7 Append-only rules

- **No UPDATE of `body`, `type`, `meta_json`, `occurred_at` or `task_key` after insert.** Phase 2 alias repointing adds `task_id` but never rewrites `task_key`.
- **Corrections (manager only):**
  - `PATCH /api/tasks/:key/events/:id` with `{ visibility }` changes visibility on events whose `author_id` equals the caller and whose type is overridable.
  - `DELETE /api/tasks/:key/events/:id` redacts: sets `redacted_at` / `redacted_by`, and nulls `body` and `meta_json`. Allowed for the author only, within 30 days. Developers cannot redact (decision D6).
- **Idempotency.** Client writes send `requestId` (UUID). The server stores `dedupe_key = 'req:' || requestId`.
  - Same payload replayed → `200` with the existing event.
  - Different payload → `409 "requestId was already used with a different payload"`. This mirrors `daily-notes.service.ts:353-357`.

### 1.3.8 Automatic emission points (behaviour change 2: legacy `note` / `context_note` writes become events)

All emissions happen inside the same `runInTransaction` as the mutation, and only when `tasks_phase1_enabled` is on.

| Mutation | Code site | Event(s) |
|---|---|---|
| Tracker `addItem` | `team-tracker.service.ts:1346-1397` | `created` (source per caller). If `params.note` is set, also an `update` with `via:'note_field'`. |
| Tracker `updateItem` state change | `team-tracker.service.ts:1513-1538` | `status {domain:'tracker_state'}`. For `in_progress`, also `focus set_current`. |
| Demotions in `setSingleInProgressForDay` | `team-tracker.service.ts:3224-3232` | For each demoted row: `status in_progress→planned, reason:'single_current'` plus `focus unset_current`. |
| `setCurrentItem` | `team-tracker.service.ts:1579-1609` | `status` (if changed) plus `focus set_current`. |
| Tracker title change | `team-tracker.service.ts:1506` | `title`. |
| Tracker `note` change (legacy API path, still accepted) | `team-tracker.service.ts:1507-1512`, also via My Day `my-day.service.ts:75-86` and Copilot `update_tracker_item` `tools.ts:1335-1372` | `update {via:'note_field'}`, body = new note. Clearing the note emits nothing. The column is still written, for compatibility (decision D10). Author = actor. |
| Tracker `deleteItem` | `team-tracker.service.ts:1559-1577` | `status {from: <state>, to:'deleted'}`. Events are kept. |
| `syncManagerDeskItem` date or assignee change | `team-tracker.service.ts:1426-1454` | `assign` (when the developer changes, with `stateReset` if the state changed) and/or `schedule {field:'day'}`. |
| Tracker carry copy | `team-tracker.service.ts:3049-3099` | `schedule {field:'day', via:'carry_forward'}` |
| Tracker reassign (new, item 13) | new, §1.4.7 | `assign` plus optionally `status reason:'reassigned'` |
| Desk `createItem` | `manager-desk.service.ts:452-534` | `created`. If `contextNote` is set, also `update {via:'context_note_field'}` (private). |
| Desk `updateItem` | `manager-desk.service.ts:536-650` | One event per changed field: `status {domain:'desk_status'}`, `title`, `assign`, `schedule` (`planned_start_at`, `planned_end_at`, `follow_up_at`). `contextNote` change → `update {via:'context_note_field'}` (private). `outcome` set → `decision` with body = outcome. |
| Desk `addLink` / `deleteLink` | `manager-desk.service.ts:693-790` | `link`. `external_group` maps to `kind:'external'`; a developer link maps to `kind:'person'`. |
| Desk `carryForward` / `moveLinkedItemsToDate` / reschedule | `manager-desk.service.ts:864-976` | `schedule {field:'day', via:'carry_forward' \| 'reschedule'}` plus time-field `schedule` events |
| Desk `cancelDelegatedTask` | `manager-desk.service.ts:664-691` | `status {domain:'desk_status', to:'cancelled'}` |
| Desk `deleteItem` | `manager-desk.service.ts:652-662` | `status {domain:'desk_status', to:'deleted'}` |
| Promote | `manager-desk.service.ts:1196-1211` | `created {source:'promote'}` on the *existing* key, with `ownerType:'developer'` |
| Today `snooze` | `today.service.ts:367-376` | Through `updateItem`: `schedule {field:'follow_up_at', via:'snooze'}` |
| Check-in with task refs | §1.4.5 | `checkin_ref` per referenced key |
| Status update with `taskKey` | §1.4.8 | `blocker raised/cleared` |
| Note mentions `T-<n>` | §1.4.9 | `note_ref mentioned` (once per note and key) |

---

## 1.4 API (Phase 1)

All request bodies are validated with Zod in the route file (convention: `server/src/middleware/validate.ts`). Errors keep the `{ error, status }` shape (AGENTS.md).

### 1.4.1 New manager router `server/src/routes/tasks.ts`

Mounted in `server/src/app.ts` next to search (`app.ts:160`):

```ts
app.use("/api/tasks", requireManager(services.authService), createTasksRouter(services.taskEventsService, services.taskKeysService, services.teamTrackerService, services.managerDeskService));
```

`AppServices` (`app.ts:90-108`) and the bootstrap (`server/src/index.ts:73-125`) gain `taskKeysService` and `taskEventsService`.

| Method and path | Purpose | Request | Response |
|---|---|---|---|
| `GET /api/tasks/:key` | Resolve a key, used by `/t/:key` and the palette | — | `200 TaskResolution` / `404` unknown / `410` all rows deleted |
| `GET /api/tasks/:key/events?cursor=&limit=` | Timeline, newest first | `limit` 1–100 (default 50). `cursor` is an opaque event id. | `200 { events: TaskEvent[]; nextCursor: string \| null }` |
| `POST /api/tasks/:key/events` | **Manager "add update"** | `AddTaskEventRequest` | `201 TaskEvent` (`200` on idempotent replay) |
| `PATCH /api/tasks/:key/events/:eventId` | Change visibility | `{ visibility: "shared" \| "private" }` | `200 TaskEvent` |
| `DELETE /api/tasks/:key/events/:eventId` | Redact | — | `200 { redacted: true }` |

```ts
export interface AddTaskEventRequest {
  type: "update" | "instruction" | "decision" | "blocker";
  body: string;                              // 1..4000 after trim
  visibility?: "shared" | "private";         // default per §1.3.5
  blockerAction?: "raised" | "cleared";      // required iff type === "blocker"
  via?: "standup" | "task_drawer";
  requestId: string;                         // uuid
}

export interface TaskEvent {
  id: number;
  taskKey: string;
  type: TaskEventType;
  body: string | null;
  visibility: "shared" | "private";
  author: { type: "manager" | "developer" | "copilot" | "system"; id?: string; displayName?: string };
  meta: unknown | null;                      // TaskEventMeta[type]
  occurredAt: string;
  approximateTime: boolean;                  // true for imports / synthesized
  redacted?: true;
}

export interface TaskEventSummary {
  id: number; type: TaskEventType; excerpt: string /* ≤160 */; authorType: TaskEvent["author"]["type"];
  occurredAt: string; approximateTime: boolean; visibility: "shared" | "private";
}

export interface TaskResolution {
  taskKey: string;                // canonical (after alias)
  requestedKey: string;
  title: string;
  kind: "tracker_only" | "delegated" | "desk_only";
  trackerItemId?: number;         // latest row of the key group
  managerDeskItemId?: number;     // canonical desk row
  developer?: Developer;          // owner, when tracker row exists
  date: string;                   // day of the latest tracker row, else desk day
  state?: TrackerItemState;
  status?: ManagerDeskStatus;
  deleted: boolean;
}
```

**Resolution algorithm (`TaskKeysService.resolveTask`):**
1. Normalise and alias-resolve the key.
2. Load Desk rows by `(workspace_id, task_key)` (at most one, by the unique index).
3. Load Tracker rows by key, ordered with `compareTrackerRowsByRecency`.
4. Classify:
   - `delegated` if the latest Tracker row has `manager_desk_item_id` equal to the Desk row id.
   - `tracker_only` if there are Tracker rows only.
   - `desk_only` if there is a Desk row only.
5. If neither kind of row exists but events do, return `410` with the last `created.title` from events.

### 1.4.2 New developer endpoints (added to `server/src/routes/my-day.ts`, behind `requireDeveloper`)

| Method and path | Purpose | Request | Response |
|---|---|---|---|
| `GET /api/my-day/tasks/:key/events?cursor=&limit=` | Timeline (shared only, owner only) | — | `200 { events; nextCursor }` / `404` |
| `POST /api/my-day/tasks/:key/events` | **Developer "add update"** | `{ date: YYYY-MM-DD; type: "update" \| "blocker"; body: string; blockerAction?: "raised" \| "cleared"; requestId: string }` | `201 TaskEvent` / `403` (disallowed type) / `404` (not owner) / `409` (read-only day) |

The service path is `MyDayService.addTaskEvent(accountId, key, input)`. It:
- calls `assertWritable(accountId, date)` (`my-day.service.ts:143-159`), so inactive and history days are read-only exactly like item edits;
- asserts current ownership (§1.3.5);
- calls `taskEvents.append(..., {type:"developer", accountId})`.

### 1.4.3 Payload additions to existing endpoints

| Endpoint | Change |
|---|---|
| `GET /api/team-tracker` (`routes/team-tracker.ts:248-289`) | Each `TrackerWorkItem` gains `taskKey`, `createdBy`, `latestEvent` (manager viewer) and `ageDays`. `ageDays` = `todayIsoDate()` minus the local date of the key group's minimum `created_at`, in days. |
| `GET /api/my-day` (`routes/my-day.ts:114-123`) | Same fields. `latestEvent` uses the developer viewer, so shared only. |
| `GET /api/manager-desk` and item detail (`routes/manager-desk.ts:247-301`) | `ManagerDeskItem.taskKey`, `createdBy` |
| `GET /api/manager-desk/tracker-items/:id/detail` (`routes/manager-desk.ts:256-271`) | `trackerItem.taskKey` (the client uses it to load the timeline) |
| `GET /api/search` (`routes/search.ts:22-33`) | `GlobalSearchResponse` (`shared/types.ts:1007-1014`) gains `tasks: GlobalSearchTaskItem[]` (see §1.4.6) |
| `GET /api/today` | `TodayActionTarget.taskKey` is populated wherever `trackerItemId` or `managerDeskItemId` is set (`today.service.ts:588-601,647-660,844-846`) |

### 1.4.4 Deprecated but still accepted in Phase 1

- `note` on `PATCH /api/team-tracker/items/:id` (`routes/team-tracker.ts:163-174`) and on `PATCH /api/my-day/items/:id` (`routes/my-day.ts:42-61`).
- `contextNote` on Desk create and patch (`routes/manager-desk.ts:108,160`).

Each write emits an event as specified in §1.3.8. The UI stops sending these fields (§1.7). Removal happens in Phase 2 contract stage 2d.

### 1.4.5 Check-in ↔ task references

**DDL (append to `ddl`):**

```sql
CREATE TABLE IF NOT EXISTS checkin_task_refs (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  checkin_id   INTEGER NOT NULL,
  task_key     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, checkin_id, task_key),
  FOREIGN KEY (checkin_id) REFERENCES team_tracker_checkins(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkin_task_refs_key ON checkin_task_refs(workspace_id, task_key);
```

`foreign_keys` is ON (`server/src/db/connection.ts:12`). A workspace reset that deletes check-ins (`server/src/services/workspace-maintenance.service.ts:247-249`) therefore cascades to the refs.

**Request changes.** Each gains `taskKeys?: string[]` (max 10; each must match `TASK_KEY_PATTERN` and resolve in the workspace, otherwise `400`):

- `POST /api/team-tracker/:accountId/checkins`: `addCheckInSchema` `routes/team-tracker.ts:194-204`
- `POST /api/my-day/checkins`: `routes/my-day.ts:83-93`. Keys must be owned by the developer, otherwise `400`.
- `POST /api/manager-actions/commands` with `command.kind = add_check_in`: body schema `routes/manager-actions.ts:57-68` gains `taskKeys`
- Copilot `manager_action` (`tools.ts:928-1030`) `add_check_in` args gain `taskKeys`

**Parsing.** The server also extracts `\bT-\d{1,9}\b` tokens (case-insensitive) from `summary`. It unions them with the explicit `taskKeys`, dedupes, silently drops unknown parsed tokens, and rejects unknown *explicit* keys (decision D25).

**Effects** (inside `TeamTrackerService.addCheckIn`, `team-tracker.service.ts:1611-1673`):
- one `checkin_task_refs` row per key;
- one `checkin_ref` event per key, shared, `author` = the check-in actor.

**Response.** `TrackerCheckIn` (`shared/types.ts:546-556`) gains `taskKeys: string[]`.

### 1.4.6 Search

`SearchService.search` (`server/src/services/search.service.ts:47-81`) gains a sixth parallel query, `searchTasks(workspaceId, managerAccountId, query)`:
1. **Exact key hit.** If `query` matches `TASK_KEY_PATTERN`, resolve it (with aliases) and return it first.
2. **Title match.** `LIKE` on `manager_desk_items.title` and `team_tracker_items.title` for keyed rows, grouped by key. Uses `sanitizeQuery` (`search.service.ts:33-35`).
3. **Event body match.** `LIKE` on `task_events.body` through `TaskEventsService.searchBodies(workspaceId, viewer, pattern, limit)`. The manager viewer predicate applies, so another manager's private events never match.

Limit is 6 (matching `DESK_ITEM_LIMIT`, `search.service.ts:26`).

```ts
export interface GlobalSearchTaskItem {
  taskKey: string; title: string; kind: TaskResolution["kind"];
  developerName?: string; state?: TrackerItemState; status?: ManagerDeskStatus;
  matchedIn: "key" | "title" | "event"; excerpt?: string; updatedAt: string;
}
```

Existing Desk-item search results stay for now. De-duplication rule: a Desk item whose key appears in `tasks` is removed from `deskItems`.

### 1.4.7 Tracker reassignment (item 13)

`POST /api/team-tracker/items/:itemId/reassign`, manager only.

- **Request:** `{ toAccountId: string; date: YYYY-MM-DD; requestId: string }`
- **Response:** `200 TrackerWorkItem`

**Service `TeamTrackerService.reassignItem`:**
1. `409` if the row has `manager_desk_item_id`. Delegated tasks are reassigned from the Desk assignee, which already moves the mirror after Phase 0 #2.
2. `409` if the state is `done` or `dropped` (decision D12).
3. `availability.assertAvailableForDate(toAccountId, date)` (the pattern at `team-tracker.service.ts:1359`).
4. `ensureDay(date, toAccountId)`.
5. `UPDATE team_tracker_items SET day_id = <new day>, position = <max+1>, state = CASE state WHEN 'in_progress' THEN 'planned' ELSE state END, updated_at = now`. The row id and `task_key` are preserved.
6. Emit `assign` (with `stateReset` when the state changed). Emit `schedule {field:'day', via:'reassign'}` if the date differs.

### 1.4.8 Status update with rationale (item 15)

`POST /api/team-tracker/:accountId/status-update` already exists (`routes/team-tracker.ts:481-508`, schema `206-229`). It gains `taskKey?: string`.

When `taskKey` is present, `recordStatusUpdate` (`team-tracker.service.ts:1675-1719`) additionally emits:
- `blocker {action:'raised', developerDayStatus}` when status is `blocked` / `at_risk` / `waiting`. Body = rationale.
- `blocker {action:'cleared'}` when status becomes `on_track` / `done_for_today` and the key's latest blocker event is `raised`.

The Copilot `record_status_update` (`tools.ts:1474-1523`) gains `taskKey`.

### 1.4.9 Notes → tasks (item 14)

**DDL:**

```sql
CREATE TABLE IF NOT EXISTS daily_note_task_refs (
  workspace_id       TEXT NOT NULL,
  manager_account_id TEXT NOT NULL,
  note_id            INTEGER NOT NULL,
  task_key           TEXT NOT NULL,
  relation           TEXT NOT NULL,
  request_id         TEXT,
  created_at         TEXT NOT NULL,
  PRIMARY KEY (note_id, task_key, relation),
  FOREIGN KEY (note_id) REFERENCES daily_notes(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_note_task_refs_request ON daily_note_task_refs(workspace_id, manager_account_id, request_id) WHERE request_id IS NOT NULL;
```

**Endpoints** (added to `server/src/routes/notes.ts`, which is already behind `requireManager`, `app.ts:161`):

| Method and path | Purpose | Request | Effects |
|---|---|---|---|
| `POST /api/notes/:date/task-updates` | "Add as update to task…" | `{ taskKey; text (1..4000); type?: "update" \| "instruction" \| "decision"; visibility?: "shared" \| "private" (default **private**, because note content is private by default); requestId }` | Appends the event with `via:'notes_page'` and `note_ref {relation:'update_from'}` (private). Inserts a ref row. Idempotent via `request_id`. The note must exist (`404` otherwise, as at `daily-notes.service.ts:488-491`). |
| `POST /api/notes/:date/tasks` | "Create task for @dev" / "Create task" | `{ title (1..500); developerAccountId?: string; jiraKey?: string; context?: string (≤4000); requestId }` | With a developer: `TeamTrackerService.addItem(dev, todayIsoDate(), …)` with `created_by_type='note'`. Without one: `ManagerDeskService.createItem` with `status:'inbox'`. If `context` is present it becomes the first `update` (private) instead of being stuffed into the title. Emits `note_ref {relation:'created_from'}`. |

**Mention scanning.** Inside `DailyNotesService.save` (`daily-notes.service.ts:246-321`) and `append` (`323-417`), after a successful write:
1. Scan the body for `\bT-\d{1,9}\b`.
2. For each key that resolves and has no `(note_id, key, 'mentioned')` ref yet, insert the ref and a `note_ref {relation:'mentioned', excerpt: ±80 chars around the first occurrence}` event (private, author = note owner).

Removing a mention later does not delete the ref or the event, because events are append-only.

The existing follow-up path (`daily-notes.service.ts:482-555`) additionally emits `note_ref {relation:'created_from'}` on the new item's key. `daily_note_follow_ups` stays as-is until Phase 2.

---

## 1.5 Client: key display and `/t/:key`

**Routing** (`client/src/App.tsx`):
- `pathToView` (`App.tsx:101-112`) gains `if (/^\/t\/[Tt]-\d{1,9}\/?$/.test(pathname)) return 'task';`.
- `ResolvedAppView` gains `'task'`.
- `viewToPath` is unchanged. `'task'` is transient and never canonical.

**Resolution flow for a manager** (new `client/src/components/tasks/TaskLinkResolver.tsx`, rendered by `renderActiveView` when `activeView === 'task'`, inside `WorkspaceShell`):
1. Call `GET /api/tasks/:key` via a new `useTaskResolution(key)` hook in `client/src/hooks/useTasks.ts`, through `client/src/lib/api.ts`.
2. Branch on `kind`:
   - `tracker_only` or `delegated`: `replaceState` to `/team?task=<KEY>`, then set `activeView='team'`.
   - `desk_only`: `replaceState` to `/desk?date=<date>&task=<KEY>`.
3. On `410`, render "T-142 was deleted" with the last title. On `404`, render `NotFoundState` (`App.tsx:736-742`).

**`?task=` parameter:**
- `client/src/lib/view-params.ts` gains `taskKeyFromParams` / `taskKeyToParams`.
- `TeamTrackerPage` opens the developer drawer and then `TrackerTaskDetailDrawer` for the resolved `trackerItemId`, via the existing `initialDeveloperAccountId` path (`TeamTrackerPage.tsx:342-347`) plus a new `initialTaskKey`.
- `ManagerDeskPage` resolves the key to `initialItemId` (`ManagerDeskPage.tsx:37-46`).
- Opening a task drawer anywhere writes `?task=<KEY>` with `replaceState`. Closing it removes the parameter. Every open task therefore has a shareable URL.

**Developer.** `/t/:key` for a developer session redirects to `/my-day?task=<KEY>`. `MyDayPage` scrolls to and highlights the row if the developer owns the task, and otherwise shows nothing (the `404` from the developer endpoint). In production, both are served by the SPA fallback (`app.ts:184-186`).

**`handleOpenTodayTarget`** (`App.tsx:488-549`). When `target.taskKey` is present and the target view is `team`, pass the key through, so the target stops dropping `trackerItemId` (review §2.4).

**Display rules:**
- A key chip (monospace, `T-142`) in `TrackerItemRow` (`client/src/components/team-tracker/TrackerItemRow.tsx:147-231`) for every variant, including `drawer-planned`.
- In `DrawerHeader` (`client/src/components/manager-desk/DrawerHeader.tsx:94-96`), the key replaces `#{item.id}`.
- In the `TrackerOnlyDrawer` header (`client/src/components/team-tracker/TrackerTaskDetailDrawer.tsx:186-217`).
- In My Day `CurrentTask` / `PlannedQueue`.
- The chip copies `https://<host>/t/<KEY>` on click.

**Palette.**
- `client/src/components/palette/paletteItems.ts` gains a `'tasks'` group (`PaletteGroupId`, `paletteItems.ts:14`) with `taskToPaletteItem`, targeting `{ type: 'tracker_item' | 'manager_desk_item', taskKey, … }`.
- An exact key match is pinned first, ahead of the quick-add placement rule (`paletteItems.ts:137-142`).

---

## 1.6 Phase 1 data migration: keys and note import

### 1.6.1 Mechanism

A new CLI, `server/src/scripts/task-phase1-migrate.ts`, registered as `"tasks:phase1-migrate": "tsx src/scripts/task-phase1-migrate.ts"` in `server/package.json` (following `package.json:11`).

- **Default is dry-run.** It prints the report and writes nothing.
- **`--apply` runs, in one process:**
  1. `BackupService.createManualBackup("pre-task-phase1")`. Abort on failure.
  2. Key assignment (§1.6.2) inside one `BEGIN IMMEDIATE` transaction.
  3. Note import (§1.6.3) inside a second transaction.
  4. `INSERT INTO data_migrations(name, applied_at, report_json)` for `p1_assign_task_keys` and `p1_import_task_notes`.
  5. Set the config key `tasks_phase1_enabled = "true"` for every workspace processed.
- **Idempotent.** Keys are assigned only where `task_key IS NULL`. Imports are skipped by `dedupe_key`. Each step is skipped if its `data_migrations` row exists, unless `--force-step <name>` is passed.
- **Options:** `--workspace <id>` (default: all). `--report <path>` writes the JSON report.

### 1.6.2 Key assignment algorithm (legacy rows)

This is deterministic and needs no human input. The goal is **zero visible regrouping on the Team board**, plus one fix (recurring titles).

For each workspace:

**Step 1: Desk canonical rows.**
- Group Desk rows by lineage root, using the same rule as `resolveLineageRootId` (`manager-desk.service.ts:1405-1422`).
- Pick the canonical row with `selectCanonicalLineageRow` (`manager-desk.service.ts:1424-1428`).
- Canonical rows are key candidates. Non-canonical legacy rows keep `task_key = NULL` and are listed in the report under `deskLineageNonCanonical`. Phase 2 step B2 maps them.

**Step 2: Linked Tracker rows.**
- A Tracker row with `manager_desk_item_id` joins the candidate of that Desk row's lineage root.
- Linked Tracker rows never form their own candidate.

**Step 3: Tracker-only groups** (rows with `manager_desk_item_id IS NULL`), per developer (`team_tracker_days.developer_account_id`):
- `groupKey = buildCarryForwardKey(row)` (`team-tracker.service.ts:489-501`), i.e. `[jiraKey, relatedKeys, title, note]`. This is exactly what the live board merges on today (`team-tracker.service.ts:2642-2662`).
- Sort each group's rows by `(day.date, created_at, id)`.
- **Recurrence split:** start a new candidate at row `r` when every earlier row in the current candidate is closed (`done` / `dropped`) *and* the latest closure time (`completed_at` for done, `updated_at` for dropped) is **before** `r.created_at`. That pattern is a re-created task (e.g. a daily "Code review"), not a carry copy.

**Step 4: Ordering and numbering.**
- Order all candidates (Desk and Tracker) by their earliest `created_at`, then by the smallest row id.
- Assign `T-1…T-N` in that order and write `task_key` to every row of each candidate.
- Set `task_key_sequences.next_value = N + 1`.

**Step 5: Provenance.** Set `created_by_type = 'unknown'` on all legacy rows where it is NULL (decision D21).

**Report fields** (stdout plus JSON):
- per workspace: `deskCandidates`, `trackerCandidates`, `linkedTrackerRows`, `recurrenceSplits` (with row ids and titles), `deskLineageNonCanonical`, `maxKey`;
- `phase2ReviewHints`: groups that already look ambiguous (two rows on the same day inside one candidate; same `[jira, related, title]` but different note across candidates). These feed the Phase 2 review (§2.2.5) but are not acted on in Phase 1.

### 1.6.3 Note import algorithm

Implementation note (2026-09-24): repeated non-empty Desk sections for the same date use stable occurrence suffixes (`:2`, `:3`, etc.) on the import dedupe key. The first occurrence retains its original key. Source text remains unchanged.

**Parser.** A server port of the client parser `client/src/components/triage/triage-notes.ts:13-104`, placed in `server/src/services/task-notes-import.ts` (the server has no `date-fns`):
- Header regex: identical to `DATED_HEADER_PATTERN` (`triage-notes.ts:13`), i.e. `^(Jan|Feb|…|Dec) \d{1,2}, \d{4}:$`.
- Date parse: month-name table plus `Number(day)` and `Number(year)`, validated with a round-trip through `Date.UTC`. Invalid headers fall through into the body, matching `triage-notes.ts:71-79`.
- Output: `{ legacyBody, datedSections: {date, body}[] }` with the same `trimBlankLines` semantics.

**Desk `context_note` → events.** Canonical Desk rows only (step 1 above):

| Part | Event |
|---|---|
| `legacyBody` (non-empty) | `update`, private, author = Desk day `manager_account_id`, `occurred_at = row.created_at`, meta `imported {field:'desk_context_note', sectionDate:null}`, `dedupe_key = imp:dcn:<rowId>:legacy` |
| Each dated section | `update`, private, `occurred_at = <sectionDate>T12:00:00.000Z`, meta `imported {…, sectionDate}`, `dedupe_key = imp:dcn:<rowId>:<sectionDate>` |

**Tracker `note` → events.** Per key group, over all Tracker rows of the key sorted by `(day.date, updated_at, id)`:
- Take each distinct non-empty `note` in order and skip consecutive duplicates. Carry copies share notes (`team-tracker.service.ts:3089`).
- Each becomes `update`, **shared**, `author_type='system'`, `author_id` NULL, `occurred_at = row.updated_at`, meta `imported {field:'tracker_note', sourceId: row.id, sectionDate:null}`, `dedupe_key = imp:tn:<rowId>`.
- Authorship of the original text is unknowable (there is no author column), hence `system`.

**Not imported:**
- `next_action` and `outcome` are current-state fields (decision D11).
- `issues.analysis_notes` belongs to Jira, not tasks.

**Source columns are not modified.**

---

## 1.7 Standup rows (item 12): UI contract

**New components** in `client/src/components/tasks/`:
- `TaskKeyChip.tsx`
- `TaskTimeline.tsx`: a paginated event list with visibility badge, author, "imported / approximate" marker and redacted placeholder.
- `TaskUpdateComposer.tsx`: a single-line input. Enter submits and Shift+Enter inserts a newline. A three-way type toggle: **Update** (`update`), **Told them** (`instruction`), **Decision** (`decision`). A **Private** toggle maps to `visibility`. A `requestId` is generated per draft, following `NotesFollowUpDialog.tsx:76-79`.
- `useTasks.ts` hooks: `useTaskResolution`, `useTaskEvents(key)` (infinite query), `useAddTaskEvent(key)`, `useRedactTaskEvent`, `useUpdateTaskEventVisibility`, `useMyDayTaskEvents`, `useAddMyDayTaskEvent`.
- Every mutation invalidates `['team-tracker']`, `['my-day']`, `['manager-desk']` and `['task-events', key]` (pattern: `client/src/hooks/useTeamTrackerMutations.ts:113-120`).

**Developer drawer** (`client/src/components/team-tracker/DeveloperTrackerDrawer.tsx`):
- Current (`243-274`) and planned (`276-362`) rows render `TaskKeyChip`, `latestEvent.excerpt` with relative time (`formatRelativeTime` from `@/lib/utils`), and `ageDays`.
- **Each row has an inline `TaskUpdateComposer`**, collapsed to a one-line affordance and expanded on focus. It posts to `POST /api/tasks/:key/events` with `via:'standup'`.
- ↑/↓ moves focus between row composers. This is the minimum keyboard support; the full flow is Phase 3.
- The check-in footer (`491-531`) gains a task picker ("about: T-142, T-150"). It sends `taskKeys` and highlights parsed `T-###` tokens.
- The `drawer-planned` variant stops hiding context: the `!isDrawerPlanned` guards at `TrackerItemRow.tsx:300,308` no longer apply to `latestEvent`. The legacy note editor itself is removed; see below.

**Task drawer.** In `client/src/components/team-tracker/TrackerTaskExecutionPanel.tsx:162-230`, the "Execution Note" textarea is **replaced** by `TaskTimeline` plus `TaskUpdateComposer`. The `onUpdateNote` prop is removed. For delegated tasks, `ItemDetailDrawer` (`client/src/components/manager-desk/ItemDetailDrawer.tsx:175`) replaces `DrawerNotes` (the `TriageNotesEditor` over `context_note`, `DrawerNotes.tsx:11-28`) with the same timeline, so there is one record rather than three textareas.

**My Day.**
- `CurrentTask` (`client/src/components/my-day/CurrentTask.tsx:96-104`) and `PlannedQueue` show the key and the latest shared event.
- The note editor path (`useMyDayHandlers.ts:66-73` → `useUpdateMyDayItem` with `note`) is replaced by a composer calling `POST /api/my-day/tasks/:key/events`.
- `QuickUpdates` (`client/src/components/my-day/QuickUpdates.tsx`) gains the same task picker for check-ins.

---

## 1.8 File and test change matrix (items 10–15)

**Item 10: Task keys, `/t/:key`, search**
- **Server, changed:**
  - `server/src/db/migrate.ts` (ddl + alters)
  - `server/src/db/schema.ts`
  - `server/src/services/team-tracker.service.ts` (`addItem` 1346-1397, `syncManagerDeskItem` 1399-1456, `carryForwardTrackerOnlyItems` 3049-3099, `mapItem` 406-437, `buildLiveWorkspaceItemKey` 503-514, `buildRemainingCarryForwardMap` 2807-2842)
  - `server/src/services/manager-desk.service.ts` (`createItem` 452-534, `createManagerDeskItemFromTrackerItem` 2151-2214, `mapItem` 1939-1970)
  - `server/src/services/search.service.ts` (47-81)
  - `server/src/services/today.service.ts` (target builders 588-601, 647-660, 844-846; context string 1305-1309)
  - `server/src/routes/manager-actions.ts:19-37` (`taskKey` on the target schema)
  - `server/src/app.ts` (mount)
  - `server/src/index.ts` (wire services)
  - `server/package.json`
  - `shared/types.ts` + regenerated `shared/types.js`
  - `server/tests/helpers/db.ts`
- **Server, new:**
  - `server/src/services/task-keys.service.ts`
  - `server/src/routes/tasks.ts`
  - `server/src/scripts/task-phase1-migrate.ts`
- **Client, changed:**
  - `client/src/App.tsx` (101-112, 488-549, 689-839)
  - `client/src/lib/view-params.ts`
  - `client/src/components/team-tracker/TeamTrackerPage.tsx`
  - `client/src/components/manager-desk/ManagerDeskPage.tsx`
  - `client/src/components/team-tracker/TrackerItemRow.tsx`
  - `client/src/components/manager-desk/DrawerHeader.tsx:94-96`
  - `client/src/components/team-tracker/TrackerTaskDetailDrawer.tsx`
  - `client/src/components/my-day/CurrentTask.tsx`, `PlannedQueue.tsx`, `MyDayPage.tsx`
  - `client/src/components/palette/paletteItems.ts`
  - `client/src/components/palette/CommandPalette.tsx`
  - `client/src/hooks/useGlobalSearch.ts`
- **Client, new:**
  - `client/src/components/tasks/TaskKeyChip.tsx`
  - `client/src/components/tasks/TaskLinkResolver.tsx`
  - `client/src/hooks/useTasks.ts`
- **Tests:**
  - New `server/tests/task-keys.service.test.ts`: allocation monotonic per workspace; Desk→mirror inherits; promote adopts; carry copy keeps; aliases resolve one hop.
  - New `server/tests/tasks.routes.test.ts`: resolve kinds, 404/410, developer receives 403.
  - New `server/tests/task-phase1-migrate.test.ts`: §2.5 fixtures F1–F6 for keys.
  - Extended: `server/tests/search.service.test.ts`, `server/tests/search.routes.test.ts` (tasks group, exact key first, Desk de-dup); `server/tests/db.migrate.test.ts` (new DDL idempotent twice); `server/tests/multi-workspace-isolation.test.ts:115` (keys and events scoped).
  - Client: `client/src/test/App.test.tsx` (`/t/` resolution and redirect), `client/src/test/view-params.test.ts`, `client/src/test/paletteItems.test.ts`, `client/src/test/TeamTracker.test.tsx` (key chip, `?task=` opens drawer).

**Item 11: `task_events`, emission, import**
- **Server, changed:**
  - `server/src/db/migrate.ts`
  - `server/src/db/schema.ts`
  - Emission sites in §1.3.8: `server/src/services/team-tracker.service.ts`, `server/src/services/manager-desk.service.ts`, `server/src/services/my-day.service.ts`, `server/src/services/today.service.ts`
  - `server/src/services/workspace-maintenance.service.ts` (reset scope for events, decision D33)
  - `server/src/services/auth-user-maintenance.service.ts` (preview and delete a manager's private events; pattern at 218-262)
  - `server/src/assistant/tools.ts` (new `add_task_update` and `get_task` tools; `get_tracker_item_detail` and `get_desk_item_detail` include the latest 10 events)
- **Server, new:**
  - `server/src/services/task-events.service.ts`
  - `server/src/services/task-notes-import.ts`
- **Tests:**
  - New `server/tests/task-events.service.test.ts`: every type's meta validation; forced visibility; developer 403/400; author-only private; redaction; idempotent `requestId`.
  - New `server/tests/task-events.boundary.test.ts`: the §1.3.6 point 1 architecture test.
  - New `server/tests/task-notes-import.test.ts`: parser parity with `client/src/test/triage-notes.test.ts` fixtures; invalid header fallthrough; dedupe.
  - Extended `server/tests/team-tracker.service.test.ts` and `server/tests/manager-desk.routes.test.ts` with emission assertions per mutation.
  - `server/tests/assistant.tools.test.ts:143`: tool count goes from **43 to 45**.
  - `server/tests/workspace-maintenance` coverage in `server/tests/config.routes.test.ts` (existing reset routes).

**Item 12: Standup rows, board payload, check-in refs**
- **Server, changed:**
  - `server/src/services/team-tracker.service.ts` (`buildLiveDeveloperDays` 2264-2421 and `buildLiveDeveloperDay` 2178-2262 batch `latestForKeys`; `ageDays`; `addCheckIn` 1611-1673 refs)
  - `server/src/routes/team-tracker.ts:194-204`
  - `server/src/routes/my-day.ts:83-93`, plus the new event routes
  - `server/src/routes/manager-actions.ts:57-68`
  - `server/src/services/today.service.ts:378-389`
  - `server/src/assistant/tools.ts:928-1030`
- **Client, changed:**
  - `client/src/components/team-tracker/DeveloperTrackerDrawer.tsx`
  - `client/src/components/team-tracker/TrackerItemRow.tsx`
  - `client/src/components/team-tracker/TrackerItemRowActions.tsx` (the note toggle at 164-176 is removed)
  - `client/src/components/team-tracker/TrackerTaskExecutionPanel.tsx`
  - `client/src/components/manager-desk/ItemDetailDrawer.tsx`
  - `client/src/components/my-day/useMyDayHandlers.ts`
  - `client/src/components/my-day/QuickUpdates.tsx`
  - `client/src/components/today/TodayCheckInDialog.tsx` (task picker)
  - `client/src/hooks/useTeamTrackerMutations.ts:154-172` (`useAddCheckIn` with `taskKeys`)
  - `client/src/hooks/useMyDay.ts:86`
- **Client, new:**
  - `client/src/components/tasks/TaskTimeline.tsx`
  - `client/src/components/tasks/TaskUpdateComposer.tsx`
  - `client/src/components/tasks/TaskPicker.tsx`
- **Tests:**
  - `server/tests/team-tracker.routes.test.ts` (check-ins with `taskKeys`; board item has `latestEvent`)
  - `server/tests/my-day.routes.test.ts` (developer sees shared only; private event absent from `GET /api/my-day`; non-owner 404; history date 409)
  - `server/tests/today.route.test.ts` (`add_check_in` refs)
  - `client/src/test/TeamTracker.test.tsx`, `client/src/test/TrackerTaskDetailDrawer.test.tsx` (textarea replaced by timeline), `client/src/test/MyDayPage.test.tsx`, `client/src/test/TodayPage.test.tsx`

**Item 13: `created_by`, Tracker reassign**
- **Server, changed:**
  - `server/src/db/migrate.ts` (alters, §1.2.1)
  - `server/src/services/team-tracker.service.ts` (`addItem` takes `actor`; new `reassignItem`)
  - `server/src/services/manager-desk.service.ts` (`createItem` takes `actor`)
  - Routes pass `req.auth.user`: `server/src/routes/team-tracker.ts:392-410`, `server/src/routes/my-day.ts:136-144`, `server/src/routes/manager-desk.ts:303-310`
  - `server/src/services/my-day.service.ts:65-73`
  - `server/src/assistant/tools.ts` (`assign_tracker_task` 1163-1205, `create_desk_item` 1032-1100 pass `copilot`)
  - `server/src/services/daily-notes.service.ts:527`
  - `server/src/services/today.service.ts:401-409`
- **Client, changed:**
  - `client/src/components/team-tracker/TrackerTaskExecutionPanel.tsx`: a "Reassign" control reusing `client/src/components/capture/DeveloperPicker.tsx`
  - `client/src/hooks/useTeamTrackerMutations.ts`: `useReassignTrackerItem`
- **Tests:**
  - `server/tests/team-tracker.service.test.ts`: reassign keeps id and key; `in_progress` becomes planned; closed gives 409; delegated gives 409; inactive target gives error.
  - `server/tests/team-tracker.routes.test.ts`: `created_by` recorded for manager, developer and Copilot.

**Item 14: Notes → tasks**
Implementation note (2026-09-24): task-creation receipts store a hash of the normalized title, owner, Jira key, context, and source note. Retries compare the original payload, not mutable task fields. Pre-existing receipts without a hash return `409`; use a fresh request ID for a new operation, after checking whether the original task already exists. Manager-owned task creation preserves Jira links as Desk issue links.

- **Server, changed:**
  - `server/src/db/migrate.ts`
  - `server/src/services/daily-notes.service.ts` (`save` 246-321, `append` 323-417, `createFollowUpInternal` 482-555, new `addTaskUpdate` and `createTask`)
  - `server/src/routes/notes.ts`
  - `server/src/assistant/tools.ts` (`append_daily_note` 1285, `replace_daily_note` 1818 inherit scanning through the service)
- **Client, changed:**
  - `client/src/components/notes/NoteDocument.tsx` (selection actions near 70-76 and 248): add "Add as update to…" and "Create task…"
  - `client/src/hooks/useDailyNotes.ts`
- **Client, new:**
  - `client/src/components/notes/NotesTaskActionDialog.tsx` (TaskPicker plus type and visibility)
- **Tests:**
  - `server/tests/daily-notes.service.test.ts`, `server/tests/daily-notes.routes.test.ts`: mention scan inserts a ref and event once; unknown key ignored; `task-updates` idempotency; `created_from` event
  - `client/src/test/NotesPage.test.tsx`

**Item 15: Status with rationale**
- **Server, changed:**
  - `server/src/routes/team-tracker.ts:206-229,481-508` (`taskKey`)
  - `server/src/services/team-tracker.service.ts:1675-1719`
  - `server/src/assistant/tools.ts:1474-1523`
- **Client, changed:**
  - `client/src/components/team-tracker/DeveloperDrawerSections.tsx:145-179`: `StatusPillSelect` calls `useStatusUpdate` (currently unused, `useTeamTrackerMutations.ts:174-196`) instead of `updateDay`. Selecting `blocked` or `at_risk` opens a rationale prompt with an optional task picker.
- **Client, new:**
  - `client/src/components/team-tracker/StatusRationaleDialog.tsx`
- **Tests:**
  - `server/tests/team-tracker.routes.test.ts` (existing status-update tests at 548 and 580, plus `taskKey` emits a blocker)
  - `client/src/test/TeamTracker.test.tsx`, `client/src/test/useTeamTrackerMutations.test.tsx`

**Rollout order inside Phase 1:**
1. Item 11 schema and service, flag off.
2. Item 10 keys and routes.
3. Run the CLI dry-run on a production copy, then `--apply`, which turns the flag on.
4. Items 11 emission and 12 UI.
5. Item 15.
6. Item 13.
7. Item 14.

Each step ships behind the same flag and is independently revertible by turning the flag off. Events and keys already written stay valid.

---

# PART II: PHASE 2 MIGRATION PLAN

## Implementation Checkpoint (2026-10-08)

**Phase 2 code work is complete.** Operational rollout (production-copy parity review, approved decisions, soaks, manual UI acceptance) remains — see "Operational gates still required" below. Everything runs behind `tasks_phase2_stage` (`2b`, `2c`, `2d`; absent and `rolled_back` use legacy paths).

Implemented:

- Canonical task CRUD, links, soft deletion, owner validation, creator-only developer rename, atomic single-current switching, reassignment without identity changes, and manager-private DTO fields.
- **2c native transport**: Team Tracker, My Day, and Manager Desk responses carry canonical `tasks` payloads keyed by `T-<n>` (`SurfaceTask`/`ManagerSurfaceTask`/`DeveloperSurfaceTask` in `shared/types.ts`); legacy item arrays are emptied at the route boundary once canonical transport is active, and client hooks (`useTeamTracker`, `useMyDay`, `useManagerDesk`) map `tasks` back to the existing view models. Item-targeted mutations accept `T-<n>` refs during the dual-identity window and client hooks prefer them (`client/src/lib/surface-tasks.ts`). `TaskCompatibilityService` is retired; `task-view-models.ts` holds the pure mappers.
- Canonical projections in `TaskService` cover board day, developer history (`day_focus`), desk live day, desk planning day, Today items, follow-ups, meetings, and per-developer active counts — batched, no all-history scans.
- Follow-ups/Meetings read `GET /api/tasks?view=…` natively with `closedFrom`/`closedTo` ranges. Today commands operate on `taskKey`. Search/palette, workload, developer notes, check-in references, Notes sources/receipts, resets, and manager private-data purges are canonical-backed.
- A workspace-selected 38-tool canonical Copilot registry; task writes retain confirmation metadata. Legacy tool handlers remain for earlier conversation confirmations.
- Explicit cutover CLI with backup, two strict verification receipts, snapshot-drift refusal, unconditional legacy write-guard triggers (§2.1.3), and non-overlapping canonical IDs.
- **Expanded strict parity (§2.2.13/B11)**: `tasks:phase2-backfill --verify --strict` now compares canonical vs legacy projections across the board, developer history days, Desk live/planning/history day views over the 15-day window, follow-ups and meetings sets, desk→task link counts, tracker jira-key links, unfilled check-in/note/follow-up references, multi-active violations, and a developer-DTO privacy check. Any diff fails strict verification and blocks cutover. One deliberate exception: history-day title/status diffs that are fully explained by a recorded task event (legacy rows show mutated current values; canonical replays point-in-time state — the §2.3.3 B9 fix) are reported as *explained drift*, informational only.
- **Stage-transition CLI** (`tasks:stage`): `--to 2c` enforces the one-week post-2b soak from `tasks_phase2_cutover_at`; `--complete 2c` records `tasks_phase2c_completed_at` explicitly.
- **2d contract CLI** (`tasks:contract`, dry-run by default): requires stage `2c`, `tasks_phase2c_completed_at` ≥ 14 days old, clean structural verification, no compatibility-adapter imports, and no routes reading legacy task tables. `--apply` creates a `pre-task-contract` backup, then in one transaction drops the read-only triggers, renames `team_tracker_items`/`manager_desk_items`/`manager_desk_links` to `legacy_*`, records `p2_contract`, sets `tasks_phase2_stage = "2d"` + `tasks_phase2_contracted_at`, and contracts `task_events.task_id` to NOT NULL. Idempotent; a second run reports already applied.
- Legacy `note`/`contextNote` writes are rejected once the workspace is at stage 2d (`assertLegacyFieldsAllowed`); canonical DTOs no longer populate them.
- `tasks:export-legacy` rollback physically drops the guard triggers before regenerating legacy rows and is refused at stage 2d (forward-fix only). Startup migrations skip the archived-table DDL once `p2_contract` is recorded and tolerate statements targeting archived tables.
- Rollback preserves exposed IDs, note receipts, developer notes, and excludes deleted tasks; lossy fields are listed in §2.3.5.

**Operational gates still required (not code work):**

- Production-copy parity review and approved decisions file. Strict verification is intentionally conservative and may reject legitimate reviewed differences; do not bypass it by setting the stage flag manually.
- Manual UI acceptance of the 2c native surfaces.
- One-week 2b soak before `--to 2c`; two-week post-2c soak before `tasks:contract --apply`.
- Do not insert `p2_contract` manually; the contract CLI owns it.

### Cutover Procedure

Keep application writers stopped from the approved backfill through cutover. Back up and rehearse on a copy first. Existing shadow backfills created before canonical ID reservation must be reviewed and rebuilt with `--resume` before cutover.

```sh
# Stage 2a: shadow backfill on a copy + strict parity verification.
npm run tasks:phase2-backfill --workspace=server -- --dry-run --workspace default
# Review the generated report/decisions; apply using that decisions file.
npm run tasks:phase2-backfill --workspace=server -- --apply --workspace default --decisions /path/to/approved-decisions.json
npm run tasks:phase2-backfill --workspace=server -- --verify --strict --workspace default

# Stage 2b: write cutover (two clean verify receipts are required).
npm run tasks:cutover --workspace=server -- --workspace default --verify
npm run tasks:cutover --workspace=server -- --workspace default --verify
npm run tasks:cutover --workspace=server -- --workspace default --dry-run
npm run tasks:cutover --workspace=server -- --workspace default --apply

# Rollback window (lossy per §2.3.5; refused after 2d).
npm run tasks:export-legacy --workspace=server -- --workspace default --dry-run
npm run tasks:export-legacy --workspace=server -- --workspace default --apply

# Stage 2c: after the one-week post-cutover soak.
npm run tasks:stage --workspace=server -- --workspace default --to 2c --dry-run
npm run tasks:stage --workspace=server -- --workspace default --to 2c --apply
# When every surface is verified green on native transport:
npm run tasks:stage --workspace=server -- --workspace default --complete 2c --apply

# Stage 2d: after the two-week post-2c soak.
npm run tasks:contract --workspace=server -- --workspace default            # plan/dry-run
npm run tasks:contract --workspace=server -- --workspace default --apply    # backup + apply
```

Every apply command creates a backup first. A changed snapshot requires a new reviewed report, explicit backfill resume, and new verification receipts. Backfill refuses to run after cutover. Rollback is lossy as described in section 2.3.5 and is refused for a contracted workspace (`stage = "2d"`).

## 2.1 Target schema

### 2.1.1 DDL (append to `ddl` in `server/src/db/migrate.ts`; everything is `IF NOT EXISTS` and inert until the backfill runs)

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL DEFAULT 'default',
  task_key              TEXT NOT NULL,
  title                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'task',
  status                TEXT NOT NULL DEFAULT 'open',
  later                 INTEGER NOT NULL DEFAULT 0,
  owner_type            TEXT,
  owner_id              TEXT,
  tracked_by_manager_id TEXT,
  parent_id             INTEGER,
  priority              TEXT NOT NULL DEFAULT 'normal',
  labels_json           TEXT,
  scheduled_on          TEXT,
  due_at                TEXT,
  follow_up_at          TEXT,
  starts_at             TEXT,
  ends_at               TEXT,
  participants          TEXT,
  next_action           TEXT,
  outcome               TEXT,
  created_by_type       TEXT NOT NULL DEFAULT 'unknown',
  created_by_id         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  closed_at             TEXT,
  deleted_at            TEXT,
  FOREIGN KEY (parent_id) REFERENCES tasks(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_workspace_key ON tasks(workspace_id, task_key);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_owner_status ON tasks(workspace_id, owner_type, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_tracked ON tasks(workspace_id, tracked_by_manager_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_follow_up ON tasks(workspace_id, follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_closed ON tasks(workspace_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id) WHERE parent_id IS NOT NULL;
-- B7 fix at the database level: one active task per developer. Managers may have several (Desk "Now" lists all in_progress, DeskRhythmList.tsx:351).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_per_developer ON tasks(workspace_id, owner_id)
  WHERE status = 'active' AND owner_type = 'developer' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  task_id      INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  ref          TEXT NOT NULL,
  role         TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_links_unique ON task_links(workspace_id, task_id, kind, ref);
CREATE INDEX IF NOT EXISTS idx_task_links_ref ON task_links(workspace_id, kind, ref);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_links_one_primary_jira ON task_links(task_id) WHERE kind = 'jira' AND role = 'primary';

CREATE TABLE IF NOT EXISTS day_focus (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  date         TEXT NOT NULL,
  owner_type   TEXT NOT NULL,
  owner_id     TEXT NOT NULL,
  task_id      INTEGER NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'plan',
  created_at   TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_day_focus_unique ON day_focus(workspace_id, date, owner_type, owner_id, task_id);
CREATE INDEX IF NOT EXISTS idx_day_focus_owner_date ON day_focus(workspace_id, owner_type, owner_id, date);

CREATE TABLE IF NOT EXISTS task_legacy_map (
  workspace_id TEXT NOT NULL,
  task_id      INTEGER NOT NULL,
  source_table TEXT NOT NULL,
  source_id    INTEGER NOT NULL,
  role         TEXT NOT NULL,
  PRIMARY KEY (source_table, source_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_legacy_map_task ON task_legacy_map(task_id);

CREATE TABLE IF NOT EXISTS developer_notes (
  workspace_id         TEXT NOT NULL,
  developer_account_id TEXT NOT NULL,
  body                 TEXT NOT NULL DEFAULT '',
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (workspace_id, developer_account_id)
);
```

**Enumerations**, validated in Zod and services (repo style), not with `CHECK`:

| Column | Values |
|---|---|
| `kind` | `task`, `meeting` |
| `status` | `open`, `active`, `blocked`, `done`, `dropped` |
| `owner_type` | `manager`, `developer`, or NULL (inbox) |
| `priority` | `normal`, `high` |
| `task_links.kind` | `jira`, `person`, `external`, `task` |
| `task_links.role` | `primary`, `related` (Jira only) |
| `day_focus.source` | `plan`, `backfill` |
| `task_legacy_map.role` | `canonical`, `mirror`, `copy`, `lineage` |

### 2.1.2 The `task_event` repoint (expand now, contract later)

**Expand.** Append to `alterStatements`. SQLite allows `ADD COLUMN … REFERENCES` with a NULL default.

```ts
"ALTER TABLE task_events ADD COLUMN task_id INTEGER REFERENCES tasks(id)",
"CREATE INDEX IF NOT EXISTS idx_task_events_task_time ON task_events(task_id, occurred_at, id)",
"ALTER TABLE checkin_task_refs ADD COLUMN task_id INTEGER REFERENCES tasks(id)",
"ALTER TABLE daily_note_task_refs ADD COLUMN task_id INTEGER REFERENCES tasks(id)",
"ALTER TABLE daily_note_follow_ups ADD COLUMN task_id INTEGER REFERENCES tasks(id)",
```

The backfill fills `task_id` (§2.2.8). From stage 2b on, `TaskEventsService` writes both `task_key` (denormalised, never rewritten) and `task_id`, and reads by `task_id`.

**Contract (stage 2d).** Rebuild `task_events` with `task_id INTEGER NOT NULL`, following the rebuild pattern `rebuildTable` / `RebuildSpec` in `migrate.ts:654-1033`. Add a `RebuildSpec` entry:

```ts
{
  tableName: "task_events",
  expectedSqlFragment: "task_id INTEGER NOT NULL",
  columns: ["id","workspace_id","task_key","task_id","type","body","visibility","author_type","author_id",
            "meta_json","source_table","source_id","dedupe_key","occurred_at","created_at","redacted_at","redacted_by"],
  defaults: { workspace_id: `'${DEFAULT_WORKSPACE_ID}'` },
  createSql: (t) => `
    CREATE TABLE ${quoteIdentifier(t)} (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}',
      task_key     TEXT NOT NULL,
      task_id      INTEGER NOT NULL,
      type         TEXT NOT NULL,
      body         TEXT,
      visibility   TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
      author_type  TEXT NOT NULL CHECK (author_type IN ('manager', 'developer', 'copilot', 'system')),
      author_id    TEXT,
      meta_json    TEXT,
      source_table TEXT,
      source_id    INTEGER,
      dedupe_key   TEXT,
      occurred_at  TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      redacted_at  TEXT,
      redacted_by  TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )`,
}
```

The contract rebuild runs only after `data_migrations` holds `p2_backfill` **and** `SELECT COUNT(*) FROM task_events WHERE task_id IS NULL` returns 0. `migrate()` must check both conditions before calling `rebuildTable` for this spec.

### 2.1.3 Read-only guard triggers (created at stage 2b by the cutover CLI, not by `migrate.ts`)

```sql
CREATE TRIGGER IF NOT EXISTS legacy_ro_tti_ins BEFORE INSERT ON team_tracker_items BEGIN SELECT RAISE(ABORT, 'team_tracker_items is read-only after task cutover'); END;
CREATE TRIGGER IF NOT EXISTS legacy_ro_tti_upd BEFORE UPDATE ON team_tracker_items BEGIN SELECT RAISE(ABORT, 'team_tracker_items is read-only after task cutover'); END;
CREATE TRIGGER IF NOT EXISTS legacy_ro_tti_del BEFORE DELETE ON team_tracker_items BEGIN SELECT RAISE(ABORT, 'team_tracker_items is read-only after task cutover'); END;
-- identical trio for manager_desk_items and manager_desk_links
```

`team_tracker_days` and `team_tracker_checkins` stay writable. Developer-day status, capacity and check-ins are not task data.

---

## 2.2 Backfill algorithm

**CLI.** `server/src/scripts/task-phase2-backfill.ts`, registered as `"tasks:phase2-backfill"`. Modes:
- `--dry-run` (default): writes the report JSON and Markdown summary.
- `--apply --decisions <file>`: executes.
- `--verify`: parity checks only.

It reuses the Phase 1 `data_migrations` gating.

**Preflight (abort on failure):**
1. `data_migrations` has `p1_assign_task_keys` and `p1_import_task_notes`.
2. Every canonical Desk row and every Tracker row has a non-NULL `task_key` (§1.6.2).
3. `tasks` is empty for the workspace, or `--resume` is given together with a matching `inputHash`.
4. On `--apply`: `createManualBackup("pre-task-phase2")`.

**Input hash.** SHA-256 over `(count, max(id), max(updated_at))` of `team_tracker_items`, `manager_desk_items`, `manager_desk_links`, `manager_desk_item_history`, `task_events` and `task_key_aliases`. The decisions file must carry the same hash, or `--apply` refuses to run.

Steps B0–B11 run in one `BEGIN IMMEDIATE` transaction per workspace.

### 2.2.1 B0: Resolve key groups

- `groups = distinct resolve(task_key)` over all keyed legacy rows. Rows whose key is an alias map to the survivor.
- Apply approved merge decisions (§2.2.5): insert `task_key_aliases(alias → survivor, reason='p2_merge:<proposalId>')` and add a `merged` event on the survivor.
- Apply approved split decisions: allocate a new key via `task-keys.service`, set the moved rows' `task_key`, and reassign the listed events per the decision file (the **only** time `task_events.task_key` is rewritten; audited in `meta` of a new `merged` event with `decisionRef`).

### 2.2.2 B1: Desk lineage leftovers

- Non-canonical Desk lineage rows (NULL key, reported in §1.6.2) map to their canonical row's task, with `task_legacy_map.role='lineage'`.
- Their history snapshots feed B8.
- Prerequisite, recommended but not required: run `npm run manager-desk:cleanup-carry-forward -- --apply` first (`server/src/scripts/cleanup-manager-desk-carry-forward.ts`). Chains it skips because they are Tracker-linked (`manager-desk.service.ts:1046-1066`) are handled by this step.

### 2.2.3 B2: One `tasks` row per key group

**Canonical sources:**
- `D` = the canonical Desk row, if any.
- `T*` = Tracker rows of the key, ordered by `compareTrackerRowsByRecency`.
- `Tlast` = the last element of `T*`.

**Field derivation:**

| Field | Rule |
|---|---|
| `task_key` | the group's canonical key |
| `title` | `D.title` if D exists (the Desk is the authority; mirror titles cannot diverge, `team-tracker.service.ts:1498-1500`), else `Tlast.title` |
| `kind` | `meeting` if `D.kind='meeting'`, else `task` (decision D14) |
| `owner_type`, `owner_id` | If `T*` is non-empty: developer = `Tlast`'s day developer. Else if `D.assignee_developer_account_id` is set: developer = assignee (a closed delegated item whose mirror was deleted by the pre-Phase-0 behaviour; counted in the report as `ownerFromAssigneeOnly`). Else if `D.status='inbox'`: NULL/NULL (inbox). Else manager = D's day `manager_account_id`. |
| `tracked_by_manager_id` | D's day `manager_account_id` if D exists, else NULL |
| `status` | table in §2.2.4 |
| `later` | 1 iff `D.status='backlog'` |
| `priority` | `high` if `D.priority ∈ {high, critical}`, else `normal`. Tracker-only tasks get `normal` (decision D16). |
| `labels_json` | from D: `category:<v>` unless `other`; `kind:decision` / `kind:waiting` when those kinds apply; `priority:critical` / `priority:low` when those apply (decision D13, D16). NULL if empty. |
| `scheduled_on` | D's day `date` (the manager's "not before" date, decision D17), else NULL |
| `follow_up_at`, `starts_at`, `ends_at`, `participants`, `next_action`, `outcome` | from D: `follow_up_at`, `planned_start_at`, `planned_end_at`, `participants`, `next_action`, `outcome` |
| `due_at` | NULL. There is no due field today. Jira due dates stay on the Jira link. |
| `created_by_type/id` | from whichever row has the earliest `created_at` among D and `T*` (Phase 1 columns). NULL becomes `unknown`. |
| `created_at` | min `created_at` over D and `T*` |
| `updated_at` | max `updated_at` over D and `T*` |
| `closed_at` | when status is `done` / `dropped`: `Tlast.completed_at` (done) or `Tlast.updated_at` (dropped), else `D.completed_at` |
| `deleted_at` | NULL (see B9 for deleted Desk items) |

**`task_legacy_map`:**
- `D` → `canonical`.
- The Tracker row linked by `manager_desk_item_id` → `mirror`.
- Other rows in `T*` → `copy` (legacy carry copies) or `canonical` for a Tracker-only `Tlast`.

### 2.2.4 B3: Status mapping and delegated merge rules

**Tracker-only groups** (look at open rows first, then the latest):

| Condition | `tasks.status` |
|---|---|
| any row in `T*` has `state='in_progress'` | `active` (subject to single-active in B4) |
| else any row is `planned` | `open` |
| else `Tlast.state='done'` | `done` |
| else `dropped` | `dropped` |

Rationale: the B4 ghost case keeps the most advanced open state rather than losing "current".

**Desk-only groups:**

| `D.status` | `tasks.status` | Extra |
|---|---|---|
| `inbox` | `open` (owner NULL, inbox) | — |
| `planned` | `open` | — |
| `in_progress` | `active` | not subject to the developer single-active rule |
| `waiting` | `blocked` | synthesized `blocker raised` event, body "Waiting (migrated)", `occurred_at = D.updated_at` |
| `backlog` | `open`, `later=1` | — |
| `done` | `done` | — |
| `cancelled` | `dropped` | — |

**Delegated groups (D and linked `Tmirror`): merge rules**

| # | D.status | Tmirror.state | Result | Why |
|---|---|---|---|---|
| M1 | open (`inbox`/`planned`/`in_progress`/`waiting`) | `planned` | `open`. If D was `waiting`, `blocked` plus a blocker event. | Execution truth is the Tracker state. Desk "waiting" is the manager saying they are blocked on someone. |
| M2 | open | `in_progress` | `active` | Execution truth |
| M3 | open | `done` | `done`, `closed_at = Tmirror.completed_at`. Report under `deskOpenExecutionDone`. | The developer finished. This is the "two Done buttons" split (B3) resolved in favour of the developer's done. |
| M4 | open | `dropped` | `dropped` | Same rule |
| M5 | `done` / `cancelled` | any (only possible after Phase 0 #1) | `done` / `dropped` from D | Both parties closed it. D's close is later by construction. |
| M6 | `backlog` | any | Cannot occur (`manager-desk.service.ts:548-553`). Abort and report. | Invariant |
| M7 | D.assignee ≠ Tmirror's day developer | — | owner = Tmirror's developer. Report `assigneeMismatch`. | The Tracker row is where the developer actually sees it |

**Links:** union of D's issue links and Tmirror's `jira_key` / `related_jira_keys` (B5).
**Notes:** already events (Phase 1).
**`scheduled_on`:** D's day. **`day_focus`:** from `T*` (B6).

### 2.2.5 Tracker-only lineage: the precise "same task" definition, ambiguous cases, and the dry-run report

Phase 1 keyed legacy rows by `buildCarryForwardKey` with a recurrence split (§1.6.2). Because that key includes `note` and `title`, carry copies whose note or title was later edited (B10) were split into separate keys. Phase 2 proposes **merges** for those and **splits** for anything Phase 1 grouped wrongly.

**Definitions.** For key groups G (Tracker-only, not delegated) of one developer:
- `first(G)` = the earliest row by `(day.date, created_at, id)`.
- `norm(title)` = `title.trim()`.
- `issueSet(row)` = `{jiraKey} ∪ relatedKeys`, normalised uppercase (`normalizeJiraIssueKeys`, `team-tracker.service.ts:130-144`).
- `closedAt(row)` = `completed_at` for done, `updated_at` for dropped, `+∞` for open rows.
- `batch(row)` = true iff at least one other Tracker row on the same `day_id` has an identical `created_at`. `carryForwardTrackerOnlyItems` inserts a whole developer batch with a single `now` (`team-tracker.service.ts:3077-3091`), which is the carry-copy fingerprint.

**Merge proposal: G₂ is the same task as G₁ (G₂ continues G₁) iff all of:**

| Rule | Condition |
|---|---|
| R1 | same developer |
| R2 | `norm(first(G₂).title) == norm(r.title)` for some `r ∈ G₁`, **or** R2′: the titles differ but `issueSet` is equal and non-empty, and `first(G₂).updated_at > first(G₂).created_at` (a rename after copying) |
| R3 | `issueSet(first(G₂)) == issueSet(r)` for that `r` |
| R4 | `first(G₂).day.date > r.day.date`, and `closedAt(r) ≥ first(G₂).created_at` (G₁'s row was not finished before G₂ appeared) |
| R5 | `batch(first(G₂))`, **or** `first(G₂)`'s original note equals `r.note` (copy signature). The original note is known when a Phase 1 import `update` event with `imported.sourceId = first(G₂).id` exists. Otherwise use the current note. |

Classification:
- **AUTO-MERGE:** R1, R2 (not R2′), R3, R4 and R5 all hold, and G₂ has exactly one candidate G₁, and G₁ has exactly one successor candidate.
- **AMBIGUOUS:** any of the cases below.
- **Anything else:** separate tasks, no proposal.

**Ambiguous cases (all require an explicit human decision; defaults are never applied silently):**

| Code | Situation | Default shown in report |
|---|---|---|
| A1 | R1–R4 hold but R5 fails (no batch fingerprint, note differs, never edited). Could be a manual re-add of the same work. | keep separate |
| A2 | More than one candidate G₁ for G₂ (e.g. two identical-title groups on earlier days) | keep separate; list all candidates |
| A3 | G₁ has more than one successor candidate (one row copied twice, or copied and also re-added) | keep separate |
| A4 | R2′ rename case: same Jira set, different title, G₂ edited after creation | merge |
| A5 | Titles equal only after case-folding or collapsing whitespace | keep separate |
| A6 | Ghost from B4: G₁ has an `in_progress` row and G₂ has a `planned` row, both open, and R5 holds only by note equality on a row that was later edited | merge |
| A7 | Recurring title: the same `norm(title)` appears in three or more groups for the developer, where every earlier group closed before the next was created (the pattern Phase 1 split on). Listed only if some other rule proposes a merge. | keep separate |

**Split proposals** (within a single Phase 1 key):

| Code | Situation | Default |
|---|---|---|
| S1 | Two or more rows of the key on the **same day** (content-identical duplicates Phase 1 could not tell apart) | split, one task per same-day row. The operator assigns events per row; unassigned events stay with the earliest row's task. |
| S2 | A row closed and a later row in the same key created afterwards (should not exist after Phase 1's recurrence split; sanity check) | split at the boundary |

**Dry-run report (must be reviewed and approved before `--apply`).** It is written to `data/manual-snapshots/task-phase2-report-<timestamp>.{json,md}`, using the repo-root `data/` folder per AGENTS.md. It contains:

1. **Header.** `inputHash`, workspace, generation time, and counts (legacy Desk rows, Tracker rows, key groups, tasks to create by kind, owner type and status).
2. **Invariant findings.** M6 violations, M7 `assigneeMismatch`, `ownerFromAssigneeOnly`, `deskOpenExecutionDone` (M3), multi-active developers resolved by B4, orphans (Tracker rows whose day is missing, links to missing issues).
3. **AUTO-MERGE list.** proposalId, rule codes, and the evidence rows.
4. **AMBIGUOUS list**, one block per proposal:
   - proposalId, code (A1–A7), default;
   - every row in both groups: row id, key, day date, developer, title, Jira set, state, current note (first 120 chars), `created_at`, `updated_at`, `completed_at`, batch flag and batch size;
   - the event count per key, with the first three event excerpts;
   - whether either key was ever *referenced*: a `checkin_task_refs` row, a `note_ref`, or appearance in `assistant_messages.tool_calls` found by a `LIKE '%T-<n>%'` scan, flagged as "user-visible reference".
5. **SPLIT list.** The same row detail, plus the events of the key with ids, so the operator can assign them.
6. **Status mapping summary** (counts per M-rule and per Desk status).
7. **Field-loss summary.** Labels created, priorities collapsed, Desk kinds relabelled.
8. **A pre-filled decisions template:**

```json
{
  "inputHash": "…",
  "decisions": [
    { "proposalId": "M-0007", "action": "merge", "survivorKey": "T-41" },
    { "proposalId": "A1-0003", "action": "keep" },
    { "proposalId": "S1-0002", "action": "split", "eventAssignments": { "1203": "row:5521", "1204": "row:5522" } }
  ]
}
```

**Approval rule.** `--apply` refuses if any AMBIGUOUS or SPLIT proposal lacks an explicit entry, or if `inputHash` differs. AUTO-MERGE entries may be omitted, in which case the default is applied. **Survivor rule:** the lower key number survives unless the decision says otherwise, because the older key is more likely to have been referenced.

### 2.2.6 B4: Single active per developer

For each developer with more than one `active` task:
- keep the task whose most recent `focus set_current` event (or, failing that, `Tlast.updated_at`) is latest;
- set the others to `open`, emitting `status {domain:'task_status', from:'active', to:'open', reason:'single_current'}` with `author_type='system'`.

This must run before B2's insert, because `idx_tasks_one_active_per_developer` would reject the rows. The report lists every demotion.

### 2.2.7 B5: `task_links`

| Source | Link |
|---|---|
| `Tlast.jira_key` (or D's first issue link by `id` when there are no Tracker rows) | `kind='jira', role='primary'` |
| Other Tracker `related_jira_keys` (`parseRelatedIssueKeys`, `team-tracker.service.ts:146-162`) and other Desk issue links | `kind='jira', role='related'` |
| Desk `developer` links (`schema.ts:273-282`) | `kind='person', ref=<developer_account_id>` |
| Desk `external_group` links | `kind='external', ref=<external_label>` |

Duplicates collapse on `idx_task_links_unique`. `created_at` comes from the source link row, or the Tracker row's `created_at` for Tracker-derived links.

### 2.2.8 B6: `day_focus` (developer plans and history)

- **For every Tracker row in `T*`:** insert `(date = row's day date, owner_type='developer', owner_id = day developer, task_id, position = row.position, source='backfill', created_at = row.created_at)`. On a unique conflict (the same task twice on one day, which S1 decisions should prevent), keep the minimum position.
- **Desk items produce no `day_focus` rows.** Their day is `tasks.scheduled_on` (decision D17).
- **Result:** "what was on Alice's list on Mar 10" becomes a query over `day_focus`. Combined with the event replay, this fixes B9 for all data from Phase 1 onward. Earlier data is approximate; see B8.

### 2.2.9 B7: Events repoint

- `UPDATE task_events SET task_id = (SELECT t.id FROM tasks t WHERE t.workspace_id = task_events.workspace_id AND t.task_key = <resolve(task_events.task_key)>)`.
- Aliases are resolved in application code, and the update is batched by key.
- Afterwards, `SELECT COUNT(*) … WHERE task_id IS NULL` must be 0 before commit. Events of keys whose rows were all hard-deleted before Phase 2 get a **tombstone task**: `status='dropped'`, `deleted_at = <last event time>`, title from the last `created` event, `created_by_type='unknown'`.

### 2.2.10 B8: Synthesized history events (data before Phase 1 launch)

Let `P1_AT` be `data_migrations.applied_at` of `p1_assign_task_keys`. Only data **before** `P1_AT` is synthesized, because from `P1_AT` onward the live emission in §1.3.8 already recorded it. Every synthesized event has `author_type='system'`, meta `approximateTime`, and `dedupe_key` `p2:*` so re-runs are no-ops.

**Desk history snapshots** (`manager_desk_item_history`, `schema.ts:284-292`; the snapshot JSON is `ManagerDeskItem`, `manager-desk.service.ts:1939-1970`):
- For each Desk item (canonical and lineage), order snapshots by `recorded_at` with `recorded_at < P1_AT` and diff consecutive pairs (`prev = null` for the first):

| Field diff | Event |
|---|---|
| first snapshot | `created {source:'desk'}` |
| `status` | `status {domain:'desk_status'}` |
| `title` | `title` |
| `assigneeDeveloperAccountId` | `assign` |
| `plannedStartAt` / `plannedEndAt` / `followUpAt` / `originDate` | `schedule` (`followUpAt` is private) |
| `links[]` (added or removed by identity, `buildLinkIdentity` `manager-desk.service.ts:268-277`) | `link` |
| `delegatedExecution.state` | `status {domain:'tracker_state'}` (the only pre-Phase-1 record of Tracker transitions for delegated work) |
| `outcome` newly set | `decision`, body = outcome |
| `contextNote`, `nextAction` | **not converted** (the context note was imported by section in Phase 1; next action is state) |
| `eventType='deleted'` (latest) | see B9 |

- `occurred_at = recorded_at`, `dedupe_key = p2:dh:<historyId>:<field>`.

**Tracker rows** (no history table exists):
- `created {source:'tracker'}` at `first(T*).created_at` (`dedupe_key p2:tc:<rowId>`).
- `status → done` at `completed_at`.
- `status → dropped` at `updated_at`.
- For the row that is `in_progress`: `focus set_current` at `updated_at`.
- For each carry copy: `schedule {field:'day', via:'carry_forward'}` at the copy's `created_at`.

All of these only when earlier than `P1_AT`.

### 2.2.11 B9: Deleted Desk items

For each Desk item whose latest history row is `eventType='deleted'` (`manager-desk.service.ts:652-662`) and whose key has no live row:
- create a task from the last *upsert* snapshot, `deleted_at = recorded_at` of the delete row;
- status from the snapshot mapping in §2.2.4.

This keeps the historical Desk view (which today replays snapshots, `manager-desk.service.ts:1430-1466`) reproducible from `tasks` plus events.

### 2.2.12 B10: Check-ins, notes, manager notes

- **Check-ins.** The table is unchanged. Check-ins stay developer-day records.
  - `checkin_task_refs.task_id` is filled via key resolution.
  - **No refs are inferred** for check-ins created before Phase 1 (decision D25). Summaries are not scanned retroactively, because pre-Phase-1 text never used keys.
- **`daily_note_follow_ups`** (`schema.ts:320-333`):
  - set `task_id` from `task_legacy_map(manager_desk_items, item_id)`;
  - insert `note_ref {relation:'created_from', noteId, noteDate}` (private, author = `manager_account_id`) if absent, with `dedupe_key p2:nfu:<id>`;
  - the table is kept, and `getSources` (`daily-notes.service.ts:446-480`) switches to `task_id` at the Notes cutover.
- **`daily_note_task_refs.task_id`** is filled via key.
- **`team_tracker_days.manager_notes` → `developer_notes`** (decision D15):
  - for each developer, collect non-empty `manager_notes` by day date ascending;
  - drop a value identical to the previous day's (Phase 0 #6 seeding makes consecutive duplicates likely);
  - serialise in the dated-section format (`formatTriageNotesHeading`, `client/src/components/triage/triage-notes.ts:50-52`), i.e. `MMM d, yyyy:` headers, so the existing `TriageNotesEditor` UI can render it unchanged.

### 2.2.13 B11: Verification (`--verify`, and part of `--apply` before commit)

- Every legacy row id appears in `task_legacy_map` exactly once (or is reported as orphaned).
- Every `task_events.task_id` is non-null.
- `idx_tasks_one_active_per_developer` holds.
- **Parity** (§2.5.3): for today's date and the last 14 days, projections from `tasks` / `day_focus` match the legacy projections (`buildLiveDeveloperDays`, `ManagerDeskService.getDay`, `getTodayItems`) on the fields `{taskKey, title, state/status, owner}`. Differences must be either explained by an applied decision or listed. With `--strict`, any unexplained difference aborts.

---

## 2.3 Transition strategy

### 2.3.1 Dual-read or dual-write?

**Recommendation: neither in production. Use shadow reads for verification, then a one-way write cutover through adapters, with legacy tables frozen by triggers.**

- **Dual-write is rejected.** Keeping two models with different identity in sync is exactly the lossy Desk↔Tracker mirror the review is removing (`syncManagerDeskItem`, `team-tracker.service.ts:1399-1456`). A second mirror, legacy ↔ tasks, would repeat its failure modes.
- **Dual-read is used only as shadow verification before cutover** (stage 2a). No user-facing surface reads from `tasks` until the write cutover.
- **Why an adapter makes the cutover low-risk.** All writes flow through three service classes (`TeamTrackerService`, `ManagerDeskService`, `MyDayService`), plus `TodayService` and `DailyNotesService`, which call them, plus the Copilot tools, which call them too (`server/src/assistant/tools.ts`, service calls listed in §2.3.4). Re-implementing those classes' **public methods** on top of a new `TaskService`, while keeping their DTO contracts, switches every writer at once without touching routes, Today, or tools.

### 2.3.2 Stages

| Stage | What happens | Legacy tables | User-visible | Exit criteria |
|---|---|---|---|---|
| **2a: Shadow** | DDL deployed (inert). Backfill runs nightly in dry-run against a copy of the production DB (`BackupService.createManualBackup`, then open the copy). The ambiguous-case report is reviewed and the decisions file is built. `TaskService` read projections are exercised in tests and in the `--verify` parity check. | Source of truth | Nothing | Two consecutive clean `--verify --strict` runs; decisions file approved |
| **2b: Write cutover** | One release. `tasks:phase2-backfill --apply` (with backup). Then `tasks:cutover` creates the §2.1.3 triggers, seeds `sqlite_sequence` for `tasks` above `max(max(team_tracker_items.id), max(manager_desk_items.id))` (decision D23), and sets config `tasks_phase2_stage = "2b"`. Legacy service classes become adapters over `TaskService`. `WorkspaceMaintenanceService.reset` (`server/src/services/workspace-maintenance.service.ts:61-98`) and `AuthUserMaintenanceService` deletion (`server/src/services/auth-user-maintenance.service.ts:265-306`) are switched to the tasks tables **in the same release**, or the triggers would abort them. | Read-only (triggers) | None intended. Same DTOs. B1–B10 behaviours disappear because the adapters implement the Phase 2 rules (M-rules, single-active, soft delete). | One week without adapter errors; parity dashboard clean |
| **2c: Native surfaces** | Surfaces move from adapter DTOs to native task contracts (`/api/tasks` grows list and mutate endpoints) in the order of §2.3.3. Each move deletes the corresponding adapter methods. | Read-only | Per-surface improvements | Each surface's tests green; no adapter callers left |
| **2d: Contract** | Drop the `note` / `contextNote` API fields. Run the `task_events` NOT NULL rebuild (§2.1.2). Rename legacy tables to `legacy_*` (not dropped; dropping is a later backlog item). Remove the triggers. | Archived | — | Two weeks after 2c completes |

**ID continuity (stage 2b).** Adapter DTO fields `TrackerWorkItem.id` and `ManagerDeskItem.id` return the legacy row id for migrated tasks (via `task_legacy_map`) and `tasks.id` for tasks created after cutover. Because the `tasks` sequence is seeded above every legacy id, the resolver is unambiguous:

```
lookup(id): task_legacy_map[source_table=<surface table>, source_id=id]?.task_id
            ?? (id > seed ? id : 404)
```

This keeps working in client URLs, Today targets (`trackerItemId` and `managerDeskItemId`, `routes/manager-actions.ts:33-34`), and Copilot conversation history (`assistant_messages.tool_calls`, `schema.ts:348-358`).

### 2.3.3 Cutover order (stage 2c)

| # | Surface | What changes | Depends on | Why this position |
|---|---|---|---|---|
| 1 | **Search** (`server/src/services/search.service.ts`) | `searchTasks` reads `tasks` and events (by `task_id`). The Desk-items group is removed, because tasks cover it. Optional: an FTS5 index over `task_events.body`, following the `daily_notes_fts` precedent (`migrate.ts:406-426`). | 2b | Read-only and isolated. Validates `TaskService` read paths first. |
| 2 | **Palette** (`client/src/components/palette/paletteItems.ts`, `CommandPalette.tsx`) | `deskItems` group becomes a `tasks` group. Targets carry `taskKey` only. | 1 | Consumer of search |
| 3 | **Team board** (`server/src/services/team-tracker.service.ts` `getBoard` 939-1017 / `buildLiveDeveloperDays` 2264-2421; `server/src/services/workload.service.ts:104-140`) | `SELECT … FROM tasks WHERE owner_type='developer' AND (status IN ('open','active','blocked') OR date(closed_at, local) = :date)`, plus `day_focus` for order and history. Removes the all-history scan (B13). The history view becomes `day_focus` for that date plus event replay (fixes B9). `WorkloadService` counts move with it. | 2b | Largest win. Its projection is shared by My Day and Today. |
| 4 | **My Day** (`server/src/services/my-day.service.ts`, `server/src/routes/my-day.ts`) | Native developer task DTO via `toDeveloperTaskDto`, which **excludes** `next_action`, `tracked_by_manager_id`, `labels_json`, `follow_up_at` and private events (decision D11). Developers may rename tasks they created (decision D30). | 3 | Shares the projection. Developer privacy DTO lands here. |
| 5 | **Today action engine** (`server/src/services/today.service.ts`, `server/src/routes/manager-actions.ts`) | Reads board and desk projections from `TaskService`. `TodayActionTarget` uses `taskKey` (the legacy id fields are kept for one release, then removed). `mark_done` / `snooze` / `carry_forward` / `set_current_work` commands become task operations. `carry_forward` becomes `reschedule` (decision D24). | 3, 4 | Consumes both projections |
| 6 | **Desk** (`server/src/services/manager-desk.service.ts`, `client/src/components/manager-desk/*`) | Desk = tasks with `owner_type='manager'` or `tracked_by_manager_id = me` or inbox, grouped by the existing rhythm (`DeskRhythmList.tsx:349-356`) mapped to the new statuses. Assignee edits become an `assign` on the task, with no mirror. Carry-forward and the RescheduleItemDialog set `scheduled_on`. The history view replays events and `deleted_at` tasks. **Delegated-task UI (two workflows, two Done buttons) is removed.** | 5 | The most UI churn. Late, so earlier surfaces have hardened `TaskService`. |
| 7 | **Follow-ups / Meetings** (`client/src/lib/manager-memory.ts`, `client/src/components/manager-memory/ManagerMemoryPage.tsx`) | Follow-ups predicate: `follow_up_at IS NOT NULL OR labels has 'category:follow_up'`, served by a new `GET /api/tasks?view=follow-ups`. Meetings: `kind='meeting'`. "Closed" lanes query `closed_at` over a range instead of the live Desk day only (fixes B17). | 6 | Pure views over Desk data |
| 8 | **Copilot tools** (`server/src/assistant/tools.ts`) | Read tools follow their surface (#3–#7). Write tools switch in one final batch (§2.3.4). | 3–7 | Tools are thin callers. Switching them last avoids re-teaching the model twice. |
| 9 | **Notes** (`server/src/services/daily-notes.service.ts`) | `createFollowUp` creates a task. `getSources` reads `task_id`. | 6 | Depends on the Desk task semantics |

### 2.3.4 Copilot tools: disposition

Tools come from the registry at `server/src/assistant/tools.ts`, with names and confirm modes listed at 177–1854. The current count of 43 is asserted at `server/tests/assistant.tools.test.ts:143`.

| Tool (line) | Stage 2b (adapter) | End of 2c |
|---|---|---|
| `get_today_snapshot` (177) | unchanged | unchanged (Today native) |
| `get_team_board` (229), `get_developer_day` (283) | unchanged | return `taskKey`, `latestEvent` |
| `list_desk_items` (456) | unchanged | becomes **`list_tasks`** `{view: desk\|follow-ups\|meetings\|developer, …}` |
| `search_workspace` (567) | unchanged | includes tasks |
| `get_desk_item_detail` (681), `get_tracker_item_detail` (705) | unchanged | merged into **`get_task`** (added in Phase 1) |
| `preview_carry_forward` (729) | unchanged | **removed** (decision D24) |
| `manager_action` (928) | unchanged | commands operate on `taskKey`; `carry_forward` becomes `reschedule` |
| `create_desk_item` (1032), `assign_tracker_task` (1163) | unchanged | merged into **`create_task`** `{title, ownerAccountId?, jiraKey?, followUpAt?, later?, kind?}` |
| `update_desk_item` (1102), `update_tracker_item` (1335) | unchanged | merged into **`update_task`** `{taskKey, title?, status?, followUpAt?, scheduledOn?, later?, priority?}` |
| `delete_desk_item` (1579), `delete_tracker_item` (1374) | unchanged (soft delete via adapter) | merged into **`delete_task`** (soft) |
| `link_desk_item` (1598), `unlink_desk_item` (1652) | unchanged | become **`link_task`** / **`unlink_task`** |
| `promote_tracker_item` (1682), `cancel_delegated_task` (1706) | adapter no-op / maps to status `dropped` | **removed** (the concept no longer exists) |
| `carry_forward` (1525) | adapter implements move semantics | becomes **`reschedule_task`** `{taskKey, scheduledOn}` |
| `update_developer_day` (1393), `record_status_update` (1474) | unchanged | unchanged (the developer-day remains); `managerNotes` arg is redirected to `developer_notes` |
| `add_task_update` (Phase 1), `get_task` (Phase 1) | switch to `task_id` reads | unchanged |
| new | — | **`reassign_task`** `{taskKey, toAccountId}` |
| `append_daily_note` (1285), `replace_daily_note` (1818) | unchanged | unchanged (mention scanning is in the service) |
| **Unaffected (19):** `search_issues`, `get_issue`, `get_notes`, `get_workload` (implementation moves with the Team board), `get_alerts`, `get_sync_status`, `list_notes`, `list_tags`, `list_saved_views`, `get_issue_suggestions`, `get_workspace_settings`, `add_issue_comment`, `update_issue_fields`, `trigger_jira_sync`, `update_developer_availability`, `set_issue_excluded`, `set_issue_tags`, `dismiss_alerts`, `save_memory` | — | — |

**Count:** 43 today, 45 after Phase 1, **38** at the end of Phase 2.

The end-of-2c arithmetic, starting from 45:
- Removed: `preview_carry_forward`, `promote_tracker_item`, `cancel_delegated_task` (−3).
- Folded into the existing `get_task`: `get_desk_item_detail`, `get_tracker_item_detail` (−2).
- Merged pairs: create, update and delete each turn two tools into one (−3).
- Renamed, no change in count: `list_desk_items` → `list_tasks`, `link`/`unlink_desk_item` → `link`/`unlink_task`, `carry_forward` → `reschedule_task`.
- Added: `reassign_task` (+1).
- 45 − 3 − 2 − 3 + 1 = **38**.

The test at `assistant.tools.test.ts:143` is the source of truth. Update it in the same change that alters the registry.

The system prompt (`server/src/assistant/prompts.ts`) needs a short task-model section. It currently has no Desk/Tracker vocabulary (a grep for `desk|tracker` returns nothing).

### 2.3.5 Rollback story

| Point | Rollback | Data loss |
|---|---|---|
| During 2a | Nothing to roll back (the DDL is inert). Optionally drop the empty tables. | None |
| 2b, backfill applied, cutover **not** yet run | `DELETE` from `tasks`, `task_links`, `day_focus`, `task_legacy_map`, `developer_notes`; `UPDATE task_events SET task_id = NULL`; `DELETE FROM data_migrations WHERE name LIKE 'p2_%'`. Phase 1 data is untouched. | None |
| After cutover, first 24 h | Restore the `pre-task-phase2` backup (`npm run backup:restore -- <path>`, `server/package.json:10`). | Writes since cutover. Communicate the window. |
| After cutover, up to the end of 2c plus 2 weeks | **`tasks:export-legacy`** CLI. It drops the triggers and regenerates legacy rows from `tasks` (spec below), then switches config `tasks_phase2_stage = "rolled_back"` so the adapters are bypassed and the old service code paths (kept behind the flag until 2d) run. | Lossy fields listed below. Events are fully kept, because `task_events` is a Phase 1 table. |
| After 2d | Forward-fix only | — |

**`tasks:export-legacy` mapping** (inverse of B2):

| Task shape | Legacy output |
|---|---|
| developer-owned | a Tracker row on the latest `day_focus` date for that owner (or `todayIsoDate()` if none); state from status (`active` → `in_progress`, `open` or `blocked` → `planned`, `done`, `dropped`) |
| `tracked_by_manager_id` set, or manager-owned | a Desk row on `scheduled_on` (or today); status from status plus the `later` flag (`blocked` → `waiting`) |
| both of the above | Desk plus a linked Tracker row (`manager_desk_item_id`) |
| — | `task_key`, `created_by` and links are written back. `labels_json` categories become `category` (first `category:*` label, else `other`). |

**Lossy on rollback:** labels beyond the first category, `priority:high` (becomes `high`, not `critical`), `due_at`, `parent_id`, and `day_focus` history beyond the latest date.

Legacy code paths stay in the codebase, gated by `tasks_phase2_stage`, until 2d. That is the cost of a rollback that preserves data.

---

## 2.4 Decision log

Every entry is a recommendation. Implementers must not silently change these; raise a change to this log instead.

| ID | Question | Recommended answer | Rationale |
|---|---|---|---|
| D1 | Phase 1 identity before `tasks` exists? | `task_key` columns on legacy rows. Events keyed by `task_key`, repointed to `task_id` in Phase 2. | Stable handles now, with no second source of truth. The repoint is a column fill, not a rewrite. |
| D2 | Key format and allocation? | `T-<n>`, per workspace, monotonic, never reused. Legacy tasks numbered by age. | Short to say in a standup. Age order makes low numbers mean old work. |
| D3 | Can a key change once shown? | Never for merges (aliases). Splits only via an approved Phase 2 decision with explicit event assignment. | Keys end up in notes, chat and Copilot history. |
| D4 | How does Phase 1 group legacy Tracker rows? | Mirror the current live grouping (`buildCarryForwardKey`) plus a recurrence split. Defer real lineage to the Phase 2 review. | Zero visible regrouping on day one. Deterministic, so no human is needed in Phase 1. |
| D5 | `close` / `reopen` event types? | Folded into `status`. `merged` is tooling-only. | One way to record a transition. |
| D6 | Can events be edited? | No. Manager authors may redact within 30 days and change visibility. Developers cannot redact. | Trustworthy record, with an escape hatch for privacy mistakes. |
| D7 | Visibility defaults? | Per §1.3.5. Developer-authored events are forced shared. `note_ref` and follow-up-time `schedule` are forced private. DB `CHECK` on `visibility`. | Privacy by construction. The `CHECK` is defence in depth. |
| D8 | Do former owners keep access after reassignment? | No. Only the current owner reads a task's shared events. | The simplest rule that cannot leak across people. Revisit if developers ask for it. |
| D9 | Which event types may developers create? | `update`, `blocker`. | "Told them" and decisions are manager speech acts. |
| D10 | Fate of `team_tracker_items.note` and `manager_desk_items.context_note`? | Phase 1: UI stops writing them; API writes are still accepted and mirrored as events. Phase 2d: removed from the API. Columns are archived with the legacy tables. | Backward compatibility for Copilot, tests and old clients without new overwrites in the UI. |
| D11 | Fate of `next_action` and `outcome`? | `tasks.next_action` (manager-private, excluded from developer DTOs). `tasks.outcome` (shared). Neither is imported as events in Phase 1. | They are current-state fields used by the Meetings lanes (`manager-memory.ts:46-55`), not logs. |
| D12 | **State on reassign?** | `planned`/`open` stays. `in_progress`/`active` becomes `open`/`planned` for the new owner. `blocked` stays `blocked`. `done`/`dropped`: reject (409, reopen first). Row id and key kept. Emit `assign` with `stateReset`. | The new owner has their own "current". Blocked is a property of the work. Reassigning closed work is almost always a mistake. Refines the current behaviour asserted at `server/tests/manager-desk.routes.test.ts:986` ("resets it to planned") instead of resetting everything. |
| D13 | **kind/category retirement?** | Phase 2: `kind ∈ {task, meeting}` plus labels (`category:<v>` except `other`, `kind:decision`, `kind:waiting`). Capture stops asking for kind or category in Phase 3. Follow-ups predicate: `follow_up_at IS NOT NULL OR label category:follow_up`. | Nothing is lost at migration. The taxonomy stops costing capture decisions. Labels stay filterable. |
| D14 | **Meetings?** | Phase 2: meetings stay as tasks with `kind='meeting'` plus `starts_at`, `ends_at`, `participants`, `outcome`. Whether to split out a `meetings` entity (with action items as child tasks via `parent_id`) is decided in the Phase 3 spec. | Avoids a second entity migration while Phase 2 is already large. `parent_id` already makes action items as children possible. |
| D15 | **`manager_notes` destination?** | A new `developer_notes` table: one body per (workspace, developer) in the dated-section format, rendered with the existing `TriageNotesEditor`. Manager-only. Per-day values are concatenated at backfill. | Fixes B5 structurally. Reuses a proven UI (`client/src/components/triage/TriageNotesEditor.tsx`). Stays private because the table is only served by manager routes. Keyed per developer, not per manager, to match today's shared day rows. |
| D16 | Priority? | `normal`/`high`. `low` and `critical` preserved as labels. | Two levels suffice for a personal tool, with no information lost. |
| D17 | Desk "day" semantics? | `tasks.scheduled_on` ("not before"). `day_focus` is only for developer daily plans. | The Desk shows open items from their day onwards (`manager-desk.service.ts:1284-1294`), which is a not-before date, not a plan. |
| D18 | Desk `waiting` status? | `blocked` plus a synthesized `blocker` event. | Keeps the review's five statuses. The event keeps the "waiting" nuance. |
| D19 | Single current? | Enforced for developers by a partial unique index. Managers may have several `active`. | Fixes B7 at the database level without breaking the Desk "Now" list. |
| D20 | Deletes? | Soft (`deleted_at`) for tasks. Deleted Desk items are reconstructed as deleted tasks. Tombstones for event-only keys. | History and references survive. Hard delete was part of the B1 data-loss pattern. |
| D21 | Data migration mechanism? | DDL in `migrate.ts` (idempotent, startup). Data changes via explicit CLIs with a backup, dry-run by default, a `data_migrations` marker table, and feature flags in `config`. | `migrate()` runs before backups initialise (`server/src/index.ts:44` vs `127`) and cannot run async `db.backup`. Data changes need a backup and human review. |
| D22 | Dual-read or dual-write? | Neither in production: shadow parity reads in 2a, a one-way write cutover through adapters in 2b, legacy tables frozen by triggers. | Dual-write would recreate the lossy mirror. Adapters switch every writer at once. Triggers catch missed writers loudly. |
| D23 | ID continuity? | `tasks` sequence seeded above every legacy id. `task_legacy_map` resolves old ids for one release after 2c. | Old URLs, Today targets and Copilot history keep resolving. |
| D24 | Carry-forward? | Retired at the Desk cutover. Replaced by `scheduled_on` (manager) and open-until-closed plus `day_focus` (developer). The Copilot `carry_forward` tool becomes `reschedule_task`. | Identity no longer depends on day rows. |
| D25 | Check-in refs? | Explicit `taskKeys` union parsed `T-<n>` tokens. Unknown explicit keys give 400; unknown parsed tokens are ignored. No retroactive inference. | Deliberate references plus low-friction typing. No guessing on historical text. |
| D26 | **Person-day status vs task blockers?** | Person-day status stays manual in Phases 1 and 2. A status update can reference a task (`blocker` events). Deriving person status from task statuses is a Phase 3 question. | Avoids changing attention signals (`team-tracker.service.ts:611-657`) mid-migration. |
| D27 | Capacity? | Unchanged through Phase 2 (it still counts tasks, `team-tracker.service.ts:361-365`). | Out of scope. Backlog item. |
| D28 | Jira reconciliation signals? | Not in Phases 1 or 2. | Separate feature. Backlog item. |
| D29 | Timezone? | `occurred_at` / `created_at` are ISO UTC. Every local-day bucketing uses `todayIsoDate()` from `server/src/utils/date.ts`. | One rule, and it avoids B8 recurring in new code. |
| D30 | Who may rename? | Manager: any task. Developer: tasks they created (`created_by_type='developer'` and the id matches). The "rename from Desk" restriction (`team-tracker.service.ts:1498-1500`) goes away at the Desk cutover. | One record. The restriction only existed because of the mirror. |
| D31 | Can developer-owned tasks be "Later"? | No, in Phase 2 (`later` only for manager-owned or inbox tasks). Revisit in Phase 3. | Preserves today's rule (`manager-desk.service.ts:548-553`). My Day has no Later concept. |
| D32 | Task search implementation? | `LIKE` in Phase 1. Optional FTS5 over `task_events.body` in Phase 2 cutover step 1. | The precedent exists (`migrate.ts:406-426`). Not needed for correctness. |
| D33 | Workspace reset and event deletion? | Reset `team_tracker` deletes events whose keys have no remaining rows after the reset. Reset `manager_desk` likewise. Reset `workspace` deletes all events. Phase 2: resets operate on `tasks`. | Resets must not leave orphan private content (`workspace-maintenance.service.ts:61-98`). |
| D34 | Meaning of "private" with several managers? | Author-only. Imported Desk notes are authored by the Desk day's manager. Deleting a manager account deletes their private events and appears in the deletion preview. | Desk data is per manager today (`manager_desk_days.manager_account_id`). Private must not widen to other managers. |

---

## 2.5 Test plan

### 2.5.1 Tests whose asserted behaviour flips or retires

Phase 0 flips are assumed done. They are listed only where Phases 1 and 2 touch the same test again.

| Test | Current assertion | Phase | New assertion |
|---|---|---|---|
| `server/tests/manager-desk.routes.test.ts:856` "does not mirror closed items and removes tracker work when an assigned item is marked done" | Tracker row deleted | 0 → 2 | 2b: task `done`, one row, no mirror concept. Rewritten against `/api/tasks`. |
| `manager-desk.routes.test.ts:917` "cancel-delegated-task removes linked tracker work…" | Tracker row deleted | 2 | Retired at the Desk cutover (the endpoint is removed). Replaced by "drop task keeps record". |
| `manager-desk.routes.test.ts:986` "reassigns mirrored tracker work to the new owner and resets it to planned" | New row, planned | 1/2 | Same id and key. `in_progress` becomes planned, `planned` stays (D12). `assign` event emitted. |
| `manager-desk.routes.test.ts:1053` "clears the assignee … removes it from the team board" | Row deleted | 2 | Owner becomes the manager (Desk), task kept, `assign` event. |
| `manager-desk.routes.test.ts:1095,1125` (reject cancelled / later on delegated) | 409s | 2 | Retired. `later` on a developer-owned task gives 409 per D31. Dropping is allowed. |
| `manager-desk.routes.test.ts:345` "promote explicitly creates a shared manager desk task" | New Desk row | 1 → 2 | Phase 1: the Desk row **adopts the Tracker key**. Phase 2: retired (sets `tracked_by_manager_id`). |
| `manager-desk.routes.test.ts:174` "collapses legacy carry-forward chains" | Lineage dedupe | 2 | Retired after 2d. The backfill fixture F7 covers lineage mapping instead. |
| `manager-desk.routes.test.ts:1392-1823` (carry-forward context, preview, move, rebasing, notes preservation, same-day rejection) | Carry-forward semantics | 2 | Retired at the Desk cutover. Replaced by `scheduled_on` reschedule tests (rebasing logic moves to `reschedule`). |
| `server/tests/team-tracker.service.test.ts:595` "does not demote historical in-progress work…" | Multiple in-progress allowed | 0 → 2 | Unique index rejects a second active task. `setCurrent` demotes the previous one with a `status` + `focus` event. |
| `team-tracker.service.test.ts:614,641` (current chosen by recency; reactivated inherited work) | Recency heuristic | 2 | Single `active` per developer. Test the explicit `setCurrent` transition. |
| `team-tracker.service.test.ts:147` "returns past dates as historical snapshots…" | Rows on that `day_id` | 2 | `day_focus` for the date plus event replay (fixes B9). New fixture: created Mon, current Tue, done Wed (the review's P7). |
| `team-tracker.service.test.ts:774`, `server/tests/team-tracker.routes.test.ts:648`, `server/tests/my-day.routes.test.ts:565` "rejects title edits for linked delegated tasks" | 409 | 2 | Manager may rename. Developer may rename own-created tasks only (D30). |
| `team-tracker.service.test.ts:855`, `team-tracker.routes.test.ts:671`, `my-day.routes.test.ts:592` "rejects deleting linked delegated tasks" | 409 | 2 | Soft delete allowed for manager. Developer may delete own-created tasks only. |
| `team-tracker.service.test.ts:838` "removes item from database" | Hard delete | 2 | Soft delete: `deleted_at` set, events kept, `status → deleted` event. |
| `team-tracker.service.test.ts:942` "unlinks Manager Desk work without deleting tracker execution data", `:977` "cancels linked Manager Desk work by deleting the tracker item" | Mirror semantics | 2 | Retired. |
| `team-tracker.service.test.ts:1260-1521`, `team-tracker.routes.test.ts:816-1050` (Tracker carry-forward) | Copy semantics | 1 → 2 | Phase 1: copies carry the source key and the grouping uses the key (new asserts). Phase 2: retired. |
| `team-tracker.service.test.ts:131` "surfaces unfinished work from earlier days … without manual carry-forward" | Live inheritance | 2 | Kept in spirit: open tasks are visible regardless of creation day, now via the `tasks` query. |
| `my-day.routes.test.ts:211` "includes task notes updated through team tracker" | `note` field round-trip | 1 | Note write emits a shared `update` event, and the developer sees it via `latestEvent`. The `note` field is still returned until 2d. |
| `my-day.routes.test.ts:617` "back-syncs delegated execution to Manager Desk detail" | Mirror back-sync | 2 | Retired. One task, so there is nothing to sync. |
| `server/tests/assistant.tools.test.ts:143` `toHaveLength(43)` | 43 tools | 1, 2 | 45 after Phase 1. Recomputed at the end of Phase 2 (§2.3.4). |

### 2.5.2 New tests guarding the backfill (`server/tests/task-phase2-backfill.test.ts`)

These use fixture databases built with the existing helpers (`server/tests/helpers/db.ts`). The first seven cover Phase 1 key assignment and Phase 2 lineage together.

| Fixture | Scenario | Expected |
|---|---|---|
| F1 | Tracker-only task created Mon, never carried, done Wed | 1 task `done`, `closed_at` = Wed, `day_focus` Mon only, synthesized `created` + `status` events (pre-P1) |
| F2 | Carry batch: 3 tasks copied Mon→Tue with identical `created_at` (`batch=true`); one copy's note edited afterwards | Phase 1: 2 keys unchanged plus 1 key split (note differs). Phase 2: AUTO-MERGE proposal for the edited one (R5 by batch). Survivor is the lower key. |
| F3 | B4 ghost: original `in_progress` (old note) plus copy `planned` (edited note) | A6 proposal; default merge; merged task `active` |
| F4 | B6: two distinct "Code review" tasks, the first done before the second was created | Phase 1 recurrence split gives 2 keys. Phase 2: no proposal (A7 only listed if another rule fires). |
| F5 | Same title, two rows on the same day, same key | S1 split proposal. Apply with `eventAssignments` moves events. The new key is allocated above the maximum. |
| F6 | Manual re-add without batch, same note null, first still open (A1) | Ambiguous. `--apply` refuses without an explicit decision. |
| F7 | Legacy Desk lineage chain (3 rows with `source_item_id`) plus a Tracker row linked to a non-canonical row | 1 task. `task_legacy_map` roles `canonical`, `lineage`, `mirror`. |
| F8 | Delegated M1–M5 and M7 matrix (one fixture per rule) | Statuses and owners per §2.2.4. M6 aborts with a report. |
| F9 | Closed delegated Desk item whose mirror was deleted (pre-Phase-0) | Owner = assignee, `done`, reported in `ownerFromAssigneeOnly` |
| F10 | Desk history snapshots across status, assign, followUp, links and delete | Synthesized events per §2.2.10 (private `followUp`). Deleted item becomes a task with `deleted_at`. |
| F11 | Events on a key whose rows were hard-deleted | Tombstone task. All events have `task_id`. |
| F12 | Two developers each with two `in_progress` rows | B4 demotions. The unique index holds. The report lists demotions. |
| F13 | `daily_note_follow_ups` plus mention refs | `task_id` filled, `note_ref created_from` present once, idempotent re-run |
| F14 | `manager_notes` on 5 days with Phase 0 seeding duplicates | `developer_notes` body has de-duplicated dated sections. It round-trips through a port of `parseTriageNotes`. |
| F15 | Idempotency | Running `--apply` twice produces identical row counts. `dedupe_key` prevents duplicate events. |
| F16 | Input hash drift | Modify a row after the dry-run: `--apply` refuses. |
| F17 | Multi-workspace | Keys, tasks and events are scoped. The same `T-1` exists in both workspaces (extends `server/tests/multi-workspace-isolation.test.ts:115`). |
| F18 | Rollback export round-trip | backfill → export-legacy → legacy projections equal the originals on `{title, state/status, owner, key}` for all non-lossy fixtures |

### 2.5.3 Parity and safety tests

- **Parity harness** `server/tests/task-parity.test.ts`. For fixtures F1–F14, compare legacy projections against `TaskService` projections for the board, My Day, Desk day, `getTodayItems` and Follow-ups predicates, on normalised fields. The known intentional differences (M3, B4 demotions, recurrence splits) are listed in the test as expected diffs.
- **Trigger guard** `server/tests/task-cutover.test.ts`. After `tasks:cutover`, any `INSERT`/`UPDATE`/`DELETE` on the legacy tables throws. `workspace-maintenance` reset and auth-user deletion still succeed (they were switched in 2b).
- **Privacy regression suite** `server/tests/task-privacy.test.ts`. It seeds private events (manager A, manager B, `note_ref`, imported Desk notes, `follow_up` schedule) and asserts:
  - no response body of any `/api/my-day/*` route contains their text;
  - manager B cannot read manager A's private events via `/api/tasks`, `/api/search` or Copilot `get_task`.

  It runs in Phase 1 and is re-run unchanged after each 2c surface cutover.
- **Boundary test** (§1.3.6 point 1). It stays green through Phase 2. `task-phase2-backfill.ts` is the only allow-listed file.
- **Client.**
  - `client/src/test/TeamTracker.test.tsx`: board from native DTO; single current; history via `day_focus`.
  - `client/src/test/ManagerDesk.test.tsx`: no delegated workflow buttons; one Done.
  - `client/src/test/ManagerMemoryPage.test.tsx`: Follow-ups predicate with labels; closed range.
  - `client/src/test/MyDayPage.test.tsx`: developer DTO omits `next_action`.
  - `client/src/test/paletteItems.test.ts`: tasks group replaces desk group.

---

# PART III: Disposition of §8 items (review "Things you didn't ask about")

| # | §8 item | Disposition | Where / what |
|---|---|---|---|
| 1 | Privacy boundary (fields vs per-event visibility) | **(a) Covered** | Phase 1 §1.3.5 (rules) and §1.3.6 (enforcement points, architecture test). Phase 2 §2.3.3 #4 (`toDeveloperTaskDto` excludes private fields). Test suite §2.5.3 "privacy regression". D7, D8, D34. |
| 2 | Authorship and provenance | **(a) Covered** | Event authorship §1.3.4 (`author_type` includes `copilot`). `created_by_type/id` columns §1.2.1, populated per item 13 (§1.8). Carried into `tasks.created_by_*` §2.2.3. |
| 3 | Copilot can trigger lossy paths | **(a) Covered** | Phase 0 fixes the paths. Phase 1 attributes Copilot writes (`author_type='copilot'`). Phase 2 §2.3.4 replaces the delegated and carry tools and removes `promote_tracker_item` / `cancel_delegated_task`. |
| 4 | Performance ceiling (board rebuilt from all history every 30 s) | **(a) Covered, Phase 2 only** | §2.3.3 #3: indexed `tasks` query plus `day_focus`. Phase 1 adds one batched `latestForKeys` query per board load; it does not worsen the complexity class. No interim fix is planned in Phase 1. |
| 5 | Blocked as a task property | **(a) Covered** for tasks, **(b) decision** for person status | Phase 1: `blocker` events and status updates with `taskKey` (§1.4.8). Phase 2: `tasks.status='blocked'` (§2.2.4). Deriving person-day status from tasks: D26 (recommend deferring to Phase 3). |
| 6 | Capacity is a task count | **(b) Decision**, then **(c) backlog** | D27: leave unchanged through Phase 2. Backlog item **"Capacity model: focus slots or remove"**. |
| 7 | Timezone correctness split | **(a) Covered** | Phase 0 fixes the Tracker. D29 requires all new code to bucket with `todayIsoDate()` (`server/src/utils/date.ts:20-22`). Applied in `ageDays` (§1.4.3) and the Team board query (§2.3.3 #3). |
| 8 | Metrics from the timeline | **(c) Deferred backlog** | Backlog item **"Timeline analytics: cycle time, reopen count, blocker duration, stale tasks"**. Made possible by `task_events` with `occurred_at` and the `status`/`blocker`/`focus` types. No schema change needed. |
| 9 | 1:1 support | **(b) Decision** (storage), then **(c) backlog** (feature) | D15: `manager_notes` moves to `developer_notes` (per-developer private dated notes). Backlog item **"1:1 workspace: recurring topics, agenda, links to tasks and developer_notes"**, to be scoped in Phase 3. |
| 10 | Tests encode lossy behaviour | **(a) Covered** | §2.5.1 lists every flipping or retiring test with its new assertion. §2.5.2–2.5.3 add backfill, parity, trigger and privacy guards. |

**Backlog items created by this document** (so they are not lost):
1. Capacity model: focus slots or remove (D27).
2. Timeline analytics (item 8).
3. 1:1 workspace (item 9).
4. Jira reconciliation signals: resolved in Jira but open in LeadOS, and the reverse (D28).
5. Derived person-day status from task blockers (D26; Phase 3 question).
6. FTS5 over task event bodies, if `LIKE` search is slow (D32).
7. Drop `legacy_*` tables after a retention period (after 2d).
8. Developer read access to their own authored events on tasks reassigned away from them (revisit D8).

---

# PART IV: Phase 3 spec outline (to be written after Phase 2 completes)

The Phase 3 interaction spec must answer each of these explicitly.

**A. Screen inventory**
1. What is the final set of top-level views? Does Desk remain a separate nav entry, or become Today plus "My tasks"? Current nav IDs: `shared/types.ts:1157-1169`.
2. For each current screen (`client/src/components/*` feature folders: today, work, team-tracker, manager-desk, manager-memory, notes, my-day, capture, palette), is it kept, merged, or retired? What replaces it?
3. What does the single task drawer contain, in which order? (Header and key, status, owner, links, timeline, composer, properties.) Which elements are hidden for meetings?
4. Does `/t/:key` become a full-page task view in addition to the drawer?
5. Do Meetings become a separate entity (D14)? If so, what does the meeting screen contain, and how are action items created?
6. Where does `developer_notes` (1:1 notes) live in the UI?

**B. Standup keyboard flow**
1. What is the entry point? A "Standup mode" route, or a mode of the Team page? How is the developer order determined (roster order, attention order, saved view)?
2. What is the complete key map? (Next/previous developer, next/previous task, log update, toggle "told them" / private, set current, done, blocked with required rationale, add task, reassign, open drawer, exit.) Resolve conflicts with Cmd/Ctrl+K/J/I (`client/src/App.tsx:669-684`).
3. How does "since last standup" work? What defines the previous standup timestamp (per developer, last manager event, explicit "standup done")? Which event types are shown?
4. How are general remarks (check-ins) versus task updates distinguished at the keyboard?
5. Is there an accessibility and focus-management contract (screen readers, focus traps across stacked drawers)?

**C. Capture parsing grammar**
1. What is the formal grammar (EBNF) for the single capture box? Tokens: `@person`, `#JIRA-KEY`, `T-<n>` (reference or parent), date expressions (`!fri`, `!tomorrow`, `!2026-10-02`), `later` / `/l`, `/meeting`, `/followup`, priority (`!!`).
2. How are ambiguous tokens resolved? (Two developers matching `@al`, a Jira key not synced, a date in the past.) What is shown before confirming?
3. What is the default owner and status when no token is present? Inbox, or the manager?
4. How does a capture become an *update* to an existing task (`T-142: said X`) rather than a new task?
5. What is the parsing locale and timezone? (Must follow D29.)
6. Does the parser run client-side, server-side, or both? Where is the canonical implementation, and how is it tested?

**D. Saved-view definitions**
1. What is the saved-view schema for tasks? (Filter predicates over owner, status, labels, links, dates, `later`, `kind`; sort; grouping.) How does it relate to the existing `team_tracker_saved_views` (`schema.ts:207-220`) and `work_saved_views` (`schema.ts:222-235`)? Unify or keep separate?
2. Which built-in views ship? Minimum: My tasks, Watching (delegated), Inbox, Follow-ups (D13 predicate), Meetings, Blocked, Stale (no event in N days), Later, Closed this week.
3. How do views encode into URLs (the `view-params.ts` pattern) and into the palette?
4. Are views shareable across managers in a workspace, or per manager?

**E. Cross-cutting questions Phase 3 must close**
1. Person-day status: derived, manual, or hybrid (D26)?
2. Capacity model (backlog item 1).
3. Removing kind and category from every remaining UI (D13), and the label management UI.
4. Should developers be able to use Later (D31)?
5. Should former owners have event access (D8)?
