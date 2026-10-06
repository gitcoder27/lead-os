# Workspace reliability and usability implementation plan

Created: 2026-10-06. Reviewed baseline: `92daf04`.

This plan covers the seven improvements selected from two parallel repository reviews (WQ-06 and WQ-07 were merged in from the second review). Recent performance findings P01–P13 are already complete; no TODO/FIXME markers were found in application source. The evidence below comes from current code, not just unchecked entries in the older plan.

## Scope and execution

- Application implementation status is recorded in the checklist and Progress log below.
- Implement sequentially on `main` in the development checkout, in the order below. No agents, task branches or worktrees are needed.
- Each item is independently finishable and verifiable. Make one commit per completed item, using `fix(scope): summary (WQ-0N)` or `feat(scope): summary (WQ-0N)`.
- After each item, show the changes, verification results and any limitations, then stop. Wait for the user's confirmation before moving to the next item or proposing another round.
- Use mocked APIs, browser storage and synthetic fixtures. No paid services, production access, runtime databases, Jira calls, outbound messages, data deletion, push or deployment.
- Preserve existing role boundaries, custom routing, lazy overlay loading, API wrappers and guarded task mutations. Reuse existing primitives and dependencies.
- Existing untracked `docs/screenshots/` belongs to the user and remains untouched. Inspect status before each item and keep unrelated changes out of commits.
- Tick the item here and in [docs/56](56-implementation-plan-solo-first.md), and record results in both progress logs in the same implementation commit.

## Checklist and order

| Order | Item | Outcome | Related older plan item |
| --- | --- | --- | --- |
| 1 | WQ-01 | Theme storage failures cannot break rendering; device preference works | P7-06 |
| 2 | WQ-02 | Reliable, accessible palette search with Retry | Part of P7-02 |
| 3 | WQ-03 | Bulk Priority and Check-by buttons in Tasks | Remaining bulk-edit slice of P3-09 |
| 4 | WQ-04 | Consistent Team defaults and shareable sorting | Default-sort slice of P7-08 |
| 5 | WQ-05 | Global and page keyboard help, including phones | P7-03 |
| 6 | WQ-06 | Last good Jira sync time and plain-language sync errors with Retry | Part of P5-03 |
| 7 | WQ-07 | Remove unreferenced components and hooks | Safe slice of P7-11 |

These items have no implementation dependencies on one another. The order follows expected impact. Completing a slice does not mark the wider older item complete: recents/ranking/show-more in P7-02, keymap changes in P3-09, other Team workflows in P7-08, the Today sync chip and Jira 5xx retries in P5-03, and the behaviour-changing legacy cutover in P7-11 remain outside this plan.

## WQ-01 — Resilient theme preference

- [x] Implement and verify WQ-01.

**Problem:** [ThemeContext.tsx](../client/src/context/ThemeContext.tsx) catches storage reads but writes to `localStorage` without a guard in its layout effect. A blocked write can throw during rendering. With no saved choice, the provider always selects Light. [index.html](../client/index.html) hard-codes `class="dark"` on `<html>`, so Light users see a dark first paint until the bundle runs.

**Implementation:**

1. Safely read and validate the existing `theme` key. A saved `light` or `dark` choice wins.
2. With no valid saved choice, resolve `prefers-color-scheme`; fall back to Light if browser preference APIs are unavailable.
3. Follow device preference changes until the user toggles manually. Persist only an explicit user choice so the first automatic selection does not become a permanent override.
4. Guard all storage writes. If persistence fails, retain the explicit choice in memory for the session and keep toggling functional.
5. Clean up media-query listeners and preserve the existing root classes and context API.
6. In `client/index.html`, replace the hard-coded `class="dark"` with a small inline `<head>` script that applies the same resolution (valid saved choice → device preference → Light) before first paint, with every storage access inside `try`. No CSP blocks inline scripts today.

**Files:** `client/src/context/ThemeContext.tsx`; `client/index.html`; `client/src/test/ThemeContext.test.tsx`.

**Acceptance and proof:** Mock Light/Dark device preferences and changes; valid/invalid saved preferences; missing preference APIs; throwing storage reads and writes. Verify root classes, continued rendering, toggling, manual-choice precedence and listener cleanup. Update the existing "defaults to light … stores light" test, which encodes the old write-on-load behaviour. Browser check: a fresh profile with dark `colorScheme` opens dark; a profile whose `window.localStorage` throws loads Today and toggles with no page errors; a saved Light choice on a dark device is light at `domcontentloaded`.

```bash
npm run test --workspace=client -- ThemeContext.test.tsx
```

## WQ-02 — Reliable and accessible command-palette search

- [x] Implement and verify WQ-02.

**Problem:** [useGlobalSearch.ts](../client/src/hooks/useGlobalSearch.ts) enables requests from the current text while its query key/function use the previous debounced text. Requests do not consume an AbortSignal. [CommandPalette.tsx](../client/src/components/palette/CommandPalette.tsx) has no search-error/Retry UI and no combobox/listbox relationship describing the highlighted result.

**Implementation:**

1. Gate requests on a settled, valid query of at least the existing minimum length. Keep auth-scoped query keys and the existing debounce/cache policy.
2. Forward TanStack Query's AbortSignal through `api.get`. A superseded, cleared or unmounted search must not leave an uncancelled active request.
3. Show remote results only for the current settled query. Local commands and quick capture remain available while searching or after a search error.
4. Add a concise announced error and Retry action for the current query. Show loading honestly; do not describe a failed or pending search as having no matches. Disable repeated Retry while fetching.
5. Use stable list/option IDs, combobox attributes, `aria-controls`, `aria-activedescendant`, listbox/option roles and selected state. Keep the active descendant valid as asynchronous results change and retain keyboard focus in the input during arrow navigation.
6. Preserve Enter/click activation, exact task-key ordering, Escape, focus return, quick-add behavior and the palette's lazy-loading boundary.

**Files:** `client/src/hooks/useGlobalSearch.ts`; `client/src/components/palette/CommandPalette.tsx`; existing `client/src/test/CommandPaletteQuickAdd.test.tsx`; new `client/src/test/useGlobalSearch.test.tsx` and `client/src/test/CommandPaletteSearch.test.tsx`. Existing API support accepts request options; no API-wrapper change is expected.

**Acceptance and proof:** Use fake timers and deferred mocked requests for rapid typing, shrinking below two characters, clearing, unmounting and out-of-order completion. Verify request text, cancellation and absence of stale results. Simulate failure then Retry success. Assert input/list/option relationships and arrow/Enter behavior before and after result changes; update existing button-role assertions where result semantics change.

```bash
npm run test --workspace=client -- useGlobalSearch.test.tsx CommandPaletteSearch.test.tsx CommandPaletteQuickAdd.test.tsx
```

## WQ-03 — Visible bulk Priority and Check-by actions

- [x] Implement and verify WQ-03.

**Problem:** [TasksPage.tsx](../client/src/components/tasks/TasksPage.tsx) already supports multi-target Priority and Check-by menus through `p` and `c`. [TaskBulkBar.tsx](../client/src/components/tasks/TaskBulkBar.tsx) exposes neither action, so mouse/touch users cannot find the equivalent selection-wide operations there.

**Implementation:**

1. Add Priority (`p`) and Check-by (`c`) controls to the existing toolbar, with accessible names and responsive wrapping.
2. Extend its menu-kind type and route both controls through existing selection targeting, `PriorityMenu`/`CheckByMenu`, `setPriority`/`setCheckBy` and guarded bulk mutations.
3. Retain skipping unchanged values, atomicity, existing bulk limits, error reporting, selection handling and Undo. Preserve the existing local 09:00 check-by behavior and clear-date option.
4. Reuse existing icons, menu primitives and theme tokens; no endpoint or task-model change is needed.

**Files:** `client/src/components/tasks/TaskBulkBar.tsx`; `client/src/components/tasks/TasksPage.tsx`; `client/src/test/TasksPage.test.tsx`; extend `client/src/test/useTaskListMutations.test.tsx` only where existing Undo coverage does not prove these fields.

**Acceptance and proof:** Select tasks across groups, click each control and inspect the exact selected-target payload. Verify unselected tasks remain unchanged, identical values are skipped, dates can be set/cleared, mutation failure is announced, and successful Undo restores previous priorities/dates. Check keyboard parity and toolbar wrapping at 390px with a synthetic browser fixture.

```bash
npm run test --workspace=client -- TasksPage.test.tsx useTaskListMutations.test.tsx
```

## WQ-04 — Consistent Team defaults and URL sorting

- [ ] Implement and verify WQ-04.

**Problem:** [useBoardQueryState.ts](../client/src/hooks/useBoardQueryState.ts) defaults/resets to Attention and [view-params.ts](../client/src/lib/view-params.ts) omits Attention from URLs. The [server query resolver](../server/src/services/team-tracker-board-query.ts) and Team toolbar use Name as the default. Omission can therefore change a chosen order after a reload or shared link, including when a saved view supplies a different inherited sort.

**Implementation:**

1. Use the server's existing Name default for initial and cleared client query state, while preserving explicitly requested sorts.
2. For an unsaved query, omit only the actual Name default; serialize Attention and every other explicit nondefault sort.
3. When a saved view is selected, retain explicit sort/group/filter overrides even when an override equals the unsaved default. Absence means inherit that saved view, not force the unsaved default.
4. Keep saved views untouched. Preserve Back/Forward behavior, URL debounce, filters and drawer/panel parameters.

**Files:** `client/src/hooks/useBoardQueryState.ts`; `client/src/lib/view-params.ts`; `client/src/test/view-params.test.ts`; new `client/src/test/useBoardQueryState.test.tsx`. Extend `client/src/test/App.test.tsx` and `client/src/test/TeamTracker.test.tsx` for the reload/saved-view integration cases.

**Acceptance and proof:** Verify bare Team URLs and Clear view resolve to Name. Attention must remain explicit in the URL and survive reload. Cover a saved Attention view overridden to Name and a saved Name view overridden to Attention; both must retain their overrides. Verify query updates and Back/Forward preserve other Team parameters.

```bash
npm run test --workspace=client -- view-params.test.ts useBoardQueryState.test.tsx App.test.tsx TeamTracker.test.tsx
```

## WQ-05 — Global and page keyboard help

- [ ] Implement and verify WQ-05.

**Problem:** [App.tsx](../client/src/App.tsx) handles global manager shortcuts but has no global `?` help. Page sheets advertise their own shortcuts separately; Today's keyboard button is hidden below `md`. The [Kbd primitives](../client/src/components/ui/Kbd.tsx) render supplied glyphs without platform mapping.

**Implementation:**

1. Add one header Keyboard shortcuts button, reachable at phone widths, and a global `?` path for authenticated managers.
2. Display the existing global actions (capture, palette and available Copilot toggle) plus the active page's implemented shortcuts. Do not advertise unavailable capabilities or invent shortcuts on pages that have none.
3. Share small shortcut descriptors between the help and existing page sheets. Keep descriptors independent of page components so help does not eagerly import lazy pages, drawers or editors.
4. Coordinate shortcut ownership so page `?` handlers and the global listener open exactly one sheet. Reuse existing page entry points where practical; avoid introducing a general command framework.
5. Ignore editable targets, composition and active dialogs/menus/standup overlays. Keep ordinary question-mark typing intact. Opening help transfers focus; Escape closes it and restores the opener. Global actions must not fire through an open help layer.
6. Use Mac Command/Option labels and Windows/Linux Ctrl/Alt labels, with a safe fallback when platform APIs are absent. At narrow widths the header remains usable without horizontal overflow.

**Files:** `client/src/App.tsx`; `client/src/components/layout/Header.tsx`; `client/src/context/QuickActionsContext.ts` if a shared opening callback is needed; `client/src/components/ui/ShortcutSheet.tsx`; `client/src/components/ui/Kbd.tsx`; new `client/src/lib/keyboard-shortcuts.ts`; existing shortcut definitions in `client/src/components/tasks/TaskListStates.tsx`, `client/src/components/tasks/TasksPage.tsx`, `client/src/lib/today-triage.ts`, `client/src/components/today/TodayRhythmHeader.tsx` and `client/src/components/team-tracker/TeamTrackerPage.tsx`. Register Notes' implemented shortcuts without changing editor key behavior.

**Tests:** Extend `App.test.tsx`, `Header.test.tsx`, `TasksPage.test.tsx`, `TodayPage.test.tsx`, `TeamTracker.test.tsx` and `NotesPage.test.tsx` as applicable; add `keyboard-shortcuts.test.ts` for shared descriptors/platform mapping.

**Acceptance and proof:** Open help by button and `?` on Today, Tasks, Team, Notes, Work and Settings; assert global and applicable page content, one layer only, Escape and focus return. Verify typing in inputs/editors and keys during overlays do not open help. Mock both platforms and unavailable Copilot. Check 390px header layout with synthetic browser data in Light/Dark themes.

```bash
npm run test --workspace=client -- keyboard-shortcuts.test.ts App.test.tsx Header.test.tsx TasksPage.test.tsx TodayPage.test.tsx TeamTracker.test.tsx NotesPage.test.tsx
```

## WQ-06 — Last good Jira sync and readable sync errors

- [ ] Implement and verify WQ-06.

**Problem:** `GET /api/sync/status` returns `lastSyncedAt` from the newest `sync_log` row whatever its status ([routes/sync.ts](../server/src/routes/sync.ts), `getLastSyncLog` in [engine.ts](../server/src/sync/engine.ts)). Failed runs also write `completedAt`, so after a failure nothing reports when data was last good. [WorkSyncControls.tsx](../client/src/components/work/WorkSyncControls.tsx) shows only "Sync issue". [ErrorBanner.tsx](../client/src/components/alerts/ErrorBanner.tsx) prints `Sync error: ${errorMessage}`; for non-401/403/404 failures [jira/client.ts](../server/src/jira/client.ts) builds `Jira API error (<status>): <raw body>`, so raw Jira JSON reaches the page. The banner has no Retry and no route to Settings.

**Implementation:**

1. Server: add `getLastSuccessfulSyncLog(workspaceId)` to the sync engine (newest `status = 'success'` row for the workspace). `/api/sync/status` adds `lastSuccessAt`. Keep `lastSyncedAt` unchanged; `useSyncRefreshCoordinator` keys refreshes on it. No schema change.
2. `shared/types.ts`: `SyncStatus.lastSuccessAt?: string` (type only; no `types.js` regeneration).
3. New `client/src/lib/sync-error.ts` with `describeSyncError(message)`: 401 → "Jira rejected the saved credentials."; 403 → "Jira denied access to the configured project or query."; 404 → "Jira could not find the configured site or query."; timeout/network → "Jira did not respond."; rate limit → the banner's existing copy; otherwise "Jira returned an error (<status>)." or "Jira sync failed." Never include the raw body.
4. Work chip in the error state: `Sync issue · last good <relative>` or `Sync issue · never synced`; tooltip uses `describeSyncError`.
5. Banner sync-error state: `describeSyncError(...)`, "Data last updated <relative>" when `lastSuccessAt` exists, a **Retry** button (`useTriggerSync`, disabled while syncing) and an **Open Settings** link to `/settings?section=connection` using the in-app navigation pattern in `TeamRosterEmpty.tsx`. Server-down and rate-limit variants are unchanged.
6. The sync-failure toast in `SettingsPanel.tsx` uses `describeSyncError`. Settings → Jira Connection keeps showing the full error text as the one diagnostic place.

**Files:** `server/src/sync/engine.ts`; `server/src/routes/sync.ts`; `shared/types.ts`; new `client/src/lib/sync-error.ts`; `client/src/components/work/WorkSyncControls.tsx`; `client/src/components/alerts/ErrorBanner.tsx`; `client/src/components/settings/SettingsPanel.tsx`.

**Acceptance and proof:** Route test for a success → failure sequence: `lastSuccessAt` equals the success run's `completedAt` while `lastSyncedAt`/`status` report the failure; failures-only and other-workspace cases have no borrowed `lastSuccessAt`. Engine test for newest-success and workspace scoping. Unit tests for each error category, including a `Jira API error (500): {"errorMessages":[...]}` input whose output has no `{`. Banner tests: plain text, last-updated line, Retry triggers sync, Settings link target, no raw body; the existing four banner tests still pass. Chip tests with and without `lastSuccessAt`. `grep -rn 'Sync error: ${' client/src` returns nothing. Browser check on an isolated DB with one seeded `success` row and Jira pointed at `http://127.0.0.1:9`: banner, Retry, Open Settings and the chip at desktop/390px in Light/Dark with no page errors. Jira stays mocked or unreachable.

```bash
npm run test --workspace=server -- tests/sync.routes.test.ts tests/sync.engine.test.ts
npm run test --workspace=client -- sync-error.test.ts ErrorBanner.test.tsx WorkSyncControls.test.tsx
```

## WQ-07 — Remove unreferenced components and hooks

- [ ] Implement and verify WQ-07.

**Problem:** No production code imports `client/src/components/team-tracker/QuickAddTaskModal.tsx` (472 lines), `client/src/components/manager-desk/DeskSection.tsx` (95) or `client/src/components/manager-desk/ItemDetailPrimitives.tsx` (277), nor `useCarryForwardPreview` / `useCarryForwardContext` in [useTeamTracker.ts](../client/src/hooks/useTeamTracker.ts). The only other reference is two mocks in `client/src/test/TeamTracker.test.tsx`.

**Implementation:**

1. Re-run the unreferenced check first; stop and report if anything now imports these.
2. Delete the three files and two hooks, plus imports/types that become unused, and remove the two mocks.
3. Do not touch the `ManagerDeskPage` fallback, `canonicalEnabled` branches or `tasks:drop-legacy`; those change behaviour or delete data and need a separate decision.

**Files:** the three files above; `client/src/hooks/useTeamTracker.ts`; `client/src/test/TeamTracker.test.tsx`.

**Acceptance and proof:** No new tests; typecheck, the production build and the full client suite are the proof. `grep -rnE "QuickAddTaskModal|DeskSection\b|ItemDetailPrimitives|useCarryForwardPreview|useCarryForwardContext" client/src shared` returns nothing. Record the deleted line count.

```bash
npm run test --workspace=client
```

## Completion gates and handoff

For each implementation item, run its focused tests and:

```bash
npm run typecheck
npm run build:check
npm run lint
npm run guard:data
git diff --check
```

Record commands and actual pass/fail results, not planned outcomes. Report pre-existing failures separately; do not edit unrelated local configuration to make a gate green. Browser checks use isolated fixtures and report the viewport/theme and observed result. Automated accessibility assertions prove DOM semantics; they do not claim a real screen-reader session was tested.

After the last item, run the full client suite once for interactions across all changes, and the full server suite after WQ-06. WQ-06 is the only item with backend changes; elsewhere add backend tests only if an actual backend behavior change becomes necessary. If a runtime shared export changes, regenerate its committed CommonJS artifact per AGENTS.md.

The handoff for each item includes the commit, changed files, user-visible behavior, focused tests, quality-gate results and any remaining limitation. Stop after reporting that item, as requested.

## Progress log

| Date | Item | Status | Verification / notes |
| --- | --- | --- | --- |
| 2026-10-06 | WQ-00 | Planning complete | Recorded all five scopes, code evidence, acceptance criteria, test commands and item-by-item stopping rule. Relative document links, five-item tracker coverage and diff whitespace checks pass. No application changes or implementation tests run. |
| 2026-10-06 | WQ-00 | Plan amended | Merged the second review's unique items: WQ-06 (last good sync, readable errors, Retry) and WQ-07 (unreferenced code), plus the WQ-01 first-paint fix. Overlapping theme, palette and Team-sort items keep this plan's scope, including the Name default. Documentation only. |
| 2026-10-06 | WQ-01 | Complete | Saved Light/Dark wins; otherwise follow device preference until a manual toggle. Automatic selection is not persisted; blocked storage retains the manual choice in memory. The head script resolves the same theme before first paint. `npm run test --workspace=client -- ThemeContext.test.tsx`: PASS, 27 tests (provider and actual head script). `npm run typecheck`, `npm run build:check`, `npm run lint`, `npm run guard:data`, `git diff --check`: PASS; lint has 0 errors and 298 warnings in unchanged files, and Vite reports existing native-config compatibility warnings. `node /tmp/lead-os-wq01-jdst0rn2/check.cjs`: PASS, six Chromium scenarios at 1440×900 and 390×900: fresh dark, throwing localStorage, saved Light on a dark device; correct DOMContentLoaded classes, Today loaded, device following/manual precedence and repeated toggles verified, 0 page errors/external requests. First browser attempt timed out on an incorrect exact Today heading selector; corrected and rerun successfully. New scratch DB `/tmp/lead-os-wq01-jdst0rn2/fixture.db`, mocked sync engine, no scheduler or real Jira; browser artifacts remain under that scratch directory. No runtime data, screenshots directory, push or deployment touched; later items remain unstarted. |
| 2026-10-07 | WQ-02 | Complete | Search waits 150 ms for valid text, consumes TanStack's AbortSignal, cancels superseded/cleared/disabled/unmounted requests, and hides unsettled or stale results while retaining the auth-scoped 30-second cache. The palette announces loading/errors, offers Retry (disabled during retry), and retains local commands/quick add. Stable combobox/listbox/option IDs and selection survive result reorder/removal; arrows keep input focus, exact task keys still lead, Enter/click/Escape and opener focus return are covered. `npm run test --workspace=client -- useGlobalSearch.test.tsx CommandPaletteSearch.test.tsx CommandPaletteQuickAdd.test.tsx`: PASS, 21 tests across 3 files, using fake timers, deferred mocked API responses and isolated in-memory query clients. `npm run typecheck`, `npm run build:check`, `npm run lint`, `npm run guard:data`, `git diff --check`: PASS on final changes. Lint: 0 errors, 298 warnings in unchanged files; existing Vite native-config compatibility warnings remain. WQ-02 requires no browser check; accessibility proof is automated DOM assertions, not a real screen-reader session. No runtime database, Jira, user screenshots, push or deployment; WQ-03 onward not started. |
| 2026-10-07 | WQ-03 | Complete | Added accessible Priority (`p`) and Check-by (`c`) controls to the wrapping bulk toolbar, using existing icons, menus and selected-key routing. TasksPage already routes both menu kinds, so it needed no edit; guarded writes, skipping unchanged values, local 09:00 dates, clearing and Undo reuse the existing path. `npm run test --workspace=client -- TasksPage.test.tsx useTaskListMutations.test.tsx`: PASS, 129 tests; added cross-group selected-target/button-keyboard parity, skip/custom/set/clear date, field-specific guarded Undo and rollback/error tests. First focused run: 127 passed, 2 failed on a new incorrect Tomorrow-vs-Sun label assertion; corrected the tests, preserving existing copy, and reran successfully. `npm run typecheck`, `npm run build:check`, `npm run lint`, `npm run guard:data`, `git diff --check`: PASS; lint has 0 errors and 298 warnings in unchanged files, with existing Vite native-config warnings. `node /tmp/lead-os-wq03-wo50y7ts/check.cjs`: PASS, four Chromium scenarios at 390×900/1440×900 in Light/Dark; toolbar wraps into 2 rows on phones and 1 on desktop, every control fits, exact bulk guards/payloads and skipped/unselected values verified, set/clear/Undo and keyboard parity work, a synthetic 409 is announced, 0 page errors/external requests. Initial browser run clicked an older consumed Undo toast and timed out; corrected the harness selector to target the current action and reran successfully. New scratch DB `/tmp/lead-os-wq03-wo50y7ts/fixture.db`, synthetic tasks and mocked sync, no scheduler or real Jira; evidence remains in that scratch directory. No runtime data, user screenshots, push or deployment; WQ-04 onward not started. |
