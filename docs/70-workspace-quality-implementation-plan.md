# Workspace reliability and usability implementation plan

Created: 2026-10-06. Reviewed baseline: `92daf04`.

This plan covers the five improvements selected from the repository review. Recent performance findings P01–P13 are already complete; no TODO/FIXME markers were found in application source. The evidence below comes from current code, not just unchecked entries in the older plan.

## Scope and execution

- This document is the planning step only. Application implementation has not started.
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

These items have no implementation dependencies on one another. The order follows expected impact. Completing a slice does not mark the wider older item complete: recents/ranking/show-more in P7-02, keymap changes in P3-09, and other Team workflows in P7-08 remain outside this plan.

## WQ-01 — Resilient theme preference

- [ ] Implement and verify WQ-01.

**Problem:** [ThemeContext.tsx](../client/src/context/ThemeContext.tsx) catches storage reads but writes to `localStorage` without a guard in its layout effect. A blocked write can throw during rendering. With no saved choice, the provider always selects Light.

**Implementation:**

1. Safely read and validate the existing `theme` key. A saved `light` or `dark` choice wins.
2. With no valid saved choice, resolve `prefers-color-scheme`; fall back to Light if browser preference APIs are unavailable.
3. Follow device preference changes until the user toggles manually. Persist only an explicit user choice so the first automatic selection does not become a permanent override.
4. Guard all storage writes. If persistence fails, retain the explicit choice in memory for the session and keep toggling functional.
5. Clean up media-query listeners and preserve the existing root classes and context API.

**Files:** `client/src/context/ThemeContext.tsx`; `client/src/test/ThemeContext.test.tsx`.

**Acceptance and proof:** Mock Light/Dark device preferences and changes; valid/invalid saved preferences; missing preference APIs; throwing storage reads and writes. Verify root classes, continued rendering, toggling, manual-choice precedence and listener cleanup.

```bash
npm run test --workspace=client -- ThemeContext.test.tsx
```

## WQ-02 — Reliable and accessible command-palette search

- [ ] Implement and verify WQ-02.

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

- [ ] Implement and verify WQ-03.

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

After WQ-05, run the full client suite once for interactions across all five changes. The scoped work is frontend-only; add backend tests only if an actual backend behavior change becomes necessary. If a runtime shared export changes, regenerate its committed CommonJS artifact per AGENTS.md.

The handoff for each item includes the commit, changed files, user-visible behavior, focused tests, quality-gate results and any remaining limitation. Stop after reporting that item, as requested.

## Progress log

| Date | Item | Status | Verification / notes |
| --- | --- | --- | --- |
| 2026-10-06 | WQ-00 | Planning complete | Recorded all five scopes, code evidence, acceptance criteria, test commands and item-by-item stopping rule. Relative document links, five-item tracker coverage and diff whitespace checks pass. No application changes or implementation tests run. |
