# Work Item Model v2 — Persistent Tasks, Item Timelines, and the Standup Workflow

**Date:** September 24, 2026
**Status:** Proposal — review and brainstorm output, no code changes
**Audience:** Product, frontend, backend
**Related docs:** `docs/26-team-tracker-manager-review-and-enhancement-roadmap.md`, `docs/28-manager-workflow-review.md`, `docs/33-team-tracker-simplification-redesign.md`, `docs/40-today-v2-actionable-manager-cockpit.md`, `docs/44-manager-experience-review-top-5.md`

---

## 1. Origin

This review was triggered by a concrete daily workflow complaint:

> During standup I open a developer on the Team page, see their tasks and current work, and they tell me what happened. I want to keep a small running record per task — what happened, what's going on — but there is no good place to put it. Tasks can span days or weeks, and I can't tell when to close one or how to refer to one. Some tasks are on the desk, some on the team board, some marked "later" — there is no clear structure.

The diagnosis below is a data-model finding, not a UX finding.

---

## 2. Root cause: the app stores days, not tasks

LeadOS has three objects that all behave like "a task," with different identity and lifecycle rules:

| Thing | Table | Identity across days | Lifecycle |
|---|---|---|---|
| Jira issue | `issues` | Stable (`jiraKey`) | Owned by Jira |
| Tracker item | `team_tracker_items` | None — cloned per day | `planned → in_progress → done/dropped` |
| Desk item | `manager_desk_items` | Stable (row moves between days) | `inbox → planned → in_progress → waiting/backlog → done/cancelled` |

The tracker item — the thing a manager actually assigns to a developer — is the weakest object in the system.

### 2.1 Tracker items are day-scoped rows cloned by carry-forward

`carryForwardTrackerOnlyItems` inserts a **new row** on the target day, copying `title`, `note`, `jiraKey`, `relatedJiraKeys`, and hard-resets `state: "planned"` — even when the source was `in_progress` (`server/src/services/team-tracker.service.ts:3079-3095`). The old row stays open on the old day.

### 2.2 Cross-day identity is a heuristic

The live board decides "these clones are the same task" via `buildLiveWorkspaceItemKey`: `manager_desk:{id}` for linked items, otherwise `tracker:` + JSON of `jiraKey, relatedJiraKeys, title, note` (`team-tracker.service.ts:489-514`). `getLiveCanonicalItemRows` then keeps only the most recent row per key (`team-tracker.service.ts:2642-2662`).

### 2.3 Latent bug: editing a carried item forks it

`note` and `title` are both inputs to the identity key, and both are editable on tracker-only items (`updateItem`, `team-tracker.service.ts:1485-1557`; the title guard at line 1498 applies only to desk-linked items). Carrying a task forward and then editing its note or title changes the clone's key — the stale open row on the old day no longer dedupes, and **two open items appear on the live board**. The most natural "update the task" gesture corrupts identity.

### 2.4 There is no per-task timeline

The standup question — *what is going on with this particular task* — has no home:

- `team_tracker_items.note`: one mutable blob, overwritten each edit, no timestamp, no author ([`TrackerTaskExecutionPanel.tsx:162-230`](client/src/components/team-tracker/TrackerTaskExecutionPanel.tsx)). Also an identity-key input (§2.3).
- `team_tracker_checkins`: timestamped and authored, but keyed to `dayId` — the developer's day, not a task ([`schema.ts:194-205`](server/src/db/schema.ts); `addCheckIn`, `team-tracker.service.ts:1611-1673`). Task updates dissolve into a mixed per-day feed.
- `team_tracker_days.manager_notes`: one blob per developer per day.
- `manager_desk_item_history`: snapshot rows exist for desk items but power restore/audit, not a readable narrative; nothing renders them.

### 2.5 Status lives on the wrong entity

`blocked`/`at_risk`/`waiting` are properties of `team_tracker_days` — the *developer's day* — not of any task (`schema.ts:148-164`). A task cannot be blocked; only a person can. The backend already requires `rationale` when a status is set to blocked/at_risk (`requiresStatusRationale`, `team-tracker.service.ts:199`; `recordStatusUpdate`, lines 1675-1719), but no client component calls `useStatusUpdate` — the structured blocker capture is a wired-but-unreachable contract (also flagged in doc 44).

On the desk side, `waiting` is a near-dead status: it renders as "Follow-up" in one map and "Planned" in `STATUS_LABELS` ([`client/src/types/manager-desk.ts:40,59`](client/src/types/manager-desk.ts)).

### 2.6 Two task systems, partial sync

Desk items are healthier: carry-forward *moves* the row to the new day (`manager-desk.service.ts:883-892`, `moveLinkedItemsToDate` lines 914-976) and history snapshots are recorded per change. But the desk↔tracker bridge is display-level:

- `syncManagerDeskItem` creates/updates/deletes the mirrored tracker item (`team-tracker.service.ts:1399-1456`).
- Tracker-side state changes only bump the desk item's `updatedAt` via `touchManagerDeskItems` (`team-tracker.service.ts:3163-3173`, used at lines 1551-1553). A developer finishing a delegated task leaves the desk item open — the divergence doc 28 called out is still live.
- `delegatedExecution` mirrors state for rendering, not as a shared lifecycle.

### 2.7 Tracker-only tasks are unreferenceable

Global search returns issues, desk items, check-ins, developers, and notes — no tracker items (`GlobalSearchResponse`, `shared/types.ts:1007-1014`; `search.service.ts` has no tracker coverage). A custom task has no stable ID, no URL, no palette result. Only Jira-linked tasks inherit a referable identity. "How do I refer to this task?" is literally unanswerable for tracker-native work.

### 2.8 No closure signal for multi-day work

`originDate` is computed and returned on `TrackerWorkItem` (`shared/types.ts:562`) and used internally for "carried" detection (`workbench-utils.ts`), but nothing surfaces "this task has been open 9 days" or "dropped twice." A multi-week task is indistinguishable from a fresh one, and marking today's clone `done` resolves that clone — not the task.

---

## 3. What prior reviews already established

This finding is the item-side twin of doc 44's "the app knows days and items, but not people." Related prior work:

- Doc 26 (TTM-02) proposed structured blocker/risk capture — still unimplemented end-to-end (§2.5).
- Doc 28 identified the delegated-lifecycle and carry-forward trust gaps — partially addressed (desk items now move rather than clone), still divergent on status (§2.6).
- Doc 40 Phase 5 proposed a guided standup flow; `standupPrompts` exists in the contract (`shared/types.ts:328-335`) but no guided capture was built.
- Docs 33/34 simplified the board and drawer — the remaining confusion is underneath the UI.

---

## 4. v2 direction: persistent work items, days as projections

The model to adopt is Sunsama/Linear, not Jira: **tasks are persistent objects; a day is a placement of tasks.** Today the day owns the task. Invert that.

### 4.1 One `work_items` entity

Converge `team_tracker_items` and `manager_desk_items` into a single persistent table:

- `title`, `kind` (task / follow-up / decision / meeting / waiting — the existing `ManagerDeskItemKind` enum generalizes), `priority`, `category`, `assignee`, `createdBy`
- `status`: `inbox → planned → active → done | dropped | cancelled`; `waiting` as a first-class flag with `waitingOn`, `reason`, `expectedAt`
- Links: Jira issues, people, notes, other items (generalize `manager_desk_links`)
- Tags: extend `local_tags` to work items, not just Jira issues

A thin `day_plans` table — `(date, developerAccountId, workItemId, position, isCurrent)` — makes Team board, My Day, and "planned today" views over persistent items. Carry-forward stops being an operation: unfinished items are simply still present tomorrow. "Set current" toggles a plan-entry flag instead of mutating the task's only state field.

This single move eliminates cloning, the dedupe heuristic, the identity-fork bug, the `in_progress` reset, and the desk↔tracker sync surface.

### 4.2 Per-item activity stream — the highest-value change

```
work_item_updates: id, workItemId, authorType, authorId, kind, text, createdAt
```

`kind` covers `note | status_change | blocker | handoff`. Standup updates land on the task's timeline, authored by manager or developer; state transitions write automatic entries so the timeline doubles as the audit log — generalizing `manager_desk_item_history` into something humans read.

This is the direct answer to "a little bit of a summary to keep track of this task." It is also why heavy structure is unnecessary: the timeline carries the story.

### 4.3 Structure: shape, not hierarchy

Do **not** add Jira-style epic/story/subtask. The right amount of structure for a personal manager tool:

- Flat items + typed links (`blocks`, `relates to`, `follows up on`, `spawned from`). An "epic" emerges as an item other items link to; add a plain `parentId` later only if the need persists.
- Soft typing via `kind`/`category`/tags — already in the model.
- The structure that matters is lifecycle + timeline, not folders. The user's actual confusion is "what state is this in and what happened," not "where is it filed."

### 4.4 Closure rules

- `done` means the work is done — once, permanently; days show what happened today.
- Signals for *when* to close or escalate: "active N days, no update in M" (trivially computable once items persist), "dropped twice," "waiting past `expectedAt`."
- `waiting`/`blocked` become item-level states with `waitingOn`/`reason`/`expectedAt`; an item auto-surfaces when its follow-up time passes — scheduling the manager's attention instead of relying on memory (cf. doc 26 TTM-09).

### 4.5 Referenceability

Stable short ID (`W-42`) on every item; deep-linkable (`/team?item=42`); indexed in Cmd+K `/api/search`; mentionable in notes and Copilot tools. Tracker-native work becomes addressable for the first time.

### 4.6 Guided standup

Build the doc-40 Phase 5 flow on the new substrate: step through developers → current item + latest updates → one input per item writes to its timeline → optional status change with rationale (wiring the existing unreachable `/status-update` contract). One capture feeds both the item timeline and the developer's day check-in.

### 4.7 Notes stay free; items stay structured

Keep the private daily scratchpad as-is. Extend the existing bridge (`daily_note_follow_ups` → `managerDesk.createItem`, `daily-notes.service.ts:482-548`): link an existing work item from a note line, and render backlinks on the item timeline ("mentioned in Sep 20 note"). Free-flow capture, structured work.

---

## 5. Direct answers to the review questions

- **"Is there a structure like Jira stories/subtasks — should we add one?"** No hierarchy needed. Add persistence + timeline + references; keep grouping emergent via links/tags. Revisit `parentId` only after living with it.
- **"Where do standup updates about a task go?"** Today: nowhere — that's the core gap. v2: the item's activity stream, written once from the drawer or guided standup.
- **"When do I close a task?"** When its work is done — a single terminal transition on a persistent item, aided by age/staleness/dropped-count signals.
- **"How do I refer to a task?"** Today: only Jira tasks are referable. v2: stable `W-n` ID, URL, search, palette, notes/Copilot mention.
- **"Why does it feel scattered across desk/team/later?"** Because they are three tables with three lifecycles and partial sync. Converge on one item substrate; keep the *surfaces* distinct.

---

## 6. Concrete issues found (fixable independently of v2)

| # | Issue | Evidence |
|---|---|---|
| 1 | Editing note/title on a carried tracker item forks its identity → duplicate open items | `team-tracker.service.ts:489-514`, `2642-2662`, `1485-1557`, `3079-3095` |
| 2 | Carry-forward resets `in_progress` → `planned` | `team-tracker.service.ts:3087` |
| 3 | Developer-side completion doesn't move the linked desk item's status (only `updatedAt`) | `team-tracker.service.ts:3163-3173`, `1551-1553` |
| 4 | Tracker items absent from global search | `shared/types.ts:1007-1014`, `search.service.ts` |
| 5 | `waiting` desk status mislabeled "Follow-up"/"Planned"; per-item blocked impossible | `client/src/types/manager-desk.ts:40,59`; `schema.ts:148-164` |
| 6 | `/status-update` rationale contract unreachable — `useStatusUpdate` unused outside tests | `client/src/hooks/useTeamTrackerMutations.ts:174-185` |
| 7 | Check-ins are day-scoped, not item-scoped — no per-task update path exists | `schema.ts:194-205` |

---

## 7. Phased plan

| Phase | Change | Rationale |
|---|---|---|
| 0 | `item_updates` table attached to existing tracker + desk items; "add update" input in the task drawer and execution panel | No migration; solves the standup-capture pain immediately; the stream is reusable post-merge |
| 1 | Tracker items become persistent (move, don't clone — mirror the desk carry-forward); delete the heuristic dedupe | Foundation for everything; desk already proves the pattern |
| 2 | Item-level `waiting`/`blocked` + `waitingOn`/`expectedAt`; merge tracker/desk items into `work_items` + `day_plans`; status sync dies with the split | Ends divergence; legible lifecycle |
| 3 | Stable IDs + search indexing + guided standup + notes backlinks | Referenceability and capture UX |
| 4 | Optional `parentId`/grouping; weekly review built on the activity stream (doc 44 #3) | Emergent structure; hindsight pays back captured data |

Phase 0 alone removes the daily friction that prompted this review; Phases 1–2 remove the class of bugs in §6.

---

## 8. Guardrails

- Keep capture friction at one field: a title is a valid work item; everything else is optional enrichment.
- Keep surfaces distinct (Today / Team / Desk / My Day) — unify the substrate, not the UI.
- Don't recreate Jira. If a feature needs a Jira field to work, it belongs on `/work`.
- Manager privacy boundary stays: developer-visible updates vs manager-private notes must remain explicit.
- Migration must preserve history: every existing day row and clone chain maps to an item + its placements.
