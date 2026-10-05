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
