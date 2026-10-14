# LeadOS review scratchpad

Review date: 2026-10-13. Review and reporting only; no fixes, commits, deployment, runtime database access, or live integrations.

## Baseline and instructions

- Root `AGENTS.md` is the applicable repository guidance. No nested guidance applies to the current client/server/shared source. The pre-existing untracked `.claude/` directory (including another checkout) is excluded.
- Scope: current LeadOS npm monorepo and its local dependencies, not other checkouts or projects.
- React 18 / Vite SPA with custom history routing; TanStack Query and shared TypeScript contracts. Express 4 API, Drizzle / better-sqlite3 SQLite, Jira sync and an OpenAI-compatible Copilot integration.
- Read documentation: root guidance, package scripts and test configuration; current product/task/tenancy/weekly-review and deployment documentation are being reconciled with source.
- Verification commands: `npm run typecheck`, `npm run build:check`, `npm run lint`, `npm run format:check`, `npm run guard:data`, workspace Vitest suites. Server Vitest allocates a unique database in `/tmp`; no server startup or operator CLI will be used.
- Environment: Node v24.14.1 (repository expects Node 20). Sandbox commands fail before execution (`bwrap` network namespace initialization); permitted inspection runs outside that sandbox.

## Coverage tracker

| Area | Status | Evidence / next checks |
| --- | --- | --- |
| Documentation / architecture / commands | Reviewed | AGENTS, README, docs/02/04/56/57/59/60/64/66/72 and relevant docs/23/48 sections; app factory/entry, package scripts and test setup. Older design docs were reconciled with current source. |
| Auth / registration / tenant and role boundaries | Reviewed | AuthService, RegistrationService, WorkspaceService, session/role middleware, auth routes/throttles, scoped client cleanup and full tenant suites. Scoped direct-ID probes passed in the existing suite; follow-on client requests exposed R1. |
| Tasks / capture / projects / views / events | Reviewed | Canonical create/update/list/DTO/purge, grammar dispatch/defaults/replay, TaskViews/visibility, events/history/inbox delivery, project ownership/destination/placement guards. Full suites plus targeted Today probes. |
| Today / Team / My Day / check-ins / 1:1 | Reviewed | Today plan/cache/actions/undo, Team carry-forward/freshness/board queries, My Day ownership and safe DTOs, manager-private 1:1 topics/actions. Confirmed R2 and R4–R7. |
| Notes / weekly review / notifications / search | Reviewed | Note identity/revision and source links, review aggregation/save/progress/export, scoped search and notification delivery/preferences. Confirmed client continuations R1 and preference loss R8. |
| Jira / background sync / Copilot / outbound requests | Reviewed | Jira request deadline/body/retry and transition/bulk handling, per-workspace scheduler/reconciliation/settings, outbound DNS/socket policy, Copilot claims/serialization/confirmation/rate limits and tools. Mocked route/sync probes confirmed R3. |
| Database / migrations / backups / maintenance | Reviewed | Schema and workspace keys/indexes/FKs, rebuild/additive/canonical-start/contract gates, async transaction helper, note/write atomicity, install-admin backup download/sanitization and maintenance scoping. Fresh migrations exercised in tests/probes; no production DB rehearsal. |
| Client state / routing / rendering / contracts | Reviewed | App custom routing/auth/lazy loading, API and task/Today/My Day/Notes/review hooks, query invalidation and scoped storage, CSV escaping, providers and alert preferences. jsdom tests only; no visual/manual browser audit. |
| Tests / static checks / build | Complete | Both full suites, typecheck/build/lint/data guard, shared artifact comparisons, isolated diagnostics. Format failure limited to baseline untracked .claude files. |

## Confirmed findings

- **R6, confirmed:** Today's meeting next-action Owner selector is discarded in the Phase 3 path. `createMeetingNextAction` turns the selected developer into a link; `createFollowUpTask` passes links but no `defaults.ownerAccountId`. Isolated service probe selected `dev-1`, yet stored `owner_type=manager`, `owner_id=review-manager`, with only a person link. Existing canonical meeting test asserts title/parent/check-by but not ownership.
- **R4, confirmed:** Today's create-follow-up caller runs non-create capture intents before requiring `res.task`. Submitting `T-n: unintended update` returns 400 but appends a shared update to T-n. The isolated probe increased its event count from 1 to 2. `/note` uses the same unsafe dispatch path by inspection, but was not exercised.
- **R5, confirmed:** Meeting outcome plus optional next-action creation is not atomic. An unknown `@person` in the next action returns 400 after the meeting outcome has already been saved. The isolated probe read `Saved despite rejection` from the meeting after the error. No undo response is returned.
- **R1, confirmed (one grouped finding):** Two passing diagnostic hook tests show that an unmounted `useReviewProgress` submits A's queued report under B's simulated current cookie when A's first response arrives, and an unmounted `useCreateDailyNoteTask` retries A's private title/context under B after a delayed unknown-person response. These exercise actual hooks with a controlled API transport, not a full two-account browser. Server routes derive destination ownership from the current session, so B's existing report can be overwritten; the note retry can create a task in B if B has a note for the same date. Query/cache guards do not prevent these new requests.
- **R3, confirmed:** `SyncEngine.syncNow` reapplies global `config.JIRA_SYNC_JQL` after the scoped Settings getter intentionally returns undefined for a foreign workspace. With synthetic install query `project = OWNERFIXTURE`, the mocked friend sync issued that exact query rather than the friend's project default. The discovery route similarly used the install URL/email/project with an explicitly supplied friend token and no friend settings, returning 200 from a mocked Jira client. Grouped as one configuration-isolation defect.
- **R7, confirmed:** Two identical Today follow-up service requests returned T-5 and T-6. The dialog's retry path retains its content after an error but sends no stable capture request ID; a lost-response retry creates duplicates.
- **R2, confirmed:** Canonical Team carry-forward with omitted IDs used the developer list's unbounded dates and changed a future task's plan from 2026-10-23 to 2026-10-14 during 2026-10-13 → 2026-10-14 carry. Explicit IDs bypass the legacy source eligibility checks too. The canonical preview deliberately returns zero; execution still accepts and reschedules these tasks.
- **R8, confirmed:** A passing hook diagnostic enabled desktop alerts with permission granted, ran `clearScopedStorageForUser` (the actual logout cleanup), then remounted: permission remained granted but `enabled` and `canOffer` were false. Cleanup deletes preference keys alongside drafts, contrary to docs/66's remembered browser choice.

## Candidates and validation

- **Async transaction ownership:** `runInTransaction` uses connection-global `inTransaction` for nesting. No externally yielding online caller or natural request-level reproduction established yet; do not report a generic race without an actual trigger.
- **Today cache retention:** Expiry deletes a cache entry only when the same key is queried; dates/zones/visit baselines can leave old entries until a workspace write clears them. No representative heap-retention or long-running workload measurement was made, so this is an investigation lead, not a prioritized performance finding.
- **Direct co-manager task access:** Lists and detail use different manager scopes, but docs/72 explicitly allows co-managers to share workspace data. Not treating intended sharing as cross-tenant isolation failure.
- **Self-linked developer task pins:** docs/64 explicitly keeps pins manager-owned. Excluded as an intentional limitation, rather than a bug.
- Previous review findings in `docs/code-review-findings.md` have remediation commits through current HEAD `60f7901`; old findings are not repeated without new evidence.
- **Disproved credential-exfiltration hypothesis:** `team/discover` syntactically has a global token fallback, but `getJiraApiToken` returns an empty string and stops its nullish chain. A friend with no token received 400. No install-token disclosure was demonstrated or will be claimed.

## Verification log

- Initial status: only `?? .claude/`; no tracked modifications.
- Inspected package scripts and Vitest configuration before running commands.
- `npm run typecheck`: passed.
- Full server suite: 127 files, 1,703 tests passed. Full client suite (`--maxWorkers=2`): 166 files, 2,219 tests passed. Shared grammar tests run in both suites, so totals overlap. Server database and backup fixtures were under the unique `/tmp` directory.
- `npm run build:check` and `npm run guard:data`: passed. `npm run lint`: passed with 607 warnings and zero errors; no auto-fix used.
- `npm run format:check`: failed on exactly two pre-existing, untracked `.claude/**/settings.local.json` files, outside review scope. No formatting changes made.
- `/tmp/leados-review-workflows.ts`: passed its three diagnostic reproductions against `/tmp/leados-review-workflows.db` using real migrations/services, synthetic principals and a no-network sync stub. Output recorded in `/tmp/leados-review-workflows.log`.
- `/tmp/leados-review-client/{review-scope,note-scope}.test.tsx`: 2 passing diagnostic reproductions, output in `/tmp/leados-review-scope-both.log`. Assertions intentionally demonstrate the bad requests.
- `/tmp/leados-review-integration.ts`: real auth middleware and Team route with a mocked Jira prototype, plus real SyncEngine/Settings with a mocked Jira factory; no network requests. Output in `/tmp/leados-review-integration-second.log`.
- Expanded `/tmp/leados-review-workflows.ts`: all five diagnostic reproductions completed, adding follow-up replay and canonical future carry; output in `/tmp/leados-review-workflows-second.log`.
- Added desktop preference diagnostic and ran all three client scratch tests: 3 passed, output in `/tmp/leados-review-scope-all.log`.
- Fresh TypeScript compilation of both shared runtime artifacts to `/tmp/leados-review-shared` and `cmp` completed successfully; committed JavaScript matched byte for byte.

## Final artifact

Eight deduplicated confirmed findings (one high, six medium, one low) are detailed in `docs/code-review-report.md`, with exact source locations, reproducible triggers, recommended fixes and regression suggestions. The report records passed checks, baseline format failure, Node-version difference and unreviewed areas. No fixes were implemented.

## Limitations

- No runtime data, production operations, live Jira/Copilot requests, or dependency changes.
- Browser interaction and external-provider behavior will only be claimed where actually exercised.
