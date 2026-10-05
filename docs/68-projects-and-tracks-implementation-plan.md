# Private Projects and Tracks

Manager-private Project → optional Track → Tasks inside the existing Tasks workspace. Membership is independent of task ownership, dates, labels, meetings and parentage. No automatic classification of existing tasks.

Names are unique per manager (projects) and project (tracks), including archives. Containers support outcome, latest dated summary and archive/restore. Archived containers remain readable but reject placement.

Placement previews identify visible selected tasks and optional descendants, capped at 200. Writes revalidate the exact set and expected placements atomically; guarded Undo follows the same validation. Capture accepts explicit placement, null clearing and parent inheritance in its creation transaction.

Facts reuse visible Tasks and local date/Later/meeting signals. Private context appears only on manager responses. Purges and resets remove appropriate private records; SQLite backups include tables.

URLs: `/tasks?view=projects&project=<id>&track=<id>`; standard task views also accept project/track overrides (`none`, `all`). Existing task interactions remain available.

## Delivery

- HIER-01: contracts, additive schema, scoped persistence and APIs.
- HIER-02: guarded placement, visibility, filters and facts.
- HIER-03: overview, drill-down, URLs and lifecycle.
- HIER-04: placement, contextual capture and subtasks.
- HIER-05: Today, cache and maintenance.
- HIER-06: synthetic verification, documentation and handoff.

No shared permissions, nested tracks, completion percentages, dependency graph, target dates, Jira project sync, permanent deletion, track relocation or Copilot tools. Push and deployment require a separate request.

## Experience and rules

The success criterion is finding the project or track needing intervention and opening its next action within one minute. `/tasks` continues to default to Planned today. Projects is one rail/mobile-picker entry, with an alphabetical active overview and an archive filter. Project/track breadcrumbs push browser history; standard task search, filters, selection, drawer, keyboard controls and actions are reused. An unavailable destination hides its task list.

Creation requires only a name. Outcome and latest manager-written summary are optional, with a separate summary timestamp. Calculated facts are open task count, blocked work, overdue work, due follow-ups, and earliest check linked to its task. Facts use the requesting manager's visible DTO fields, local date and Later resurfacing rules; meetings are never overdue. Each project task counts once regardless of track. Empty tracks say “No tasks yet”; no dated follow-up says “No check scheduled.”

Project fields in the drawer and row/selection actions share a searchable placement dialog. “No project” removes membership; projects allow “No track” or an active track. Include subtasks starts unchecked. The preview lists the exact visible task keys and titles and the affected count, deduplicating overlapping roots. Traversal may cross inaccessible ancestry but never returns or changes inaccessible tasks. Task parentage, ownership, labels, activity timestamps and events are unaffected by moves. Guarded Undo uses the acknowledged postimage and rejects archived destinations.

Inline capture preselects the current project/track. Global capture shows contextual placement explicitly and allows changes or clearing; unrelated sessions start without placement. Placement affects only task creation. New children inherit private placement unless the caller overrides it or sends null. Ordinary drawers offer subtask capture; meetings retain action capture. Visible nondeleted direct children contribute to row completion counts; dropped children are excluded. Lists stay flat and parent completion remains independent.

## Persistence and interfaces

`projects`, `project_tracks` and `task_placements` are separate additive SQLite/Drizzle tables. Scope is `(workspace_id, manager_account_id)`; projects have unique names in that scope and tracks within their project, including archives. Composite foreign keys constrain membership to the correct workspace task and project/track scope. Each task has at most one membership per manager. Existing tasks start unplaced. Task visibility is shared between view candidates, membership validation and descendant results; losing visibility retains membership but removes it from reads/totals. Manager DTO placement reads are batched and scoped; developer/former-owner responses carry none.

| Interface | Behavior |
|---|---|
| `GET /api/projects?today=&tz=&archived=true` | Private alphabetical list with derived facts |
| `GET /api/projects/:id?today=&tz=` | Project, tracks and facts, including archived records |
| `POST /api/projects`, `PATCH /api/projects/:id` | Name, outcome, summary, archive/restore |
| `POST /api/projects/:id/tracks`, `PATCH /api/project-tracks/:id` | Scoped track creation/editing and lifecycle |
| `POST /api/task-placements/preview` | `{keys, includeSubtasks}` → exact keys, titles and expected placements |
| `POST /api/task-placements/bulk` | Preview plus one destination; atomic revalidation and an Undo receipt |
| Undo through the same bulk endpoint | Previewed postimage plus per-task prior placements; all-or-nothing guards |
| Task view definitions | `filters.project`/`filters.track`: numeric id or `none`; URL `all` clears inherited filters |
| Capture defaults | `placement: {projectId, trackId}` or null, applied in the task-creation transaction |

All endpoints are manager-only. Bulk size is at most 200 visible tasks including descendants. Submission rechecks the visible task set, destinations and expected placements before writing. Capture retains request-ID replay; invalid destinations roll back creation, links, focus and events. Placement and container writes invalidate Today's server cache and authenticated task/project query contexts.

Archiving a project hides its tracks through the parent state and prevents new placement. Restoring preserves independently archived tracks. Archived work remains actionable. No relocation or permanent container deletion is exposed.

## Maintenance and verification

Task purge deletes all associated memberships. Manager task reset and private-data purge delete that manager's containers and membership. Workspace reset removes all project data in that workspace; team-only reset preserves containers while purged tasks lose membership. Reset/private-deletion previews include counts. Existing SQLite snapshots include all new tables; restore remains CLI-only.

Automated project tests cover scoped routes, independent managers, developer/former-owner privacy, inaccessible ancestry, distinct filters/counts, local timezone boundaries, Later resurfacing, private follow-up visibility, chronological checks, meeting overdue behavior, closed/dropped children, stale/conflicting/overlapping moves, Undo, invalid/archived destinations, capture replay/inheritance/clearing/rollback, the 200-task cap, additive migration, task purge, manager/workspace/team reset, private-data deletion and isolated backup restoration. Frontend tests cover URL filter roundtrips and explicit clearing, rail/mobile navigation, capture defaults, ordinary child creation and late mutation responses across login changes; existing drawer/keyboard/task interaction tests remain enabled.

Browser verification uses a synthetic manager, projects, tracks and tasks with a temporary SQLite database under `/tmp`, an API fixture that refuses Jira sync, Vite on an isolated port, and Playwright/Chromium installed outside the repository. Checked creation/editing/dated summaries, project/track archive/restore, project and track drill-down, Back/Forward, ordinary subtasks, exact descendant moves and Undo, contextual global capture, unrelated-session clearing, inaccessible deep links, saved placement filters and explicit clearing across reload, Today private context, drawer keyboard focus, mobile overflow, and desktop/mobile light/dark rendering. No page errors were observed. Runtime databases, real Jira, production, push and deployment were not used.

## Handoff validation — 2026-10-05

All six delivery items are complete on `main`, with one commit per item. Server startup applies the additive migration; existing tasks stay unplaced. No deployment was performed.

- Full backend: 101 files, 1,505 tests passed.
- Full frontend: 132 files, 1,832 tests passed; final focused frontend checks: 256 tests passed.
- Final project service/route checks: 14 tests passed.
- `npm run typecheck`, `npm run build:check`, `npm run lint` (zero errors), `npm run guard:data` and `git diff --check` passed.
- All tracked JSON/YAML files passed Prettier. `npm run format:check` reports only the pre-existing local `.claude/settings.local.json`; that private file was left untouched.
- Isolated browser checks passed at desktop 1440×1000 and mobile 390×844 in light/dark themes, with no page errors or mobile horizontal overflow.

Browser fixtures, database, screenshots and test logs were temporary `/tmp` artifacts. No runtime database, production service or real Jira operation was involved.
