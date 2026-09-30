# Standup Mode: Critical Review

2026-09-30. Evidence: **visual** = screenshots 1-3; **code** = file/symbol; **unverified** = needs runtime observation. Recommendations are judgments. Older reviews are leads, not facts.

## 1. Verdict

Standup Mode does **not** meet the bar: navigation implies coverage, drafts/retries are unsafe, and bookkeeping dominates. It fits live or async reviews of 5-15 reports, not a solo practitioner or two reports, who should use Team/capture. First make the review loop trustworthy, not larger.

## 2. What It Does Today

**Code:** entry points are Team's toolbar (Phase 3, today, writable board), Today's Start standup and Run again card, the palette's Phase-3 command, and `/team?mode=standup`. Notes' standup context opens Team, not the mode. Sources: [TeamTrackerPage.tsx](../client/src/components/team-tracker/TeamTrackerPage.tsx#L600):`onStartStandup`, [TodayStandupStatus.tsx](../client/src/components/today/TodayStandupStatus.tsx#L19):`TodayStandupCard`, [paletteItems.ts](../client/src/components/palette/paletteItems.ts#L101):`action-standup`, [NotesDayContext.tsx](../client/src/components/notes/NotesDayContext.tsx#L45):`buildContextChips`.

1. Load the filtered/sorted board; resume the first unreviewed person, otherwise wrap-up. Progress uses viewer/date-scoped `sessionStorage`.
2. Show tasks, person status and activity. Account ID preserves selection through reordering. Click selects a task; double-click/Enter opens its drawer.
3. Leaving a person, entering wrap-up, or a successful logged write marks them reviewed. Merely opening them does not. Jumped-over people remain unreviewed; no-task people still count.
4. Canonical APIs write events, status, captures, reassignments and check-ins. `/standup/reviews` upserts manager/person/day timestamps. `f` opens an optional 200-character reason; Enter flags, another `f` unflags.
5. End POSTs `/standup/session`: one durable session plus manager-owned follow-ups for explicit flags, transactionally. Same-day open follow-ups may be reused. They carry a person link, reason, today's schedule and immediately due follow-up time. They appear as manager work, not automatically in Waiting: [task-views.service.ts](../server/src/services/task-views.service.ts#L178):`waitingMatch` excludes an otherwise ordinary self-owned follow-up.
6. Separately append to `kind=standup` Notes by default; scratchpad stays separate. Last round shows the latest seal. Summary contains action descriptions, not update/note bodies.

Sources: [StandupMode.tsx](../client/src/components/team-tracker/StandupMode.tsx#L88):`StandupMode`, [standup.ts](../client/src/lib/standup.ts#L137):`standupSessionReducer`, `buildStandupSummary`; [team-tracker.service.ts](../server/src/services/team-tracker.service.ts#L1371):`recordStandupSession`, `recordStandupReviews`; [daily-notes.service.ts](../server/src/services/daily-notes.service.ts#L1049):`append`.

| Exit/state | Actual persistence, **code**: `StandupMode` |
|---|---|
| Esc/Exit; browser Back | No seal; same-tab progress survives. Already successful writes remain. Direct-link Back goes to browser history, not necessarily Team. |
| Wrap-up Back | Returns to the previously current person; discards nothing. |
| Reset | Clears local flags/log/coverage without confirmation; never undoes server writes or reviews. |
| Refresh | Restores progress, not unsent drafts or exact selection. Blocked storage silently leaves memory-only state. |
| End | Clears progress synchronously after seal; archive failure warns but still exits. Stored session summary remains. |
| Empty round | End has a no-op guard, but opening wrap-up already reviews the current person. Empty roster offers Exit. |
| Two tabs/twice daily | Tabs have independent progress; seals share the manager's feed anchor. Successful End starts a fresh next round. |

## 3. Spec Fidelity

**Code** against [50-standup-mode-redesign-spec.md](50-standup-mode-redesign-spec.md), including v2; sources above and component symbols below.

| Requirement | State | Difference |
|---|---|---|
| S1 client resume | Built | Viewer-scoped; no draft persistence. |
| S2 review on leave/write; skipped people | Built | Navigation is the evidence of coverage. |
| S3 one-key session flag | Different | Reason dialog adds a step; v2 makes flags durable tasks. |
| S4 wrap-up navigation | Built | Left returns to current person, not necessarily roster's last. |
| S5 grouping/importance/noise | Partial | Blockers float; other importance tiers use recency. |
| S6 event metadata | Built | Status transitions/blocker actions mapped. |
| S7 clickable scoped actions | Built | Toolbar buttons excluded from Tab. |
| S8 shared row idiom | Built | Shared glyph, excerpt and activity marker. |
| Layout/top bar/rail | Partial | Responsive columns exist; header occlusion below; top bar inline, not separate component. No no-check-in rail dot. |
| Five-cell strip/follow-up time | Different | Solo substitutes Last touched; remaining cells built. |
| Task focus/done section | Partial | Done collapses; selection changes without DOM focus. |
| Feed authors/states | Partial | Loading/error/retry/empty built; manager means "you" regardless of identity; check-ins lack author mapping. |
| Wrap-up six sections/actions | Different | Built, but no-check-in alone does not qualify for follow-up. |
| Regression keymap | Different | Old aliases removed; current grammar below. |
| Motion/density | Different | Reduced-motion support; 38px minimum rows, not 36; ring replaces left bar. |
| V1 seal/idempotence | Partial | Server dedupes IDs; client replaces ID on retry. |
| V2 anchor; V3 follow-ups | Built | Global manager anchor; title-based reuse risks below. |
| V4 archive; V5 clear | Built | Separate standup note, optional; failure non-atomic. |
| V6 recall | Built | [StandupHistory.tsx](../client/src/components/team-tracker/standup/StandupHistory.tsx#L12):`StandupHistory`. |
| V2 single-click opening | Different | Double-click intentionally covered by current tests. |
| Non-goals | Mostly retained | v2 supersedes no persistence/recall; no timer, reorder, team-wide feed or feed editing. |

## 4. Findings

### Bugs And Data-Trust Risks

Ranked; **code** unless stated otherwise.

1. **P1: draft retargeting/loss.** Type on T-1, select T-2, submit: the unkeyed composer retains draft/privacy/type but receives T-2. Changing person unmounts it, losing draft. Bind drafts and pending writes to task identity; preserve them across navigation. [TaskUpdateComposer.tsx](../client/src/components/tasks/TaskUpdateComposer.tsx#L59):`draft`, `submit`; `StandupMode` composer placement.
2. **P1: unreliable retry identity.** Lose a successful seal response, then retry: `endStandup` generates another UUID, creating another session/anchor. Existing follow-up reuse limits, but does not eliminate, duplication. Retain one round ID and archive receipt through retries. `CheckInForm` also submits on Enter while pending, without a handler guard or request ID: repeated Enter can duplicate notes. [StandupLayers.tsx](../client/src/components/team-tracker/standup/StandupLayers.tsx#L96):`CheckInForm`.
3. **P1: false durable coverage.** Failed requests leave green checks; another review change triggers retry. Refresh assumes restored IDs were recorded. Persist/reconcile acknowledgements without requiring another review or seal. `StandupMode`:`recordedReviewsRef`; Reset also leaves this ref populated.
4. **P1: modal contract broken.** **Visual:** the global header occupies the screenshots' top strip. **Code:** Standup is fixed inset-0 at z60; [Header.tsx](../client/src/components/layout/Header.tsx#L113):`Header` is z300. Its own progress/Last round/Exit header can be covered. Outer autofocus/trap/return are absent. Fix shell placement and keyboard ownership, not individual button offsets.
5. **P1: different definitions of today.** Browser-local Team date can be yesterday on the server; `getTrackerViewMode` then marks it history and prevents Standup rendering. Feed Monday fallback also uses server day, while Today uses manager timezone. Propagate one date/zone contract. [team-tracker.service.ts](../server/src/services/team-tracker.service.ts#L304):`getTrackerViewMode`, `getStandupFeed`; [today-clock.ts](../server/src/services/today-clock.ts#L160):`getRhythmState`.
6. **P2: incomplete delta presented as complete.** Seal after reviewing only A: B's unseen earlier events disappear from the next window. Instructions/decisions are excluded; task events silently cap at 120, check-ins are unbounded, and reassigned work follows its current owner. Preserve a conservative per-person boundary; include relevant event types and disclose truncation. [task-events.service.ts](../server/src/services/task-events.service.ts#L313):`feedForOwner`; `getStandupFeed`.
7. **P2: follow-up identity is a title.** Same-named people can share one task; renaming a person/task defeats reuse. Match stable person identity plus manager/day, retaining existing tasks. `recordStandupSession`.

**Code:** task status/check-in mutations are success-driven; detail text patches roll back ([useTaskDetail.ts](../client/src/hooks/useTaskDetail.ts#L90):`useUpdateTaskDetail`). Review marks do not. Today's optimistic actions only invalidate/refetch on error, so offline reconciliation is not rollback ([useTodayActions.ts](../client/src/hooks/useTodayActions.ts#L281):`onError`).

**Code:** manager-only mounts and workspace scoping exist ([app.ts](../server/src/app.ts#L204):`createApp`). Seal/review dates use regex, unlike Notes' real-date validation; empty seals and unverified reviewed IDs are accepted server-side. Tighten validation. Board polling continues every 30 seconds; feed has no interval, so its delta can lag ([useTeamTracker.ts](../client/src/hooks/useTeamTracker.ts#L28):`useTeamTracker`, `useStandupFeed`). Latency is **unverified**, not a measured slow-query defect.

### Simplification Opportunities

Ranked by clutter removed; **visual** screenshots 1-3, supported by the named components:

1. **Shrink wrap-up.** Remove four zero tiles and empty sections. Keep coverage, flags and End. Remove the archive checkbox and Reset from the primary flow. Cost: fewer controls, less archive flexibility.
2. **Collapse empty feed automatically.** Reclaim 320-420px; reuse its reveal control. Cost: one existing reveal action.
3. **Flatten the header.** Current/Open/Done repeat the list; keep current work and exception signals inline. Remove header status pill beside its dropdown; quiet normal rail status. Cost: no new interaction.
4. **Reduce the footer.** Keep navigation, Update, Flag, End/Wrap-up and help; task administration already exists in the drawer. Cost: occasional extra drawer visit, fewer shortcuts to learn.
5. **Remove ritual administration from work.** Exclude generated check-in requests using ask identity, never title matching; keep them in their existing ask workflow. Remove 1:1 reminders from standup outcomes; Today/Team already own them. Cost: no new controls.

**Code inventory:** five people/three tasks render **32 controls**, including disabled: four top-bar, six rail, four header, four task/composer, one feed, thirteen footer. Sources: `StandupMode`, [StandupActionBar.tsx](../client/src/components/team-tracker/standup/StandupActionBar.tsx#L22):`StandupActionBar`.

### Genuinely Missing

None qualifies. Recovery, focus and attribution repair existing promises without another mode, setting or step.

### Taste

**Visual:** containers and uppercase metrics overemphasize bookkeeping. Keep typography/palette; no rebrand.

## 5. Leads Check

| Lead | Verdict and evidence |
|---|---|
| Reviewed without writes | **Partly true, code:** leave/write, not arrival. It affects manager-touch freshness; not developer check-in freshness. "Everyone was covered" overclaims attention. |
| Needs follow-up = flags? | **Refuted, visual/code:** screenshot 3's three are 1:1 reminders. `followUpReasons` includes flags/status/suggestions/1:1; only flags create tasks. |
| Duplicate On track | **Confirmed, visual/code:** same developer-day status in rail, header pill and dropdown; not task status. `StandupPersonHeader`. |
| Since last standup | **Confirmed, code:** latest manager seal, however old or earlier today; otherwise rolling 24h/72h Monday. Future seal falls back but incorrectly keeps `anchoredToSession=true`. |
| Stat redundancy | **Confirmed, visual:** three cells repeat list content; zeros dominate. |
| Check-in request tasks | **Confirmed, visual/code:** `openTasksFor` filters status, not origin; [today.service.ts](../server/src/services/today.service.ts#L882):`askForCheckIn` creates real tasks. New asks are participation-gated; old tasks remain. |
| Exits | **Confirmed, code:** distinct effects in section 2; Reset is not undo. |
| Left outlined bar/footer cutoff | **Unverified cause:** rail has a deliberate 2px active marker, but that does not explain the thin outlined artifact conclusively. Footer uses `shrink-0`/horizontal overflow; screenshot clipping alone proves no viewport bug. |
| Rail edge cases | **Confirmed, code:** no-task people retained, jumps skip coverage, board order inherited. Polling/status changes can reorder it; account ID preserves current person, not a frozen route. |
| docs/55 freshness/reason/link | **Refuted, code:** `recordStandupReviews`, `getFreshnessInputs`, reason form and person links now exist. |
| docs/54 contrast/shadows/layers | **Refuted for inner layers, code:** shared `Dialog`, theme shadow and solid accent tokens. Outer shell still fails independently. |
| Jira chip drift | **Partly true, code:** Tasks and Standup match muted bordered mono; Team remains accent mono. [TaskListRow.tsx](../client/src/components/tasks/TaskListRow.tsx#L278):`jira`; [TrackerRosterBoard.tsx](../client/src/components/team-tracker/TrackerRosterBoard.tsx#L111):Jira metadata. |

## 6. Solo Versus Collab

**Code:** [tracker-freshness.ts](../server/src/services/tracker-freshness.ts#L37):`getFreshnessClock`; `StandupMode`:`noteWording`.

| Situation | Current / should do |
|---|---|
| Solo manager, 5-15 reports | Manager-touch, Note wording / keep; remove feed's residual check-in/"Quiet" language. |
| Collab, participating people | Developer-only freshness / keep distinct from manager review; header count currently includes any author's check-ins. |
| Collab, nobody participating | Touch clock / behave like managed people, without implying missing participation. |
| Empty roster | No Today card; palette/direct overlay offers Exit / sufficient. |
| One or two reports | Full ritual machinery / do not promote it over Team. |

**Code integration:** Today unions today's reviewed/flagged IDs, whereas Last round and Notes context use the latest seal. Closing a follow-up does not clear historical flags. Label these as history, not outstanding work. [today-state.service.ts](../server/src/services/today-state.service.ts#L135):`getStandupSummary`; `DailyNotesService.getDayContext`. Day Rhythm's default 10:00-12:00 window controls Today placement, not access or feed bounds ([DayRhythmSection.tsx](../client/src/components/settings/DayRhythmSection.tsx#L17):`FIELDS`).

## 7. Keyboard And Accessibility Inventory

**Code:** `StandupMode`:`keyHandlerRef`; `StandupLayers`:`keyHelp`. Mouse-free dispatch exists; reliable accessible completion fails.

| Inventory | Assessment |
|---|---|
| Person/task navigation | Left/Right people; Up/Down or j/k tasks. **Partial:** state moves, DOM focus/scroll do not. |
| Writes | u update, v privacy, . current, e done, b blocked rationale, n new, c note/check-in, a reassign, y accept suggestion, f flag/unflag. **Pass dispatch**, not usability certification. |
| Session | Enter task; w wrap-up; ? help; Esc exit. Wrap-up: Left/w return, Enter ends unless on button/link. No old n/p/s/d/r aliases. |
| Forms | Enter saves; Shift+Enter newline; Esc closes layer. Check-in lacks pending/IME guards; root composer Esc does not blur. **Fail robustness.** |
| Discovery | Clickable footer/help exist; v and Up/Down absent from footer. **Partial.** |
| Tab/roles | Outer `aria-modal` without trap; footer `tabIndex=-1`; rail lacks roving focus. Enter can hijack focused buttons to open a task. **Fail.** |
| Global keys | Ctrl/Cmd K/J/I remain palette/Copilot/capture. Local drawer suspension works; global-layer suspension incomplete. Copilot Escape does not prevent Standup's listener: can close both. **Fail.** |
| Announcements/layers | Polite person/flag/wrap announcements; feed error alert; shared Dialog trap/return. **Pass code**, screen-reader experience **unverified**. |
| Motion | Root `MotionConfig reducedMotion="user"`, local branches and CSS reduction. **Pass code**; fades can remain. |
| Touch/narrow | 28px navigation, 20px feed-open target; 64px rail below md; feed stacks below lg; nowrap reasons risk overflow. **Partial/unverified layout**, not mobile-ready evidence. |

**Code calculations:** WCAG sRGB luminance, composited alpha; [index.css](../client/src/index.css#L8):`:root`, `.dark`, `.ui-btn-solid`. Required: text 4.5:1, focus 3:1. Ratios light/dark:

| Pair | Ratio | Result |
|---|---|---|
| Save text/solid fill | 5.36 / 8.19 | Pass |
| Muted text/secondary | 5.69 / 7.43 | Pass |
| Task key/secondary; focused | 4.29 / 5.08; 4.05 / 4.78 | Light fails |
| Accent text/primary | 3.55 / 8.19 | Light fails |
| Danger/12% chip | 2.92 / 4.51 | Light fails |
| Success; warning/secondary | 2.28 / 7.44; 1.93 / 8.79 | Light fails |
| Focus ring/focused task | 1.49 / 2.09 | Both fail |

## 8. Do Not Build

No timers, speaking-order editor, attendance scoring, AI summaries, mandatory per-person updates, standup-specific tasks, notification system, mobile mode, or another history browser. Existing task history and Notes are enough. Do not demand writes merely to justify green checks.

## 9. Roadmap

Priority directions, not an implementation plan. No add-phase item qualifies.

| Order | Impact; size | Dependencies / blast radius | Browser-free test |
|---|---|---|---|
| 1 Draft ownership | Prevent wrong-task/lost notes; M | Composer identity; Standup/Tasks/My Day | Switch task/person with unsent and pending text. |
| 2 Durable recovery | Honest reviews, one seal/follow-up; M | Stable IDs/person links; Team/Today/Tasks/Notes | Lost response, reload, two tabs, same names, rename, archive failure. |
| 3 One clock | Reliable opening/day labels; M | Date contracts; Team/Today/Notes | Fixed clocks across UTC midnight, Monday, DST. |
| 4 Trustworthy feed | Retain unseen work; M | Coverage boundary; Standup | Partial round, mid-round event, instruction, 121 events. |
| 5 Accessible shell | Reachable controls; M | Layer ownership/tokens; all overlays | jsdom focus/Enter/Escape tests; contrast calculation. |
| 6 Remove repetition | Faster scan/close; M | 5; Standup | Component assertions for empty feed, zero totals, normal status. |
| 7 Separate outcomes | Flags mean follow-ups; S | 2; Standup/Today/Tasks/1:1 | 1:1-only round creates nothing; resolved task is not outstanding. |
| 8 Exclude ask administration | Real work dominates; M | Existing ask identity; Standup/Team contract | Generated ask excluded; identical user-written title retained. |

## 10. Scorecard

| Dimension | Grade | Reason |
|---|---|---|
| Purpose fit | C+ | Useful live review; async inspection, not an async ritual service. |
| Speed/keyboard | C | Rich dispatch, weak focus ownership. |
| Clarity/focus | D | Repeated metrics/status; follow-up mixes outcomes and reminders. |
| Data trust | D | Draft attribution and recovery failures. |
| Solo/collab | B- | Correct clock split; inconsistent counts/feed/History wording. |
| Mobile | Incomplete | Code adapts, but no visual evidence; target/overflow risks. |
| Accessibility | D | Outer modal and contrast failures. |

## 11. Assumptions And Limits

Assume one manager, 5-15 reports, 10-15-minute live reviews, mixed participation, occasional second rounds, and summaries for recall. Ten reports leave roughly one minute each; fifteen require exception-only capture.

Only three desktop dark screenshots. Hover, focus, keyboard execution, mobile, light theme, flags/dialogs, previous-round and History are **unverified visually**. No browser/app, runtime data, Jira, production or git history access; tests inspected, not executed.

[StandupMode.test.tsx](../client/src/test/StandupMode.test.tsx#L1), [standup.test.ts](../client/src/test/standup.test.ts#L1) and [useRecordStandupReviews.test.tsx](../client/src/test/useRecordStandupReviews.test.tsx#L1) cover dispatch/reducer/resume/review posting, not the recovery/focus scenarios above. [standup.routes.test.ts](../server/tests/standup.routes.test.ts#L21):`createTestApp` injects manager auth, so those route tests do not establish authorization middleware behavior. Performance and screenshot artifact causes remain unverified.

## 12. Open Questions

1. Is the ritual primarily live? **Recommend:** optimize live capture; reuse existing updates for async review.
2. Must coverage prove engagement? **Recommend:** no; label it "visited," never attendance or confirmed delivery.
3. Are summaries actually reused? **Recommend:** keep automatic archive initially, remove its checkbox; do not add reporting.
4. Should due 1:1s count as standup outcomes? **Recommend:** no; only explicit flags belong in the outcome list.