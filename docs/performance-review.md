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
| P02 (resolved) | High | Frontend rendering | [DefectTable.tsx:1152](../client/src/components/table/DefectTable.tsx#L1152), [TaskList.tsx:101](../client/src/components/tasks/TaskList.tsx#L101) | Work and Tasks mount every matching row, including offscreen cells, menus and motion wrappers. Responses are unbounded; mobile Work also renders every card. | Virtualize both Work layouts and grouped Tasks; paginate APIs while preserving filter-wide counts and export. |
| P03 (resolved) | Medium | Frontend data | [TeamTrackerPage.tsx:356](../client/src/components/team-tracker/TeamTrackerPage.tsx#L356), [useIssues.ts:45](../client/src/hooks/useIssues.ts#L45) | Team polls all visible issues every 30 seconds, including descriptions/analysis notes, even with its drawer closed. Its picker needs only five metadata fields. | Fetch lean, bounded suggestions when the editable picker opens; keep large text in detail requests. |
| P04 (resolved) | Medium | Backend queries | [task-events.service.ts:252](../server/src/services/task-events.service.ts#L252), [task.service.ts:733](../server/src/services/task.service.ts#L733) | Team/Today surface DTOs fetch and sort all historical events, including bodies/metadata, then retain one latest event per task. Cost grows with event history. | Use indexed latest-visible-event lookups in SQL and project summary fields; preserve visibility and timestamp/ID ordering. |
| P05 (resolved) | Medium | Backend queries | [task-views.service.ts:401](../server/src/services/task-views.service.ts#L401), [jira-drift.service.ts:82](../server/src/services/jira-drift.service.ts#L82) | Needs attention includes drift, bypassing the closed-task SQL restriction. Lifetime closed history is hydrated before drift's seven-day window is applied. | Bound candidates to open tasks plus the applicable recent closed window, retaining explicit closed-view semantics. |
| P06 (resolved) | Medium | Notes typing | [NoteDocument.tsx:154](../client/src/components/notes/NoteDocument.tsx#L154), [note-markdown.ts:224](../client/src/lib/note-markdown.ts#L224), [daily-note-drafts.ts:229](../client/src/lib/daily-note-drafts.ts#L229) | Every edit scans the document for wrap-up candidates, rebuilding the roster regex per ordinary bullet. Draft persistence also synchronously scans/parses stored drafts on every edit. | Compile mention matching once per roster/analysis; defer or incrementally update footer counts. Coalesce draft writes with lifecycle flushing; move cap cleanup off each edit. |
| P07 (resolved) | Medium | Query invalidation | [useTaskDetail.ts:65](../client/src/hooks/useTaskDetail.ts#L65), [useTaskDetail.ts:68](../client/src/hooks/useTaskDetail.ts#L68) | Detail mutations invalidate the same query family twice. TanStack restarts the refetch; the query ignores its AbortSignal, so both GETs execute. | Remove the duplicate invalidation, scope it to affected tasks, and forward the signal. |
| P08 (resolved) | Medium | Inbox polling | [useTaskInbox.ts:18](../client/src/hooks/useTaskInbox.ts#L18), [ManagerActionInbox.tsx:107](../client/src/components/actions/ManagerActionInbox.tsx#L107) | In collab mode, loading older unread pages expands the always-mounted badge's infinite query. Every 30-second poll sequentially refetches all loaded pages, even after closing the popover. | Separate count/latest-page polling from paginated history; bound history retention and refresh deliberately. |
| P09 (resolved) | Medium | Bundle/load | [TeamTrackerPage.tsx:34](../client/src/components/team-tracker/TeamTrackerPage.tsx#L34), [SessionColumn.tsx:18](../client/src/components/team-tracker/one-on-one/SessionColumn.tsx#L18) | Team's static 1:1 workspace import pulls in the approximately 396 KB raw CodeMirror/editor chunk, even when the panel's feature is disabled. | Lazy-load OneOnOneWorkspace inside the existing feature/panel branch. |
| P10 (resolved) | Medium | Bundle/load | [App.tsx:12](../client/src/App.tsx#L12), [App.tsx:41](../client/src/App.tsx#L41) | Capture, palette and task drawer are eagerly imported despite conditional rendering; detail fields/timeline/composer land in startup JS. Total static entry closure is approximately 933 KB raw / 276 KB gzip. | Lazy-load these overlays, preserving their state after first use where needed. The measured total is not an estimate of savings. |
| P11 (resolved) | Medium | Copilot history | [assistant/service.ts:555](../server/src/assistant/service.ts#L555), [assistant/service.ts:669](../server/src/assistant/service.ts#L669) | Every tool-loop iteration loads the entire conversation before trimming to MAX_HISTORY_ROWS/character budget. Long conversations incur growing DB/allocation costs despite bounded model context. | Select a bounded recent history window in SQL, preserving complete user/tool turns; paginate conversation detail separately. |
| P12 (resolved) | Medium | Backup runtime | [backup.service.ts:176](../server/src/services/backup.service.ts#L176), [backup.service.ts:184](../server/src/services/backup.service.ts#L184) | Each backup download sanitizes a copy with synchronous better-sqlite3 VACUUM on the HTTP process. Large snapshots block unrelated requests while the whole file is rewritten. | Run sanitization/VACUUM in a worker or subprocess, with bounded concurrency and temporary-file cleanup. Preserve session removal. |
| P13 (resolved) | Medium | Search queries | [search.service.ts:160](../server/src/services/search.service.ts#L160), [search.service.ts:191](../server/src/services/search.service.ts#L191) | Palette issue search sorts/materializes all substring matches, including closed/hidden history, before visibility filtering and returning six. Common terms amplify work. | Push equivalent visibility rules and LIMIT into SQL; consider FTS if substring scanning remains costly. |

## Quick wins

1. **P01:** Reuse timezone formatters, following `today-clock.ts`'s existing pattern; precompute per-row signals for counts.
2. **P07:** Delete the redundant detail invalidation; one mutation should trigger one detail refetch.
3. **P09:** Lazy-load the optional 1:1 workspace to remove the editor dependency from ordinary Team visits.
4. **P05 / P06:** Bound attention's closed candidates; compile one mention matcher per note analysis.

## High finding notes

**P01 — resolved 2026-10-06:** Cached timezone formatters and request-local row signals, facts and sort keys; all nine view results and timezone semantics preserved.

**Original P01 evidence — task-view CPU blocks other requests.** `matching()` calculates signals before testing filters, and `counts()` repeats it for each view. Actual matching code over 1,000 synthetic tasks across nine built-in views took **1.89–2.15 seconds**, excluding database work. Independently, 10,000 calls to the real `isoDatePart` took **1,002 ms**, versus **78 ms** with equivalent formatting using one reused formatter. Cache formatters, calculate row facts/signals once, and precompute comparator keys; preserve timezone/date semantics.

**P02 — resolved 2026-10-06:** Virtualized Work desktop/mobile and grouped Tasks; bounded list APIs with complete-filter totals preserve full-view search, export, selection, actions and drawer links.

**Original P02 evidence — backlog size determines browser work.** Work's desktop table and mobile cards, and Tasks' expanded groups, mount the full response. Backend list paths ([issue.service.ts:76](../server/src/services/issue.service.ts#L76), [task-views.service.ts:404](../server/src/services/task-views.service.ts#L404)) impose no page limit. Large backlogs therefore increase mount, reconciliation and layout work even when only a few rows are visible. Add viewport virtualization and bounded API pages, preserving keyboard navigation, selection and whole-view operations. Browser latency was not measured.

## Review evidence and existing strengths

Parallel reviewers covered rendering, frontend data, bundle/load and DB queries; the lead reviewer covered runtime and independently checked the highest-impact paths. Checks used actual source transpiled in memory with synthetic inputs/mocked query functions, plus a production client build in `/tmp`. Notes analysis measured **48 ms for 500 bullets / 20,399 characters**, and **94 ms for 1,000 bullets / 40,799 characters**, with 50 developers. Query probes confirmed two detail fetches after duplicate invalidation and three sequential requests for a three-page inbox refetch. No runtime database, app startup, Jira calls, push or deployment was used.

Already useful: major routes are lazy, task associations are batched, SQLite uses WAL, task rows are memoized, and CodeMirror decorations inspect visible ranges. Today's cache coalesces identical builds; event timelines and ordinary closed views are bounded.

## Fix measurements (2026-10-06)

P01 rerun: `node scripts/benchmark-task-views.cjs` transpiles the actual source with inert infrastructure imports (no DB/Jira), 1,000 synthetic tasks × nine built-in views, and 10,000 timestamp `isoDatePart` calls in Asia/Kolkata. Three runs before: matching **3,318 / 3,139 / 3,162 ms**, dates **960 / 935 / 946 ms**. After: matching **69 / 32 / 31 ms**, dates **65 / 56 / 56 ms** (includes cold first run). Median reductions: **98.99%** and **94.08%**. Every view's count is identical: `519, 0, 519, 260, 77, 130, 227, 639, 91`. These are synthetic CPU measurements, exclude DB/DTO work, and use a reproducible fixture rather than claiming the review's unspecified fixture or host is identical.

P02 Work portion: bounded issues pages (default 200, maximum 500, complete-filter totals) and measured desktop/mobile virtualization. A synthetic 1,000-defect browser fixture mounted **25 desktop rows / 13 mobile cards** initially; scrolling to the end, offscreen selection, fifth-page search and complete CSV passed. Clients assemble all bounded pages to preserve the existing full-filter client operations; viewport-only fetching and pushing all issue predicates into SQL are deferred, so total client data memory and backend candidate scans still scale with the backlog. Grouped Tasks completed in the following commit.

P02 Tasks portion: one measured window across task groups, labels and inline capture; bounded task pages (default 200, maximum 500) before DTO/child enrichment, complete-filter totals and unchanged internal whole-view reads/counts. A 1,000-task browser fixture mounted **24 initial rows / 25 end rows**, **16–24 mobile rows** across repeated runs, with grouped scrolling, 51-row keyboard range selection across the mounted window, complete CSV, offscreen `?task=` drawer and inline capture focus verified. Work repeated runs mounted **25 desktop rows / 13–19 mobile cards**. Row memoization, active editors, URL/saved-view filters and existing atomic bulk-write limits are preserved. Browser mount counts are measurements, not latency estimates. Both clients read all bounded pages before enabling complete-filter operations; viewport-only data loading and SQL predicate pushdown are deferred. All **241 targeted client / 102 backend tests** pass, as do typecheck, lint (0 errors), build checks and the data guard. The requested format check reports only the pre-existing local `.claude/settings.local.json`, left untouched.

Final P01 smoke rerun after P02: matching **71 / 34 / 34 ms**, dates **62 / 56 / 56 ms**; all nine counts remain identical.

**P07 — resolved 2026-10-06:** Detail invalidation runs once per affected task/scope, including cached parent/child references; GETs consume AbortSignal. Active observer regression measured 2 → 1 GET per mutation; unrelated details stay fresh and unmount cancels requests. 19 focused frontend tests pass.

**P09 — resolved 2026-10-06:** Lazy 1:1 workspace stays behind both existing feature/panel gates; 121 focused Team/1:1 tests pass. Manifest-based static Team closure: 1,680,071 → 1,241,587 bytes raw; 494,303 → 356,127 gzip. Reproduce with a Vite manifest build and scripts/measure-client-bundle.cjs. No shared runtime exports changed.

**P10 — resolved 2026-10-06:** App overlays load on first use with local Suspense boundaries; the task drawer remains mounted after closing, preserving its existing state lifecycle. 175 focused App/palette/capture/drawer tests pass. Static entry closure: 932,795 → 756,866 bytes raw; 277,055 → 228,454 gzip (18.9% / 17.5% reduction). No shared runtime exports changed.

**P05 — resolved 2026-10-06:** Needs attention/drift SQL now selects open tasks and the inclusive seven-day UTC closed window before event/link hydration; explicit closed and withClosed ranges keep their timezone bounds. 34 backend service/route tests pass, covering cutoff, future rows and historical closed views.

**P06 — resolved 2026-10-06:** One roster regex per analysis, deferred footer counts, 250 ms coalesced draft writes with pagehide/hidden/unmount flushing, cancellation on clear, and deferred cap cleanup. 94 focused frontend tests pass; 20-edit fixture makes 1 storage write instead of 20. Synthetic 1,000-bullet analysis median 96.03 → 6.07 ms (scripts/benchmark-notes.cjs); candidate counts unchanged.

**P03 — resolved 2026-10-06:** Team no longer mounts the full-issue polling hook. Editable Jira picker debounces cancellable lean SQL suggestions (maximum 8, five fields), preserving visibility, priority order, literal substring and Unicode case behavior; detail bodies stay out of suggestions. 91 frontend and 10 backend tests pass. Synthetic 60-second closed-picker fixture: 3 full-list GETs → 0; opening fetches one bounded suggestion page.

**P08 — resolved 2026-10-06:** Badge/latest polling uses one bounded shared query; older history loads on demand without polling, retains at most five pages, and is released on close. Explicit Refresh returns to latest; overlaps are deduplicated. 24 focused inbox/header tests pass. Three-page synthetic poll: 3 sequential requests → 1, also after closing; retention capped at 100 history rows plus 20 latest.

**P04 — resolved 2026-10-06:** Indexed correlated latest-visible-event SQL returns summary fields only, preserving canonical/legacy identity, manager/developer/former-owner visibility, redaction, UTF-16 excerpts and timestamp/ID ties. Reuses existing indexes; no schema change. 71 backend service/route tests pass. A 1,002-event synthetic history returns 1 summary row; EXPLAIN confirms the existing task/time index.

**P13 — resolved 2026-10-06:** Palette issue search applies equivalent visibility and LIMIT 6 in SQL and projects result fields only. 29 service/route tests cover hidden newest matches, expired/future snoozes, scopes and SQL LIMIT. Substring matching is preserved; FTS is not introduced because the finding is addressed without changing matching semantics (substring scans remain).

**P11 — resolved 2026-10-06:** Model history selects at most 61 recent rows in SQL before existing whole-user/tool-turn and character-budget trimming; detail uses separately bounded keyset pages (100 default/200 max), complete counts and explicit Load older with preserved scroll position. 26 backend and 20 frontend tests pass; a 1,002-message fixture hydrates at most 61 model rows and paginates all detail messages without gaps/duplicates. Existing indexes suffice.

**P12 — resolved 2026-10-06:** Download-copy session deletion and VACUUM run in a worker with one global rewrite slot, timeout/error handling, and temporary cleanup on failure/completion/disconnect. 18 focused service/route tests pass, including session bytes, event-loop responsiveness, concurrency, worker failure and an already-disconnected response. Synthetic 46,104,576-byte snapshot: maximum 5 ms timer gap 982.9 → 34.8 ms; job duration 977.5 → 1,202.5 ms (worker overhead; responsiveness improves). Reproduce with scripts/benchmark-backup-sanitizer.cjs.
