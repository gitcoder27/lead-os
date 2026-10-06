# LeadOS performance review

Reviewed 2026-10-05 against `756d22d`. Review only; application code unchanged.

## Summary

LeadOS has useful foundations: route splitting, batched task associations, and scoped query caches.
The biggest risks are synchronous task-view CPU work and rendering entire Work/Tasks backlogs.
Historical events and closed tasks increase read costs; Team polling and inbox pagination amplify requests.
These risks grow with workspace size; measurements below are synthetic, not production latency claims.

## Findings

Ordered by likely impact. High list-rendering severity assumes hundreds/thousands of matching rows.

| ID | Severity | Area | File:line | Issue | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| P01 (resolved) | High | Backend CPU | [utils/date.ts:2](../server/src/utils/date.ts#L2), [task-views.service.ts:500](../server/src/services/task-views.service.ts#L500) | Each timestamp conversion constructs an Intl formatter; counts recompute signals for every task in every view. Sorting also repeats date conversion. | Cache formatters by zone; compute signals and sort keys once per row per request. |
| P02 | High | Frontend rendering | [DefectTable.tsx:1152](../client/src/components/table/DefectTable.tsx#L1152), [TaskList.tsx:101](../client/src/components/tasks/TaskList.tsx#L101) | Work and Tasks mount every matching row, including offscreen cells, menus and motion wrappers. Responses are unbounded; mobile Work also renders every card. | Virtualize both Work layouts and grouped Tasks; paginate APIs while preserving filter-wide counts and export. |
| P03 | Medium | Frontend data | [TeamTrackerPage.tsx:356](../client/src/components/team-tracker/TeamTrackerPage.tsx#L356), [useIssues.ts:45](../client/src/hooks/useIssues.ts#L45) | Team polls all visible issues every 30 seconds, including descriptions/analysis notes, even with its drawer closed. Its picker needs only five metadata fields. | Fetch lean, bounded suggestions when the editable picker opens; keep large text in detail requests. |
| P04 | Medium | Backend queries | [task-events.service.ts:252](../server/src/services/task-events.service.ts#L252), [task.service.ts:733](../server/src/services/task.service.ts#L733) | Team/Today surface DTOs fetch and sort all historical events, including bodies/metadata, then retain one latest event per task. Cost grows with event history. | Use indexed latest-visible-event lookups in SQL and project summary fields; preserve visibility and timestamp/ID ordering. |
| P05 | Medium | Backend queries | [task-views.service.ts:401](../server/src/services/task-views.service.ts#L401), [jira-drift.service.ts:82](../server/src/services/jira-drift.service.ts#L82) | Needs attention includes drift, bypassing the closed-task SQL restriction. Lifetime closed history is hydrated before drift's seven-day window is applied. | Bound candidates to open tasks plus the applicable recent closed window, retaining explicit closed-view semantics. |
| P06 | Medium | Notes typing | [NoteDocument.tsx:154](../client/src/components/notes/NoteDocument.tsx#L154), [note-markdown.ts:224](../client/src/lib/note-markdown.ts#L224), [daily-note-drafts.ts:229](../client/src/lib/daily-note-drafts.ts#L229) | Every edit scans the document for wrap-up candidates, rebuilding the roster regex per ordinary bullet. Draft persistence also synchronously scans/parses stored drafts on every edit. | Compile mention matching once per roster/analysis; defer or incrementally update footer counts. Coalesce draft writes with lifecycle flushing; move cap cleanup off each edit. |
| P07 | Medium | Query invalidation | [useTaskDetail.ts:65](../client/src/hooks/useTaskDetail.ts#L65), [useTaskDetail.ts:68](../client/src/hooks/useTaskDetail.ts#L68) | Detail mutations invalidate the same query family twice. TanStack restarts the refetch; the query ignores its AbortSignal, so both GETs execute. | Remove the duplicate invalidation, scope it to affected tasks, and forward the signal. |
| P08 | Medium | Inbox polling | [useTaskInbox.ts:18](../client/src/hooks/useTaskInbox.ts#L18), [ManagerActionInbox.tsx:107](../client/src/components/actions/ManagerActionInbox.tsx#L107) | In collab mode, loading older unread pages expands the always-mounted badge's infinite query. Every 30-second poll sequentially refetches all loaded pages, even after closing the popover. | Separate count/latest-page polling from paginated history; bound history retention and refresh deliberately. |
| P09 | Medium | Bundle/load | [TeamTrackerPage.tsx:34](../client/src/components/team-tracker/TeamTrackerPage.tsx#L34), [SessionColumn.tsx:18](../client/src/components/team-tracker/one-on-one/SessionColumn.tsx#L18) | Team's static 1:1 workspace import pulls in the approximately 396 KB raw CodeMirror/editor chunk, even when the panel's feature is disabled. | Lazy-load OneOnOneWorkspace inside the existing feature/panel branch. |
| P10 | Medium | Bundle/load | [App.tsx:12](../client/src/App.tsx#L12), [App.tsx:41](../client/src/App.tsx#L41) | Capture, palette and task drawer are eagerly imported despite conditional rendering; detail fields/timeline/composer land in startup JS. Total static entry closure is approximately 933 KB raw / 276 KB gzip. | Lazy-load these overlays, preserving their state after first use where needed. The measured total is not an estimate of savings. |
| P11 | Medium | Copilot history | [assistant/service.ts:555](../server/src/assistant/service.ts#L555), [assistant/service.ts:669](../server/src/assistant/service.ts#L669) | Every tool-loop iteration loads the entire conversation before trimming to MAX_HISTORY_ROWS/character budget. Long conversations incur growing DB/allocation costs despite bounded model context. | Select a bounded recent history window in SQL, preserving complete user/tool turns; paginate conversation detail separately. |
| P12 | Medium | Backup runtime | [backup.service.ts:176](../server/src/services/backup.service.ts#L176), [backup.service.ts:184](../server/src/services/backup.service.ts#L184) | Each backup download sanitizes a copy with synchronous better-sqlite3 VACUUM on the HTTP process. Large snapshots block unrelated requests while the whole file is rewritten. | Run sanitization/VACUUM in a worker or subprocess, with bounded concurrency and temporary-file cleanup. Preserve session removal. |
| P13 | Medium | Search queries | [search.service.ts:160](../server/src/services/search.service.ts#L160), [search.service.ts:191](../server/src/services/search.service.ts#L191) | Palette issue search sorts/materializes all substring matches, including closed/hidden history, before visibility filtering and returning six. Common terms amplify work. | Push equivalent visibility rules and LIMIT into SQL; consider FTS if substring scanning remains costly. |

## Quick wins

1. **P01:** Reuse timezone formatters, following `today-clock.ts`'s existing pattern; precompute per-row signals for counts.
2. **P07:** Delete the redundant detail invalidation; one mutation should trigger one detail refetch.
3. **P09:** Lazy-load the optional 1:1 workspace to remove the editor dependency from ordinary Team visits.
4. **P05 / P06:** Bound attention's closed candidates; compile one mention matcher per note analysis.

## High finding notes

**P01 — resolved 2026-10-06:** Cached timezone formatters and request-local row signals, facts and sort keys; all nine view results and timezone semantics preserved.

**Original P01 evidence — task-view CPU blocks other requests.** `matching()` calculates signals before testing filters, and `counts()` repeats it for each view. Actual matching code over 1,000 synthetic tasks across nine built-in views took **1.89–2.15 seconds**, excluding database work. Independently, 10,000 calls to the real `isoDatePart` took **1,002 ms**, versus **78 ms** with equivalent formatting using one reused formatter. Cache formatters, calculate row facts/signals once, and precompute comparator keys; preserve timezone/date semantics.

**P02 — backlog size determines browser work.** Work's desktop table and mobile cards, and Tasks' expanded groups, mount the full response. Backend list paths ([issue.service.ts:76](../server/src/services/issue.service.ts#L76), [task-views.service.ts:404](../server/src/services/task-views.service.ts#L404)) impose no page limit. Large backlogs therefore increase mount, reconciliation and layout work even when only a few rows are visible. Add viewport virtualization and bounded API pages, preserving keyboard navigation, selection and whole-view operations. Browser latency was not measured.

## Review evidence and existing strengths

Parallel reviewers covered rendering, frontend data, bundle/load and DB queries; the lead reviewer covered runtime and independently checked the highest-impact paths. Checks used actual source transpiled in memory with synthetic inputs/mocked query functions, plus a production client build in `/tmp`. Notes analysis measured **48 ms for 500 bullets / 20,399 characters**, and **94 ms for 1,000 bullets / 40,799 characters**, with 50 developers. Query probes confirmed two detail fetches after duplicate invalidation and three sequential requests for a three-page inbox refetch. No runtime database, app startup, Jira calls, push or deployment was used.

Already useful: major routes are lazy, task associations are batched, SQLite uses WAL, task rows are memoized, and CodeMirror decorations inspect visible ranges. Today's cache coalesces identical builds; event timelines and ordinary closed views are bounded.

## Fix measurements (2026-10-06)

P01 rerun: `node scripts/benchmark-task-views.cjs` transpiles the actual source with inert infrastructure imports (no DB/Jira), 1,000 synthetic tasks × nine built-in views, and 10,000 timestamp `isoDatePart` calls in Asia/Kolkata. Three runs before: matching **3,318 / 3,139 / 3,162 ms**, dates **960 / 935 / 946 ms**. After: matching **69 / 32 / 31 ms**, dates **65 / 56 / 56 ms** (includes cold first run). Median reductions: **98.99%** and **94.08%**. Every view's count is identical: `519, 0, 519, 260, 77, 130, 227, 639, 91`. These are synthetic CPU measurements, exclude DB/DTO work, and use a reproducible fixture rather than claiming the review's unspecified fixture or host is identical.

P02 Work portion: bounded issues pages (default 200, maximum 500, complete-filter totals) and measured desktop/mobile virtualization. A synthetic 1,000-defect browser fixture mounted **25 desktop rows / 13 mobile cards** initially; scrolling to the end, offscreen selection, fifth-page search and complete CSV passed. Clients assemble all bounded pages to preserve the existing full-filter client operations; viewport-only fetching and pushing all issue predicates into SQL are deferred, so total client data memory and backend candidate scans still scale with the backlog. Grouped Tasks remains pending until the next commit.
