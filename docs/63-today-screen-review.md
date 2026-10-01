# Today Screen: Critical Review

2026-09-30. **Visual** = screenshots; **code** = current file/symbol; **unverified** = runtime evidence needed. Recommendations are judgments.

## 1. Verdict

Today does **not** meet the bar: it has enough capabilities, but fragments attention and overstates completion. It is a defensible home for a manager of 5-15 reports, including manager-maintained teams, excessive for three reports, and poorly proportioned for a solo practitioner with no roster. The most important change is to keep one trustworthy daily work list visible through wrap-up instead of declaring the queue clear while unfinished work occupies, or disappears behind, the side panel.

## 2. What Today Does Now

**Code:** [TodayPage.tsx](../client/src/components/today/TodayPage.tsx#L73):`TodayPage`, [today-layout.ts](../client/src/lib/today-layout.ts#L1):`todayPanelOrder`, `splitPanelRows`, `withoutWrapUpItems` control placement. Server sources below are [today.service.ts](../server/src/services/today.service.ts#L1):`buildToday` and its named builders; plan data comes from [today-plan.service.ts](../server/src/services/today-plan.service.ts#L1):`TodayPlanService.build`.

| Panel | Data source / decision | When shown | Judgment |
|---|---|---|---|
| Header | `buildSummary`, rhythm, generated timestamp / urgency and freshness | Always | Merge counts into meaningful list headings; retain date/refresh |
| Getting started | `buildGettingStarted`: workspace tasks, roster, Jira, saved rhythm / setup | Any incomplete step, until locally dismissed | Hide once real work exists |
| Queue | Ranked people, Jira, promises, meetings, pins, sync/drift / next intervention | Always; 12-row preview | Keep as principal work surface |
| My plan | Own planned/overdue/active tasks, pins, Inbox count / personal execution | Morning through midday | Keep across phases; avoid duplicated pins |
| Promises & meetings | `railItems` subtracts queue identities / remaining commitments | Nonempty; promises excluded at wrap-up | Merge into existing list |
| Due soon | Future follow-ups within two hours / act before reminder | Midday only | Merge; not another section |
| People / Quiet | Attention snapshot minus queue people / investigate or ask | Nonempty; Quiet at midday | Merge exceptions; Team owns roster |
| Since strip | Jira arrivals/overdue/resolved, developer check-ins, newly due follow-ups / catch up | Nonzero delta with baseline | Keep only actionable changes |
| Standup status | Today's sealed sessions / start, rerun, revisit flags | Morning/window; completed-only midday | Keep compact and secondary |
| 1:1s | `dueSignals` / open overdue or today's meeting | Nonempty, all phases | Move genuine overdue decisions ahead of routine carry |
| Carry | Earlier scheduled open items / finish or reschedule | Morning/midday panel; inside wrap-up later | Merge with unfinished plan |
| Wrap-up | Carry, promises, missing developer check-ins, completions, tomorrow pins / close day | From wrap-up boundary | Replace plan presentation without losing its work |
| Weekly review | `weeklyReviews.todayStatus` / weekly review or catch-up | Review afternoon; Monday/Tuesday catch-up | Keep one secondary row, not first priority |

**Code:** morning/standup share order; midday adds Due soon/Quiet; wrap-up removes My plan/Standup. Weekly review can lead the panel. Queue ownership changes at wrap-up.

**Code:** `rankActionItems` sorts priority, severity, direct-write availability, then title. Pins score 120-118, ahead of blocked people (100), regardless of phase.

**Code integration:** [App.tsx](../client/src/App.tsx#L632):`handleOpenTodayTarget` opens task keys in a shared drawer; `taskView` selects Waiting/Meetings, people open Team, Standup uses `mode=standup`, EOD opens dated Notes. Weekly review uses `/?mode=review`; Capture/Copilot remain global. Tasks are shared; projection predicates disagree.

**Code:** [today-clock.ts](../server/src/services/today-clock.ts#L1):`getRhythmState` uses browser-supplied IANA timezone with defaults **10:00 / 12:00 / 16:00**, even without setup ([types.ts](../shared/types.ts#L353):`DEFAULT_TODAY_RHYTHM_BOUNDARIES`). Phases run every calendar day, midnight onward; no weekend/off-hours suppression. Attention aging separately respects weekday working windows ([tracker-freshness.ts](../server/src/services/tracker-freshness.ts#L1):`buildSignals`). [DayRhythmSection.tsx](../client/src/components/settings/DayRhythmSection.tsx#L1):`DayRhythmSection` edits phase times; [AttentionRulesSection.tsx](../client/src/components/settings/AttentionRulesSection.tsx#L1):`AttentionRulesSection` owns working hours and timezone. These are two clocks, not one understandable schedule.

## 3. First 10 Seconds

The manager needs **interventions, personal commitments and data freshness**, with Capture immediately available.

**Visual:** screenshot 1 gives most space to an empty queue while carry and overdue 1:1s compete in the narrow column. Screenshot 2 spends substantial left-column height on three completed setup steps before live attention. Neither makes the next consequential decision obvious.

**Code, not a screenshot measurement:** at 1440x900, [today.css](../client/src/components/today/today.css#L1):`.today-body` allocates approximately 432px to the panel and the remainder to the queue, beneath global chrome and a 40px strip. Six plan rows or the setup card consume much of their respective first viewport; exact visible row counts depend on content/font metrics. Both desktop columns scroll independently. Below 1024px, queue then panel share one scroll, putting personal planning after the entire queue.

Smallest Today: date/freshness, personal commitments and exceptions in one list, existing Standup/Notes/review links. Quiet days should be shorter.

## 4. Findings

### Bugs And Trust Risks

Ranked; **code** unless noted.

1. **P1: wrap-up can conceal today's unfinished work.** `buildDeskCarryForwardActions` and [task.service.ts](../server/src/services/task.service.ts#L907):`projectTodayRows` select earlier dates, not ordinary tasks scheduled today. My plan disappears; [TodayWrapUp.tsx](../client/src/components/today/TodayWrapUp.tsx#L1):`TomorrowTopThree` exposes only three unpicked candidates. With four ordinary unpinned tasks today, the fourth can disappear entirely from Today. `allClosed` ignores the plan, queue and 1:1s, permitting “Loops closed” despite unfinished work. Reuse the complete unfinished plan; make completion claims local and explicit.

2. **P1: unsuccessful actions can look successful.** [useTodayActions.ts](../client/src/hooks/useTodayActions.ts#L1):`onMutate` removes rows; `onError` refetches without rollback. Failed write plus failed refetch leaves work missing. Invalidation omits `tasks`, `task-detail`, `task-events` and `task-view-counts`: recently visited Tasks can remain wrong after Done. Restore failed changes and invalidate canonical consumers. Unpatched wrap-up arrays/buttons linger until refetch.

3. **P1: keyboard focus can dispatch to another row.** [useTodayKeyboardTriage.ts](../client/src/hooks/useTodayKeyboardTriage.ts#L1):`onKeyDown` uses an internal cursor. [today-triage.ts](../client/src/lib/today-triage.ts#L1):`shouldIgnoreTriageEvent` excludes inputs/dialogs/menus, not buttons. Select with `j`, Tab to Carry, then Space: the queue primary can run instead. Scope triage and preserve native activation.

4. **P2: counts and reassurance describe different universes.** `buildSummary` counts all ranked attention rows as “open”; “due” means Jira defects due today, excluding overdue 1:1s and carry. The “open” button focuses the reduced queue, not all counted work. `buildDelta` omits ordinary task changes/blocker events, so “No changes” is not a workspace-wide claim. Furthermore, [task-views.service.ts](../server/src/services/task-views.service.ts#L178):`waitingMatch` excludes ordinary self-owned follow-ups that Today counts and links to Waiting. Align destinations/predicates; remove broad reassurance and ambiguous counters.

5. **P2: equal titles are not duplicate commitments.** [today-layout.ts](../client/src/lib/today-layout.ts#L1):`groupQueueItems` groups follow-ups by normalized title and offers Done all. Two distinct “Send update” tasks for different people can close together. Group by stable identity/context, or remove this bulk completion.

6. **P2: incomplete coverage can look complete.** `buildToday` silently drops failed plan/state/review reads outside `sourceStatus`; an absent plan need not trigger the partial banner. Only 20+80 action rows ship; `buildTodayQueueView` can advertise unreachable remainder. Expose missing essential sources through the existing notice and provide an honest existing-workspace handoff for truncation.

7. **P2: timezone repair is incomplete.** `TodayPlanService.build` passes timezone to display bucketing, but `TaskViewsService.run` filters deadlines using server-local `taskPlanDate`; an open, inactive deadline-only task can be admitted on the wrong day. `TodayService.createFollowUpTask` omits `clientToday/tz` when invoking Capture, so typed date tokens use server time despite the command timezone. Propagate the existing contract. [routes/today.ts](../server/src/routes/today.ts#L1):`dateQuerySchema`, `top3Schema` validate date shape, not calendar validity.

**Code performance:** Desk N+1 is fixed by [manager-desk.service.ts](../server/src/services/manager-desk.service.ts#L433):`getTodayItems` batching; [team-tracker.service.ts](../server/src/services/team-tracker.service.ts#L1124):`getAttentionSnapshot` is leaner. Builds await all sources, scan unbounded open candidates and evaluate plan views separately. The scoped 25s promise cache usually expires before 30s polling. [useToday.ts](../client/src/hooks/useToday.ts#L1):`useToday` revalidates a 15-minute session snapshot. Latency is **unverified**; measure before optimizing.

### Simplification Opportunities

Ranked by clutter removed:

1. **Visual/code:** remove the completed setup checklist above attention; keep initial capture guidance only when genuinely empty. Cost: optional configuration moves to existing Settings.
2. **Visual/code:** merge carry and unfinished plan; demote or remove Carry all. Three-week-old work needs reconsideration, not effortless renewal. Cost: occasional Tasks drawer visit for Drop, which already exists there.
3. **Code:** remove redundant promise/people presentations and the queue progress bar. Its denominator combines grouped remaining signals with all manager completions, not a stable queue cohort (`TodayActionQueue`). Cost: lose a misleading progress percentage, not capability.
4. **Visual/code:** replace stale taxonomy with “Update overdue” plus actual risk. Prefer existing Ask over Add check-in for participants. Cost: fewer labels; manager notes remain secondary.

### Genuinely Missing

None earns a new panel/control/setting. Repair existing promises; Tasks already schedules work. Remove the candidate limitation within the existing list, not another picker.

### Taste

**Visual:** retain the list-first typography and palette. Uppercase subheads and ubiquitous cyan outlines overemphasize routine actions. No rebrand, decorative empty-state art or extra animation.

## 5. Leads Check

| Lead | Result |
|---|---|
| Earlier reviews | **Partly true, code:** [docs/53](53-today-screen-review.md) snooze, dialog recovery, person targets, phases, keyboard, mobile actions and batching are fixed. “Assign owner” still navigates; sync opens broad Settings. Overflow/recovery remain incomplete. |
| docs/54 theming | **Partly true, code:** solid Save text and overlay shadows now use shared tokens; tinted row/solid dialog buttons are intentional. Other contrast failures remain below. [docs/54](54-consistency-audit.md) is not a current defect list. |
| docs/55 and 58 | **Partly true, code:** solo clocks, plan/pins and weekly review exist; [canonical-start.ts](../server/src/db/canonical-start.ts#L1):`startCanonicalTasksIfEmpty` repairs fresh workspaces. [docs/55](55-solo-vs-collaborative-review.md)/[docs/58](58-manager-one-stop-review.md) absence claims are obsolete; [docs/56](56-implementation-plan-solo-first.md) records delivery. Durable event delivery remains unfinished, outside Today. |
| Empty queue / 18 open / 15 carry | **Confirmed, visual/code:** different definitions, deliberate panel ownership. Fifteen carry plus three 1:1s could explain 18; actual records are unverified. Empty dominant space is structural, not evidence of no work. |
| Getting started 3/4 | **Confirmed, visual/code:** `TodayPage` shows all steps while any is incomplete, regardless of queue urgency. Optional Jira can keep it incomplete indefinitely. |
| Unset rhythm | **Confirmed, code:** defaults run before saving; `hasCustomRhythm` checks a stored config row. Saving unchanged defaults is disabled in Day Rhythm, so accepting defaults does not complete the checklist. |
| Stale / participation / Will set | **Partly true, code:** risk plus stale differs from elapsed-time stale, but the primary often remains Add check-in. Solo uses Add note; collab non-participants can still have No current, deliberately. “Will set” previews the first candidate, not an automatic scheduled write. Screenshot mode is **unverified**. |
| Raw mention tokens | **Partly true, visual/code:** systemic literal-title problem; the original colon-parser defect is fixed. See provenance below. |
| Long titles | **Confirmed, visual/code:** top-three/compact titles ellipsize without tooltip/expansion; rows open detail. Queue `action()` truncates at 120 characters server-side. Note-like usage does not excuse unreadable context. |
| Carry age / Drop | **Confirmed, code:** no age ceiling, age-based reconsideration or inline Drop in `TodayWrapUp`; Done/Carry only. Do not auto-drop old work. |
| Tomorrow 0/3 and 3/3 | **Confirmed, code:** three candidates initially; selecting exposes later candidates; at three all candidates hide, leaving unpin. Picks do not reschedule. No arbitrary task search here. |
| Mixed dates | **Confirmed, visual/code:** `rowContext` formats friendly dates; `buildOneOnOneActions` embeds ISO dates. Normalize display only. |
| Since / Updated | **Partly true, code:** [today-state.service.ts](../server/src/services/today-state.service.ts#L1):`recordVisit` rolls baseline after a 45-minute gap. `formatSince` uses local dates. “Updated in 2 seconds” suggests server/client clock skew, not a countdown; actual skew is **unverified**. |
| Independent scrolling / left bar | **Confirmed** two scrollers in CSS; keyboard ergonomics fail below. **Unverified** outlined-bar cause: checked `WorkspaceShell`, Header and global positioning; no matching global edge control identified. Do not call it a defect. |

**Code provenance:** [capture-grammar.ts](../shared/capture-grammar.ts#L294):`PERSON_REF`, `parseCapture` consume valid colon IDs; malformed tokens survive with warnings. [CaptureBox.tsx](../client/src/components/capture/CaptureBox.tsx#L249):`submit` sends structured owners. [useCapture.ts](../client/src/hooks/useCapture.ts#L1):`createTaskViaCapture` and [useDailyNotes.ts](../client/src/hooks/useDailyNotes.ts#L1):`createFromNote` route current Notes creation through grammar; unknown people retry as plain text without `@`. Literal paths remain: `TaskService.create/update`, Team `addItem`, [daily-notes.service.ts](../server/src/services/daily-notes.service.ts#L1389):`createFollowUpInternal`/`createTask`, and [assistant/tools.ts](../server/src/assistant/tools.ts#L1087):`create_desk_item`, `update_desk_item`, tracker writes. [sync/engine.ts](../server/src/sync/engine.ts#L245):`toIssueRow` preserves Jira summary text, but does not inject an assignee token. Today and [TaskListRow.tsx](../client/src/components/tasks/TaskListRow.tsx#L210):`TaskListRow` render stored titles literally. Preserve literal APIs; repair known malformed captures with explicit review, not silent reassignment. Screenshot provenance remains unknown.

## 6. Solo Vs Collab Vs Empty Matrix

**Code:** `buildSignals`, `buildFocus`, `buildGettingStarted`, `isNotePerson`.

| Situation | Current / should show |
|---|---|
| Solo manager, 5-15 reports | Touch-based exceptions and notes / keep; no participation demands |
| Collab, participants | Developer staleness, asks, Quiet/missing updates / keep only actionable exceptions |
| Collab, none | Touch clock; No current still tracked; zero stale metric possible / omit empty participation framing |
| Brand-new | Four setup steps and empty plan; wrap-up can say loops closed / capture first, no earned-completion claim |
| Empty roster | No Standup or people / personal plan only |
| One report | Full Standup promotion remains / secondary Team access is sufficient |
| Jira disconnected | Sync-error rows suppressed; leftover defects may retain metrics / show existing data honestly |
| Nothing due | Calm queue can coexist with plan/carry/1:1s / say no urgent exceptions, not all work finished |

## 7. Keyboard And Accessibility Inventory

| Inventory | Assessment |
|---|---|
| Queue keys | **Pass dispatch, code:** j/k or arrows; Enter opens; e/Space primary; s tomorrow snooze; f follow-up; c note/check-in; z latest undo; ? help. Arrows are omitted from help. |
| Mouse-free completion | **Fail, code:** cursor neither focuses nor scrolls rows; expanded members/panel excluded. Buttons remain Tabbable, but Enter/Space conflict described above prevents reliable operation. |
| Global shortcuts | **Pass modifier separation, code:** [App.tsx](../client/src/App.tsx#L1056):`handler` uses Ctrl/Cmd K/J/I for search/Copilot/Capture. Full layered interaction **unverified**. |
| Menus/dialogs | **Pass code:** [TodayActionMenu.tsx](../client/src/components/today/TodayActionMenu.tsx#L1):`TodayActionMenu` uses shared menu; [Dialog.tsx](../client/src/components/ui/Dialog.tsx#L1):`Dialog` traps/restores focus. Check-in Enter saves, Shift+Enter newline; dialogs support Ctrl/Cmd+Enter, Escape. |
| After writes | **Partial, code:** next-row/heading fallback exists. Undo is six seconds for supported inverses; no undo for check-in/Set current, legacy carry confirms. Ask remains until developer response; manager note does not reset developer staleness. |
| Roles/announcements | **Partial, code:** main/aside, headings, status notices, error alerts; no live announcement of cursor movement. Header and Today both render h1. |
| Motion/touch | **Partial, code:** reduced-motion CSS; 24-30px controls, below comfortable 44px touch targets, not universally below WCAG's 24px minimum. |
| Narrow layout | **Unverified:** single scroll and visible primary actions are coded; nowrap titles/chips/actions compete. Phone clipping and assistive-technology behavior not established. |

**Code calculation:** parsed [index.css](../client/src/index.css#L8):`:root`, `.dark`, `.ui-btn`, `.ui-chip`; WCAG sRGB/alpha compositing on secondary surfaces, not screenshot pixels. Text requires 4.5:1; focus 3:1.

| Pair | Light / dark | Result |
|---|---|---|
| Solid Save text/fill | 5.36 / 8.19 | Pass |
| Muted text/secondary | 5.69 / 7.43 | Pass |
| Accent text/secondary | 3.32 / 7.77 | Light fails |
| Warning text/12% warning chip | 1.78 / 7.30 | Light fails |
| Danger text/12% danger chip | 2.92 / 4.51 | Light fails |
| Composited focus ring/secondary | 1.51 / 2.08 | Both fail |

**Code:** red also marks risk/stale and sync failures, not exclusively deadlines. Reserve highest emphasis for consequential exceptions; elapsed time alone is not an emergency.

## 8. Do-Not-Build List

No new panels, AI briefing, productivity score, Today notification center, compulsory pins, per-phase settings, roster, expanded setup, autonomous carry/drop or unmeasured prewarming.

## 9. Roadmap

Priority directions, not an implementation plan. All repair or replace existing behavior.

| Order | Impact / size | Dependencies; blast radius | Browser-free test |
|---|---|---|---|
| 1 Restore mutation truth | Trust / M | Canonical keys; Today, Tasks, Team, Notes | Failed write+refetch; cached Tasks after Done/undo; wrap-up double-click |
| 2 Preserve daily work | Closure / M | Plan identity; Today, Tasks | Four unpinned tasks across 15:59/16:00; overdue 1:1; tomorrow pins |
| 3 Repair keyboard/contrast | Accessible speed / M | Shared focus/tokens; all consumers | jsdom Tab/Space target, offscreen cursor, dialogs; token calculations |
| 4 Align clock/membership | Cross-screen trust / M | Existing date/zone contract; Capture, Tasks, Today | Midnight, DST, invalid dates; self follow-up versus Waiting |
| 5 Remove unsafe grouping | Avoid accidental closure / S | Stable identity; Today/Tasks | Same title, different people/deadlines; no Done all |
| 6 Make coverage honest | Reliability / M | Source status/limits; Today | Plan failure; 101 signals; no false clear or dead expansion |
| 7 Subtract competing UI | Ten-second clarity / M | 2, 6; Today | Work suppresses onboarding; one item once; zero metrics hidden |
| 8 Resolve title provenance | Readability / M | Explicit repair policy; Capture, Notes, Tasks, Team, Copilot, Work | Colon IDs, punctuation, literal imports, existing bad title; no inferred ownership |

## 10. Scorecard

| Dimension | Grade | Reason |
|---|---|---|
| Purpose fit | C+ | Correct home-screen job, too many competing rituals |
| First-10-seconds clarity | D | Setup and narrow-panel work defeat priority |
| Trust of data | D | Hidden work, inconsistent sets, incomplete recovery |
| Speed/keyboard | C- | Direct actions exist; focus ownership fails |
| Solo/collab correctness | B- | Sound server clock split; client wording depends on capped pulse membership |
| Mobile | Unverified | Responsive code is not usability evidence |
| Accessibility | D | Text/focus contrast and keyboard defects |

## 11. Assumptions And Limits Of This Review

Assume one manager, 5-15 reports, optional Jira, mixed participation and occasional pins. Datasets differ; modes are unknown. No cross-screenshot count comparisons. Screenshot 2 and supplied prose disagree on since-time; conclusions use its computation.

Only desktop dark wrap-up is visually verified. Morning, midday, standup, light theme, hover/focus, dialogs, mobile and unseen content remain **unverified**. No browser/app, runtime data, Jira, production or git history accessed. Contrast calculations ran; application tests did not.

**Code:** [app.ts](../server/src/app.ts#L150):`createApp` enforces manager-only Today and clears server cache after task/capture/config/team writes; this refutes that cache lead. [TodayPage.test.tsx](../client/src/test/TodayPage.test.tsx#L1039), [TodayPlan.test.tsx](../client/src/test/TodayPlan.test.tsx#L188), [today-layout.test.ts](../client/src/test/today-layout.test.ts#L61) and [useToday.test.tsx](../client/src/test/useToday.test.tsx#L42) cover dispatch/layout/pins/hydration, not the combined failure scenarios above. [today-plan.test.ts](../server/tests/today-plan.test.ts#L255)'s timezone case uses an active task, masking horizon membership. Standup-specific findings belong in [docs/62](62-standup-mode-review.md), not duplicated here; its historical defects are not assumed still open.

## 12. Open Questions

1. Which screenshot is collab? **Recommend:** verify mode and actual developer participation before interpreting stale rows; assume unknown meanwhile.
2. Is Today primarily personal planning or team triage? **Recommend:** personal commitments plus exceptions, not another team board.
3. Are pins used most days? **Recommend:** keep optional; never require three to finish planning.
4. Does Carry all save useful work or postpone decisions? **Recommend:** remove its prominence and use existing Tasks for backlog decisions.

## 13. Implementation status (2026-10-01)

Roadmap items 1-8 were implemented without commits (working tree only). Each repaired behavior has a regression test named after `docs/63`.

| Item | What changed |
|---|---|
| 1 | `useTodayActions`: snapshot before an optimistic write and restore it on failure (single and bulk, keeping rows whose write landed); Tasks lists, drawers, events and view counts are invalidated; wrap-up/midday/morning lists are patched optimistically (`lib/today-optimistic.ts`); a repeat of the same write joins the first instead of resending. |
| 2 | Wrap-up lists every unfinished plan task ("Still open today": Done, Carry when a carry row exists, Pick for tomorrow - disabled with a reason at 3/3, never hidden). The "loops closed" claim is now scoped and explicit, absent on an empty day and while any source failed. |
| 3 | `triageOwnsEvent`: triage only from the page or inside the queue; Enter/Space on a focused control stay native; keys act on the focused row; `j`/`k` move real focus (and scroll). Tokens `--accent-text`, `--warning-text`, `--focus-ring`, and chip text mixed toward `--text-primary`; `themeTokens.test.ts` measures them. |
| 4 | `TaskViewsService.run/count/counts`, `/api/tasks` and the client view hooks take `tz`; Today's plan passes it. Follow-up capture from Today passes `tz` and `clientToday`. Every Today/manager-actions date is calendar-validated. Follow-up rows open their own task; the follow-up metric and a multi-follow-up "came due" chip no longer claim Waiting, which excludes follow-ups I owe myself (docs/51 F1). |
| 5 | Title-based grouping and "Done all" removed; only same-reason people still fold into "Ask all". |
| 6 | `sourceStatus` gains `plan`, `state`, `review` (present only when they apply); an empty queue with a failed source is not "clear"; rows the server never sent are counted apart from "+N more" with a handoff to Work / Tasks / Team. |
| 7 | Get-started only for a workspace with no task, plan row or queue row; progress bar, open count in the header, zero counters, "No changes since", the People list and "Carry all" removed; a carried task already on the plan is that plan row; pins live in My plan; one date style for server-written dates. |
| 8 | New `malformed-mention` diagnostic (requires confirmation; suggests, never applies, a repair); no text is stripped and no owner is inferred; literal APIs and existing records are untouched. |

Not done on purpose: the "Update overdue" relabel and Ask-first primary for participants (review simplification 4) - outside the eight roadmap items and it touches participation rules in many tests; existing rows with malformed titles are not repaired (no runtime data was modified).

