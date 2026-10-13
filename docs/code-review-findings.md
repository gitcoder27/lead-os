# Code review findings

Reviewed `db344c7` on 2026-10-13. Eight confirmed findings are ordered by severity. The most consequential issues affect password-reset recovery, outbound address enforcement, duplicate Copilot writes, and note conflict protection. Targeted tenant probes found no cross-workspace row access. Application code and existing `.claude/` changes were preserved; no commits were created.

## 1. In-flight credential checks can undo a password reset

**High — confirmed.** References: [auth.service.ts:238](../server/src/services/auth.service.ts#L238), [433](../server/src/services/auth.service.ts#L433), [437](../server/src/services/auth.service.ts#L437), [487](../server/src/services/auth.service.ts#L487).

- **Trigger / impact:** An old-password login or password-change request starts before an administrator reset and finishes its asynchronous password check afterward. Both use the previously loaded hash without checking that it remains current. The login can create a valid seven-day session after revocation; the password change can replace the administrator's new password with the caller's chosen password.
- **Evidence:** Scratch tests held the old-password scrypt callback until reset completed. The login then issued a usable session. The password-change variant made the recovery password fail and the caller's replacement succeed.
- **Fix:** After hashing, atomically compare the current credential version/hash and active state with the verified snapshot before inserting a session or changing the password. Reject stale checks; keep session revocation in the credential-update transaction.

## 2. Changing a password leaves existing sessions valid

**Medium — confirmed.** References: [auth.service.ts:437](../server/src/services/auth.service.ts#L437), [SignInForm.tsx:84](../client/src/components/auth/SignInForm.tsx#L84).

- **Trigger / impact:** A user changes their password through the sign-in form. The service updates only the hash, so someone holding an existing session retains access until its original expiry, potentially seven days later.
- **Evidence:** Created a session, changed the password, and verified that `getUserForSession` still accepted the original session while the old password was rejected.
- **Fix:** Revoke existing sessions atomically with a successful password change. The current UI already asks the user to sign in afterward.

## 3. Outbound DNS validation does not constrain the actual connection

**Medium — confirmed boundary bypass; exploitation depends on TLS and network reachability.** References: [outbound-guard.ts:37](../server/src/net/outbound-guard.ts#L37), [llm-client.ts:337](../server/src/assistant/llm-client.ts#L337), [jira/client.ts:46](../server/src/jira/client.ts#L46).

- **Trigger / impact:** A configured hostname resolves publicly during validation but privately when `fetch` resolves it again. An authenticated manager controlling the hostname's DNS can bypass the production private-address restriction when the destination also presents a trusted certificate for that hostname. Copilot and Jira use the same pattern.
- **Evidence:** With production policy enabled and no host exception, the guard received a public address; the real Copilot HTTPS request independently resolved to a loopback fixture and returned its response. TLS validation remained enabled with a disposable trusted fixture certificate.
- **Fix:** Bind the connection to vetted addresses through the transport's resolver/connector while retaining the original hostname for TLS verification. Apply this on every connection and retry.

## 4. Overlapping confirmations execute a Copilot proposal twice

**Medium — confirmed.** References: [assistant/service.ts:205](../server/src/assistant/service.ts#L205), [230](../server/src/assistant/service.ts#L230), [239](../server/src/assistant/service.ts#L239), [assistant/tools.ts:1287](../server/src/assistant/tools.ts#L1287).

- **Trigger / impact:** Two confirmation requests overlap while a write tool is awaiting completion. Both read `pending`; resolution is persisted only after execution. Multiple tabs or a retry during a slow Jira call can therefore produce duplicate comments or other writes.
- **Evidence:** Started a confirmation using the actual `add_issue_comment` tool with its Jira service mocked and blocked. A second confirmation entered the same tool, and both executed with identical arguments.
- **Fix:** Atomically claim the proposal before executing it, serialize conversation mutations, and return the existing execution/result on duplicate confirmation. Keep uncertain external outcomes from being blindly replayed.

## 5. Clearing and recreating a note defeats its revision guard

**Medium — confirmed.** References: [daily-notes.service.ts:1020](../server/src/services/daily-notes.service.ts#L1020), [1040](../server/src/services/daily-notes.service.ts#L1040), [1053](../server/src/services/daily-notes.service.ts#L1053), [useDailyNoteEditor.ts:389](../client/src/hooks/useDailyNoteEditor.ts#L389).

- **Trigger / impact:** One tab holds revision 1; another clears the note, deleting its row, then recreates it at revision 1. The stale tab can overwrite the replacement without a conflict. The editor also ignores the replacement because its revision has not increased.
- **Evidence:** Backend reproduction created, deleted, and recreated a note, then successfully overwrote it using the original revision. A frontend hook test supplied the new row ID at the same revision: the editor retained the old body and submitted its stale revision.
- **Fix:** Include a document generation/identity in the write precondition, or preserve a monotonically increasing revision across deletion. Reconcile changed identities and remote deletions in the editor. Update the shared save contract accordingly.

## 6. Public password-change attempts have no bounded IP limiter

**Medium — confirmed.** References: [auth.ts:253](../server/src/routes/auth.ts#L253), [94](../server/src/routes/auth.ts#L94), [118](../server/src/routes/auth.ts#L118).

- **Trigger / impact:** Unauthenticated callers vary the username on `/api/auth/change-password`. Unlike login, this route has no `authIpLimit`; every failed username creates an entry in a process-wide map with no capacity or general expiry cleanup. This permits password spraying and sustained memory growth.
- **Evidence:** Forty distinct failed usernames from one IP all received 401, with no 429. Static tracing confirms that each failure inserts a retained map entry; single-failure entries are never expired by `assertAllowed`.
- **Fix:** Apply a per-IP limiter to this endpoint and bound/expire the per-account throttle independently of whether the same key is used again.

## 7. Jira's timeout ends before the response body is read

**Medium — confirmed.** References: [jira/client.ts:74](../server/src/jira/client.ts#L74), [102](../server/src/jira/client.ts#L102), [sync/engine.ts:71](../server/src/sync/engine.ts#L71).

- **Trigger / impact:** Jira or a configured endpoint sends successful headers and stalls or slowly trickles the body. The client clears its timeout before `response.json()`, leaving body consumption outside the application's 30-second deadline. A stalled sync retains its workspace's running flag and delays subsequent workspaces in the sequential scheduled pass.
- **Evidence:** A mocked successful response blocked `json()`. After advancing beyond 30 seconds, the request signal remained un-aborted and the operation completed only when the body was manually released.
- **Fix:** Keep the deadline active through body consumption and normalize body-read abort errors. Bound retry waits within the same overall deadline.

## 8. Historical task reconstruction repeatedly scans all events

**Low — confirmed performance issue.** References: [task.service.ts:636](../server/src/services/task.service.ts#L636), [641](../server/src/services/task.service.ts#L641), [task-events.service.ts:403](../server/src/services/task-events.service.ts#L403), [manager-desk.service.ts:1557](../server/src/services/manager-desk.service.ts#L1557).

- **Trigger / impact:** Opening a historical Desk date in canonical mode loads all of the manager's task events and filters the entire event array once per task: O(tasks × events). This synchronous work blocks unrelated requests on the shared server as history accumulates.
- **Evidence:** The actual method took approximately 1.3 seconds for 4,000 synthetic tasks and 40,000 events in an isolated database, performing 160 million task/event comparisons. This is a local observation, not a production benchmark.
- **Fix:** Fetch only relevant reconstruction events after the cutoff and group them by task ID once, preserving reverse chronological order.

## Checks and limitations

- Passed `npm run typecheck`, `npm run build:check`, and `npm run guard:data`. Fresh compilation of `shared/types.ts` and `shared/capture-grammar.ts` into `/tmp` matched both committed JavaScript artifacts byte-for-byte.
- Passed 319 backend tests across 18 focused suites covering auth, registration, tenant/config isolation, outbound policy, tasks, capture, notes, Copilot, Jira, and query paging; passed 108 frontend tests across eight suites covering auth/cache cleanup, notes, task mutations/detail, Copilot, capture, and paging. Frontend runs emitted jsdom `window.scrollTo` warnings.
- Ran 12 additional scratch probes under `/tmp/lead-os-code-review`, including controlled password races, mocked Jira writes, note lifecycle tests, a loopback HTTPS/DNS fixture, and a synthetic history profile. No runtime database, real Jira operation, or external provider was accessed.
- This was a targeted review, not an exhaustive audit, full-suite/coverage run, dependency advisory scan, or production load test. DNS bypass was demonstrated against a trusted local TLS fixture; reachability of production internal services was not tested. Co-manager sharing documented in docs/72 was treated as intentional. Cross-account cookie changes during note cleanup were not tested end-to-end.

## Remediation

Original evidence above is preserved. Commit subjects identify the remediation commits in `git log --grep=CR-` (one per finding); validation uses isolated databases and synthetic credentials.

- **1 / CR-01 ([e0ec00d](../../commit/e0ec00d)):** `fix(auth): reject stale credential checks (CR-01)` — synchronous hash/active-state revalidation before final writes; four gated race regressions plus auth timing, reset and route tests.
- **2 / CR-02 ([9625894](../../commit/9625894)):** `fix(auth): revoke sessions on password change (CR-02)` — atomic revocation, expired cookie and fresh sign-in; 32 backend tests and 4 SignInForm tests pass.
- **3 / CR-03 ([7b1353d](../../commit/7b1353d)):** `fix(net): bind provider sockets to vetted DNS (CR-03)` — shared connector address enforcement for Jira/Copilot. 82 existing tests and 3 disposable loopback/TLS socket regressions pass, including wrong-host certificate rejection.
- **4 / CR-04 ([0ee9ab1](../../commit/0ee9ab1)):** `fix(assistant): claim proposals before execution (CR-04)` — durable claims plus serialized conversation mutations; duplicate requests return recorded results, uncertain writes and attempted-write retries cannot replay. 34 service/route tests (including eight races/interruption probes) and 20 frontend tests pass. Conversation queuing follows the existing single-server process model; claims survive process interruption.
- **5 / CR-05 ([99c6cd7](../../commit/99c6cd7)):** `fix(notes): guard saves with document identity (CR-05)` — noteId/revision preconditions, identity-aware drafts and remote replacement/deletion reconciliation. 157 backend and 64 frontend tests pass, including reproduced service and hook failures and HTTP recreation conflicts. Pre-identity drafts are preserved for explicit reconciliation. Shared changes are type-only.
- **6 / CR-06:** `fix(auth): bound password attempt throttles (CR-06)` — password-change IP limiter and bounded account failures with idle expiry. 62 auth/throttle/registration tests pass; spraying stops before the service and never-reused entries expire without new requests.
