# LeadOS code and application review

Reviewed **60f7901** on **2026-10-13**. Review and reporting only: application code, dependencies, configuration and runtime data were not changed. No commits, deployment or live integration calls were made. Detailed coverage and diagnostic evidence are in [review-scratchpad.md](review-scratchpad.md).

## Summary and priorities

Eight confirmed defects remain despite passing full test suites. Prioritize account-switch privacy, carry-forward date integrity, and Jira configuration isolation. Related account-switch paths and Jira fallbacks are grouped below; previously remediated review findings are not repeated.

| ID | Severity | Confidence | Finding |
| --- | --- | --- | --- |
| R1 | High | High | Delayed client continuations send the previous account's private text under the next account |
| R2 | Medium | High | Canonical Team carry-forward reschedules future commitments outside its source day |
| R3 | Medium | High | Jira discovery and sync bypass workspace-scoped configuration defaults |
| R4 | Medium | High | Rejected follow-up creation can update an unrelated task or append a note |
| R5 | Medium | High | A failed meeting next action leaves the meeting outcome saved |
| R6 | Medium | High | Meeting next-action Owner selection creates only a person link |
| R7 | Medium | High | Retrying a Today follow-up after an uncertain result creates duplicates |
| R8 | Low | High | Logout silently removes the remembered desktop-alert preference |

## Findings

### R1 — Client follow-on writes outlive their initiating account

**High severity · High confidence.** Files: `client/src/hooks/useWeeklyReview.ts:58`, `:82`, `:104`; `client/src/hooks/useDailyNotes.ts:177`, `:185`, `:297`; `client/src/context/AuthContext.tsx:52`; `server/src/routes/review.ts:78`.

- **Evidence / impact:** Two diagnostic tests exercised the actual hooks with a controlled API transport. An unmounted review hook submitted A's queued report under B's current simulated cookie after A's first response arrived. The Notes task hook similarly retried A's private title and context under B after a delayed unknown-person response. Cache cleanup and success-callback guards do not stop these new requests. Server routes use the current session's owner/workspace, so a review can overwrite B's report with A's confidential text. The Notes retry can create a task in B when B has a note for the same date.
- **Trigger / reproduction:** Start a review save as A, edit the report again while it is pending, then log out and sign in as B before the first response arrives. Alternatively, start a note-derived task containing an unknown `@person`, switch accounts, then allow the rejected response to arrive. Observe a follow-on PUT/POST containing A's text.
- **Recommended fix:** Capture an auth scope/epoch for the whole operation and check it before every follow-on request, including recursive flushes, confirmation resubmissions and mention retries. Revoke continuations on account/session changes. Preserve ordinary navigation saves within the same account.
- **Suggested verification:** Deferred-response hook tests covering both paths, plus a two-account browser/API test asserting that B receives no request or persisted text from A. Include logout failure and switching back to A.

### R2 — Team carry-forward pulls future work into the destination day

**Medium severity · High confidence.** Files: `server/src/services/team-tracker.service.ts:2640`; `server/src/services/task.service.ts:269`; `server/src/routes/team-tracker.ts:251`, `:703`.

- **Evidence / impact:** The canonical branch calls `TaskService.list({ view: "developer", date: fromDate })`, whose predicate includes developer tasks regardless of scheduled date, then reschedules every open result. Selected IDs also bypass the legacy source-day eligibility checks. An isolated real-service probe moved a task from **2026-10-23 to 2026-10-14** when carrying **2026-10-13 → 2026-10-14**. This overwrites deliberate future plans; availability failure on unrelated future work can also reject a carry operation.
- **Trigger / reproduction:** Create an open developer task scheduled after the carry destination. POST `/api/team-tracker/carry-forward` with `fromDate`, `toDate` and no `itemIds`; inspect its `scheduledOn` afterward.
- **Recommended fix:** Define canonical carry eligibility from the source board/day, preserving future commitments. Validate explicit IDs against the same eligible set and deduplicate them before mutation. If this legacy operation is intentionally unavailable in canonical mode, reject execution consistently with its disabled preview.
- **Suggested verification:** Canonical route tests with source-day, overdue, future, undated, closed and unavailable-owner tasks; test both omitted and explicit IDs. Assert future dates remain unchanged and preview/execution agree.

### R3 — Jira fallbacks reintroduce another workspace's settings

**Medium severity · High confidence.** Files: `server/src/sync/engine.ts:161`; `server/src/routes/team.ts:210`; `server/src/services/settings.service.ts:76`, `:176`.

- **Evidence / impact:** The Settings service limits environment fallbacks to `default`, but SyncEngine applies `config.JIRA_SYNC_JQL` again when the scoped getter returns undefined. A mocked friend sync used **`project = OWNERFIXTURE`** despite having its own project and no custom query. Discovery also used the install URL/email/project with an explicitly supplied friend token and no friend connection settings. These paths can query the wrong project/instance, return the wrong roster or import unexpected issues within the supplied credentials' permissions.
- **Trigger / reproduction:** Set a synthetic install `JIRA_SYNC_JQL`; configure a second workspace's Jira connection without a `jira_sync_jql` row and run a mocked sync. For discovery, submit a token from the second workspace before storing its connection settings and inspect the mocked client destination.
- **Recommended fix:** Resolve every Jira setting through the workspace-aware Settings service; remove downstream global fallbacks. Missing foreign-workspace settings should remain missing. Audit the engine's custom-field fallbacks as well.
- **Suggested verification:** Multi-workspace tests with distinct environment and persisted settings, absent versus explicitly blank queries, and captured client arguments. **No install-token disclosure was demonstrated:** the runtime token getter's empty-string sentinel prevents the apparent final token fallback.

### R4 — Create-only follow-up paths execute other capture intents before failing

**Medium severity · High confidence.** Files: `server/src/services/today.service.ts:883`, `:901`; `server/src/services/capture.service.ts:89`; `client/src/components/today/TodayPage.tsx:582`.

- **Evidence / impact:** `createFollowUpTask` dispatches the text through the full capture pipeline, then rejects a response without `task`. The real-service probe submitted `T-n: unintended update`: the command returned **400**, but a shared update was appended to T-n, increasing its event count from 1 to 2. `/note` follows the same dispatch-before-rejection path by inspection. Meeting next-action text uses this helper too. Users see failed creation while different data has changed; task updates may be developer-visible.
- **Trigger / reproduction:** In Today's Follow up dialog, submit `T-1: text` for an existing task, or send that title to `/api/manager-actions/commands` with `capture_follow_up`. Inspect T-1's timeline despite the failure response.
- **Recommended fix:** Require `parseCapture(...).intent === "create"` before invoking the mutating pipeline, as `createTaskViaCapture` already does on the client. Apply the restriction to both follow-ups and meeting next actions.
- **Suggested verification:** Route tests for `T-n: ...` and `/note ...` in both fields. Assert a validation error and unchanged task events, notes, task counts and meeting outcome.

### R5 — Outcome and next-action creation do not commit atomically

**Medium severity · High confidence.** Files: `server/src/services/today.service.ts:682`, `:684`, `:799`.

- **Evidence / impact:** The service updates the meeting before creating its optional next action, without an encompassing transaction. A valid outcome plus `Follow up @absentperson` returned **400**, yet the outcome remained stored. No success or undo response reached the caller. The legacy branch likewise commits its outcome/status first.
- **Trigger / reproduction:** Record a meeting outcome with a next action containing an unknown person, invalid parent/link, or another creation validation failure; reload the meeting after the error.
- **Recommended fix:** Validate the proposed next action first and commit meeting changes and child creation in one transaction. Failures must restore the original outcome/status and leave no child or events.
- **Suggested verification:** Service and route tests that induce failures after the meeting write in canonical and supported legacy modes. Assert all affected tables remain unchanged.

### R6 — Selected next-action owner is discarded

**Medium severity · High confidence.** Files: `client/src/components/today/TodayTextCaptureDialog.tsx:118`; `server/src/services/today.service.ts:839`, `:853`, `:890`.

- **Evidence / impact:** The dialog labels the developer selector **Owner**. The service converts it into `links.developerAccountIds` and omits `defaults.ownerAccountId`. Selecting `dev-1` in the isolated probe created a manager-owned task with only a `person` link to dev-1. It therefore does not become the developer's assigned work or appear in their My Day. The existing canonical test checks parent/title/check-by, not ownership.
- **Trigger / reproduction:** Record a meeting outcome, add a next action, select a developer as Owner, and inspect the created child task and that developer's My Day.
- **Recommended fix:** Pass the selected owner as structured capture ownership context, preserving typed-token precedence and the default **You** behavior.
- **Suggested verification:** Route-level assertions for owner type/ID, tracking manager, parent, availability validation, developer My Day visibility and undo; test **You** and an explicit developer.

### R7 — Today task creation has no stable replay identity

**Medium severity · High confidence.** Files: `client/src/components/today/TodayPage.tsx:582`; `server/src/routes/manager-actions.ts:114`; `server/src/services/today.service.ts:883`; `server/src/services/capture.service.ts:95`.

- **Evidence / impact:** Today command requests do not carry a retained request ID into capture. Capture generates a new UUID for each call. Two identical real-service submissions produced **T-5 and T-6**. The dialog remains open after a transport error, so retrying a request whose first response was lost duplicates the follow-up. Meeting next-action retries use the same path. The in-flight click guard only coalesces overlapping calls.
- **Trigger / reproduction:** Let a create command commit but drop its response; save again from the still-open dialog. Observe two tasks/child actions for one intended submission.
- **Recommended fix:** Retain a request ID for the dialog's submission across uncertain results and retries, carry it through shared contracts and route validation, and replay the original result. Use a fresh identity for an intentionally new submission; reject incompatible reuse. Include the compound meeting result/undo in replay semantics.
- **Suggested verification:** Lost-response/retry tests assert one task, one child/event set and the same returned identity. Test edited retry payloads and overlapping requests.

### R8 — Desktop-alert preference is erased on logout

**Low severity · High confidence.** Files: `client/src/context/AuthContext.tsx:59`, `:101`; `client/src/lib/scoped-storage.ts:23`; `client/src/hooks/useDesktopAlerts.ts:31`, `:54`. Intended persistence: [docs/66](66-in-app-task-updates.md).

- **Evidence / impact:** Logout deletes every user-prefixed storage key, including `desktop-alerts` and its prompt state. A diagnostic test enabled alerts with browser permission granted, ran the actual cleanup, and remounted the hook: **enabled=false, canOffer=false**. Returning users silently lose their per-person/browser choice and receive no new permission prompt.
- **Trigger / reproduction:** Enable desktop alerts, sign out, then sign back in on the same browser with permission still granted.
- **Recommended fix:** Separate persistent per-user preferences from drafts/cached content during cleanup. Keep alert choices scoped to their user and browser while revoking pending notifications/callbacks on logout.
- **Suggested verification:** Auth-plus-alert integration tests proving preference persistence for the same user, separation between users and removal of sensitive drafts.

## Scope, checks and limitations

The current npm monorepo is one application: React 18/Vite/TanStack Query client, Express 4 services, Drizzle/better-sqlite3 SQLite and shared TypeScript contracts/grammar. Custom history routing serves Today, Tasks/projects, Team/standup/1:1, Work/Jira, Notes, weekly review, Settings and developer My Day. Auth uses cookie sessions, workspace principals and invite-only registration; Jira has scheduled workspace sync and Copilot has streamed replies with confirmation-gated writes.

Read root `AGENTS.md`, README, architecture/technical documentation, current task/solo-first/tenancy/weekly-review/1:1/notification specs, deployment guidance and prior review remediation. Inspected application entry/mounts, auth/validation/error middleware, core routes/services, client API/hooks/routing/storage, shared contracts, schema/migration/transaction paths, outbound guards, Jira writes/scheduler, Copilot claims, backups and maintenance boundaries. Traced the critical workflows above end to end and reviewed relevant tests. Query batching/paging, Today caching, history reconstruction, render/query state and resource bounds were inspected; no additional measured performance defect is claimed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build:check` | Passed; client output went to `/tmp`, server used no emit |
| `npm run test --workspace=server` | 127 files / 1,703 tests passed; unique temporary database |
| `npm run test --workspace=client -- --maxWorkers=2` | 166 files / 2,219 tests passed; shared tests overlap with server totals |
| `npm run lint` | Zero errors, 607 existing warnings; no fixes applied |
| `npm run guard:data` | Passed |
| `npm run format:check` | Failed only on two pre-existing untracked `.claude/**/settings.local.json` files |
| Shared JS artifact comparison | Fresh compilation into `/tmp` matched both committed artifacts byte for byte |
| Diagnostic reproductions | Three client hook tests plus isolated real-service/auth/route probes confirmed findings; Jira clients were mocked |

All review diagnostics, generated build output, test databases and logs were temporary. No normal application bootstrap, runtime database, real Jira operation, external Copilot provider, install/dependency mutation or production checkout was used. Only the two requested documentation files were added; the pre-existing untracked `.claude/` directory was preserved.

This is a focused cross-layer review, not a line-by-line audit of every file. No manual browser/visual accessibility audit, production migration rehearsal, real-provider compatibility test, dependency advisory scan, coverage-threshold run or representative load/heap benchmark was performed. Tests ran on Node **24.14.1**, while repository guidance expects Node 20; client tests emitted jsdom navigation/animation limitations without failures. Account-switch probes controlled the transport and cookie identity; full browser persistence validation remains a suggested regression test. Unproven transaction-interleaving and cache-retention concerns are recorded separately in the scratchpad.

## Remediation — R1 (2026-10-13)

Review flushes and every note capture retry/confirmation now require the initiating auth epoch; note continuations also require the original mounted scope. Same-account navigation still flushes review edits.

Revalidated against current code before editing. AccountWriteContinuations, useDailyNotes, AuthContext and WeeklyReviewMode: 42 tests passed; typecheck and build:check passed. Actual AuthProvider cleanup is exercised with deferred mocked transport, failed logout, B login and return to A; no full browser run. Original review evidence above is preserved.

## Remediation — R2 (2026-10-13)

Canonical Team carry-forward now rejects with 409, matching its disabled preview/context; canonical unfinished work already remains visible on the board and is scheduled through Tasks. Legacy carry-forward is unchanged.

Revalidated against current code before editing. Team Tracker route/service suites: 126 tests passed; typecheck and build:check passed. Regression checks bulk and explicit IDs, duplicate selection, source/overdue/future/undated/closed tasks and destination leave; task rows and events remain identical. Original review evidence above is preserved.

## Remediation — R3 (2026-10-13)

Jira discovery resolves URL, email, project and stored credentials through SettingsService. Sync and reconciliation consume scoped query/custom-field values without downstream install-env fallbacks.

Revalidated against current code before editing. jira-workspace-settings, sync.engine and team.routes: 22 tests passed; typecheck and build:check passed. Mocked Jira validates friend destination/token, absent/blank/custom queries, custom-field import and reconciliation; default workspace env fallback remains supported. Original review evidence above is preserved.

## Remediation — R4 (2026-10-13)

Today follow-up and next-action fields reject non-create grammar intents before invoking capture or mutating a meeting; the creation helper also enforces the restriction.

Revalidated against current code before editing. Today follow-up, route and service suites: 51 tests passed; typecheck and build:check passed. Service and route regressions submit T-n updates and /note to both fields and assert unchanged tasks, events, notes and meeting outcome. Original review evidence above is preserved.
