# 58 — LeadOS manager one-stop review

Date: 2026-09-29  
Scope: current manager journey across Today, Tasks, Team, Standup, 1:1s, Work/Jira, Notes, Capture, Search, Copilot and Settings. This review checked the current tree and recent reviews in docs/53–57. It is code-based; no production data or Jira account was used.

## Verdict

LeadOS now has the right core for a manager's daily operating system. Today provides a plan, top three, attention queue, standup entry and wrap-up. Tasks has Inbox, Planned, Waiting, Later and Meetings lenses. Team covers situational awareness, standup and 1:1s. Capture, search and Copilot work across those surfaces.

The next gain will not come from adding another destination. It will come from closing three loops:

1. one task model and one navigation model everywhere;
2. daily activity becoming a useful weekly review and status update;
3. commitments and team updates reaching the manager without repeated checking.

## What is already strong

- **Daily command view:** My plan, top three, done-today recap and tomorrow planning are implemented in [TodayPage.tsx](../client/src/components/today/TodayPage.tsx) and [today-plan.service.ts](../server/src/services/today-plan.service.ts).
- **Coherent work lifecycle:** bare capture goes to Inbox; planned, waiting, later and done are explicit task states. Waiting can name developers or external contacts. See [capture.service.ts](../server/src/services/capture.service.ts), [task-views.service.ts](../server/src/services/task-views.service.ts) and [types.ts](../shared/types.ts).
- **Fast capture and retrieval:** one capture endpoint, structured defaults, typeahead, command palette and global search reduce navigation overhead.
- **Manager operating rhythms:** Team, Standup and 1:1s are substantial workflows rather than summary widgets.
- **Solo-first behavior:** solo/collaborative mode and participation-aware attention rules prevent false check-in noise for manager-maintained teams.
- **Good resilience foundation:** Today has partial-source handling and caching; the app has a root error boundary; recent consistency work established shared UI primitives.

## Findings

| Rank | Improvement | Why it matters | Effort |
|---|---|---|---|
| 1 | Finish the canonical core and release hardening | A fresh workspace can still start without canonical Tasks enabled; navigation still defaults to Work/Team/Desk and cannot hide pages. The product promise changes by workspace history. | Small–Medium |
| 2 | Add a guided weekly review and manager-ready reporting | LeadOS captures completions, carry-forward, waiting age, blockers and team signals but does not turn them into a weekly decision process or status update. | Medium |
| 3 | Build a durable proactive commitment loop | The current action inbox is a live Today projection, not persistent unread communication. Due promises, developer blockers and changed assignments require the manager to poll. | Medium–Large |
| 4 | Create a person command center | Team drawer, 1:1, tasks, check-ins, notes and availability contain person context, but there is no single history/open-loops view for “What do I owe Priya?” or 1:1 preparation. | Medium |
| 5 | Complete Jira execution workflows | Work still lacks safe bulk triage and status transitions; default sync can omit unassigned defects. Managers must return to Jira for common steering actions. | Medium |
| 6 | Add recurrence and stronger date language | Recurring 1:1 preparation, weekly checks and monthly obligations still require repeated capture. | Medium |
| 7 | Add product and reliability telemetry | There is no adoption funnel, workflow timing, client error reporting or feature feedback, so product decisions rely on code review rather than observed use. | Medium |

## Selected top 3

### 1. Finish one coherent core

Ship this before broader feature work.

- Initialize new workspaces directly on canonical Tasks (`tasks_phase2_stage = 2c`, Phase 3 enabled) while leaving existing workspaces unchanged.
- Make solo navigation default to **Today · Tasks · Notes**; reveal Team and Work when configured; allow pages to be hidden.
- Remove the remaining legacy Desk fallback and dead manager-memory code after the migration soak period.
- Complete the current safety bundle: include unassigned issues in default Jira scope, replace Suggestions “Apply All” with a field diff, expose backups to managers, and make reset consequences explicit.

Evidence: [migrate.ts](../server/src/db/migrate.ts), [task-keys.service.ts](../server/src/services/task-keys.service.ts), [nav-preferences.service.ts](../server/src/services/nav-preferences.service.ts), [types.ts](../shared/types.ts), and [56-implementation-plan-solo-first.md](56-implementation-plan-solo-first.md).

**Success:** a brand-new solo workspace can capture immediately and sees one stable vocabulary: Today, Tasks and Notes. No setup path exposes Desk/Tasks split behavior.

### 2. Add a weekly review and reporting loop

Build a guided review rather than a passive dashboard:

- completed and dropped work from the last seven days;
- open blockers and waiting items with age/check-by status;
- Inbox and unscheduled work needing a decision;
- carry, drop, schedule or delegate actions with undo;
- team changes and check-in cadence only in collaborative mode;
- Copy as Markdown and CSV for a boss update or status report.

Reuse the existing `closed-week` lens and task signals instead of creating another data model. Copilot can later consume the same report for “weekly summary” and “prepare my update.”

**Success:** a manager can finish Friday review and produce a credible weekly update in under ten minutes without assembling data in another tool.

### 3. Build the proactive commitment loop

Turn the header inbox into durable, user-specific attention rather than another rendering of Today:

- persisted unread items for assignment changes, developer blockers, asks and replies;
- reminders for due follow-ups, check-by dates and snooze expiry;
- acknowledge/reply and reason-on-block/drop in collaborative mode;
- blocker and waiting reasons flow into Today immediately;
- seen cursors and provenance so developers know what changed and managers know what was read;
- optional daily digest after the in-app model is trusted.

Keep the distinction clear: **Today ranks current work; Inbox records new events; Tasks stores commitments.**

Evidence: [ManagerActionInbox.tsx](../client/src/components/actions/ManagerActionInbox.tsx), [schema.ts](../server/src/db/schema.ts), and P4/P6 in [56-implementation-plan-solo-first.md](56-implementation-plan-solo-first.md).

**Success:** a blocker or changed commitment reaches the right person once, carries unread state, opens the exact item, and can be resolved without checking several pages.

## After the top 3

Next, combine the Team drawer, 1:1 history, linked tasks, decisions and private notes into a person command center. Then add Jira transitions/bulk triage and recurrence. These are valuable, but they compound better after the core, weekly and proactive loops are closed.

## Product guardrails

- Do not add more top-level pages; use Tasks lenses, person context and guided modes.
- Keep manager-private notes and fields private by default; make developer visibility explicit.
- Prefer actions and decisions over more counters.
- Measure time to plan the day, clear the Inbox, run standup and finish weekly review.
- Preserve Today performance and exact-target deep links as new workflows are added.