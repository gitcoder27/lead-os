# Phase 3 Implementation Review — Findings & Fixes

Read-only review of the Task & Team Management Phase 3 implementation (`9e3bc56`..`17bb96d`) against `TASK_TEAM_MANAGEMENT_PHASE3_IMPLEMENTATION.md`. Validation at review time: `typecheck`, `build:check`, server tests (794) and client tests (706) all pass — the issues below are not covered by the current suites.

---

## Blockers

### B1. `tasks:drop-legacy --apply` fails on real data — parent table dropped before child

- **Where:** `server/src/services/task-legacy-drop.service.ts:10-14, 216-218`; FK at `server/src/db/migrate.ts:606`; rename at `server/src/services/task-contract.service.ts:215-217`; `PRAGMA foreign_keys = ON` at `server/src/db/connection.ts:12`.
- **Spec:** §8.2.
- **Issue:** `LEGACY_DROP_TABLES` drops `legacy_manager_desk_items` before `legacy_manager_desk_links`, but links holds `FOREIGN KEY (item_id) REFERENCES legacy_manager_desk_items(id)` (rewritten by the contract's `ALTER TABLE ... RENAME`). With FK enforcement, `DROP TABLE` performs an implicit DELETE; any row in `legacy_manager_desk_links` → `FOREIGN KEY constraint failed` → transaction rollback. The `dependents()` gate excludes in-set tables (`:91-92`), so it doesn't catch this. Fails safe (backup precedes, nothing dropped) but `--apply` can never succeed on a workspace that used Desk links — the normal case. Test gap: `server/tests/task-legacy-drop.test.ts:30-35` archives empty tables only, so the FK path is never exercised.
- **Fix:** drop children before parents — reorder the drop loop so `legacy_manager_desk_links` precedes `legacy_manager_desk_items` (keep the displayed plan order if desired). Add a test that seeds rows into the legacy links/items tables and asserts `apply()` succeeds.

---

## Bugs

### G1. Former-owner read access is live with `tasks_phase3_enabled` off — flag-off parity broken

- **Where:** `server/src/services/task-events.service.ts:162-179` (`developerAccess`), `:133-145` (`visibility`); `server/src/services/my-day.service.ts:37-52`; `server/src/routes/my-day.ts:126` vs `:131-136`.
- **Spec:** §0 ("with the flag off, routes, nav and components behave exactly as in Phase 2"), §7.2 / P3-D15.
- **Issue:** `developerAccess`/`visibility` gate on `canonicalEnabled` (stage ≥2c), never on `phase3Enabled`. `GET /api/my-day/tasks/:key` and `GET /api/my-day/tasks/:key/events` are ungated, while the sibling `/detail` route is phase3-gated (`my-day.ts:126`) — the asymmetry shows the gate was intended. Flag-off, a reassigned-out developer gets `200 {taskKey, title, status, access:"former-owner"}` + their own shared events where Phase 2 returned `404` (writes return `403` instead of `404`). Disclosure is limited to the spec's own minimal projection, but it is an observable Phase-2 behavior change on a privacy boundary.
- **Fix:** gate the `"former"` tier on `phase3Enabled` inside `developerAccess()` (one change covers `resolveTask`, `getTaskEvents`, `visibility`, `requireTask`, and `detail`), or gate the two my-day routes the way `/detail` is gated. Add a flag-off route test asserting 404 for former owners.

### G2. `/later` captures get `scheduled_on = today` — the explicit `null` is defeated

- **Where:** `server/src/services/capture.service.ts:147` passes `resolved.later ? null : ...`; `server/src/services/task.service.ts:250` does `scheduledOn: data.scheduledOn ?? todayIsoDate()`.
- **Spec:** §4.2 row f ("Later tasks have no date"), P3-D14.
- **Issue:** `null ?? today` evaluates to `today`, so parked tasks are stored with a real date — they leak into `scheduled:`-range filters and land in the "Today" bucket of grouped views (`client/src/lib/task-views.ts`). There is also no server-side `later`/`scheduledOn` invariant; only the grammar rejects the combination, and `create()` is reachable from non-capture callers.
- **Fix:** make `create()` respect an explicit `null` for `scheduledOn` (e.g., distinguish `undefined` "not provided" from `null` "deliberately unset", or add a `later` fast-path that skips the default). Enforce "later tasks have no date" in `TaskService.create`/`validateShape` so non-capture paths can't violate it. Add a service test: capture `/later` → `scheduled_on IS NULL`.

### G3. `today-plan` built-in view does not exclude `later` tasks

- **Where:** `server/src/services/task-views.service.ts:75`.
- **Spec:** §5.1 ("Desk rhythm grouping survives as the 'Today plan' view").
- **Issue:** Filters are `owner:"me", status:[open,active,blocked]` with no `later:false`, so parked tasks appear in the daily plan — Desk rhythm kept Later as a quiet strip out of the plan, and the drawer's own copy says "Later (parked, off today's list)" (`TaskDrawer.tsx:573`). Compounds G2.
- **Fix:** add `later: false` to the `today-plan` definition (and audit the other built-ins for the same omission — `my-tasks`, `blocked`, `stale` should decide deliberately whether parked tasks belong).

### G4. `followUp` / `linkedJira` / `jiraDrift` filters are one-way — `false` silently unfiltered

- **Where:** `server/src/services/task-views.service.ts:125, 183, 192`; schema `z.boolean()` at `:25, 30, 32`; contrast bidirectional `later` at `:127`.
- **Spec:** §5.2.
- **Issue:** The schema accepts `false`, but the filter code only applies the predicate when truthy. A saved view meaning "not a follow-up" / "not linked to Jira" / "no drift" silently returns everything.
- **Fix:** make all three bidirectional (`!== undefined` checks with a negated predicate), matching `later`'s pattern.

### G5. `closed: {}` admits an unbounded all-history closed scan

- **Where:** `server/src/services/task-views.service.ts:14` (`dateRange` makes both bounds optional) + `:131-132` + `inRange` at `:100-105`.
- **Spec:** §5.2 ("closed ranges are required for closed tasks").
- **Issue:** `filters: { closed: {} }` validates, and `inRange(value, {})` returns true for every non-null `closedAt` — an unbounded closed scan, exactly what the requirement exists to prevent.
- **Fix:** require at least one of `from`/`to` inside `dateRange` (e.g., `.refine((r) => r.from || r.to)`), or apply that refinement specifically to `closed`.

### G6. `followUpAt` stored as UTC midnight; readers use server-local `isoDatePart`

- **Where:** `server/src/services/capture.service.ts:148` vs `server/src/utils/date.ts:24-41` (`isoDatePart` formats in server-local time) and readers `task.service.ts:732, 752`.
- **Spec:** §4.1 / D29 (dates resolve in workspace timezone semantics).
- **Issue:** `` `${date}T00:00:00.000Z` `` parses one day early on servers behind UTC; every other writer stores local-time instants (e.g., `today.service.ts:1336` uses `` new Date(`${date}T09:00:00`) ``). Separately, a dateless `/f` defaults `?? today`, making a "mark as follow-up" task due today — the grammar makes the date optional, so this default is presumptuous.
- **Fix:** store `followUpAt` as a local-time instant consistent with the rest of the codebase (or normalize all `followUpAt` readers to UTC), and decide whether dateless `/f` should leave `follow_up_at` NULL (relying on `category:follow_up`, which the grammar already injects at `capture-grammar.ts:459`).

### G7. Deleted-task tombstone renders an enabled `StatusSelect`

- **Where:** `client/src/components/tasks/TaskDrawer.tsx:420` — `canEditTitle || mode === 'manager'` bypasses the `!deleted` gate at `:255`.
- **Spec:** §3.2 ("Deleted tasks render a read-only tombstone").
- **Issue:** Managers get a live status control on a tombstone that PATCHes into a guaranteed 410; every other control honors `readOnly={deleted}`.
- **Fix:** gate the select on `!deleted` (e.g., `(canEditTitle || mode === 'manager') && !deleted`).

### G8. Developer task drawer fires manager-only endpoints on every open

- **Where:** `client/src/components/tasks/TaskDrawer.tsx:477, 605, 762` (`useDevelopers()` unconditional, incl. before the `mode === 'developer'` early return at `:480`) and `:889` (`useTaskLabels()`, `enabled: phase3` — developers legitimately have the flag).
- **Spec:** §3.1, P3-D15 (developers don't touch manager surfaces).
- **Issue:** Every developer drawer open issues 3× `GET /api/team/developers` + 1× `GET /api/task-labels`, all `requireManager` (`app.ts:136, 174`) → four guaranteed 403s per open.
- **Fix:** thread `mode`/`enabled` into those hooks (`useDevelopers(undefined, { enabled: mode !== 'developer' })`-style; add an `enabled` option where missing) so the manager-only queries never fire for developers.

---

## Spec deviations

### D1. Every saved-view run is an all-history in-memory scan

- **Where:** `server/src/services/task-views.service.ts:166-181` (`candidateRows` selects all non-deleted manager-scoped tasks, filters in JS).
- **Spec:** §5.2 ("The query is batched and indexed, with no all-history scans").
- **Fix:** push bounded predicates (scheduled/closed ranges, status, owner, later) into SQL; keep in-memory filtering only for what SQL can't express (labels JSON, staleness/drift lookups — already batched).

### D2. Literal `GET /api/tasks/:key` 403s for developers

- **Where:** `server/src/app.ts:173` (`requireManager` mount); developer equivalents live under `server/src/routes/my-day.ts:131-136`.
- **Spec:** §7.2 names `GET /api/tasks/:key` and `/events` for owner/former-owner reads.
- **Fix:** either alias the developer-safe handlers onto `/api/tasks/:key` for developer principals (keeping `requireManager` for managers), or update the spec to bless `/api/my-day/tasks/:key` as the developer path — functionally equivalent today.

### D3. Server warning diagnostics are dropped on successful submit

- **Where:** `client/src/components/capture/CaptureBox.tsx:181-198` — `res.diagnostics` renders only when `blocked`/`confirmRequired`.
- **Spec:** §4.2 row c ("not synced — kept as text" is a warning the user should see).
- **Issue:** Lookup-dependent warnings (`jira-not-synced`, `bad-task-ref`) can't appear in the preview (client passes `{ people }` only) and are discarded on success — the user is never told a token was demoted to text.
- **Fix:** surface non-blocking warnings post-submit (toast or inline note listing `res.diagnostics` warnings on success).

### D4. Standup layers do not form a focus-trap stack

- **Where:** `client/src/components/team-tracker/StandupMode.tsx:852-912` (`LayerShell`: Escape + `aria-modal`, no Tab handling); `StatusRationaleDialog.tsx:44-50`; `TaskDrawer.tsx:85`.
- **Spec:** §6.2 ("stacked layers form a focus-trap stack where only the top layer traps").
- **Fix:** add Tab/Shift+Tab containment to the topmost layer (shared `LayerShell` is the natural place) so focus cycles within the dialog while a layer is open.

### D5. TaskDrawer does not restore focus to the originating row on close

- **Where:** `client/src/components/tasks/TaskDrawer.tsx:85` + `StandupMode.tsx:335-340` (standup-internal layers restore focus via `focusRow`; the drawer does not).
- **Spec:** §6.2 ("focus returns to the originating row when a drawer or dialog closes").
- **Fix:** capture `document.activeElement` on open and restore it on close (or return focus to the focused standup row via the existing `focusRow` path when opened from standup).

### D6. Status suggestion fires on any blocked owned task, not the current task

- **Where:** `server/src/services/team-tracker.service.ts:2863-2865` — `find(status === "blocked")` across the whole surface.
- **Spec:** §6.3 / P3-D11 ("when the developer's current task is `blocked`").
- **Issue:** The code comment acknowledges a blocked canonical task can never be "current" in tracker DTOs (it maps to `planned`), so the spec wording is literally unsatisfiable — the trigger is deliberately broader than spec.
- **Fix:** either narrow to a defensible "the task the developer is/was working on" (e.g., most recently current or highest-positioned blocked task), or amend the spec wording to match the implemented semantics and note the divergence.

### D7. CaptureBox has no label typeahead

- **Where:** `client/src/components/capture/CaptureBox.tsx` (no `useTaskLabels`; labels appear only as post-hoc chips at `:97-99`).
- **Spec:** §3.3 ("The drawer and capture use a label chip picker with typeahead").
- **Fix:** extend the existing `@person` typeahead pattern to `+label` tokens, suggesting names from `task_labels` via `useTaskLabels`.

### D8. Label filter dropdown shows raw `category:`/`kind:`/`priority:` prefixes

- **Where:** `client/src/components/tasks/TasksPage.tsx:344-345` (`{label.name}`).
- **Spec:** §3.3 (system labels "display without their prefixes").
- **Fix:** render `taskLabelDisplayName(label.name)` in the option label (keep `value={label.name}`).

### D9. `taskViewDefinitionSchema` lives in the server service, not `shared/types.ts`

- **Where:** `server/src/services/task-views.service.ts:20`.
- **Spec:** §5.2 ("the definition schema (Zod, in shared/types.ts)").
- **Fix:** move the Zod schema to `shared/types.ts` alongside the `TaskViewDefinition` interfaces (and regenerate `shared/types.js` since it's a runtime export).

### D10. P3-D4 "developer_notes gets a tab" implemented as a drawer section

- **Where:** `client/src/components/team-tracker/DeveloperTrackerDrawer.tsx:459-516` (a `DrawerSection` editing `managerNotes`; the drawer has no tab structure).
- **Spec:** §1 P3-D4.
- **Fix:** intent is met (notes surfaced/editable in the drawer) — either introduce a real tab affordance or amend the spec wording to "a section".

### D11. Copilot `capture` tool is advertised with the flag off

- **Where:** `server/src/assistant/tools.ts:1925` — `canonicalTaskTools()` registers whenever `canonical` (stage ≥2b); only `execute` gates on phase3 (`server/src/assistant/task-tools.ts:66` → 409).
- **Spec:** §0 parity (the toolset differs flag-off, though it fails safe).
- **Fix:** include the `capture` tool in `canonicalTaskTools()` only when `phase3Enabled` for the workspace (requires passing the flag into tool registration).

---

## Nits

| Where | Issue |
|---|---|
| `server/src/services/capture.service.ts:127` | Create intent ignores `requestId` — update/note are replay-deduped, create isn't; a transport retry duplicates the task. |
| `server/src/services/capture.service.ts:153-162` | Post-create link writes run in separate transactions — a mid-flight failure leaves the task created without links and a retry duplicates it. |
| `server/src/services/capture.service.ts:82-84` | `#KEY` "synced" = any `issues` row; `excluded`/`out_of_scope` issues still get linked. |
| `server/src/services/task.service.ts:259` + `task-events.service.ts:16` | `created.meta.source` has no `"capture"`; capture-created tasks record `"desk"` (update events do record `via:"capture"`). |
| `server/src/routes/capture.ts:7` vs `task.service.ts:28` | `text` cap 4000 vs `title` cap 500 → long captures fail a generic 400 instead of a structured `blocked` diagnostic. |
| `shared/capture-grammar.ts:455` | A second non-followup `!date` is tokenized, removed from the title, and ignored with no diagnostic. |
| `client/src/components/capture/CaptureBox.tsx` | `/note ` prefill shows an `empty-note` error before the user types (cosmetic). |
| `client/src/hooks/useDevelopers.ts:14-17,34-35` | Client filters placeholder devs (`dev-1`/`lead-1`/"dev"/"lead") the server resolver would match → possible preview/server `unknown-person` divergence. |
| `client/tsconfig.json:19-22`, `server/tsconfig.json:8` | No `shared/capture-grammar` path mapping; `shared/capture-grammar.test.ts` is outside both `include` lists (vitest transpiles it untyped). |
| `client/src/components/capture/GlobalCaptureDialog.tsx:295-327` | `NoteCaptureForm` itself is unreachable flag-on — `/note` intent works, so §4.3 is met functionally, not literally. |
| `client/src/components/team-tracker/StandupMode.tsx:90-105` | `?` is missing from `KEY_HELP` though it's a real binding. |
| `client/src/components/tasks/TaskDrawer.tsx:280-299` | Composer nested inside the Timeline block instead of its own section (order preserved, grouping differs from §3.1). |
| `client/src/components/tasks/TaskDrawer.tsx:527` | `Tracked by` renders raw accountId for another manager — no display-name resolution. |
| `client/src/components/tasks/TasksPage.tsx:126` | Unknown `?view=<id>` silently falls back to `allViews[0]` while the URL keeps the bogus id. |
| `client/src/components/tasks/TasksPage.tsx:60-61,369` | `GROUP_OPTIONS` defines `'' → 'No grouping'` but the select filters it out — dead option, no ungroup override. |
| `client/src/components/tasks/TasksPage.tsx:194` | Saved-view rename uses native `window.prompt`, off-convention. |
| `client/src/components/manager-desk/ManagerDeskPage.tsx:407` | Dead `tasksPhase3 &&` TaskDrawer branch — the page only mounts flag-off. |
| `server/src/services/task.service.ts:270,133` | `later` absent from the private-field gate and exposed unconditionally on the DTO (inconsistent with `nextAction`/`followUpAt`/`labels`). |
| `server/src/services/task-views.service.ts:34` | `sort` optional while the spec's definition shape requires it (permissive superset). |
| `shared/types.ts:1548` | `NavPageId` keeps `"desk"` alongside `"tasks"` — deliberate (enables rewrite-on-read/rollback); noted for the record. |
| `server/src/services/task-labels.service.ts:150-162,185-195` | Per-task rename/remove `update` events are appended *after* the rewrite transaction commits — a crash mid-loop loses `meta.labelRenamed`/`labelRemoved` events (dedupe keys make PATCH retries safe). |
| `package.json` (root) | No `tasks:drop-legacy` convenience alias (`tasks:cutover`/`tasks:phase3` have one; the `--workspace=server` script works). |
| `server/src/services/task-legacy-drop.service.ts:178` | `rebuildDailyNoteFollowUps` hardcodes the column list — a future added column would be silently dropped by the rebuild. |
| `server/src/scripts/task-drop-legacy.ts:22` | `--workspace` with no value swallows the next flag (`--workspace --apply` → garbage workspace id, gates fail confusingly). |

---

## Fix plan to declare Phase 3 complete

Ordered roughly by impact; each item references the finding ID above.

1. **B1** — Reorder the drop loop (children before parents); add a seeded-links `apply()` test.
2. **G1** — Gate the `"former"` tier on `phase3Enabled` in `developerAccess()`; add flag-off 404 tests for `GET /api/my-day/tasks/:key` and `/events`.
3. **G2 + G3 + G6** — Fix `later`/`scheduledOn` semantics end-to-end: `create()` honors explicit `null`, server enforces "later ⇒ no date", `today-plan` excludes `later`, `followUpAt` uses local-time convention (and decide the dateless-`/f` default).
4. **G4 + G5** — Make view filters bidirectional and require at least one bound on `closed`; add tests for `{followUp:false}`, `{linkedJira:false}`, `{closed:{}}`.
5. **G7 + G8** — Gate `StatusSelect` on `!deleted`; thread `mode` into the drawer's manager-only hooks.
6. **D1** — Push bounded view predicates into SQL (or document the deviation; correctness is fine, this is the perf clause).
7. **D2** — Resolve the `/api/tasks/:key` vs `/api/my-day/tasks/:key` path question (code or spec edit).
8. **D3** — Surface non-blocking warnings after successful capture.
9. **D4 + D5** — Focus-trap the top layer and restore focus on drawer close (§6.2 a11y).
10. **D6** — Align suggestion trigger semantics with the spec (or spec wording).
11. **D7 + D8** — Label typeahead in CaptureBox; prefix-free label names in the filter dropdown.
12. **D9 + D11** — Move `taskViewDefinitionSchema` to `shared/types.ts` (+ regen `types.js`); register the copilot `capture` tool only under `phase3Enabled`.
13. **D10** — Keep the notes section or add a real tab; reconcile spec wording.
14. **Nits** — Address opportunistically; the ones most worth taking early: `requestId` on create, non-atomic link writes, `created.meta.source:"capture"`, label events inside the transaction, `?` in `KEY_HELP`, `tasks:drop-legacy` root alias.

---

## Resolution — post-fix pass

All blockers, bugs, and deviations addressed. Validation after the fix pass: `npm run typecheck`, `npm run build:check`, `npm run test` (server: 62 files / 809 tests; client: 69 files / 715 tests), and `npm run test --workspace=client` all pass. The only test-run noise is pre-existing jsdom `window.scrollTo` warnings from Motion keyframe measurement — no failures.

### Blockers

| Finding | Status | Resolution |
|---|---|---|
| B1 | Fixed | `LEGACY_DROP_TABLES` orders `legacy_manager_desk_links` before `legacy_manager_desk_items` (`task-legacy-drop.service.ts:10-14`), so children drop first under `PRAGMA foreign_keys = ON`. New test seeds link/item rows and asserts `apply()` succeeds (`server/tests/task-legacy-drop.test.ts`). |

### Bugs

| Finding | Status | Resolution |
|---|---|---|
| G1 | Fixed | The `"former"` tier and the own-authored-events clause in `developerAccess()`/`visibility` now require `phase3Enabled` (`task-events.service.ts`). Flag-off, former-owner reads return 404 and writes 403 — Phase 2 parity restored. Flag-off 404 route tests added for the task, `/detail`, and `/events` endpoints (`my-day.routes.test.ts`). |
| G2 | Fixed | `TaskService.create()` honors an explicit `scheduledOn: null` (distinguishes `undefined` "not provided" from `null` "deliberately unset") and enforces the "later ⇒ no date" invariant in `validateShape`, so non-capture callers can't violate it. Capture `/later` → `scheduled_on IS NULL` covered by service/route tests. |
| G3 | Fixed | `today-plan` now carries `later: false`, pushed into SQL alongside the other built-in predicates, so parked tasks stay out of the daily plan. Other built-ins audited — `my-tasks`/`blocked`/`stale` keep parked tasks deliberately (they're still actionable views, not the daily plan). |
| G4 | Fixed | `followUp`, `linkedJira`, and `jiraDrift` are bidirectional (`!== undefined` + negated predicate), matching `later`. `{followUp:false}` and `{linkedJira:false}` route tests added. |
| G5 | Fixed | `closed` requires at least one of `from`/`to` — the schema refinement rejects `{closed:{}}` (route test added). `COALESCE` guards the follow-up SQL predicate so NULL `labels_json` rows aren't dropped by three-valued logic. |
| G6 | Fixed | `followUpAt` stores a local-time instant (`new Date(`${date}T09:00:00`)`-style) consistent with every other writer. A dateless `/f` leaves `follow_up_at` NULL — the `category:follow_up` label carries the flag; the stale "fall back to schedule date" test expectation was corrected. |
| G7 | Fixed | `StatusSelect` is gated on `!deleted` in addition to the mode check (`TaskDrawer.tsx`); tombstone assertion added to `TaskDrawer.test.tsx`. |
| G8 | Fixed | `useDevelopers`/`useTaskLabels` accept an `enabled` option; the drawer's three `useDevelopers` calls and `useTaskLabels` are gated on `mode !== 'developer'` (`TaskDrawer.tsx:477,605,762,889`), so no manager-only queries fire for developer drawers. |

### Spec deviations

| Finding | Status | Resolution |
|---|---|---|
| D1 | Fixed | Bounded predicates (owner, status, `later`, follow-up, linked-Jira, scheduled/closed ranges) are pushed into SQL in `task-views.service.ts`; only labels-JSON and staleness/drift lookups remain in-memory (batched). |
| D2 | Resolved — spec amended | `/api/tasks/:key` stays manager-only; spec §7.2 now explicitly blesses `GET /api/my-day/tasks/:key` and `/events` as the developer path. Chosen over aliasing developer handlers onto the manager mount — keeps `requireManager` boundaries simple. |
| D3 | Fixed | Non-blocking warning diagnostics survive a successful capture: success toast first, then a warning toast listing `res.diagnostics` warnings (`CaptureBox.tsx`). |
| D4 | Fixed | New `useModalFocus` hook traps Tab/Shift+Tab in the topmost layer; `LayerShell` (standup), `StatusRationaleDialog`, and `TaskDrawer` use it. Lower layers suspend their keymaps while a layer is stacked above (standup `suspended` flag). |
| D5 | Fixed | `useModalFocus` captures `document.activeElement` on open and restores focus on close for drawers and dialogs. jsdom test stubs `offsetParent` to exercise the trap. |
| D6 | Resolved — spec amended | The suggestion fires on the developer's highest-positioned open blocked task — the only satisfiable reading, since blocked canonical tasks map to `planned` tracker DTOs and can't be "current". Spec §6.3/P3-D11 wording updated to match; existing server/client coverage retained. |
| D7 | Fixed | `+label` typeahead added to CaptureBox using the existing `@person` suggestion pattern: prefix matching, Enter/Tab accepts, arrows navigate, Escape dismisses; inserted text stays canonical (`+escalation`). |
| D8 | Fixed | The label filter dropdown renders `taskLabelDisplayName(label.name)` (`category:follow_up` → "follow up") while `value` stays canonical. |
| D9 | Fixed | `taskViewDefinitionSchema` moved to `shared/types.ts` beside the `TaskViewDefinition` interfaces; `shared/types.js` regenerated (committed CJS artifact). |
| D10 | Resolved — spec amended | §1 P3-D4 wording updated from "tab" to an editable drawer section — matches the implemented `DrawerSection` in `DeveloperTrackerDrawer`. |
| D11 | Fixed | `canonicalTaskTools({ phase3 })` registers `capture` only when `tasks_phase3_enabled`; `createAssistantTools` threads the flag; `execute` still defensively re-checks `phase3Enabled()` (409). Registration tests added. |

### Nits

| Where | Status |
|---|---|
| `capture.service.ts` — `requestId` ignored on create | Fixed — create replays the original task on a repeated request id (dedupe via the created event). |
| `capture.service.ts` — non-atomic link writes | Fixed — task creation + all link writes run in one `runInTransaction`; a mid-flight failure rolls the whole capture back. Rollback test added. |
| `capture.service.ts` — `#KEY` synced check | Fixed — `excluded`/`out_of_scope` issue rows no longer count as synced. |
| `created.meta.source` | Fixed — `"capture"` added to the created-source enum; capture-created tasks record `source: "capture"`. |
| `text` cap 4000 vs `title` cap 500 | Fixed — titles over 500 chars now emit a structured `title-too-long` blocked diagnostic instead of a generic 400. |
| Second non-followup `!date` ignored | Fixed — subsequent dates emit an `extra-date` warning ("Only the first !date applies"). Grammar + both tests in `shared/capture-grammar.test.ts`. |
| `/note ` prefill `empty-note` flash | Fixed — the empty-body cosmetic diagnostic is suppressed while the body is still blank. |
| `useDevelopers` placeholder-filter divergence | Noted, not fixed — the filter keeps dummy devs out of the `@` typeahead; divergence only shows if a user literally types `@dev-1`. Edge case accepted. |
| `shared/capture-grammar` path mapping / untyped test | Noted, not fixed — vitest transpiles the shared suite untyped in both workspaces; adding path mappings is repo-config churn for no runtime gain. |
| `NoteCaptureForm` unreachable flag-on | Noted, not fixed — `/note` intent works, meeting §4.3 functionally; the dead form is harmless. |
| `?` missing from `KEY_HELP` | Already present — `?` was listed in `KEY_HELP`; no change needed. |
| Composer nested inside Timeline block | Noted, not fixed — render order is correct; grouping differs cosmetically from §3.1. |
| `Tracked by` raw accountId | Noted, not fixed — resolving another manager's display name needs a users lookup the client doesn't have; cosmetic. |
| Unknown `?view=` fallback | Noted, not fixed — falls back to the first view; URL retains the stale id (harmless). |
| `GROUP_OPTIONS` dead `''` option | Fixed — the unreachable `'' → 'No grouping'` option was removed. |
| Saved-view `window.prompt` | Noted, not fixed — works, though off-convention. |
| `ManagerDeskPage` dead TaskDrawer branch | Fixed — removed the unreachable `tasksPhase3` branch (the page mounts flag-off only) plus its `TaskDrawer`/`navigateToTaskPage`/`useTasksPhase3` imports. Orphaned `LinkedIssueSnapshot.tsx` + its test were also removed during cleanup. |
| `later` private-field gate | Fixed — `later` is now masked/writ-gated like `nextAction`/`followUpAt`/`labels` (`task.service.ts:133,270`). |
| `sort` optional in view schema | Noted, not fixed — permissive superset of the spec shape; tightening would reject existing views. |
| `NavPageId` keeps `"desk"` | As designed — supports rewrite-on-read/rollback. |
| Label rename/remove events outside txn | Fixed — per-task audit events are appended inside the rewrite transaction (`task-labels.service.ts`). |
| Root `tasks:drop-legacy` alias | Already present — root `package.json` alias exists; verified. |
| `rebuildDailyNoteFollowUps` column list | Noted, not fixed — hardcoded list; a future added column would be dropped by the rebuild. Requires schema-awareness plumbing not worth the risk now. |
| `--workspace` swallows next flag | Fixed — flag-like values (`--apply`) are rejected (`task-drop-legacy.ts:24`). |

Phase 3 is complete pending a clean working tree: `data/dashboard.sandbox.db.pre-phase2-backup` and `data/manual-snapshots/` are runtime artifacts that stay untracked per repo policy.

Once items 1–13 land, the remaining divergence from the spec is the documented deferrals (full 1:1 workspace, event-body FTS5, timeline analytics, developer Later) and intentional permissive supersets — at which point Phase 3 can be called complete.
