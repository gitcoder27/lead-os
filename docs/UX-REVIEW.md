# LeadOS UX/UI and workflow review

Reviewed 2026-10-04 against `f2b9884`. I ran the real UI on a scratch copy of the sandbox DB: a fresh `reviewer` workspace (8 people, 53 tasks, 4 meetings, 12 Jira-like issues, check-ins, 1:1 series, notes), plus a brand-new empty DB for the Setup Wizard. Screenshots are in [`ux-review-assets/`](ux-review-assets/); anything I couldn't verify is listed in §8. This review doesn't repeat items that docs/56, docs/57, docs/60 or docs/61 already schedule; it references them where they overlap.

## 1. Verdict

| Dimension | Grade | One-line reason |
|---|---|---|
| Visual design | **7/10** | Calm palette, good dark mode, strong Tasks list, Standup and My Day. Work and Settings use a different, denser visual language. |
| Ease of workflow | **6/10** | Capture, palette, Tasks keyboard flow and Weekly review are excellent. Today asks you to scan about 30 rows, and some primary actions don't fit the problem. |
| Consistency | **5.5/10** | The same item shows in 2–3 places, legacy names (Manager Desk, Team Tracker) remain, and dates appear in four formats. |
| "World-class" readiness | **5/10** | The building blocks are Linear-grade. The connective layer is not yet. |

**Biggest theme to fix: attention is fragmented.** Six surfaces each compute "what needs me" in their own way: the Today queue, Carry from earlier, the header Action inbox, Attention signals, the Tasks "Needs attention" view, and Work's "Attention 24" tile. They duplicate rows, and none of them states the one next thing with the right verb.

## 2. Top 10 changes (ranked by impact ÷ effort)

1. **Today: give blocked and at-risk people a blocker action, not "Set current".** Today queue row 1 tells you to make Marcus's *blocked* task current (`today.service.ts:1191-1207` ignores `status`).
2. **Show and edit "Waiting on" in the task drawer.** The drawer never renders `waitingOn`, so a Waiting item reads "Owner: You" with no counterpart (`tasks-drawer-waiting.jpg`).
3. **Render @mentions as names in the capture input.** Picking "Marcus" inserts `@manual:marcus-lee-ec28abd3` into the text you are typing (`g-capture-preview.jpg`).
4. **Show each task in one place on Today.** Waiting items appear as queue rows *and* under Carry from earlier; in wrap-up "RCA for SSO outage" is in both Open promises and Carry to tomorrow (`today-wrapup-1440.jpg`).
5. **Retire the header Action inbox outside Today, or make it a count that links to Today.** It re-lists the Today queue plus Jira alerts, behind a sparkle icon that sits right next to Copilot's sparkle (`g-action-inbox.jpg`).
6. **Settings: stop calling Jira on mount and stop opening on Jira.** Every Settings visit runs a Jira user search, so a down Jira gives a persistent "fetch failed" error toast, and solo users land on Jira Connection (`settings-team.jpg`, `SettingsPanel.tsx:89,618`).
7. **Make `/w` forgiving.** `Ask @marcus … /w !fri` is blocked ("Add @who right after /w"), and `/w @tom <title> !thu` silently becomes a *plan* date rather than a check-by date (`flow-delegate-preview.jpg`).
8. **Wrap-up: put closing loops first.** At wrap-up the exception queue still fills two thirds of the screen, and the three right-panel lists use three different verb pairs. Add a single "Move the rest to tomorrow" action.
9. **Bring accent text up to AA contrast in the light theme.** Active nav and rail labels in `#0891b2` measure 3.68:1 and 2.79:1 (axe, every page), and badge white-on-`#ef4444` measures 3.76:1.
10. **Remove "Manager Desk" and "Team Tracker" from live copy.** They still appear in the Notes "Create task" hint, Triage, the Action inbox confirm, Settings → Data Maintenance and the Jira Connection description.

## 3. Findings

### P0: blocks ease of use

| ID | Area/Route | Finding (evidence) | Impact | Effort | Recommendation |
|---|---|---|---|---|---|
| P0-1 | `/` Today queue | A blocked person's primary action is **Set current**, previewed as "Will set Fix flaky payment webhook retries", which is the blocked task itself. The same happens for at-risk Noah. `today.service.ts:1191` takes `setCurrentCandidates[0]` before looking at status (`today-1440-light.jpg`). | H | S | When `status ∈ {blocked, at_risk}`, make the primary action "Follow up" (capture a follow-up with the blocker reason as context) and show the reason as the row subtitle ("Waiting on payments sandbox keys · 10m"). Keep Set current as a secondary action. |
| P0-2 | `/tasks` drawer | The drawer has no Waiting-on field: grep finds `waitingOn` only in `TaskList`, `TaskMenus` and `TasksPage`. A waiting item shows Owner "You", Tracked by "You", and nobody you are waiting on (`tasks-drawer-waiting.jpg`). | H | S | Add a "Waiting on" row to `TaskDetailFields` (person/contact/text picker that reuses the `w` menu) plus "since 8d · check Tue". Hide "Tracked by" when it equals Owner. |
| P0-3 | Capture (global) | The typeahead inserts the raw id (`@manual:marcus-lee-ec28abd3`, `@manual:tom-becker-81b9d6a0`) into the editable text. Managers then read and edit machine ids (`g-capture-preview.jpg`). Related to TS-08, which is an investigation only. | H | M | Keep `@Marcus` visible in the textarea (or as an atomic chip) and send the id through `defaults`/a side map in `useCaptureTypeahead`. The grammar already accepts colon ids, so this is a display-layer change. |
| P0-4 | `/` Today | The same task shows twice: "CI cost estimate" and "RCA for SSO outage" are queue rows (Overdue follow-up) *and* Carry-from-earlier rows. In wrap-up, "RCA for SSO outage" sits under both Open promises and Carry to tomorrow (`today-wrapup-1440.jpg`). | H | S | Build one key set per Today build and drop a task from later sections once an earlier one has it, the same way `isPinnedDuplicate` already folds pinned rows (`today.service.ts:469`). Waiting items belong in promises, never in carry. |
| P0-5 | Header, all pages but Today | The **Action inbox** (sparkle icon, "9+") re-lists the Today queue (23 open), adds "Attention signals" Jira alerts, and has its own Done/Set current buttons. Copilot uses the same sparkle right beside it (`g-action-inbox.jpg`, `ManagerActionInbox.tsx:313`). | H | S | Replace it with a plain count pill ("Today 14") that navigates to `/`. Move Jira attention signals into the Work page. If the popover stays, use a bell/inbox icon, never a sparkle. |

### P1: clear friction

| ID | Area/Route | Finding (evidence) | Impact | Effort | Recommendation |
|---|---|---|---|---|---|
| P1-1 | `/settings` | `useEffect` at `SettingsPanel.tsx:618` runs Jira user discovery whenever Settings mounts, on any section. With Jira unreachable it raises a persistent error toast, "Failed to discover team members · fetch failed", and an inline "fetch failed" (`settings-team.jpg`, `settings-390-dark.jpg`). | H | S | Discover only when the Team Members section is open and the user types or clicks Refresh. Map errors to plain copy: "Can't reach Jira. Check the connection." plus a link. |
| P1-2 | `/settings` | The default section is `connection` (`SettingsPanel.tsx:89`). A solo, Jira-less manager opens Settings onto Jira fields, with an orange "No query" on Sync Scope and a sticky Reset & Reconfigure / Save / Save & Sync footer (`empty-settings-1440-light.jpg`). P7-07 (IA regroup) is planned; this is the smaller first step. | M | S | Default to Navigation, or to Team Members when the roster is empty. Show the sticky footer only on Jira sections (it already is section-gated at `:2164`, but it still claims about 120px on phones). Drop warning colour for unused Jira settings. |
| P1-3 | Capture grammar | `/w` must be followed by `@who`. "Ask @marcus for ETA /w !fri" is rejected with "Add @who right after /w" and Enter does nothing. `/w @tom Send plan !thu` stores `scheduled_on=2026-10-08` and no `follow_up_at`, so the item never surfaces as a due check, yet the preview chip reads only "Thu, Oct 8" (`flow-delegate-preview.jpg`, DB row T-53). | H | S | Let `/w` bind the only @person anywhere in the text and the first `!date` anywhere. Label preview chips by meaning: "Check Thu" vs "Plan Thu". |
| P1-4 | `/` wrap-up | The left two thirds is still the 10-row exception queue. The wrap-up lists are squeezed into the side panel with three verb pairs: Pick/Done, Tomorrow/Done, Done/Carry (`today-wrapup-1440.jpg`). | H | M | At `stage=wrap_up`, swap the columns (wrap-up becomes the main column, exceptions go to the side), unify the verbs as "Done · Tomorrow · Drop", and add a "Move the rest to tomorrow" bulk action with Undo. |
| P1-5 | `/` Today | Information priority: about 30 rows (16 queue + 10 plan + standup + carry), every row with a bordered action button, and no single "start here" outside wrap-up. Rows for one person scatter: Marcus appears in rows 1, 3 and 5 (`today-1440-light.jpg`). | H | M | Show one "Start here" card (the top-ranked row with its reason), then cluster queue rows by person or issue ("Marcus · blocked · 2 related"). Cap the visible queue at 7 with "+N more". |
| P1-6 | `/team` | The Attention column is "—" for all 8 people, including blocked Marcus. Open items shows a 5-segment meter with no scale. Five of eight people show "No current item", and in solo mode only the manager can set it, so it becomes busywork (`team-1440-light.jpg`). | M | M | In solo, drop the Attention column or merge it into Status. Label the meter ("2 open"). Replace "No current item" with the next planned task. Over-capacity is P7-09. |
| P1-7 | Team drawer | Blocked card says "Next check not scheduled." with no action. Waiting-on-them rows mix three date formats: `2026-10-04`, `10/3/2026, 10:00:00 AM`, and "Updated 6d ago" (`team-drawer-marcus.jpg`). | M | S | Add "Set check" and "Follow up" buttons in the blocked card. Format every date with one helper ("Sat 3 Oct, 10:00"). |
| P1-8 | 1:1 vs Meetings | Two meeting models: the 1:1 workspace (Team → person → 1:1, sessions, agenda) and meeting tasks (Tasks → Meetings, Outcome, Action items). "1:1 with Priya" exists as a meeting task *and* a 1:1 session on Mon 5 Oct. The palette finds the task for "1:1" but has no command for the 1:1 workspace. | M | M | Make 1:1 meeting tasks open the 1:1 workspace, or let the series own its sessions and hide `kind=meeting` duplicates. Add palette commands "1:1 with <name>". P7-10 covers enable toggle and discoverability only. |
| P1-9 | `/work` | The table has a redundant OPEN column ("Open" link on every row, with the row already clickable), "No tags +" on every row, two empty-circle columns (Notes, Tracker), and monospace dates. Header tiles include non-defect "Attention 24 · action rows" and "Follow-ups 4", and at 1280px tiles truncate ("All defec…", "New to te…") (`work-1440-light.jpg`, `work-1280-dark.jpg`). | M | M | Remove OPEN, show tags only when present, and merge Notes/Tracker into one "Linked" icon. Drop the Attention and Follow-ups tiles (Today owns them). Use 5 defect tiles that wrap. |
| P1-10 | Work triage | A suggestion proposes moving the due date from 2026-10-02 to 2026-09-26 and itself warns "Already in the past: applying it makes this issue overdue" (`work-triage.jpg`). | M | S | Don't emit suggestions whose target is in the past (`automation.service.ts` rules). Alert quality more broadly is P5-06. |
| P1-11 | `/team` empty | With 0 people the Team page says "No developers match this view. Change the filters or add team members from settings." There are no filters and no button (`empty-team-1440-light.jpg`, `TrackerRosterBoard.tsx:493`). Standup and Display stay active. | M | S | Use a zero-roster empty state: "Add the people you manage" + **Add person** (inline manual add) + "Import from Jira" if connected. Disable Standup/1:1s until someone exists. |
| P1-12 | `/tasks` Meetings | A past meeting shows as a red "1d overdue" task in Planned today/Overdue and Needs attention ("Architecture sync · 0/2 actions"). The Meetings view groups the same item correctly as "Needs outcome" (`tasks-bulk.jpg`, `tasks-view-meetings.jpg`). | M | S | Exclude `kind=meeting` from overdue math. Show "Needs outcome" in all views, and offer **Capture outcome** as its row action. |
| P1-13 | Weekly review step 6 | Copy Markdown, Copy for Teams, Download CSV and Finish review sit at y≈1405 in a 900px viewport. The footer only shows "← Next week" (`review-step6.jpg`). | M | S | Pin Copy for Teams, Copy Markdown and Finish review in the step footer, where "Waiting →" lives on earlier steps. |
| P1-14 | Copy / IA | Live UI still says "Manager Desk": Notes "Create task" hint "Leave unassigned to send the task to your Manager Desk inbox" (`NotesTaskActionDialog.tsx:293`), the Action inbox confirm (`ManagerActionInbox.tsx:729`), Data Maintenance (`SettingsMaintenanceSection.tsx:170-211`), and the Jira identity hint. It also says "Team Tracker" (Triage section label, toast at `TriagePanel.tsx:102`). | M | S | Rename to "Inbox" / "Tasks" / "Team board". P7-11 removes dead code but not these live strings. |
| P1-15 | Accessibility | Contrast: accent `#0891b2` as 12px text measures 3.68:1, rail active 2.79:1, Work tile amber 1.96:1, and badge 3.76:1. `/work` has 30 `aria-label` on role-less `<span>` (screen readers drop them). Team rows are `role="button"` with focusable children (nested-interactive, also in Standup). Triage has one unnamed button (axe). | M | S | Add an `--accent-text` token (about `#0e7490` light) for text on light fills. Give status spans `role="img"` or visible text. Make roster rows a link plus separate buttons. Name the triage icon button. |
| P1-16 | Mobile `/` | At 390px queue titles truncate to about 12 characters ("CI cost estim…", "AM-4101 Checko…") because badge + button + menu take most of the row. The stage strip clips the date ("Sun 4 O") (`today-390-light.jpg`). | M | S | At ≤480px move the badge under the title and make the primary button icon-only or swipe-revealed. Let the stage strip wrap. |
| P1-17 | Mobile `/work` | The "9+" Action-inbox badge overlaps the logo ("LeadO"). The defect table needs horizontal scrolling, with Open/SEV/ID taking the first 200px (`work-390-light.jpg`). | L | S | Hide the Action inbox under 480px (see P0-5). On phones render Work as cards (title, assignee, due, status). |
| P1-18 | First run | With **Just me** selected the wizard shows "Step 1 of 4", but steps 3–4 (manager mapping, team) exist only for Jira. "Skip for now" finishes after 2 screens, so the indicator overstates the work. When Jira comes from env vars and the first sync fails, the only Today content is "Jira sync needs review · fetch failed", and this suppresses the Get started checklist (`hasRealWork` counts any non-calm row) (`setup-step1-1440-light.jpg`, `firstrun-today-1440-light.jpg`, `SetupWizard.tsx:140-149,743`). | M | S | Label steps 3–4 "with Jira", or count 2 until Jira is saved. Exclude `sync_issue` rows from `hasRealWork` so Get started still shows. |

### P2: polish

| ID | Area/Route | Finding (evidence) | Impact | Effort | Recommendation |
|---|---|---|---|---|---|
| P2-1 | Header | The subtitle "People, work, risks, and planning" (`Header.tsx:148`) costs a line on every page. Work adds "Sync off" and a refresh icon to the global header, so the header changes shape per page. | L | S | Drop the subtitle. Move Work's sync controls into the Work toolbar. |
| P2-2 | Today plan | "Top 3 · 3/3" is set larger than the "My plan" heading (`TodayPlanPanel.tsx:46`). Six identical bordered **Done** buttons stack in the plan. | L | S | Use section-label size. Show Done as a ghost checkbox until hover/focus, like Tasks rows. |
| P2-3 | Settings → Team Members | Eight identical "This is me" chips, one per person, and a Jira Directory column that is prime real estate even when Jira is unreachable. "Add manually" sits below the fold (`settings-team.jpg`). | L | S | One "Which one is you?" select above the list. Put Add manually first when Jira is missing. |
| P2-4 | 1:1 overview | Next dates are raw monospace ISO (`2026-10-05`) with "0 agenda", and there is no "next up" emphasis (`team-oneonones-overview.jpg`). | L | S | Show "Mon 5 Oct · tomorrow" and sort by next date. Show agenda count only when > 0. |
| P2-5 | Tasks rows | "Waiting 0d" for items created today. Today's wrap-up, Team and Tasks show "Me", "You" and "RE" (avatar) for the same person. | L | S | "Waiting since today". Use "You" everywhere. |
| P2-6 | Work workload bar | Chips read "Aisha 2 S0", where "S0" is unexplained. The left icon rail has four unlabeled icons above "0 FOCUS" (`work-1440-light.jpg`). | L | S | Spell out ("2 open · 0 Sev-1") with a tooltip. Add text labels on hover/focus to the rail. |
| P2-7 | Palette | No commands for 1:1s or Settings sections ("attention rules" returns only "Add to Tasks"; "backup" returns "Go to Settings"). "Go to Waiting" and "Tasks: Inbox" use two naming styles. P7-02 covers ARIA, recents and ranking. | L | S | Add "1:1 with <name>" and one entry per Settings section (deep-link `?section=`). Use one style: "Tasks › Waiting". |
| P2-8 | Notes → task | The Notes "Create task" dialog is a separate form (Title / Assign to / Jira key / Context) that keeps "@Priya Raman" in the title, while global capture uses the grammar (`notes-turn-into.jpg`). | L | M | Open the shared CaptureBox prefilled with the line and `defaults` (owner, note source), and strip the mention from the title once the owner is set. |
| P2-9 | Today first run | In the morning stage a solo manager with 0 people sees "Standup window until 12:00" as the stage chip (`empty-today-1440-light.jpg`). | L | S | In solo with an empty roster, call it "Morning" (Day Rhythm labels can stay). |
| P2-10 | Weekly review | The step 1 Jira line is set at about 17px while list rows are 13px. "Shipped" in step 6 lists the dropped item "Evaluate new standup bot" (unchecked) (`review-step6.jpg`). | L | S | Use body size. Exclude dropped items from Shipped. |
| P2-11 | My Day (developer) | Today's Up next shows a task scheduled for tomorrow (T-27, scheduled 5 Oct) labelled "Continued from Oct 4" on 4 Oct (`myday-dev-1440.jpg`). | L | S | Show "Planned for tomorrow", or don't list it under today. |
| P2-12 | Empty My plan | "Nothing is planned yet. Add a task or triage your inbox." is truncated with an ellipsis even at 1440px (`empty-today-1440-light.jpg`). | L | S | Let empty-state copy wrap. |

## 4. Workflow scorecards

Clicks are measured with real interactions unless marked *est.* "Rows scanned" counts items visible before a decision.

| # | Workflow | Current | Ideal | Dead ends / confusing labels | Key fix |
|---|---|---|---|---|---|
| 1 | Start of day | 0 clicks; about 30 rows to scan; top row says "Set current" for a blocked person | 0 clicks; 1 "Start here" + ≤7 rows | "Will set …" preview; Marcus in 3 separate rows; Queue + Plan + Standup + Carry + header inbox all compete | P0-1, P1-5, P0-5 |
| 2 | Capture in < 3 s | Ctrl+I → type → Enter (measured; toast "Captured T-52 · Open task") | Same | Raw `@manual:…` ids in text; `/w` after the title is rejected; plain title works perfectly | P0-3, P1-3 |
| 3 | Delegate and track | Capture: 3 key actions (Ctrl+I, pick @tom, Enter). Track: Waiting view (1 click or `g w`). Change who: row ⋯ → Waiting on… (2) | Same capture; drawer edit in 1 | `!thu` after the title becomes a plan date, so the item never nudges; the drawer hides waiting-on; no outbound nudge (WR-13/15 deferred) | P0-2, P1-3 |
| 4 | Prepare and run a 1:1 / meeting, then turn notes into actions | 1:1: Team → person → scroll drawer → Open workspace = 3 clicks *est.*; ⌘⇧E turns a line into an action (1 key). Meeting: Tasks → Meetings → row = 3 clicks; Action items are below the fold | Palette "1:1 Priya" = 1; meeting opens with notes and actions above the fold | Two meeting models (task "1:1 with Priya" and 1:1 session); palette can't open the 1:1 workspace; past meeting reads "1d overdue" | P1-8, P1-12 |
| 5 | Spot blocked / overloaded / quiet | Team (1) → summary shows "1 blocked · 1 at risk" → row (2) → no action in blocked card → Capture follow-up (3) | 1 click from Today's person row | Attention column all "—"; load meter unlabeled; "Last touched" is the only quiet signal (seeded data was all fresh, so staleness is unverified) | P1-6, P1-7, P0-1 |
| 6 | Triage a Jira defect and link it | Today "Assign owner" = 1. From Work: row (1) → owner chip or "Add to Marcus" (2–3) | 2 | Past-date suggestion; "Team Tracker" section label; Open column duplicates row click | P1-9, P1-10, P1-14 |
| 7 | End-of-day wrap-up | 1 click per item across 3 lists: 10 still-open + 4 promises + 4 carry, so up to 18 decisions; EOD note opens Notes | 1 bulk "Move the rest to tomorrow" + exceptions | Duplicate rows (P0-4); Pick/Tomorrow/Carry verbs; exceptions dominate the screen | P1-4, P0-4 |
| 8 | Weekly review and report | Ctrl+K "weekly" ↵ → 6 steps with per-item decisions → Copy (≈8 clicks minimum) | Same | Copy and Finish are below the fold on step 6 | P1-13 |
| 9 | Find anything | Ctrl+K + 2 characters; results grouped across tasks, issues, check-ins, people and notes (measured) | Same | No 1:1 or Settings-section results; unmatched queries always offer "Add to Tasks"; Notes has a second search (⌘⇧F) | P2-7 |

## 5. Missing features and opportunities

These fit the solo-first, lightweight follow-through direction and are not already planned in docs/56/57/60/61.

| Opportunity | User problem | Proposal | Size |
|---|---|---|---|
| **Start here card** (next best action) | "What do I do first?" takes about 30 rows of scanning | Promote `rankActionItems()[0]` to a card with *why* ("Blocked 10m · payments sandbox keys") and the correct verb. Reuses existing ranking. | S |
| **Person clusters on Today** | One person's problems show as 3–4 separate rows | Group queue rows by developer or issue when ≥2 share an owner; expand inline. | M |
| **Nudge drafts (in-app only)** | Overdue waiting items need a message, and nothing helps write it | "Copy nudge" on overdue Waiting rows: "Hi Aisha, checking on the CI cost estimate (asked 26 Sep)". No outbound delivery, so it doesn't overlap WR-13/15. | S |
| **1:1 / meeting templates** | Each 1:1 starts blank | Per-series agenda template (wins / blockers / growth) seeded into each session. Meeting tasks get the same optional template. | S |
| **Calendar awareness (read-only ICS)** | Meetings are re-typed by hand, and Needs outcome depends on that | Optional ICS URL. Today's events become meeting tasks with start/end, and "Capture outcome" fires after each ends. | M/L |
| **Recent changes with Undo** | Undo is a 5 s toast, so mistakes after that are invisible | A "Recent changes" panel (Ctrl+Z history) using the existing `task_events`, each with Revert. | M |
| **Contextual Copilot actions** | Copilot is a separate dock; most managers won't phrase prompts | "Draft follow-up" / "Summarize for 1:1" buttons on rows and person drawers that open Copilot pre-filled (confirm-gated as today). Complements P6-04 (morning brief). | M |

Already planned elsewhere, so not re-proposed: recurrence and natural-language dates (P3-07), list at scale (P3-09), digest and notifications (WR-11–16), over-capacity signal (P7-09), global shortcut sheet (P7-03), palette ARIA and recents (P7-02), theme `prefers-color-scheme` (P7-06), Settings IA regroup (P7-07), sync freshness chip (P5-03).

## 6. Quick wins (under 1 day each)

- [ ] Blocked/at-risk rows: primary action "Follow up", with the blocker reason as subtitle (P0-1)
- [ ] Waiting-on row in `TaskDetailFields`; hide "Tracked by" when it equals Owner (P0-2)
- [ ] Dedupe Today rows across queue, promises and carry with one key set (P0-4)
- [ ] Settings: no Jira discovery on mount, default section not `connection`, plain error copy (P1-1, P1-2)
- [ ] Preview chips read "Check Thu" vs "Plan Thu"; `/w` binds any single @person (P1-3)
- [ ] Exclude `kind=meeting` from overdue; show "Needs outcome" everywhere (P1-12)
- [ ] Pin Copy/Finish in Weekly review step 6 footer (P1-13)
- [ ] Replace live "Manager Desk" / "Team Tracker" strings (P1-14)
- [ ] `--accent-text` token for small accent text; fix badge contrast; role/label fixes on Work spans (P1-15)
- [ ] Zero-roster Team empty state with **Add person** (P1-11)
- [ ] Wizard step count follows Just me / Me and a team; sync errors don't hide Get started (P1-18)
- [ ] Guard triage suggestions against past dates (P1-10)
- [ ] Remove header subtitle; move Work sync controls into the Work toolbar (P2-1)
- [ ] One date formatter for drawer, 1:1 overview and waiting lists (P1-7, P2-4)
- [ ] Swap Action inbox sparkle for an inbox icon, hidden under 480px (P0-5, P1-17)

## 7. Proposed target design principles

1. **One next thing.** Every screen leads with a single recommended action, with its reason and the verb that solves the problem. Lists come after.
2. **Each item lives in one place per screen.** A task appears once per surface, in the section that matches its state. Counts elsewhere link to it rather than re-listing it.
3. **Humans see names, machines see ids.** No raw ids, ISO dates or internal names (Manager Desk, S0, `manual:`) in the UI. One date format.
4. **Forgiving input.** Capture accepts natural word order and explains what it understood ("Check Thu", "Waiting on Tom") before saving. It never silently changes meaning.
5. **Solo first, team when present.** Hide or rename concepts that need a team, a login or Jira (Standup, current item, Attention, Jira settings) until they apply.
6. **Calm by default.** Actions show as quiet controls until hover/focus. Colour and badges are reserved for real exceptions, and text meets AA contrast in both themes.
7. **Keyboard and phone parity.** Every primary flow (capture, decide, close, review) works with keys on desktop and with one thumb at 390px.

## 8. Appendix

**Screenshots** (`docs/ux-review-assets/`, JPEG, ≤1200px wide):
`setup-step1-1440-light`, `firstrun-today-1440-light`, `empty-today-1440-light`, `empty-team-1440-light`, `empty-settings-1440-light`, `today-1440-light`, `today-1440-dark`, `today-390-light`, `today-wrapup-1440`, `g-capture-preview`, `flow-delegate-preview`, `g-action-inbox`, `g-palette-marcus`, `tasks-bulk`, `tasks-view-waiting`, `tasks-view-meetings`, `tasks-drawer-waiting`, `tasks-drawer-meeting`, `team-1440-light`, `team-drawer-marcus`, `team-oneonone`, `team-oneonones-overview`, `team-standup`, `work-1440-light`, `work-1280-dark`, `work-triage`, `work-390-light`, `settings-team`, `settings-390-dark`, `notes-turn-into`, `review-step6`, `myday-dev-1440`.

**What I tested:**
- **Route sweep:** every route at 1440, 1280 and 390px in light and dark (48 captures) with axe on the 1440 and 390 captures. No horizontal page overflow at 390px. Panes scroll internally, so full-page captures equal the viewport.
- **First run:** empty DB → Setup Wizard (Just me, skip Jira) → Today; fresh Jira-less workspace on every route before seeding.
- **Seeded workspace interactions:** shortcut sheet; palette (9 queries); capture with typeahead, `/w` and plain titles; Copilot dock (not configured); Today row menu; Done + Undo; Action inbox; all Tasks views, the drawer (task, waiting, meeting), bulk select, View options and row menu; Team board, person drawer, 1:1 workspace and overview, and Standup mode; Work table, triage panel and bulk select; Notes mention and ⌘⇧E; every Settings section; Weekly review steps 1–6; wrap-up stage (evening time zone); More menu keyboard (works: arrows and Escape); collab mode Team; developer My Day at 1440 and 390.

**Unverified / couldn't test:**
- Screen-reader behaviour (axe only), 200% zoom, Safari/Firefox, and touch gestures.
- Staleness, "quiet" and Attention signals: all seeded touches were minutes old, and the review date was a Sunday.
- Copilot with a real provider, real Jira sync and write-back, and the Jira directory (reads went to a dead port).
- Production-build performance. Dev-mode route loads were 2.7–3.7 s and are not representative.
- Large-data scale and drag-and-drop.
- The legacy `/desk` page: a Phase-3 workspace redirects it to `/tasks`.
- The Today follow-up (`f`) and check-in (`c`) dialogs from the keyboard. My scripted focus didn't land on a row, so the result is inconclusive, not a bug.
- A title-scrambling race after a typeahead pick appeared only at 20 ms per keystroke. At 60–120 ms it didn't reproduce, so it's excluded.

**Incidental (not UX, worth a ticket):** `BackupService.pruneOldBackups` lists *every* `.db` in the backup directory, not just its own DB's snapshots (`backup.service.ts:118-142, 285-310`). An instance started against a scratch DB writes a startup backup into the shared `data/backups/` by default and prunes by its own retention there. For this review I pointed the scratch DB's `backup_directory` at the scratchpad, and no pruning occurred.
