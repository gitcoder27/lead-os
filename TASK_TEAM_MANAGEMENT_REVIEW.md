# LeadOS: Task and Team Management Review, and a v2 Proposal

_Independent review worked out from the code. Nothing under `docs/` or any earlier review or roadmap document was read._

---

## 0. Scope, method, and evidence conventions

- **Method.** I traced six real workflows end to end: React component, then hook, then `client/src/lib/api.ts`, then Express route, then service, then Drizzle schema, and back. For each workflow I looked at two things: what the data model allows, and how many steps and decisions the UI asks of the manager.
- **Citations.** `path:line` or `path:start-end`, relative to the repo root.
- **"Verified".** Marks a behaviour I reproduced by running the real `TeamTrackerService` / `ManagerDeskService` against a throwaway SQLite DB. The probe ran from `/tmp` using `server/tests/helpers/db.ts`. No repo files were changed, and the probe was deleted afterwards. Scenario scripts and outputs are summarised in the [Appendix](#appendix-a--verification-probes).
- **Tests that encode current behaviour.** Where a behaviour I call a problem is asserted by an existing test, I say so. Changing it will mean deliberately changing that test.

---

## 1. TL;DR

1. **There is no single "task" in LeadOS. There are four things that look like tasks:**
   - Team Tracker items (`team_tracker_items`)
   - Manager Desk items (`manager_desk_items`), which themselves split into action, meeting, decision, waiting, follow-up and "Later" by combining `kind` × `status` × `category` × `followUpAt`
   - Jira issues (`issues`)
   - Note selections that become Desk follow-ups

   A Desk item with an assignee is **mirrored** into a Tracker item. The mirror is lossy.
2. **A task's home is a *day*, not the task.** Tracker items belong to `team_tracker_days (date, developer)`. Desk items belong to `manager_desk_days (date, manager)`. Continuity across days is rebuilt at read time with heuristics:
   - "latest row per content key" for Tracker-only items
   - "latest row per lineage" for Desk items
   - copy-based carry-forward

   This is the root cause of most of the awkwardness and most of the bugs.
3. **The "small running record per task" you want has no real home.**
   - Tracker items have one overwrite-in-place `note` field (2000 chars). The developer sees and can edit it.
   - Check-ins are attached to the developer's day, not to a task, and the live drawer only shows **today's**.
   - "Notes" in the developer drawer is a per-day `manager_notes` field that **silently disappears the next day** once anything is written (Verified).
   - The only dated log in the app, `TriageNotesEditor`, exists for Desk items and Jira issues. It is not available for Tracker tasks.
4. **Multi-day tasks break in several verified ways:**
   - Carry-forward resets "current" to "planned".
   - Editing the note on a carried copy **brings back a ghost duplicate** of the original.
   - Two distinct tasks with the same title **collapse into one**.
   - A developer can have several `in_progress` rows at once. When one is finished, a "zombie" current task reappears.
   - Historical days are not snapshots.
5. **Closing a delegated task from the Desk (or from Today) deletes the developer's task row**, including their completion record and note (Verified; asserted by a test). The same drawer has two "Done" buttons with opposite effects on that data.
6. **You cannot reliably refer to a task later.**
   - Tracker items show no visible ID, have no URL, and are not in Cmd+K search.
   - Desk items show `#id` but have no deep link.
   - Tracker item IDs change when the Desk moves or reassigns the linked item (Verified).
7. **Notes connect to tasks in one direction only.** A text selection can become a *Desk follow-up*. It cannot become a Tracker task, cannot be attached to an existing task as an update, and cannot mention a developer or Jira key.
8. **Capture asks you to classify first.** You pick a target (Desk / Team / Notes) and then answer up to four taxonomy questions (kind, category, status, priority) before the thing even exists. Delegating to a developer *and* tracking it yourself is not possible from any capture dialog.
9. **Recommendation for v2: something in between, not Jira and not pure free-flow.**
   - One `task` entity with a stable, human-readable ID, one owner, a small status set, and optional one-level grouping.
   - An append-only per-task timeline of updates, instructions, decisions and status changes, with a visibility flag.
   - "Today", "My Day", "Desk", "Follow-ups" and "Standup" become *views* over tasks, not separate storage.
   - Jira stays a linked source. Do not mirror Jira's hierarchy.
10. **Phasing.**
    - Phase 0: fix the lossy behaviours (about a week of targeted changes).
    - Phase 1: add a task timeline and stable IDs on top of the current tables (the standup flow improves immediately).
    - Phase 2: merge Desk and Tracker items into one `tasks` table with a backfill.
    - Phase 3: redesign capture, standup and notes around the unified model.

---

## 2. Current data model: map and lifecycle

### 2.1 Task-like entities

| Entity | Table (schema) | Scoped to | Key fields | Where it shows up |
|---|---|---|---|---|
| **Tracker item** ("team task") | `team_tracker_items` `server/src/db/schema.ts:177-192` | `day_id` → `team_tracker_days(date, developer)` `schema.ts:148-164` | `title`, `state` (planned/in_progress/done/dropped), `note`, `jira_key`, `related_jira_keys` (JSON text), `position`, `manager_desk_item_id` | Team board, Developer drawer, My Day, Today pulse |
| **Desk item** | `manager_desk_items` `schema.ts:250-271` | `day_id` → `manager_desk_days(date, manager)` `schema.ts:239-248` | `kind`, `category`, `status` (7 values), `priority`, `assignee_developer_account_id`, `context_note`, `next_action`, `outcome`, `participants`, `planned_start_at/end_at`, `follow_up_at`, `source_item_id` (legacy lineage) | Desk, Follow-ups, Meetings, Today |
| Desk links | `manager_desk_links` `schema.ts:273-282` | item | `link_type` = issue / developer / external_group | Desk drawer, developer drawer "follow-ups" |
| Desk history | `manager_desk_item_history` `schema.ts:284-292` | item | full JSON snapshot per mutation | Desk history view |
| **Jira issue** | `issues` `schema.ts:11-41` | workspace | synced fields plus local `analysis_notes`, `excluded`, tags | Work page, triage panel |
| **Check-in** | `team_tracker_checkins` `schema.ts:194-205` | `day_id` (developer-day) | `summary`, `status`, `rationale`, `author_type` | Developer drawer, My Day, search |
| Developer-day | `team_tracker_days` `schema.ts:148-164` | (date, developer) | `status`, `capacity_units`, `manager_notes`, `last_check_in_at`, `next_follow_up_at` | Board signals, drawer header |
| **Daily note** | `daily_notes` `schema.ts:294-305` | (manager, date) | `body` (free text) | Notes page |
| Note→follow-up link | `daily_note_follow_ups` `schema.ts:320-333` | note, item | `item_id` → Desk item | "From your note" badge |

The *derived* task types are not stored anywhere. They exist only as predicates:

- **Follow-up**: `category === 'follow_up' || followUpAt` (`client/src/lib/manager-memory.ts:22-24`).
- **Meeting**: `kind === 'meeting'` (`manager-memory.ts:26-28`).
- **"Later"**: `status === 'backlog'` (`client/src/components/manager-desk/DeskRhythmList.tsx:354`).
- **Delegated task**: a Desk item with an assignee plus a mirrored Tracker row (`manager-desk.service.ts:2070-2091`).
- **Tracker-only task**: `manager_desk_item_id IS NULL` (`team-tracker.service.ts:420`).

### 2.2 Relationship sketch

```
                 ┌───────────────────────── issues (Jira mirror) ◄──── sync engine
                 │ jira_key / related_jira_keys (text)        ▲
                 │                                            │ issue link
 team_tracker_days(date,dev) ─┬─ team_tracker_items ──manager_desk_item_id──► manager_desk_items ─┬─ manager_desk_links
      │  status, manager_notes│    state, note, position        (0..1 mirror)   kind/category/status├─ manager_desk_item_history
      └─ team_tracker_checkins│                                                  assignee_dev ─────┘
                              │                                                  day_id ─► manager_desk_days(date,mgr)
                              │                                                        ▲
                              │                                    daily_note_follow_ups (note → desk item)
                              │                                                        │
                              └───────── (no link) ──────────────  daily_notes(date,mgr)
```

Notice what is missing:

- Nothing links a Tracker item to a check-in.
- Nothing links a Tracker item to a note.
- Nothing links a Tracker item to the item it was carried forward from.
- Nothing records who created a Tracker item (there is no `created_by` / author column, `schema.ts:177-192`).

### 2.3 Five different status vocabularies

| Concept | Values | Source |
|---|---|---|
| Tracker item state | planned, in_progress, done, dropped | `shared/types.ts:539` |
| Desk item status | inbox, planned, in_progress, waiting, backlog ("Later"), done, cancelled | `shared/types.ts:823-830` |
| Desk item kind | action, meeting, decision, waiting | `shared/types.ts:806-810` |
| Developer-day status | on_track, at_risk, blocked, waiting, done_for_today | `shared/types.ts:532-537` |
| Jira status | free-form `status_name` plus `status_category` | `schema.ts:19-20` |

"Waiting" is both a Desk **kind** and a Desk **status**. "Blocked" exists only for a *person-day*, never for a *task*.

### 2.4 Identity

| Thing | Stable ID? | Visible to user? | Addressable (URL / search)? |
|---|---|---|---|
| Tracker item | **No.** The row id is replaced on carry-forward (copy) and on Desk move or reassign (delete and insert, `team-tracker.service.ts:1445-1454`, Verified P3). The live board merges rows by a **content key** `[jiraKey, relatedKeys, title, note]` (`team-tracker.service.ts:489-514`). | No | No: not in `/api/search` (`search.service.ts:114-259` searches issues, desk items, check-ins, developers, notes only). The Team deep link drops `trackerItemId` (`client/src/App.tsx:510-516`). |
| Desk item | Yes (row id; carry-forward now *moves* the row, `manager-desk.service.ts:882-892`) | `#id` in the drawer header (`DrawerHeader.tsx:94-96`) | Searchable. The deep link is in-memory only: the URL carries `?date=`, not the item (`App.tsx:518-528`). |
| Jira issue | Yes (key) | Yes | Yes |

### 2.5 Lifecycles

**Tracker-only item**

1. Created on a developer-day by one of: `addItem`, always `state: planned` (`team-tracker.service.ts:1346-1397`); the drawer's "Add Task"; global capture on the Team tab; My Day; or the Copilot `assign_tracker_task` (`server/src/assistant/tools.ts:1163-1205`).
2. On later days it shows up through **live inheritance**. `buildLiveDeveloperDays` loads *every* day row ≤ the date for each developer, then *every* item row on those days, then keeps the "latest" row per content key (`team-tracker.service.ts:2264-2421`, `2642-2662`).
3. Explicit **carry-forward** is also available: API, Copilot `carry_forward` (`tools.ts:1525-1575`), and a hook with no UI button (`useCarryForward` is imported only by tests). It **inserts copies** with `state: 'planned'` and leaves the originals untouched (`team-tracker.service.ts:3049-3099`).
4. "Current" means `state = in_progress`. `setSingleInProgressForDay` demotes other in-progress rows **on the same day row only** (`team-tracker.service.ts:3175-3242`). Leaving earlier days alone is intended, and a test asserts it (`server/tests/team-tracker.service.test.ts:595`).
5. **Done / Drop** set the state (and `completedAt`). The row stays under its original day.
6. The item can be **deleted** outright (hard delete, `team-tracker.service.ts:1559-1577`).
7. There is **no reassignment**. `updateItem` accepts only title, state, note and position (`team-tracker.service.ts:1485-1494`). Moving a task to another developer means dropping it and creating it again.

**Desk item (manager's own)**

1. Created by `createItem` with default `status: inbox`, `category: other` (server) or `planning` (global capture, `DeskCaptureForm.tsx:44`).
2. Moves through the statuses via the drawer's workflow buttons (`DrawerWorkflowActions.tsx:129-202`).
3. Shows on every live day while it is open. Closed items show only on the day they were completed (`manager-desk.service.ts:1278-1302`).
4. **Carry-forward / reschedule** moves the row to another day and rebases its times (`manager-desk.service.ts:864-912`).
5. **Delete** writes a "deleted" history snapshot and then removes the row (`manager-desk.service.ts:652-662`).

**Delegated item (Desk item with an assignee)**

1. Every create, update, link change or carry-forward calls `syncTrackerAssignment` (`manager-desk.service.ts:2070-2091`), which calls `TeamTrackerService.syncManagerDeskItem` (`team-tracker.service.ts:1399-1456`).
2. **If the Desk item is closed** (`done` / `cancelled`, i.e. `!isOpenStatus`), the assignee is treated as null and **the Tracker row is deleted** (`manager-desk.service.ts:2083`, `team-tracker.service.ts:1412-1416`). A test asserts this: `server/tests/manager-desk.routes.test.ts:856` "…removes tracker work when an assigned item is marked done".
3. **If the Desk day or the assignee changes**, the Tracker row is deleted and **re-inserted as `planned` with a new id**. The note is carried over; the state and id are not (`team-tracker.service.ts:1426-1454`). A test asserts the reset: `manager-desk.routes.test.ts:986`.
4. **Tracker state changes do not flow back to Desk status.** They only bump `manager_desk_items.updated_at` (`team-tracker.service.ts:1551-1553`, `3163-3173`). The Desk shows a separate "Execution" chip (`DrawerHeader.tsx:165-194`).

---

## 3. Workflow traces

### W1. Standup: "open a developer, see their tasks and current task, keep a small running record per task"

**Path.**
- `TeamTrackerPage` loads data via `useTeamTracker(date)`, which calls `GET /api/team-tracker?date=`, which calls `getBoard` and then `buildLiveDeveloperDays` (`client/src/hooks/useTeamTracker.ts:26-35`, `server/src/routes/team-tracker.ts:248-289`, `team-tracker.service.ts:939-1017`).
- Clicking a roster row opens `DeveloperTrackerDrawer` (`client/src/components/team-tracker/DeveloperTrackerDrawer.tsx`).

**What the drawer shows (`DeveloperTrackerDrawer.tsx:243-531`):**

| Section | Backing field | Problems |
|---|---|---|
| Current work (one row) | Tracker item `state=in_progress`, picked as the most recent `updatedAt` across all days (`team-tracker.service.ts:2374-2376`) | Shows the item's `note`. The only row actions are title-edit and Done (hover preset `hover-done`, `TrackerItemRowActions.tsx:45-47,146-163`). There is no inline "log update". |
| Planned (drag list) | other open rows | The `drawer-planned` variant **hides the note entirely** (`TrackerItemRow.tsx:300,308`). The hover preset shows only Edit-title and Start: no note, no Drop (`TrackerItemRowActions.tsx:120-145,164-202`). No task age: `viewDate` is not passed, so the "Continued from" badge (`TrackerItemRow.tsx:91,286-299`) never renders in the manager's drawer, though it does on My Day. |
| Manager follow-ups | Desk items with a **developer link** (not an assignee) (`DeveloperTrackerDrawer.tsx:570-589`) | Delegated tasks (assignee) are not listed here, and developer-linked follow-ups are not listed among the tasks. Two different ways of associating a person with work. |
| Notes | `team_tracker_days.manager_notes`: **per developer, per day** (`DeveloperTrackerDrawer.tsx:374-431`) | **Disappears the next day** after the first write of any kind (Verified P5). See B5. |
| Completed / Dropped | `completedAt` / `updatedAt` equal to the date (UTC slice) | Timezone bug B8. |
| Check-ins (timeline) | `team_tracker_checkins` for **today's day row only** (`team-tracker.service.ts:2340-2352,2386`) | Yesterday's standup notes are not visible during today's standup. Check-ins cannot reference a task. |
| Footer "Add a check-in note…" | `POST /team-tracker/:id/checkins` | The fastest capture box in the drawer, but it is **not attached to a task**. |
| Status select (header) | `PATCH /:accountId/day` → `updateDay` (`DeveloperDrawerSections.tsx:145-179`) | Bypasses the server's rationale-required status flow (`recordStatusUpdate`, `team-tracker.service.ts:1675-1719`). `useStatusUpdate` exists but no component uses it (`useTeamTrackerMutations.ts:174-196`). Status changes leave no trail. |

**Where a per-task record *can* go today.** Clicking a task row opens `TrackerTaskDetailDrawer` on top of the developer drawer (`TrackerTaskDetailDrawer.tsx`).

- **Tracker-only task.** One "Execution Note" `<textarea>` with a Save button (`TrackerTaskExecutionPanel.tsx:162-230`). It sends `PATCH /team-tracker/items/:id {note}` (2000 chars max, `routes/team-tracker.ts:170`), which **overwrites** `team_tracker_items.note`.
  - No timestamp, no author, no history.
  - The developer sees the same field and can edit it (`MyDayService.updateItem`, `server/src/services/my-day.service.ts:75-86`; `CurrentTask.tsx:96-104`).
  - For carried or copied rows, editing the note **changes the row's identity key** and brings back a duplicate (Verified P1).
- **Delegated task.** The stacked drawer offers **three** free-text places, and you have to pick one:
  1. "Execution Note" (Tracker `note`, shared with the developer, overwrite).
  2. "Next move" (`manager_desk_items.next_action`, `DrawerPrimaryFields.tsx:76-101`).
  3. "Notes", a **dated log** (`context_note` rendered through `TriageNotesEditor`, which parses `MMM d, yyyy:` headers into per-day sections, `DrawerNotes.tsx:11-28`, `client/src/components/triage/triage-notes.ts:13,54-104`). This is the closest thing to what you want. It is capped at 5000 chars (`routes/manager-desk.ts:108,160`), which a multi-week task with daily notes will hit. Past sections stay editable, so it is not a true log.
- **Getting a dated log for a Tracker-only task** requires "Promote to Manager Follow-Up" (`TrackerTaskDetailDrawer.tsx:245-274`). That creates a Desk item with `category: other` (`manager-desk.service.ts:2151-2214`), so the task now lives in two places.

**Verdict.** The data model has no per-task, time-ordered record. Of the six places standup context can go (task note, day notes, check-in, next action, dated context note, daily note), only one is dated. That one is reachable only for delegated tasks and needs 3+ clicks to reach. The fastest place to type (the check-in footer) loses the link to the task and drops out of view the next day.

### W2. A task assigned today that runs for days or weeks

**Tracker-only task, no carry-forward (the normal UI path, since the Team page has no carry-forward button).**

- **Day 1.** The row is created on day 1 as `planned`.
- **Days 2…N.** Live inheritance shows the same row. `originDate` stays day 1. Edits go to the day-1 row. This is consistent in the *live* view.
- **History.** A historical day shows only rows **whose `day_id` is that day**, **in their current state** (`team-tracker.service.ts:2110-2176`). Verified P7:
  - A task created Monday, current on Tuesday and completed Wednesday shows under **Monday as "completed"**.
  - It shows under **neither Tuesday nor Wednesday**.
  - History is therefore not a snapshot, and a past standup cannot be reconstructed.
- **Manager day notes.** These look like they carry over (the live view falls back to the latest prior day row). They vanish the moment today's day row is created (B5).
- **Check-ins.** Visible only on their own day.

**Tracker-only task with carry-forward (API, or Copilot `carry_forward`).**

- A copy is inserted on the target day with `state: planned` (`team-tracker.service.ts:3080-3092`). The original stays `in_progress` on day 1.
- The live board now shows only the copy, because the content keys match and the latest date wins. So **the developer's current task drops back to "planned"** (Verified P1).
- If you then edit the copy's note (the obvious next standup step), the keys no longer match, **the day-1 original comes back as the current item**, and you see two "Build API" tasks: one current with the old note, one planned with the new note (Verified P1).

**Delegated task.**

- Lives as one Desk row plus one Tracker row.
- Rescheduling or carrying forward the Desk item moves the Desk row, then **deletes and re-creates the Tracker row as `planned` under a new id**. The developer's "in progress" disappears (Verified P3; also reachable from Today's "carry forward" command at `server/src/services/today.service.ts:411-423`, and from `RescheduleItemDialog`).

**What the developer sees on My Day** (`GET /api/my-day`, `my-day.service.ts:29-52`, the same `buildLiveDeveloperDay`):

- Inherited tasks carry a "Continued from …" badge (`TrackerItemRow.tsx:286-299`).
- The developer can set current, add notes, and mark done. Their "done" does not close the manager's Desk item.
- If the manager later closes the Desk item, the developer's done row is **deleted** (Verified P4).

**Verdict.** Identity across days is inferred from content, not stored. The lifecycle has three competing mechanisms (live inheritance, copy-based carry-forward, Desk move-with-mirror-rebuild), and each loses a different piece of state.

### W3. What is a task? Why work feels scattered

**Six places a unit of work can live:**

1. Desk inbox, planned, in progress or waiting (`status`).
2. Desk "Later" (`status = backlog`, `DeskRhythmList.tsx:354`).
3. A Desk follow-up. This is a *view*, not a type: category `follow_up` **or** any `followUpAt` (`manager-memory.ts:22-24`). A Desk action with a follow-up time therefore shows up on both Desk and Follow-ups. Follow-ups and Meetings read the **live Desk day** (`ManagerMemoryPage.tsx:54,60`), so their "Closed" lanes only contain items closed *today*.
4. A Tracker task on a developer's day.
5. A delegated Desk↔Tracker pair.
6. A Jira issue, optionally referenced by 3, 4 or 5. The link is not a sync: nothing in `server/src/sync/` touches Tracker or Desk tables, so resolving a Jira issue never updates or flags the linked task.

**How the UI pushes you to choose:**

- **Global capture** (Cmd/Ctrl+I) opens with a *target switch*: Desk / Team / Notes (`GlobalCaptureDialog.tsx:28-32`).
  - Desk asks for kind (4 buttons) and category (9-option select) (`DeskCaptureForm.tsx:128-169`).
  - Team asks for a developer (required before the title field is enabled, `TrackerCaptureForm.tsx:128-146`), and it ignores an incoming developer context (`TrackerCaptureForm.tsx:52-63` handles only `context.issue`).
  - Neither can create a delegated task that you also track. Assignee is absent from every Desk capture dialog (`DeskCaptureForm.tsx`, `ManagerDeskCaptureDialog.tsx`). Only the Follow-ups/Meetings composer has one (`MemoryComposer.tsx:23,66,120`).
- **The Desk's own quick capture** asks for kind (3 options) and category (9) (`QuickCapture.tsx:14-18`). The drawer's kind list omits `waiting` (`DrawerProperties.tsx:11`), while global capture offers it (`DeskCaptureForm.tsx:10`). Items captured as "Waiting" then show as **"Waiting (legacy)"** (`DrawerProperties.tsx:47-56`).
- **Converting between kinds is one-way and awkward:**
  - Tracker → Desk: "Promote" (creates a second record).
  - Desk → Tracker: set an assignee (creates a mirror).
  - A Tracker task cannot be moved to Later. A delegated Desk item cannot be moved to Later either (`manager-desk.service.ts:548-553`; the UI hides the option, `DrawerWorkflowActions.tsx:182-184`).

**Verdict.** "Task" is fragmented by *who executes it* (me vs a developer) and *which page shows it*, not by anything intrinsic to the work. The mirror link that is supposed to unify them is lossy (see W4 and B1–B3).

### W4. When to close a task, and how to refer to it later

**Closing.**

- A **Tracker** task is closed with Done or Drop in the drawer hover, the task drawer, or My Day. Undo is offered through a toast (`TeamTrackerPage.tsx:146-180`). There is no outcome field.
- A **Desk** task is closed with Done or Drop (`cancelled`) and has an optional `outcome` field hidden under "Details" (`DrawerProperties.tsx:28-43`).
- A **delegated** task: the same stacked drawer shows
  - the Execution panel's **"Mark Done"**, which sets the Tracker state to done and keeps the Desk item open (`TrackerTaskExecutionPanel.tsx:119-134`), and
  - the Workflow **"Done" / "Mark done"**, which sets the Desk status to done and **deletes the Tracker row** (`DrawerWorkflowActions.tsx:141-143,178-180`, plus the Details → Status select, `DrawerProperties.tsx:21-23`).

  So "done by the developer" and "done for me" are two independent flags. Setting mine wipes theirs (Verified P4). Today's "Mark done" command does the same thing (`today.service.ts:356-365`).
- **Nothing suggests closing a task** when its linked Jira issue resolves, or when the developer marks it done (no Desk-side prompt).

**Referring to a task later.**

- **Search.**
  - Cmd+K searches Desk items, check-ins, issues, developers and notes. **Tracker items are not included** (`search.service.ts`).
  - Team board search does cover item titles and notes, but only for rows visible in the current live or history projection (`team-tracker.service.ts:749-780`). A task done three weeks ago is effectively unfindable unless you remember its creation day and open that historical date.
- **IDs.** Desk has `#id`. Tracker has none. Tracker ids change on Desk move or reassign (B2).
- **Links.** There are no item URLs. The Desk target passes the item id only through React state (`App.tsx:415-416,518-528`). Team targets ignore `trackerItemId` (`App.tsx:510-516`). You cannot paste a link into a note, a Jira comment or a chat.

### W5. Notes as a daily scratchpad: does the bridge to tasks work?

- **Notes are well built as notes:** idempotent appends with request IDs, revision-based conflict detection, local drafts (`daily-notes.service.ts:323-417`, `NoteCaptureForm.tsx:28-80`). This is the most careful data path in the app.
- **The bridge is one-way and narrow.** Select text, then "Create follow-up". A dialog opens with the title prefilled from the selection and a follow-up time (default tomorrow 09:00) (`NotesFollowUpDialog.tsx:24-98`). The server then:
  - creates a Desk item `{kind: action, category: follow_up, status: planned, followUpAt}` (`daily-notes.service.ts:527-535`), and
  - records `daily_note_follow_ups` (note → item), shown as a "From your … note" badge (`NotesItemSource` in `ItemDetailDrawer.tsx:167`).
- **Gaps:**
  - It cannot create a **Tracker task** for a developer, or a delegated task.
  - It cannot **append** the selection as an update to an *existing* task. This is the most common standup need: "Alice said X about task Y".
  - The selected text becomes the **title** (up to 500 chars). It is not saved as context, so a long selection makes a very long title and the surrounding context is lost.
  - There are no `@developer`, `#JIRA-123` or task references in the note body, and no backlinks from a task's history into notes.
  - The note body keeps no marker of what was extracted. The only backlink is on the item side.

### W6. Capture friction while someone is talking to you

Clicks are counted from the relevant page already open; typing is not counted. "Decisions" are choices you must make before you can save.

| Intent | Fastest path today | Clicks | Decisions | Notes |
|---|---|---|---|---|
| Log "what they said" on their current task (Tracker-only) | Team row → task row → Execution Note → type → Save → Back | 5 | 2 (which field; overwrite or hand-prepend a date) | The overwrite loses the previous record. The developer can overwrite it too. |
| Same, for a delegated task | Team row → task row → pick one of 3 textareas → type → Save (Execution note) or blur (Next move / Notes) → Back | 5 | 3 | The dated log is further down the drawer. |
| Log a general standup remark for a developer | Team row → footer input → type → Enter | 1 | 0 | Fast, but not tied to a task and gone from the drawer tomorrow. |
| Log a remark on a *planned* task | Team row → task row → … | 5 | 2 | The planned list shows no notes, so you cannot see the last remark without opening each task. |
| Assign a new task to this developer | Team row → "Add Task" → type → Enter | 2 | 0 (+2 clicks to attach Jira) | Good. |
| Assign a task *and* track it on my Desk | Cmd+I → Desk → type → Enter → "Open Desk" toast → find item → Assignee select | ~6 plus navigation | 3 (kind, category, assignee) | Alternative: Team add → open task → Promote. It gets labelled "Follow-Up" and is recorded as category `other`. |
| "I'll get back to Alice by Friday" | Cmd+I → Desk → type → category=Follow-up → Enter → open item → Details → Follow-Up datetime | ~7 | 3 | Global capture has no date field. Follow-ups page composer: 1 click + fields. |
| Move a task from Alice to Bob | Tracker-only: **not possible** (drop and re-add, which loses the note). Delegated: open → Assignee select. | — / 3 | — | Reassigning resets the state to planned and changes the id (asserted by a test). |
| Jot something to sort out later | Cmd+I → Notes → type → Cmd+Enter | 1 | 0 | Good, but later conversion to a task is limited (W5). |

---

## 4. Diagnosis: the structural causes

### C1. The developer-day is the container, so task identity is emergent

Both Tracker and Desk items hang off `*_days` rows (`schema.ts:148-192,239-271`). A task that spans ten days is ten days of rows, or one row that is "inherited", or copies. The code then works hard to re-infer "the same task":

- the content-key merge (`team-tracker.service.ts:489-514,2642-2662`)
- lineage chains for legacy Desk copies (`manager-desk.service.ts:1381-1428`, plus a cleanup script at `978-1099`)
- "remaining carryable" arithmetic (`team-tracker.service.ts:2807-2842`)
- `originDate` from the row's day, which for Desk items actually means the *current* scheduled day (`manager-desk.service.ts:1376`)

Every one of the multi-day bugs (B4, B6, B7, B10) follows from this design choice. The day is a good container for **plans and check-ins**. It is the wrong container for **tasks**.

### C2. Two task models joined by a mirror that deletes and rebuilds

The Desk model (rich: kind/category/priority/dates/links, full history snapshots) and the Tracker model (thin: title/state/note/position, no history) describe the same thing whenever a task is delegated. `syncManagerDeskItem` keeps them "in sync" by **deleting and re-inserting** the Tracker row whenever the date or assignee changes, and by deleting it on close (`team-tracker.service.ts:1399-1456`). The desk-side code already has to shuttle the Tracker note around to limit the damage (`manager-desk.service.ts:632-635,929,1686-1689`). Statuses are not mapped either way, so the same drawer shows two workflows, and "Manager status" and "Execution" can disagree indefinitely.

### C3. Context is overwritten in place and spread across 6+ fields

- Tracker `note`
- day `manager_notes`
- check-in `summary`
- Desk `context_note` (dated-by-convention)
- Desk `next_action`
- Desk `outcome`
- Jira `analysis_notes` (dated-by-convention)
- daily note `body`

None of them is an append-only event with an author and a timestamp, except check-ins, which are attached to the day rather than the task. The one "log" pattern (dated headers inside a text blob, `triage-notes.ts`) is a UI convention on a single string. It has length caps and editable history.

### C4. No stable handle for a task

Without a persistent task ID, short key, URL or search index, work cannot be referenced across time, pages, notes or tools, and the Copilot has to resolve tasks by fuzzy title. Once references are not durable, everything downstream (backlinks, "what did I tell Alice about X last week?", metrics) becomes impossible.

### C5. Capture asks for a classification up front, from an overloaded taxonomy

To capture something you must pick:

- a destination (3)
- a kind (3–4)
- a category (9)
- implicitly a status (inbox)
- and, for team work, an owner

Several of these categories overlap with views (`follow_up` category vs `followUpAt`; `waiting` kind vs `waiting` status; `team_management` category vs a developer link). In a meeting, every one of those questions is friction, and the answers are rarely used for anything other than filtering.

### C6. Status belongs to the person-day, not the task, and it has no audit trail

"Blocked" and "at risk" belong to `team_tracker_days`, so you cannot say *which task* is blocked. Changing status from the drawer skips rationale and the check-in trail (`DeveloperDrawerSections.tsx:145-179` vs `team-tracker.service.ts:1675-1719`). Nothing records who created a task, who changed it, or when it changed hands.

### C7. The tests lock in the lossy behaviour

Several of the problems above are asserted by tests:

- `manager-desk.routes.test.ts:856` (closing deletes Tracker work)
- `:986` (reassign resets to planned)
- `team-tracker.service.test.ts:595` (no cross-day demotion)

The code is doing what the tests say. The *model* is what needs to change, and the tests will have to change with it.

---

## 5. Latent bugs and fragile behaviours

Severity reflects impact on your stated workflow.

| # | Severity | Behaviour | Evidence | Status |
|---|---|---|---|---|
| **B1** | High (data loss) | Closing a delegated Desk item (Desk Done, Details→Status Done, Today "Mark done", Copilot) **deletes the developer's Tracker row**, including their done state, `completedAt` and note. My Day loses the completed entry. | `manager-desk.service.ts:2083` → `team-tracker.service.ts:1412-1416`; test `manager-desk.routes.test.ts:856` | Verified P4 |
| **B2** | High | Carry-forward, reschedule or reassign of a delegated Desk item **re-creates the Tracker row**: new id, `state: planned`, current work lost. | `team-tracker.service.ts:1426-1454`, `1378-1394`; reached via `manager-desk.service.ts:894-903,960-969`, `today.service.ts:411-423` | Verified P3 |
| **B3** | High (UX trap) | Two "Done" buttons in the same delegated-task drawer with opposite data effects (B1 vs keep). | `TrackerTaskDetailDrawer.tsx:71-118` renders `TrackerTaskExecutionPanel.tsx:119-134` and `DrawerWorkflowActions.tsx:141-143,178-180` | Code |
| **B4** | High | Tracker carry-forward copies rows as `planned` and leaves originals `in_progress`. The live board hides the original, so current work drops to planned. **Editing the copy's note or title brings the original back** as a duplicate current task. | `team-tracker.service.ts:3080-3092`, key `489-514`, merge `2642-2662` | Verified P1 (reachable via the API or the Copilot `carry_forward` tool) |
| **B5** | Medium–High | Developer drawer "Notes" (`manager_notes`) are per day and **not seeded** into a new day row. The live view shows yesterday's notes until any write (check-in, add task, status) creates today's row, and then they read as empty. Editing prefills yesterday's text and saves it only to today. | `ensureDay` `team-tracker.service.ts:1264-1282` (seeds status/capacity/follow-up, not notes); live fallback `2364,2406` | Verified P5 |
| **B6** | Medium | Two distinct Tracker-only tasks with the same title (and same Jira key and note) for one developer on different days **collapse into one** on the live board. | `buildCarryForwardKey` has no id component (`team-tracker.service.ts:489-501`) | Verified P2 |
| **B7** | Medium | Several `in_progress` rows per developer across days. Setting today's current item leaves older ones in progress; they appear in "Planned" still marked in progress. **Marking the current one done auto-promotes the old one** to current. | `setSingleInProgressForDay` scoped by `dayId` (`team-tracker.service.ts:3224-3232`); planned includes non-current in_progress (`2377-2379`); test `team-tracker.service.test.ts:595` | Verified P6 |
| **B8** | Medium (depends on server timezone) | Tracker `completedItems`/`droppedItems`/`originDate` use `value.slice(0,10)` (UTC date) against a local date. In non-UTC timezones, items finished near midnight **vanish from both Planned and Completed** for that day. Desk already fixed this with local-date parsing. | `team-tracker.service.ts:257-259,2380-2385` vs `manager-desk.service.ts:287-305` and test `manager-desk.routes.test.ts:612` | Verified P8 with `TZ=Asia/Kolkata` |
| **B9** | Medium | Historical Tracker days are not snapshots: they show only rows created or carried that day, **in their current state**. | `team-tracker.service.ts:2110-2176` | Verified P7 |
| **B10** | Medium | The Tracker item "note" is part of the identity key. Any note edit on a task with carried copies forks its identity (the cause of B4). | `team-tracker.service.ts:489-501` | Verified P1 |
| B11 | Medium (privacy) | The per-task "Execution Note" is shared with, and editable by, the developer. It sits next to manager-only fields, so it is easy to write something private there. | `my-day.service.ts:75-86`; `CurrentTask.tsx:96-104` | Code |
| B12 | Low–Medium | The rationale-required status update API exists but no UI uses it. Drawer status changes leave no check-in, rationale or trail. | `useTeamTrackerMutations.ts:174-196` (unused), `DeveloperDrawerSections.tsx:156` | Code |
| B13 | Low–Medium | Live board cost grows with *all history*. Each 30 s poll loads every day row and every item row for every developer since the beginning; issue-assignment lookups load every day row in the workspace. | `team-tracker.service.ts:2276-2310,2694-2724`; `useTeamTracker.ts:32` | Code |
| B14 | Low | The "Waiting" kind can be captured from global capture but is labelled "(legacy)" in the drawer. | `DeskCaptureForm.tsx:10` vs `DrawerProperties.tsx:11,47-56` | Code |
| B15 | Low | Dead or unused code that suggests half-finished flows: `QuickAddTaskModal` (never imported), `useCarryForward` (no UI), `useStatusUpdate`, `getCarryForwardStatus` (`manager-desk.service.ts:356-361`), `source_item_id` lineage code (legacy clone model). The Today confirmation copy still says carry-forward "will create today's carry-forward item" (`TodayPage.tsx:409-414`) although it now moves the item. | as cited | Code |
| B16 | Low | Tracker-only tasks cannot be reassigned. There is no provenance (who created a task: manager, developer or Copilot). | `team-tracker.service.ts:1485-1494`; `schema.ts:177-192` | Code |
| B17 | Low | Follow-ups/Meetings "Closed" counts cover only items closed today, because they read the live Desk day. | `ManagerMemoryPage.tsx:54-62`, `manager-desk.service.ts:1293` | Code |

---

## 6. v2 recommendation: design from the job to be done

### 6.1 Jira-style hierarchy, free-flow, or in between?

**What a manager tracking a team actually needs:**

1. **Who is doing what right now, and is it moving?**
2. **What did we say about it**, including what I told them.
3. **What do I owe, and what am I waiting on?**
4. **Refer back and close cleanly.**

**What you do *not* need from LeadOS:** backlog grooming, estimation, sprint scope, or an epic → story → subtask tree. Jira already does that for the defect stream and is the system of record for it. Copying that hierarchy would double the classification burden (C5) and bring in sync conflicts.

**Pure free-flow (notes and checklists) fails requirements 1 and 4.** Without owner, status and a stable identity there is no board, no "current", no "stale" signal and no way to refer back.

**So: in between.**

- A flat task with an optional one-level parent, for grouping a multi-week piece of work into a few concrete steps. No deeper nesting.
- Strong identity.
- An append-only timeline.
- Views instead of types.

### 6.2 The minimal model

```
task
  id                INTEGER PK
  key               TEXT UNIQUE         -- human handle, e.g. "T-142" (per workspace sequence)
  title             TEXT
  owner_type        'manager' | 'developer'
  owner_id          TEXT NULL           -- NULL = inbox (unassigned, just captured)
  status            'open' | 'active' | 'blocked' | 'done' | 'dropped'
  later             BOOLEAN             -- "someday/Later" is a flag, not a status
  parent_id         INTEGER NULL        -- one level only (group / initiative)
  due_at            TEXT NULL           -- commitment date
  follow_up_at      TEXT NULL           -- "check back on" reminder (drives Follow-ups view)
  priority          'normal' | 'high'   -- two levels are enough for a personal tool
  created_by        (type, id)          -- manager / developer / copilot / note
  created_at, updated_at, closed_at
  outcome           TEXT NULL           -- one line on close (optional prompt)

task_event            -- append-only timeline; the "running record"
  id, task_id, at, author_type, author_id
  type        'update' | 'instruction' | 'decision' | 'blocker' | 'status' | 'assign'
              | 'focus' | 'link' | 'note_ref' | 'close' | 'reopen'
  body        TEXT NULL
  visibility  'shared' | 'private'     -- private = manager-only, never on My Day
  meta        JSON NULL                -- {from,to} for status/assign, noteId, checkInId…

task_link             -- replaces jira_key / related_jira_keys / manager_desk_links(issue)
  task_id, kind ('jira'|'person'|'external'|'task'), ref

day_focus             -- optional per-person daily plan / "current" pointer (projection, not identity)
  date, owner_id, task_id, position, is_current

checkin               -- keep, but allow task references
  … existing fields … + task_ids JSON / checkin_task join
meeting               -- optional: a light entity (title, time, participants, notes)
                      -- whose action items are just tasks with parent/meeting link
```

**Rules that follow from the model:**

- **Identity is the task row.** Carry-forward disappears as a concept. An open task is simply open until it is closed. Plans are projections (`day_focus`) that can reference the same task on many days.
- **One status, one owner.**
  - Delegating means `owner = developer`.
  - "I'm tracking it" is a *view*: tasks I created, I follow, or with a `follow_up_at`. It is not a second record.
  - Developer "done" means done. The manager can reopen, and that reopen is itself an event.
  - Nothing is ever deleted by a status change.
- **"Current" is one per owner:** `status = active`, enforced across the owner, not per day.
- **Blocked is a task status**, with a required `blocker` event. The person-day status can then be *derived* ("Alice is blocked because T-142 is blocked") instead of set by hand.
- **History is a replay of `task_event`.** Past standups become reconstructible. The Desk's snapshot history can be migrated into events.
- **Jira stays linked, not mirrored.**
  - A Jira issue can be "adopted" as a task in one click, with the title prefilled and a link added.
  - Show the Jira status next to the task.
  - Raise a signal when Jira is resolved but the task is open, or the other way round.
- **Meetings, decisions and follow-ups are not task *types*:**
  - A decision is a `decision` event, or a task closed with an outcome.
  - A follow-up is any task with `follow_up_at`.
  - A meeting is a lightweight record whose action items are tasks.

### 6.3 Interaction model

**Standup mode** (the highest-value change). In the developer drawer, one row per open task, current first:

- `T-142 · Build billing API · active · 6d · "blocked on auth" (Tue)`, showing the last event inline and the age.
- **One text box per row, always visible.** Enter adds an `update`. A small toggle switches the entry to `instruction` ("what I told them") or `private`. Keyboard: ↑/↓ moves between tasks, Enter logs, `d` marks done, `b` marks blocked, `s` sets current.
- A **"Since last standup"** strip: new events from the developer (My Day notes, check-ins, status changes) since the previous standup timestamp.
- **Add task** inline at the bottom, same as today.
- A general remark with no task still goes in as a check-in, and it can mention `T-142`.

**Capture: one box, with the details inferred rather than asked for.**

- Type `@alice fix login redirect #PROJ-12 !fri`. That creates a task owned by Alice, linked to PROJ-12, due Friday.
- No `@` means it goes to your inbox (owner = you).
- `later` or `/l` sets the Later flag.
- Kind and category are dropped from capture. If filtering needs them, use tags.

**Desk** becomes "My tasks" (owner = me) plus "Watching" (tasks I delegated or follow, with due or follow-up dates) plus Inbox triage. The existing rhythm (Now / Needs triage / Planned / Later / Done) stays as grouping over the unified task set.

**Follow-ups** is a view: tasks with `follow_up_at`, grouped Overdue / Today / Upcoming, including delegated ones.

**Notes:**

- `T-142`, `@alice` and `#PROJ-12` are recognised in the note body and rendered as chips. Each mention writes a `note_ref` event on the task, so the task timeline links back to the note.
- Selection actions: **Create task**, **Add as update to…** (task picker), **Create follow-up**.
- Notes stay private.

**My Day** shows the same tasks (owner = developer):

- `shared` events are visible; `private` events are never shown.
- The developer's own updates land in the same timeline, marked with the developer as author.

**Referencing:**

- Every task gets a URL, `/t/T-142`, that opens the task drawer from anywhere.
- Cmd+K searches task keys, titles and event bodies.
- The Copilot resolves `T-142` directly.

### 6.4 What to remove

- Tracker-only carry-forward (copy semantics), `buildCarryForwardKey` identity, and the `source_item_id` lineage code.
- The Desk↔Tracker mirror (`syncManagerDeskItem`, `promoteTrackerTask`, `cancelDelegatedTask`, the delegated-vs-manager status split).
- `team_tracker_days.manager_notes`, replaced by private task events or a person-level private note.
- `kind`/`category` at capture; the dual "waiting" meaning; "Later" as a status.

---

## 7. Ranked improvements and phasing

Impact is measured against the standup and multi-day workflows. Effort is rough: S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–3 weeks.

### Phase 0: stop losing data (current model, no schema change)

| Rank | Change | Fixes | Effort |
|---|---|---|---|
| 1 | Closing a delegated Desk item sets the Tracker row to `done`/`dropped` (with `completedAt`) instead of deleting it. `cancelDelegatedTask` sets it to `dropped`. Update the tests at `manager-desk.routes.test.ts:856,917`. | B1, B3 (half) | S |
| 2 | `syncManagerDeskItem`: when the date or assignee changes, **update** `day_id` (move to the new owner's day row) and keep `state`/`note`/`id`. Only reset the state when the owner actually changes, and even then consider keeping it. Update the test at `:986`. | B2 | S |
| 3 | Make the drawer have one Done. For delegated tasks, the Workflow "Done" either maps to "mark execution done and close", or asks which one you mean. Relabel "Manager status" to "My follow-through". | B3 | S |
| 4 | Tracker carry-forward should **move** the row (update `day_id`) or be removed, since live inheritance already covers visibility. At minimum, take `note` out of the identity key and copy the `state`. | B4, B10 | S |
| 5 | `setSingleInProgressForDay` should demote every live `in_progress` row for the developer, not just same-day rows. Update the test at `team-tracker.service.test.ts:595`. | B7 | S |
| 6 | Seed `manager_notes` in `ensureDay`, or better, move it to a developer-level field. | B5 | S |
| 7 | Use local-date parsing in the Tracker, matching the Desk's `isoDatePart`. | B8 | S |
| 8 | Show recent check-ins (last 7 days) in the drawer. Show the note and the age on planned rows. Pass `viewDate` so "Continued from" renders for managers too. | W1 friction | S |
| 9 | Add Tracker items to `/api/search` and the palette. | W4 | S |

### Phase 1: stable handles and a task timeline (additive schema)

| Rank | Change | Why | Effort |
|---|---|---|---|
| 10 | Add a `task_key` (sequence) to Desk and Tracker rows. Display it everywhere. Add a `/t/:key` route that opens the right drawer. | C4 | M |
| 11 | Add a `task_event` table, keyed by `(source, id)` for now: Tracker item id, or Desk id for delegated pairs. Log status changes, assignments and focus changes automatically. Migrate the existing `note` and `context_note` dated sections into initial events. | C3, B9 | M |
| 12 | **Standup rows**: inline "log update" on every task row in the developer drawer, with the last event inline, plus the instruction/private toggle. Retire the Execution Note textarea into the timeline. | W1 | M |
| 13 | Record `created_by` on Tracker items. Allow reassigning Tracker items (it becomes an event). | B16 | S |
| 14 | Notes: "Add as update to task…" and "Create task for @dev" selection actions. Recognise `T-###` in note bodies and write `note_ref` events. | W5 | M |
| 15 | Wire the drawer status select to `recordStatusUpdate`, so changes carry a rationale and a trail. | B12 | S |

### Phase 2: unify storage (one `tasks` table)

1. Create `tasks`, `task_links` and `day_focus`. Promote `task_event` to reference `tasks.id`.
2. **Backfill:**
   - Each Desk item becomes a task (owner = manager, or the assignee if set).
   - Each Tracker row linked by `manager_desk_item_id` is **merged** into that task: execution state becomes the status, the note becomes an event.
   - Tracker-only rows are grouped into lineages by carry-forward key and day order (the same heuristic as today, run once), and each lineage becomes one task.
   - Jira keys become `task_links`.
   - Desk history snapshots become events.
   - `daily_note_follow_ups` becomes `note_ref` events.
3. Keep the old tables read-only for a release. Add compatibility views so the old My Day and Today code paths can be switched one by one.
4. Replace `buildLiveDeveloperDays` with `SELECT … FROM tasks WHERE owner = ? AND status NOT IN (done, dropped) OR closed_at::date = ?`. This also fixes B13.
5. Retire carry-forward (Desk and Tracker). Replace "reschedule" with editing `due_at` / `follow_up_at` or `day_focus`.

**Risk:** the lineage backfill for Tracker-only rows is heuristic. Run it in dry-run first with a report, as `manager-desk:cleanup-carry-forward` already does. Keep the original row ids in `meta` so the result can be audited.

### Phase 3: interaction redesign

- A single smart capture box (with parsing) replaces the three-way target switch.
- Desk becomes "My tasks / Watching / Inbox"; Follow-ups and Meetings become saved views.
- A "Standup mode" route with keyboard flow and "since last standup".
- Derive the person-day status from task statuses, with a manual override.
- Jira reconciliation signals (resolved in Jira but open in LeadOS, and the reverse).

---

## 8. Things you didn't ask about but should consider

1. **Privacy boundary.** Today the private/shared line runs through *fields* (the Tracker note is shared; day notes and Desk fields are private). A per-event `visibility` flag is simpler and safer. A developer's My Day should never render a private event, and that should be enforced in the service, not only in the UI.
2. **Authorship and provenance.** There is no record of who created, reassigned or closed a Tracker task: manager, developer or Copilot. With a Copilot that can write (`tools.ts` registers about two dozen confirm-gated write tools, from `manager_action` at line 928 onward), provenance matters for trust. Record `author_type = copilot` on events.
3. **The Copilot can trigger the lossy paths.** `carry_forward`, `update_desk_item {status: done}` and `cancel_delegated_task` all lead into B1, B2 and B4. The Phase 0 fixes also make the assistant safer.
4. **Performance ceiling.** The live board rebuilds from all history on every 30 s poll (B13). This gets worse as history grows and will eventually hurt. The unified model makes it an indexed query.
5. **"Blocked" should be a property of a task.** Person-level status forces you to remember which task was blocked. Task-level blockers also make the "waiting on others" view possible.
6. **Capacity is a task count.** `capacity_units` compares against the number of assigned items (`team-tracker.service.ts:361-365`), so ten tiny tasks look "over capacity" and one huge task looks "under". Either drop capacity or make it explicit, such as focus slots per day.
7. **Timezone correctness is split.** The Desk handles local dates; the Tracker does not (B8). Pick one date utility for the server.
8. **Performance and quality metrics become possible with the timeline.** Examples: cycle time per task, number of times a task was reopened, how long blockers lasted, and stale tasks (no event in N days). These fall out of `task_event` at no extra cost and are useful for 1:1s and reviews, without adding Jira-style process.
9. **1:1 support.** A per-developer "private notes and recurring topics" space is currently squeezed into `manager_notes` (per-day, ephemeral). A developer-level private timeline (events with no task) would cover 1:1 prep.
10. **Tests.** Phase 0 changes will fail existing tests on purpose (C7). Treat those tests as the specification being revised, not as regressions.

---

## Appendix A: verification probes

All probes called the real services (`TeamTrackerService`, `ManagerDeskService`) against a temporary SQLite DB, using the repo's `resetDatabase()` helper and fake timers. They ran from `/tmp`, and the files were deleted afterwards.

| Probe | Steps | Observed |
|---|---|---|
| **P1** | Tracker-only "Build API" (note "day1 note") set current on 03-09. Next day, `carryForward(03-09→03-10)`, then edit the note on the visible row. | Before carry-forward: current = id 1. After: **current = null**, planned = id 2 (copy). After the note edit: **current = id 1 "day1 note"** *and* planned = id 2 "day2 standup…", i.e. a duplicate. |
| **P2** | Two separate tasks titled "Code review" created on 03-08 and 03-09. | Live board shows **one** task (id 2). |
| **P3** | Delegated Desk item assigned to the developer; Tracker row set current with a note; `desk.carryForward(03-09→03-10)`. | Tracker row id **1 → 2**, state **in_progress → planned**, note kept. |
| **P4** | Delegated Desk item; developer marks the Tracker row done with note "merged PR 42"; manager sets Desk status done. | Before: developer's completed = ["Fix flaky test"]. After: **0 Tracker rows**, developer's completed = []. |
| **P5** | `updateDay(03-09, managerNotes)`; next day read the board, then add a check-in, then read again. | Before the check-in: notes shown. After: **managerNotes = null**. |
| **P6** | Task A current on 03-09; on 03-10 add B and set it current; then mark B done. | After setting B: current B, planned contains **A still `in_progress`**. After B done: **current = A**. |
| **P7** | Task created Mon, set current and checked in Tue, done Wed; view history on Thu. | Mon: **completed = [task]**. Tue: no task (1 check-in). Wed: no task. |
| **P8** | `TZ=Asia/Kolkata`, clock 02:00 local on 03-10; add a task for 03-10 and mark it done. | 03-10 live view: completed = [], planned = []. **The task is not shown at all.** |

## Appendix B: file index for the traced paths

- **Schema:** `server/src/db/schema.ts`, `server/src/db/migrate.ts`
- **Contracts:** `shared/types.ts:530-1153`
- **Tracker:** `server/src/services/team-tracker.service.ts`, `server/src/routes/team-tracker.ts`, `server/src/services/my-day.service.ts`, `server/src/routes/my-day.ts`
- **Desk:** `server/src/services/manager-desk.service.ts`, `server/src/routes/manager-desk.ts`
- **Today:** `server/src/services/today.service.ts`
- **Notes:** `server/src/services/daily-notes.service.ts`, `server/src/routes/notes.ts`
- **Search:** `server/src/services/search.service.ts`
- **Copilot tools:** `server/src/assistant/tools.ts`
- **Team UI:**
  - `client/src/components/team-tracker/TeamTrackerPage.tsx`
  - `client/src/components/team-tracker/DeveloperTrackerDrawer.tsx`
  - `client/src/components/team-tracker/DeveloperDrawerSections.tsx`
  - `client/src/components/team-tracker/TrackerItemRow.tsx`
  - `client/src/components/team-tracker/TrackerItemRowActions.tsx`
  - `client/src/components/team-tracker/TrackerTaskDetailDrawer.tsx`
  - `client/src/components/team-tracker/TrackerTaskExecutionPanel.tsx`
  - `client/src/components/team-tracker/AddTrackerItemForm.tsx`
- **Desk UI:**
  - `client/src/components/manager-desk/ItemDetailDrawer.tsx`
  - `client/src/components/manager-desk/DrawerHeader.tsx`
  - `client/src/components/manager-desk/DrawerWorkflowActions.tsx`
  - `client/src/components/manager-desk/DrawerPrimaryFields.tsx`
  - `client/src/components/manager-desk/DrawerProperties.tsx`
  - `client/src/components/manager-desk/DrawerNotes.tsx`
  - `client/src/components/manager-desk/QuickCapture.tsx`
  - `client/src/components/manager-desk/DeskRhythmList.tsx`
  - `client/src/components/manager-desk/DeskItemCardPrimitives.tsx`
- **Capture:**
  - `client/src/components/capture/GlobalCaptureDialog.tsx`
  - `client/src/components/capture/DeskCaptureForm.tsx`
  - `client/src/components/capture/TrackerCaptureForm.tsx`
  - `client/src/components/capture/NoteCaptureForm.tsx`
- **Notes UI:** `client/src/components/notes/NoteDocument.tsx`, `client/src/components/notes/NotesFollowUpDialog.tsx`
- **Memory views:** `client/src/components/manager-memory/ManagerMemoryPage.tsx`, `client/src/lib/manager-memory.ts`
- **My Day UI:** `client/src/components/my-day/CurrentTask.tsx`, `client/src/components/my-day/QuickUpdates.tsx`
- **Routing and search:** `client/src/App.tsx`, `client/src/components/palette/paletteItems.ts`
- **Hooks:** `client/src/hooks/useTeamTracker.ts`, `client/src/hooks/useTeamTrackerMutations.ts`
