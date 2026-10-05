# Project tracks: a small hierarchy for managers

Reviewed 2026-10-05 against `c2e3ae9`. Code-based review of Tasks, capture, Today, Team, Work/Jira, shared contracts and relevant tests. No live-app usability session or runtime data access. This is a proposal for discussion, not an implementation plan.

## Recommendation

**Yes, one additional level would help: optional Tracks inside Tasks.** Migration, Testing and Security are good examples. Each track brings together the existing tasks that move an ongoing responsibility toward an outcome.

A manager needs to answer: **What am I responsible for moving forward, what needs attention, and what is the next action?** Today answers the daily-action question; Team answers the people question. LeadOS currently makes the manager reconstruct the broader work picture from individual tasks.

Start with **Track → Tasks**. Keep task breakdown available where useful, but avoid a mandatory Project → Epic → Track → Task → Subtask structure.

## What the application already supports

| Current capability | What it means for this proposal |
|---|---|
| Tasks already have a parent, children and cycle validation. Capture accepts `^T-12` to attach a task to a parent. | Hierarchy exists underneath; the experience is limited. This is not a completely flat data model. |
| The drawer displays subtasks, but its inline “Add action” input is available only on meetings. List-level child counts are also meeting-specific. | Ordinary parent tasks have weak discovery and visibility. Simply adding more nesting would leave the overview problem unresolved. |
| Labels, label filters and saved views already collect related tasks. | A saved “Migration” label view is a useful workaround, but has no outcome, management summary or track lifecycle. Label grouping is deliberately absent from the toolbar because multi-label tasks duplicate rows. |
| Tasks already carry owners, blockers, waiting parties, check-by dates, updates and Jira/external links. | Reuse these for execution and follow-through; no second task system is needed. |
| Today centers on commitments and exceptions; Team centers on people; Work centers on Jira defects. | The missing view is work across people and dates, including external QA/security commitments. |

Evidence: [task relations UI](../client/src/components/tasks/TaskDetailRelations.tsx), [task service](../server/src/services/task.service.ts), [capture grammar](../shared/capture-grammar.ts), [view service](../server/src/services/task-views.service.ts), [toolbar](../client/src/components/tasks/TaskToolbar.tsx), [Today plan](../server/src/services/today-plan.service.ts), [person commitments](../client/src/components/team-tracker/PersonCommitments.tsx), [Work layout](../client/src/components/layout/DashboardLayout.tsx).

## The smallest useful experience

Add one **Tracks** entry in the existing Tasks views rail, also accessible through the mobile view picker. It opens a compact list of active tracks. Selecting one opens its tasks in the familiar list and drawer.

Illustrative overview; these are proposed examples, not current app data:

| Track | Manager's short summary | Attention from tasks | Next check |
|---|---|---|---|
| Migration | Rehearsal waiting for infrastructure | 1 blocked task | Thu: confirm environment |
| Testing | Regression running; sign-off outstanding | 2 overdue tasks | Fri: chase QA sign-off |
| Security | Report received; exceptions need a decision | 1 follow-up due | Today: review exceptions |

Each track needs only a **name** to start. Its detail can hold an optional one-sentence outcome, such as “Migration validated and rollback ready,” and an optional dated manager summary. Attention counts and the next scheduled check come from existing tasks. If no check is scheduled, say so; do not invent one.

The daily workflow stays short:

1. Create a track when several commitments serve the same ongoing outcome.
2. Add existing tasks, or capture directly inside the track with its membership preselected. Keep global quick capture frictionless; choosing a track is optional.
3. Scan tracks to decide where to intervene. Open a task to assign, unblock, follow up or plan it for today.
4. Archive a track when finished. Surface remaining open tasks before archiving; archiving never closes or deletes them.

Tasks retain their own owners, dates and statuses. For example, “Get security sign-off” can remain manager-owned and wait on an external security contact. That team does not need a developer account.

Today continues to surface the relevant task, with a small track label for context. A track itself does not become a daily checkbox. Track membership also leaves existing Team assignment and Jira linking behavior intact.

## Why a track should be separate from a parent task

| Approach | Assessment |
|---|---|
| Labels and saved views only | Smallest workaround, but leaves the manager maintaining the overall story elsewhere. |
| Promote ordinary parent tasks | Reuses storage, but mixes long-running areas with executable tasks. Meeting actions already occupy the single parent relationship. |
| Lightweight track containing existing tasks | Recommended: adds one clear concept while retaining task and meeting behavior. |

A security action can belong to the Security track **and** remain a child of the meeting where it originated. Moving it between tracks should not erase that meeting relationship. This is the main reason to give track membership its own association instead of reusing `parentId`.

For an initial version, make tracks and their summaries manager-private, scoped to the workspace and manager. Allow a task at most one track per manager; labels can still describe overlapping themes. Use existing task IDs, never copies. Do not expose private track summaries through developer task responses.

## Keep the scope small

- No separate Projects navigation, nested tracks, Gantt charts, dependencies, capacity planning or custom workflows in the first version. Multiple projects can initially use names such as “Atlas / Migration.”
- No mandatory classification or migration of all existing tasks. Unassigned-to-track tasks work as they do today.
- No automatic “project percentage complete.” Task sizes differ, and unrecorded work exists. Show concrete blocker/overdue/follow-up facts; keep the manager's dated summary distinct from those facts.
- No separate track reminder engine. Use task check-by dates and Today. A quiet track is not automatically healthy.

This would require a small track model and membership relation, a Tasks overview/filter, contextual capture defaults, and task context in Today. It is a bounded cross-layer feature, not just enabling the existing subtask input. Preserve meeting parentage, manager privacy and the single canonical task across surfaces.

Before committing to implementation, walk through Migration, Testing and Security with representative tasks. The success test is simple: **can the manager identify the track needing intervention and open its next action within a minute, without maintaining a second list?** Start with that experience; deeper hierarchy should follow demonstrated need.
