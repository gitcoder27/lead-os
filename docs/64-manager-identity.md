# 64 — One person, two ids: the manager on the roster

## Problem

A manager who is also on the roster (Jira assignee, standup participant) is stored as two people:

| Id | Owns | Read by |
|---|---|---|
| Login (`ayan`, `ownerType = manager`) | private tasks: the Copilot's "assign to me", captures, pins, Today's plan | Tasks, Today |
| Roster record (`dev-…`, `ownerType = developer`) | board tasks, check-ins, standup | Team board, standup |

Every screen picked one id, so the screens disagreed. Tasks "My tasks" showed the login's tasks, Team showed the
roster record's, and "assigned to me" tasks never appeared on the manager's own Team row.

## Decision

Keep both ids and **link them once, on read** ("This is me"). Rejected: leaving the roster (loses the manager's
standup row and their Jira-assigned issues), and making "assigned to me" developer-owned (mixes private planning into
the shared board and breaks pins, which require `ownerType = manager`).

## Rules

- **Storage:** `manager_self_links (workspace_id, manager_account_id, developer_account_id)`, one row per manager,
  private to them. Nothing else is written; deleting the row restores the old behaviour. A link to a deactivated
  roster record is ignored and comes back if the record returns.
- **One resolver:** `SelfIdentityService.linkedDeveloperId`. `GET/PUT /api/team/self` (manager only) reads and sets it
  and offers the roster record that matches the saved `manager_jira_account_id` as a suggestion. Settings → Team
  Members shows a **This is me** chip per member.
- **Tasks and Today:** `TaskPrincipal.selfDeveloperId` (set inside `TaskViewsService`, never by callers). `owner: me`
  covers both ids, `owner: team` excludes mine, and the roster record's tasks are in my scope even when another
  manager tracks them. Today's plan and counts follow because they run the same views.
- **Team board (canonical model, live days only):** the linked row (`Developer.isSelf`, shown as **You**) also lists
  the manager's own open tasks and what they finished today (`TaskService.managerBoardRows`). Parked (Later),
  waiting, meeting and 1:1 prep tasks stay off, as does any task linked to another person: a 1:1 topic is private
  prep and never appears on a developer's row (docs/48 P0-S5). Other managers' boards never show these tasks.
- **No chasing yourself:** the row is never on the check-in clock; stale, untouched, status-follow-up and no-current
  flags are off, and no 1:1 is "due" with yourself (board badge and Today). Blocked, at-risk, waiting and overdue
  linked work still count: those are the manager's own words about their own work.
- **Pins:** unchanged. `stillMine` still requires a manager-owned task.

## Limits

- Past days show the roster record's work only (the history view reads `day_focus`, which manager-owned tasks never
  had). The standup "Changes" feed for the row covers the roster record's tasks, not private ones.
- Standup and the board list every open own task. If that gets long, Later or waiting moves it off the row.
- The legacy (pre-canonical) tracker model is not changed.
