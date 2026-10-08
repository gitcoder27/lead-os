# Task reliability implementation plan

Created: 2026-10-07. Reviewed application baseline: `f07a77b`.

This plan covers the five fixes selected after the repository review. No TODO/FIXME markers were found in application source; findings came from recent commits, current code and disposable reproductions. The user approved planning all five. This documentation commit does not implement any application fix.

## Scope and execution

- Work sequentially in `/home/ubuntu/Development/lead-os` on `main`. No branches, worktrees or sub-agents. Implement only this plan's items, in the order below; older unchecked backlog items are not part of this run.
- Inspect `git status` and recent commits before each item. Existing untracked `docs/screenshots/` belongs to the user: do not modify, stage or commit it. Do not overwrite unrelated changes introduced after this plan was written.
- Each item gets one implementation commit containing its code, tests and tracking updates. Use the commit messages below, or an equivalent `type(scope): summary (TR-0N)` message. Stage explicit task-scoped paths; do not combine items in one commit.
- After completing each item, report its commit, changed behavior/files, exact verification results and limitations, then stop. Wait for the user's confirmation before starting the next item. Do not propose another round of work until the user confirms.
- Use mocked APIs, browser storage, synthetic fixtures and fresh temporary test databases. No paid services, production access, runtime databases, real Jira calls/sync, outbound messages, data deletion, push or deployment. Existing test-fixture resets are allowed only in the isolated test database.
- Preserve custom routing, lazy loading, manager/developer permissions, manager-private project placement, the shared capture grammar, guarded writes/Undo, and existing pagination/performance bounds. Reuse the installed dependencies and API wrapper.
- Re-read the cited code before editing; file lists identify the expected scope, not a requirement to modify every listed file. A small supporting module or regression test within the same item is allowed. Do not expand into neighboring product features.
- Tick each item here and in [docs/56](56-implementation-plan-solo-first.md), and add verification rows to both progress logs in the same implementation commit. Leave incomplete criteria unchecked. A log may say `main (this commit)`; report the actual hash in the handoff rather than rewriting the commit to include its own hash.

## Checklist and order

| Order | Item | Outcome | Implementation status |
| --- | --- | --- | --- |
| 1 | TR-01 | Retrying an unchanged inline task/subtask submission cannot create a duplicate | Complete |
| 2 | TR-02 | Task activity, counts and project summaries refresh after the scoped writes | Complete |
| 3 | TR-03 | The manager's linked roster identity is consistently shown as You in Tasks | Complete |
| 4 | TR-04 | Temporary history failures preserve loaded task activity and offer targeted Retry | Complete |
| 5 | TR-05 | The project capture/replay test passes independently of the real calendar date | Complete |

There are no implementation dependencies between items. TR-01 and TR-02 touch some of the same hooks; preserve the earlier item's behavior and regression tests. Do not mark wider backlog items complete merely because these fixes overlap them.

## Review evidence and baseline limitations

Five disposable mocked checks confirmed these current behaviors: a creation retry without an explicit ID gets a different ID; list writes omit project caches; posted updates omit Tasks/count caches; task detail people lookup ignores a separate linked roster ID; failing to load older inbox updates hides the successfully loaded latest update. Those checks asserted the current bugs, not the desired result, and are not committed regression tests. Recreate meaningful acceptance tests in the repository; do not depend on review artifacts under `/tmp` being present in a later session.

`npm run test --workspace=server -- tests/projects.service.test.ts` reproduced **12 passed, 1 failed** on 2026-10-07: the capture/replay case sends `clientToday: "2026-10-05"`, while the server resolves today to 2026-10-07. TR-05 owns this existing failure. Do not weaken production date validation or sneak the test fix into an earlier commit. Earlier items must pass their applicable focused tests and quality gates; if a broader server run encounters this unchanged failure, record it explicitly. After TR-05 the full isolated server suite is a required gate.

## TR-01 — Safe retries for inline task creation

- [x] Implement and verify TR-01.

**Problem:** [createTaskViaCapture](../client/src/hooks/useCapture.ts) generates a fresh `requestId` whenever its caller omits one. [InlineAddForm](../client/src/components/tasks/TaskList.tsx), [TasksPage](../client/src/components/tasks/TasksPage.tsx) and the child/action-item form in [TaskDetailRelations](../client/src/components/tasks/TaskDetailRelations.tsx) retain a failed draft but submit it again without its original ID. If the server committed the first request and its response was lost, the second request can create another task. The [server capture service](../server/src/services/capture.service.ts) already replays a repeated ID to the original task.

**Implementation:**

1. Give each inline-add or child/action-item form its own submission identity. Allocate it before the first request and retain it when that same submission fails or is not acknowledged.
2. Retry the unchanged submission with the original ID and payload context. Capture text, structured defaults, parent/placement and client day/zone belong to the attempt; do not silently reuse an ID after any of those changes. A day rollover must not cause an old retry ID to mean a newly resolved relative date, or silently allocate a new ID for an uncertain prior submission. If the retained day becomes too old for the server's validation, report the unresolved retry rather than automatically creating another task.
3. Start a new identity after success, an edited submission, changed owner/group/parent/placement context, or an explicit canceled/new form. Deliberately adding the same title again must still work. Scope attempts to the current authenticated account; a late response must not clear another form/account's draft.
4. Guard repeated submission while pending, retain the failed draft, and release the pending state on every error path. Preserve grammar/typeahead, confirmation behavior, warnings, context defaults, child placement inheritance and the existing server replay contract.
5. Prefer a small reusable attempt abstraction or explicit per-form request IDs. Do not deduplicate globally by title or give unrelated open forms the same identity. This item covers Tasks inline adds and task/meeting child adds; preserve other capture callers without broadening the feature scope.

**Expected files:** `client/src/hooks/useCapture.ts`; `client/src/components/tasks/TaskList.tsx`; `TasksPage.tsx`; `TaskDetailRelations.tsx`; a small capture-attempt hook/module if useful. Tests: `client/src/test/useCapture.test.ts`; `TasksPage.test.tsx`; `TaskDrawer.test.tsx`; a focused new test for the attempt lifecycle if needed. Reuse the existing replay test in `server/tests/capture.routes.test.ts`; extend it only if integration proof is missing.

**Acceptance and proof:** Simulate a server-accepted request whose response is lost, then retry through each UI path. Assert the retry carries the same ID and resolves to one task. Verify edits/context changes get a new ID; intentional equal-title additions remain distinct; two forms and two managers remain isolated; repeated Enter while pending cannot duplicate a submission; failure leaves the draft usable. Preserve malformed-mention and confirmation regressions. The UI proof must be stronger than calling the helper twice with a hard-coded ID, which the server already supports.

```bash
npm run test --workspace=client -- useCapture.test.ts TasksPage.test.tsx TaskDrawer.test.tsx
npm run test --workspace=server -- tests/capture.routes.test.ts
```

Include any newly added focused test in the run and handoff.

**Commit:** `fix(capture): preserve inline task retry identity (TR-01)`.

## TR-02 — Consistent task activity, counts and project summaries

- [x] Implement and verify TR-02.

**Problem:** [useTasks](../client/src/hooks/useTasks.ts) refreshes timelines and several daily surfaces after an event, but omits `tasks` and `task-view-counts`. [TaskViewsService](../server/src/services/task-views.service.ts) derives stale signals and some Waiting membership from the latest event, so a newly updated task can still appear stale. [useTaskListMutations](../client/src/hooks/useTaskListMutations.ts), [useTaskDetail](../client/src/hooks/useTaskDetail.ts) and [useCapture](../client/src/hooks/useCapture.ts) omit `projects`/`project`; a mounted [project summary](../client/src/components/tasks/ProjectFactsRow.tsx) can therefore keep outdated open/blocked/follow-up facts.

**Implementation:**

1. Refresh affected Tasks queries and manager view counts after successful manager/developer task updates posted through `useTasks`. Preserve coalesced manager recounts; developer writes must not wake a cached manager count query.
2. Refresh the submitting manager's project directory/detail/track facts after capture, list/bulk edits and Undo, and detail edits that can change those facts. Existing placement writes already refresh their project surfaces; preserve that behavior.
3. Share only the necessary refresh policy in a domain-specific module if this removes duplication. Avoid a circular dependency between the capture and list-mutation hooks. Query key layouts vary: some put auth scope at index 1 and some elsewhere. Inspect actual keys and match them accurately.
4. Guard late completions against account/workspace changes. Keep another scope's queries untouched. Keep P07's detail refresh behavior: the affected task and related parent/child details refresh; unrelated details do not.
5. Preserve ordered writes, field-aware rollback, atomic guards and Undo, bounded requests, existing daily-surface refreshes and count debounce. Refused/confirmation-only captures and failed event submissions must not announce success or trigger a success recount. Keep the existing error/settlement policy for uncertain task writes.

**Expected files:** `client/src/hooks/useCapture.ts`; `useTasks.ts`; `useTaskDetail.ts`; `useTaskListMutations.ts`; a new `client/src/lib/task-query-invalidation.ts` or equivalent if needed. Reuse `client/src/lib/task-count-invalidation.ts`. Tests: `client/src/test/useTaskInvalidation.test.tsx`; `useProjects.test.tsx`; `useTaskListMutations.test.tsx`; new `useTaskEvents.test.tsx` if useful. `ProjectsPanel.test.tsx` or another mounted integration test can prove visible summary changes.

**Acceptance and proof:** With active query observers and mocked fresh responses, post an update and observe the stale signal/Waiting membership and count change without navigation or window focus. Complete a project task and Undo it; both directory and detail open counts must follow the server answer. Verify blocked/check-by changes and new captures update applicable facts, including track summaries. Assert exact refresh behavior across success, failure, confirmation-only capture, auth changes and unrelated task details. Seed inactive caches too and verify they become stale when appropriate. Do not rely solely on spying that `invalidateQueries` was called.

```bash
npm run test --workspace=client -- useTaskInvalidation.test.tsx useProjects.test.tsx useTaskListMutations.test.tsx ProjectsPanel.test.tsx
```

Include new event/refresh tests in the run. This is a client refresh repair; a broader rewrite of Team/My Day adapter mutation hooks or server caches is outside the item.

**Commit:** `fix(tasks): refresh activity counts and project facts (TR-02)`.

## TR-03 — Linked manager identity throughout Tasks

- [x] Implement and verify TR-03.

**Problem:** The server's [self-identity resolver](../server/src/services/self-identity.service.ts) and Tasks views recognize a manager's login plus their separately linked roster ID. [TasksPage](../client/src/components/tasks/TasksPage.tsx), [useTaskPeople](../client/src/components/tasks/TaskDetailFields.tsx), and [task grouping](../client/src/lib/task-views.ts) compare only one ID. Existing UI tests cover a legacy manager whose login already equals the roster ID, leaving the separate-ID case untested. The intended read-only identity model is documented in [docs/64](64-manager-identity.md).

**Implementation:**

1. Use the existing auth-scoped `useSelfLink` for managers, with `developerAccountId` as the authoritative separate roster identity. A suggested match is not a confirmed link. Developer screens must not request the manager-only endpoint.
2. Resolve the login and linked active roster record as You in list rows, detail owner/person labels and relevant owner/party grouping. One owner group should represent the manager, with correct inline-add context. Do not turn an explicitly chosen waiting-on party into an implicit assignment.
3. Remove the duplicate self roster entry from owner filters/assignment choices while retaining the existing You choice. Preserve colleague names and explicit assignment semantics.
4. Follow link/unlink changes and auth/workspace changes through the existing cache policy. With a failed/unavailable link read, fall back to the known login identity rather than guessing from name/email or a suggestion.
5. Keep this read-side only. Rendering, grouping and linking must not rewrite task ownership, visibility, placement, pins, links or history. The login remains the owner ID used by explicit manager assignment and ordinary private inline creation.

**Expected files:** `client/src/components/tasks/TasksPage.tsx`; `TaskDetailFields.tsx`; `client/src/lib/task-views.ts`; a small shared identity hook/module if useful. Reuse `client/src/hooks/useSelfLink.ts`. Tests: `client/src/test/TasksPage.test.tsx`; `TaskDrawer.test.tsx`; `SelfLink.test.tsx`; focused grouping/identity tests if needed.

**Acceptance and proof:** Use different login/roster IDs and tasks owned by each. Verify both labels say You and owner grouping has one self group; no duplicate self assignment/filter option; colleague labels and groups remain correct; inline add uses a valid manager owner context. Cover legacy equal IDs, no link, suggestion-only, failure, unlinking and switching managers. Assert no task PATCH is emitted by reading/grouping and no manager-only self-link request comes from developer detail mode.

```bash
npm run test --workspace=client -- TasksPage.test.tsx TaskDrawer.test.tsx SelfLink.test.tsx
```

Include any new grouping/identity regression suite.

**Commit:** `fix(tasks): resolve linked roster identity as You (TR-03)`.

## TR-04 — Recover history without hiding loaded activity

- [x] Implement and verify TR-04.

**Problem:** [useTaskInbox](../client/src/hooks/useTaskInbox.ts) combines latest-page and older-history errors into one `isError`. [TaskInboxContent](../client/src/components/actions/TaskInboxContent.tsx) then drops all rendered items. [TaskTimeline](../client/src/components/tasks/TaskTimeline.tsx) similarly returns only an error on any query failure, including a later page/refresh failure with already loaded activity.

**Implementation:**

1. Distinguish initial/latest load failure from older-page failure and temporary refresh failure. Retain successfully loaded rows for temporary transport/server failures, with a concise announced error identifying the failed portion.
2. Provide a targeted Retry for the failed older request without resetting successful pages. Keep explicit Refresh updates as the existing action that resets history to latest. Disable repeat attempts while the relevant request is pending; do not describe a failed load as an empty history.
3. Preserve manager/developer timeline behavior, exact event deep links, read-state acknowledgements, unread/all filters and deduplication. Do not retain another account/task/filter's rows after context changes.
4. Preserve P08's one-page latest polling, no history polling, at most five retained older inbox pages and release-on-close behavior. Do not replace the bounded history approach with unbounded refetches.
5. Treat access loss separately from temporary failure: do not keep rendering content after an authoritative permission/unavailability response. Preserve server-disabled collaboration behavior. Do not relax the existing strict guard on the exact-event deep-link section or event visibility/redaction rules.

**Expected files:** `client/src/hooks/useTaskInbox.ts`; `client/src/components/actions/TaskInboxContent.tsx`; `client/src/components/tasks/TaskTimeline.tsx`. Tests: `client/src/test/TaskInbox.test.tsx`; `tasks.test.tsx`; focused new timeline recovery tests if helpful. `useTasks.ts` changes are allowed only if needed to expose the timeline's request/error information. Notes sidebar recovery is outside this item.

**Acceptance and proof:** Load the latest page, fail the first older request, then fail a later older page after some history has loaded. Loaded rows remain usable during temporary failures; Retry appends the missing page once with no duplicates. Cover background refresh failure and first-load failure, both timeline roles, pending-state controls, read actions and account/task/filter changes. Permission loss must clear protected content. Re-run existing P08 bounded-retention/polling and exact-event tests. UI tests must assert visible retained rows and the targeted retry request, not just hook flags.

```bash
npm run test --workspace=client -- TaskInbox.test.tsx tasks.test.tsx
```

Include new timeline recovery tests. Check recovery with keyboard-accessible buttons and announced error/pending states.

**Commit:** `fix(activity): retain loaded history during retryable failures (TR-04)`.

## TR-05 — Calendar-independent project capture test

- [x] Implement and verify TR-05.

**Problem:** The capture placement/inheritance/replay case in [projects.service.test.ts](../server/tests/projects.service.test.ts) supplies a fixed 2026-10-05 client day to the real clock. The [capture service](../server/src/services/capture.service.ts) correctly rejects a date more than one day away from the server's day in the supplied zone. The test's success therefore expires as time passes.

**Implementation:**

1. Control the Date clock in the affected case (or a tightly scoped fixture), with a fixed UTC instant that resolves to the intended client day in Asia/Kolkata. Prefer the existing `vi.useFakeTimers({ toFake: ["Date"] })` pattern so timer-driven Express/database operations continue normally.
2. Restore the real clock in cleanup even when assertions fail. Make any other time-dependent value in that case consistent with its fixture.
3. Keep all existing placement, child inheritance, explicit clearing, replay, archive rollback and task-count assertions. Do not replace fixed dates with whatever happens to be today just to avoid the check.
4. Keep production code and validation unchanged. Do not weaken date-drift limits, remove `clientToday`/`tz` from the test request, skip the test, or reduce its assertions.

**Expected files:** `server/tests/projects.service.test.ts`. No application changes are expected. Reuse the existing wrong-client-day regression in `server/tests/capture.routes.test.ts`.

**Acceptance and proof:** The project suite's existing 13 tests all pass on a machine whose actual date differs from the fixture. Capture tests continue to reject an out-of-sync client day and resolve stored dates/times in the client zone. The full isolated server suite must pass; report any genuinely new failure rather than hiding it with changed expectations.

```bash
npm run test --workspace=server -- tests/projects.service.test.ts tests/capture.routes.test.ts
npm run test --workspace=server
```

**Commit:** `test(projects): control capture replay clock (TR-05)`.

## Completion gates and handoff

For every item, run its focused suites, including newly added tests, and these gates before marking it done:

```bash
npm run typecheck
npm run build:check
npm run lint
npm run guard:data
git diff --check
```

Run `npm run format:check` if tracked JSON/YAML changes; distinguish pre-existing ignored local-file failures without editing those files. No new dependencies or shared runtime exports are expected. If an approved implementation changes runtime code in `shared/types.ts` or `shared/capture-grammar.ts`, regenerate the matching committed CommonJS artifact using AGENTS.md's command and include it in that item's commit.

After TR-05, also run the full client and isolated server suites once on the final combined implementation. Repeat broader tests only when subsequent changes or failures justify it. For documentation-only TR-00, verify links, checklist/ID consistency and `git diff --check`; application builds/tests are unnecessary.

In the per-item handoff, report the commit hash, changed behavior and main files, test commands and counts/results, and any known limitation. Distinguish automated DOM/mocked checks from browser verification. If a browser check is needed, use synthetic data and a scratch DB with Jira sync disabled; never start the ordinary server against runtime data. Show the final task-scoped diff/status and stop.

## Progress log

| Date | Item | Commit | Validation / progress |
| --- | --- | --- | --- |
| 2026-10-07 | TR-00 | main (this commit) | Created this five-item plan and matching docs/56 tracking entries. Local links, five-item checklist/ID consistency, per-item commit messages and diff whitespace checks pass. Application implementation not started; no runtime data, external services, Jira, push or deployment. |
| 2026-10-08 | TR-01 | main (this commit) | Reproduced three failing lost-response/pending UI checks against original code. Form-local attempts retain ID, defaults and client day/zone; edits/context/auth changes renew identity, pending resubmission is guarded, and late completion cannot clear changed/closed drafts. Client focused suites (useCapture, useCaptureAttempt, TasksPage, TaskDrawer): 165 passed; isolated capture.routes: 31 passed. typecheck, build:check, lint (0 errors; 299 existing warnings), guard:data and git diff --check pass. Automated DOM/mocked checks only; no browser/runtime/external service access. Known date-sensitive project case remains unchanged for TR-05. |
| 2026-10-08 | TR-02 | main (this commit) | Reproduced eight observer/auth failures before repair. Scoped refresh policy updates Tasks/activity and directory/detail/track facts immediately after capture, event and detail/list writes and Undo; counts remain coalesced, developer events never wake manager counts, and unrelated details/scopes remain fresh. Failed events and refused/confirmation captures do not recount; detail/list settlement policy is preserved. Required four client suites plus useCapture/useCaptureAttempt: 63 passed. typecheck, build:check, lint (0 errors; 299 existing warnings), guard:data and git diff --check pass. Automated active-observer/mocked verification; no browser/runtime/external service access. Known project date failure remains for TR-05. |
| 2026-10-08 | TR-03 | main (this commit) | Three final UI regressions fail against original code. Authoritative auth-scoped self-link reads label login/roster owners and people as You, merge owner groups with private manager inline context, and remove duplicate self choices. Explicit waiting-party refs and all task data remain unchanged. Suggestion/error fallback, unlink, manager switch, legacy equal IDs and developer no-manager-request behavior covered. TasksPage, TaskDrawer, SelfLink, task-list and new TaskIdentity suites: 238 passed. typecheck, build:check, lint (0 errors; 299 existing warnings), guard:data and git diff --check pass. Automated DOM/mocked verification only; no browser/runtime/external access. Known project date failure remains for TR-05. |
| 2026-10-08 | TR-04 | main (this commit) | Reproduced two inbox and both-role timeline retention failures against original code. Loaded activity survives temporary older/refresh errors; announced targeted Retry preserves successful pages, pending controls block repeats, deduplication/read actions remain usable, and explicit Refresh updates resets inbox history. Authoritative 401/403/404/410 and server-disabled collaboration suppress protected content. TaskInbox, tasks and new TaskTimelineRecovery: 61 passed, including P08 latest-only polling/five-page retention/release and strict exact-event checks. typecheck, build:check, lint (0 errors; 299 existing warnings), guard:data and git diff --check pass. Automated DOM/mocked checks only; no browser/runtime/external access. Known project clock failure remains for TR-05. |
| 2026-10-08 | TR-05 | main (this commit) | Reproduced unchanged baseline: projects 12 passed/1 failed because client 2026-10-05 differed from real 2026-10-08. Pinned only Date to 2026-10-05T04:30Z (10:00 Asia/Kolkata) in the capture case; finally restores real time. Production validation and all existing assertions unchanged. projects.service + capture.routes: 44 passed (13 project tests). Full isolated server: 1531 passed/106 files. Initial full client: 2054 passed/1 unchanged DefectTable viewport timeout under concurrent validation; isolated DefectTable: 47 passed; full rerun npm run test --workspace=client -- --maxWorkers=2: 2055 passed/147 files, with unchanged assertions/timeouts. typecheck, build:check, lint (0 errors; 299 existing warnings), guard:data and git diff --check pass. All five items complete; automated DOM/mocked tests only, no browser/runtime/external service access. |
