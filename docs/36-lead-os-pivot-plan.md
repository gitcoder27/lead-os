# LeadOS Pivot Plan

Date: 2026-04-28

This document is the implementation plan for repositioning the original defect dashboard into LeadOS, a broader daily operating workspace for software engineering managers.

The goal is not to replace the existing application. The goal is to preserve the working defect, team tracking, developer workspace, and manager desk flows while expanding the product identity and architecture so Jira is one optional work source, not the required foundation for every workflow.

## Product Direction

### Current Product

The current application is primarily a Jira-connected defect command center with supporting manager and developer workflows:

- Manager dashboard for Jira defects, triage, alerts, filters, workload, and risk visibility.
- Team Tracker for manager visibility into developer plans, current work, check-ins, and carry-forward.
- My Day for developers to manage daily planned, current, completed, and dropped work.
- Manager Desk for manager planning, quick capture, linked issues, linked developers, and daily task organization.
- Settings and Setup for Jira configuration, users, teams, and bootstrap.

### Target Product

The target application is a daily command center for software engineering managers.

Short positioning:

> One place for engineering managers to track people, work, risks, meetings, notes, and follow-ups throughout the day.

Core promise:

> Help a software engineering manager quickly answer: who needs me, what is stuck, what changed, what did I promise, and what should I do next?

### Product Boundaries

Build for software engineering managers first, especially hands-on leads who manage people while still being close to delivery work.

Do not turn the app into:

- a generic project management suite
- a Jira replacement
- a full calendar product
- a full HR or performance management system
- a chat tool
- a heavy analytics platform
- a crowded task manager with every possible feature

The product should remain fast, operational, and useful from morning until end of day.

## Core Design Principles

- Preserve existing working behavior before adding new behavior.
- Keep Jira defects as a first-class workflow, but not the only workflow.
- Make the manager's attention the center of the product.
- Favor daily execution over long-term planning complexity.
- Keep every screen action-oriented: decide, assign, follow up, unblock, capture, review.
- Prefer fewer high-value workflows over many low-value features.
- Make manual entry useful even without Jira connected.
- Keep developer-facing My Day simple and focused.
- Keep manager-facing surfaces dense, scannable, and calm.
- Avoid duplicating full features from Jira, calendars, Slack, or HR tools.

## Target Information Architecture

Recommended top-level navigation:

| Area | Purpose | Current Mapping |
|---|---|---|
| Today | Manager's daily command view: attention, risks, meetings, follow-ups, blockers, and quick capture | New home surface |
| Team | People, current work, status, check-ins, workload, carry-forward | Evolves Team Tracker |
| Work | Jira defects, manual work, unassigned work, blocked work, overdue work, due soon | Evolves current dashboard |
| Desk | Notes, ideas, planning, decisions, reminders, linked people and work | Evolves Manager Desk |
| Follow-ups | Promises, reminders, action items, ownership, due dates, status | New focused workflow |
| Meetings | Lightweight meeting notes, decisions, action items, linked people and work | New focused workflow |
| My Day | Developer daily workspace | Preserve current My Day |
| Settings | Team, users, connectors, Jira, preferences, setup | Evolves Settings and Setup |

Selected product name:

> LeadOS

## Core Domain Shift

The most important pivot is changing the core domain model.

### Current Mental Model

Jira is the source of truth for the team and work. Most workflows assume Jira exists first.

### Target Mental Model

The app owns the manager's operating workspace. Jira is an optional connector that can enrich people and work.

Core entities:

- Person
- Work item
- Day plan
- Risk
- Follow-up
- Note
- Meeting
- Decision
- Connector link

Jira defects become one type of work item.

### Person Model

Team members should be manageable without Jira.

Recommended person fields:

- display name
- email
- role or title
- app role: manager or developer
- active status
- optional Jira account ID
- optional external identities for future connectors
- working preferences or lightweight notes, if useful later

### Work Item Model

Work should be able to come from Jira or manual entry.

Recommended work item fields:

- title
- description or context
- source: manual, jira, or future connector
- source key or URL
- owner or assignee
- priority
- status
- due date
- tags
- risk flags
- linked people
- linked notes
- linked follow-ups
- linked meeting items

Do not remove existing Jira issue contracts immediately. Introduce the generalized work concept in parallel, then migrate surfaces gradually.

## Killer Workflows

### 1. Start My Day

Question answered:

> What needs my attention today?

The Today page should show:

- blocked people
- overdue work
- due today work
- unassigned work
- stale work
- high-priority work not started
- follow-ups due today
- open decisions
- meeting actions from yesterday or today
- quick capture
- suggested standup prompts

This should become the default manager landing page.

### 2. Check My Team

Question answered:

> Who is doing what, who is blocked, and who needs help?

The Team page should show:

- each team member
- current work
- planned work
- completed work
- blockers
- check-in freshness
- workload level
- carry-forward items
- idle or overloaded signals

This should preserve Team Tracker behavior, but should stop depending on Jira for team existence.

### 3. Manage Work

Question answered:

> What work is unassigned, risky, overdue, blocked, or needs a decision?

The Work page should include:

- Jira defects
- manual work items
- unassigned work
- blocked work
- due soon
- overdue
- stale
- at risk
- triage flow for Jira defects

The existing defect dashboard can move into this area with minimal behavioral change.

### 4. Capture And Follow Up

Question answered:

> What did I promise, who do I need to check with, and what should not be forgotten?

Follow-ups should support:

- title
- person
- due date
- status
- notes
- linked work
- linked meeting
- linked manager desk item

This is likely one of the most valuable new workflows because managers lose time and trust when follow-ups disappear.

### 5. Run Lightweight Meetings

Question answered:

> What was discussed, what was decided, and what needs action?

Meetings should stay lightweight:

- meeting title
- date/time
- attendees
- notes
- decisions
- action items
- generated follow-ups
- linked work items

Do not build a full calendar replacement in the first pivot.

## Implementation Phases

The phases below are intentionally broad. Each phase contains enough work for an AI agent to make meaningful progress without over-fragmenting the plan.

## Phase 1: Product Reframe, Navigation, And Non-Breaking Shell

Objective: Reposition the app as LeadOS while preserving existing behavior.

Scope:

- Rename visible product language to LeadOS where appropriate.
- Update app header, page titles, setup copy, empty states, and README/product docs.
- Introduce the new top-level navigation shape without removing existing pages.
- Make Today the planned future home, but keep current dashboard accessible.
- Decide whether the current `/` route immediately becomes Today or temporarily remains the existing dashboard with updated framing.
- Group current dashboard under Work or Defects in the navigation.
- Keep Team Tracker, My Day, Manager Desk, and Settings routes working.
- Add a short product description to the UI where it is useful, without adding marketing clutter.

Recommended route direction:

| Route | Target |
|---|---|
| `/` | Today |
| `/work` | Work dashboard, including Jira defects |
| `/team` | Team view |
| `/desk` | Manager Desk |
| `/follow-ups` | Follow-ups (retired in P3-06: redirects to `/tasks?view=waiting`) |
| `/meetings` | Meetings (retired in P3-06: redirects to `/tasks?view=meetings`) |
| `/my-day` | Developer workspace |
| `/settings` | Settings |

Compatibility:

- Keep old routes working as redirects or aliases:
  - `/team-tracker` to `/team`
  - `/manager-desk` to `/desk`
  - existing dashboard path behavior to `/work` or `/`

Deliverables:

- Updated naming and copy.
- Updated navigation labels.
- Route aliases for old paths.
- Product overview doc or README update.
- No loss of current functionality.

Validation:

- `npm run typecheck`
- `npm run build:check`
- Frontend route smoke tests where practical.

## Phase 2: Team Independence And Connector Foundation

Objective: Make the app useful without Jira as the mandatory source of team identity.

Scope:

- Introduce or update a first-class app team member model.
- Allow managers to manually create, edit, activate, and deactivate team members.
- Keep optional Jira linking per team member.
- Update setup flow so Jira connection is optional or can be deferred.
- Update Settings so team management does not require successful Jira discovery.
- Preserve existing Jira-backed team selection for users who want it.
- Add connector language around Jira: connected, disconnected, needs attention, optional.
- Ensure developer app users can still be linked to app team members and optionally to Jira users.

Data and architecture:

- Avoid a destructive migration.
- Preserve existing developer account IDs and Jira account IDs.
- Add nullable connector fields rather than forcing all existing rows into a new model in one step.
- Keep shared contracts in `shared/types.ts`.
- Keep server routes thin and put business rules in services.

Deliverables:

- Manual team member management.
- Optional Jira linking.
- Setup path that works before Jira is connected.
- Settings language that treats Jira as a connector.
- Tests for manual team member creation and linking behavior.

Validation:

- `npm run typecheck`
- `npm run test`
- `npm run test --workspace=client` for affected settings/setup flows.

## Phase 3: Today, Work, Team, And Desk As The Core Manager Loop

Objective: Build the main daily operating loop around attention, people, work, and capture.

Scope:

- Create the Today page as the manager landing view.
- Move or reframe existing dashboard behavior into Work.
- Evolve Team Tracker into Team while preserving current board behavior.
- Evolve Manager Desk into Desk while preserving linked issues and developers.
- Add manual work items if not already introduced in Phase 2.
- Allow Today to aggregate signals from:
  - Jira defects
  - manual work
  - Team Tracker / Team
  - Manager Desk / Desk
  - follow-ups, once available
  - meetings, once available

Today page sections:

- Attention list: blocked, overdue, due today, stale, unassigned, high priority not started.
- Team pulse: blocked, idle, overloaded, missing check-in.
- My follow-ups: due today and overdue.
- Quick capture: note, work item, follow-up, meeting note.
- Standup prompts: generated from team/work state.

Work page sections:

- Jira defects.
- Manual work.
- At risk.
- Unassigned.
- Due soon.
- Blocked.

Team page sections:

- Team member list.
- Current work.
- Today plan.
- Blockers.
- Check-ins.
- Carry-forward.

Desk page sections:

- Inbox or quick capture.
- Today plan.
- Notes and ideas.
- Decisions.
- Linked people and work.

Deliverables:

- Today route and page.
- Work route with current defect dashboard preserved.
- Team route with current Team Tracker preserved or lightly reframed.
- Desk route with current Manager Desk preserved or lightly reframed.
- Shared attention/risk aggregation service or hook.
- Focused tests around new aggregation logic.

Validation:

- `npm run typecheck`
- `npm run build:check`
- `npm run test`
- `npm run test --workspace=client`

## Phase 4: Follow-ups, Meetings, And Manager Memory

Objective: Add the highest-value manager memory workflows without crowding the app.

Scope:

- Add Follow-ups as a focused workflow.
- Add Meetings as lightweight notes plus decisions plus action items.
- Allow follow-ups to be created from:
  - quick capture
  - Desk
  - Team member context
  - Work item context
  - Meeting notes
- Allow follow-ups to link to:
  - person
  - work item
  - meeting
  - desk item
- Add follow-up signals into Today.
- Add meeting action items into Today and Follow-ups.

Follow-up statuses:

- open
- waiting
- done
- dismissed

Meeting model:

- title
- date/time
- attendees
- notes
- decisions
- action items
- linked work
- generated follow-ups

Keep meetings intentionally simple:

- no calendar sync in this phase
- no recurring meeting engine
- no heavy agenda builder
- no complex minute-taking workflow

Deliverables:

- Follow-ups routes, API, service, shared types, and UI.
- Meetings routes, API, service, shared types, and UI.
- Today integration.
- Desk and Team contextual creation paths.
- Tests for follow-up due/overdue behavior and meeting action item creation.

Validation:

- `npm run typecheck`
- `npm run test`
- `npm run test --workspace=client`

## Phase 5: Polish, Migration Safety, And Operating Quality

Objective: Make the pivot feel coherent, stable, and production-ready.

Scope:

- Update onboarding for the new product story.
- Add empty states for no Jira, no team, no work, no follow-ups, and no meetings.
- Add import/link flows where needed for existing Jira users.
- Add route redirects for renamed sections.
- Update docs and screenshots where applicable.
- Add lightweight telemetry or logs for sync/connectors if already consistent with the app.
- Review UI density so the app remains useful under real manager load.
- Tighten role expectations:
  - manager can access manager surfaces
  - developer can access My Day
  - developer views remain uncluttered
- Review backup/migration impact.
- Run broad validation before deployment.

Deliverables:

- Updated onboarding.
- Updated docs.
- Route compatibility.
- Final UI copy pass.
- Regression coverage for critical existing workflows.
- Manual QA checklist completed.

Validation:

- `npm run typecheck`
- `npm run build:check`
- `npm run test`
- `npm run test --workspace=client`

## Suggested First Implementation Order

If starting immediately, do the work in this order:

1. Rename and reframe the product shell.
2. Add route aliases and future navigation labels.
3. Make team members app-owned and Jira-linked optionally.
4. Add the Today page as an aggregator, initially using existing data only.
5. Move/reframe the current dashboard as Work while preserving behavior.
6. Reframe Team Tracker as Team.
7. Reframe Manager Desk as Desk.
8. Add Follow-ups.
9. Add lightweight Meetings.
10. Polish onboarding, settings, empty states, and docs.

## Feature Selection Rules

Before adding a feature, ask:

- Does this help a manager decide what to do next?
- Does this reduce context switching?
- Does this preserve or improve the morning-to-night daily workflow?
- Can this work without forcing Jira to be connected?
- Can this be explained in one sentence?
- Will this remain useful when managing 10 people?
- Is this better handled by Jira, Slack, Google Calendar, or an HR tool?

If the feature does not pass these questions, defer it.

## Agent Implementation Checklist

Use this checklist when implementing the pivot.

### Product And UX

- [ ] Product name updated to LeadOS or chosen final name.
- [ ] Current defect functionality is preserved.
- [ ] Jira is described as an optional connector, not the whole product.
- [ ] Navigation reflects Today, Team, Work, Desk, Follow-ups, Meetings, My Day, and Settings.
- [ ] Old routes still work through redirects or aliases.
- [ ] Manager surfaces are dense, scannable, and action-oriented.
- [ ] Developer My Day remains focused and uncluttered.
- [ ] Empty states guide the manager without sounding like marketing copy.
- [ ] No page becomes crowded with low-value widgets.

### Data And Backend

- [ ] Team members can exist without Jira.
- [ ] Jira account ID is optional on team members.
- [ ] Manual work items can exist without Jira.
- [ ] Jira defects remain supported as first-class work.
- [ ] Shared contracts are defined in `shared/types.ts`.
- [ ] Server routes remain thin.
- [ ] Business rules live in services.
- [ ] Zod validation is added or updated for new write endpoints.
- [ ] Migrations preserve existing data.
- [ ] Backup and restore assumptions remain valid.

### Current Workflow Preservation

- [ ] Dashboard defect triage still works.
- [ ] Filters still work.
- [ ] Triage panel still works.
- [ ] Alerts still work.
- [ ] Workload view still works.
- [ ] Team Tracker board still works.
- [ ] Carry-forward still works.
- [ ] Check-ins still work.
- [ ] My Day still works for developers.
- [ ] Manager Desk linked issues and developers still work.
- [ ] Settings and setup still work for existing Jira-connected installations.

### New Manager Workflows

- [ ] Today page aggregates urgent manager attention.
- [ ] Today includes blocked, overdue, due today, stale, unassigned, and high-priority not-started signals.
- [ ] Today includes team pulse signals.
- [ ] Today includes follow-ups when available.
- [ ] Quick capture is available from the manager flow.
- [ ] Follow-ups support owner/person, due date, status, notes, and links.
- [ ] Meetings support notes, attendees, decisions, action items, and follow-up creation.
- [ ] Work items can link to people, notes, meetings, and follow-ups where useful.

### Testing And Validation

- [ ] `npm run typecheck` passes.
- [ ] `npm run build:check` passes.
- [ ] `npm run test` passes for backend changes.
- [ ] `npm run test --workspace=client` passes for frontend changes.
- [ ] Route compatibility is manually checked.
- [ ] Existing manager and developer login flows are manually checked.
- [ ] Jira-connected setup is manually checked.
- [ ] No-Jira or deferred-Jira setup is manually checked once implemented.
- [ ] Production deploy is not run from the development checkout.

## Definition Of Done For The Pivot

The pivot is successful when:

- The app clearly presents itself as a command center for software engineering managers.
- A manager can use the app without Jira as the mandatory first step.
- Jira defects remain powerful and useful inside the Work area.
- Today becomes the manager's daily starting point.
- Team, Work, Desk, Follow-ups, and Meetings form one coherent daily loop.
- My Day continues to work for developers.
- Existing users do not lose current data or workflows.
- The product feels simpler and more useful, not bigger and noisier.
