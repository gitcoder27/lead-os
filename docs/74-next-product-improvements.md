# LeadOS review: what to build next

Reviewed **2026-10-13**, source baseline `60f7901`. Source/roadmap review; no live usability study. Recommendations need validation with managers and do not authorize implementation.

## Recommendation

**Next improvement: complete the planned morning digest. Next major feature: meeting preparation and follow-through inside Today, followed by a read-only calendar connection.**

The biggest opportunity is reducing manual coordination: assembling context before conversations, recording commitments afterward, and remembering to check them. This benefits solo managers and managers without Jira or developer logins.

## What the review shows

| Surface | Already useful | Remaining opportunity |
| --- | --- | --- |
| Today | My plan, top three, ranked exceptions, carry-forward and wrap-up | Bring the actual meeting schedule and preparation into the daily plan. |
| Tasks / Meetings | Meeting start/end times, participants, outcomes and child actions | Make preparation and capturing several actions one continuous workflow. |
| Team / 1:1s | All-date “I owe them” / “Waiting on them” commitments, agendas and session history | Bring relevant person context directly into the next conversation. |
| Projects | Outcomes, dated summaries, tracks and derived task facts | Add a next milestone and retrievable decision history. |
| Notes / Copilot | Rich notes, task provenance and confirmation-gated tools | Offer contextual preparation and follow-up drafts with source links. |
| Work | Established Jira triage and defect visibility | Feed relevant exceptions into meeting preparation. |

The latest UI upgrade, weekly reporting and CSV are recorded as complete. Connecting workflows now offers more value than another broad redesign. Scheduled morning digests remain unfinished in [WR-11–16](60-weekly-review-implementation-plan.md).

## Next major feature: prepare → meet → follow through

**Example:** Open a release review from Today and see its last outcome, outstanding actions and blockers. Take notes, then record the decision and three actions with owners and dates. Actions enter the existing plan/Waiting views and return at the next review.

Ship the first version using existing meeting tasks:

1. **Prepare.** Open linked people/projects, previous outcomes, unresolved actions and relevant work in one focused view. Managers confirm context links; free-text participant names should not silently attach private records. Route 1:1s into their existing workspace.
2. **Meet.** Keep private notes beside the agenda using the existing editor. Offer reusable agendas for release reviews, stakeholder updates and team meetings.
3. **Capture outcomes together.** Extend the outcome dialog to accept several actions with owners, dates and optional check-bys. Today currently offers one next action with a tomorrow-morning follow-up default. Reuse capture and canonical child tasks; their completion stays independent of the meeting.
4. **Follow through.** Bring unresolved actions into the next related meeting and existing Today/Waiting/review flows. Optional Copilot extraction produces editable suggestions that managers confirm.

Then connect **one calendar provider** used by pilot managers. Show meeting blocks alongside My plan; link selected events to meeting tasks. Keep source identity separate so reschedules, cancellations and recurring occurrences preserve local notes/actions without duplicates. Ordinary busy blocks should not demand outcomes.

Read-only access is supported by [Microsoft Graph calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0) and [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth). Validate access in a pilot organization. Preserve workspace isolation and keep private preparation out of shared descriptions and exported updates.

## Other improvements, in priority order

| Order | Improvement | Daily benefit / existing plan |
| --- | --- | --- |
| 1 | Morning digest | One useful reminder when the app is closed: priorities, due checks and meetings. Finish WR-11–16; personal update alerts already exist. |
| 2 | Recurring management routines | Weekly preparation, monthly stakeholder updates and repeatable agendas without recreating tasks. Extend P3-07 and UX-38; preserve existing 1:1 cadence. |
| 3 | Contextual follow-up actions | “Copy nudge”, “Prepare for 1:1” and “Draft update” from the relevant row, with editable text and sources. Extend UX-37/40. |
| 4 | Project milestones and decisions | A dated next milestone and linked decision history explain delivery progress beyond task counts. Build on current outcomes/summaries and P3-10. |

## Validate before expanding

Pilot with 3–5 managers for one week. Proposed targets: meeting preparation under two minutes, outcome/action capture under one minute, and previous commitments accessible without searching multiple screens. Check whether managers replace separate preparation lists and calendar updates preserve local actions. These are targets, not measured results.

Source anchors: [meeting/task contracts](../shared/types.ts), [Today outcome handling](../server/src/services/today.service.ts), [person commitments](../client/src/components/team-tracker/PersonCommitments.tsx), [project overview](../client/src/components/tasks/ProjectOverview.tsx), and [current roadmap](56-implementation-plan-solo-first.md).
