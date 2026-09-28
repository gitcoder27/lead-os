# 54 — Cross-Surface Consistency Audit

Audit only; no code changed. Scope: global chrome (`layout/`, `palette/`,
`capture/`, `assistant/`, toasts) and the shared vocabulary of the five
redesigned surfaces (Today, Tasks, Team board + Standup, My Day, Notes), plus
the unrevised 1:1 workspace and global Capture. Intended language taken from
docs/49–53. Paths are relative to `client/src/components/` unless noted.
Findings marked *(code-inferred)* were read from code, not observed running.

Severity: **must-fix** = a seam a daily user hits, or an a11y regression ·
**should-fix** = visible inconsistency · **polish** = hygiene.

---

## 0. Verdict

It reads as **one palette, five dialects**. Colour tokens, Geist, the cyan
accent and the calm dark mood hold everywhere. The seams are in behaviour and
component grammar: the same key means four different things, the same task
opens in three different places, and there are five dialog shells, six `kbd`
styles and three avatars. Tasks' `TaskDetailPrimitives` + `TaskPopover` and
Today's `today.css` are already the right shared set. Most of the fix is
adoption, not design.

---

## 1. Findings

### 1.1 Token discipline

Today is the benchmark: `today.css` has two raw colours in 915 lines, and
tone is carried by one `--tone` variable (`today.css:7-11`). Raw-colour
counts elsewhere: Tasks 24 (mostly `label-colors.ts`), Team 47, My Day 21,
Capture 27, Notes 7.

| ID | Sev | Finding |
|---|---|---|
| T1 | **must-fix** | **White text on `--accent` fails contrast in both themes.** Measured: 2.43:1 in dark (`#06B6D4`) and 3.68:1 in light (`#0891B2`), for 11–13px labels. Affected: `today.css:389` (every Today dialog Save), `notes.css:1303-1307`, `standup/StandupLayers.tsx:183`, `StatusRationaleDialog.tsx:260`, `OneOnOneWorkspace.tsx:115,531,557,592`, `capture/CaptureBox.tsx:422`. My Day already works around it with `color: var(--bg-primary)` (`my-day/AddTaskForm.tsx:287`, 8.2:1 in dark). That fix still gives only 3.55:1 in light. |
| T2 | should-fix | **Dark-only colours hard-coded as `rgba()`.** Status tints use the dark-theme cyan `rgba(6,182,212,…)` and amber `rgba(217,169,78,…)` in both themes: `my-day/status-config.ts:22-54`, `TrackerStatusPill.tsx:52-58`, `layout/Header.tsx:245-248`, `capture/GlobalCaptureDialog.tsx:186,206,213,276`, and `context/ToastContext.tsx:83-88`, where the info toast is dark cyan on light. Every one can be `color-mix(in srgb, var(--x) 12%, transparent)`, which `TrackerStatusMark` already does. |
| T3 | should-fix | **Off-palette hues.** The 1:1 "done" uses `#22c55e` (`OneOnOneWorkspace.tsx:47,565`) instead of `--success` `#10B981`. Notes Jira chips use indigo `#6366f1` (`notes.css:722-723`). That is the only indigo in the app; Jira refs are accent-mono on Team (`TrackerRosterBoard.tsx:107`) and muted bordered mono on Tasks and Standup (`TaskListRow.tsx:260`, `standup/StandupTaskList.tsx:125`). |
| T4 | should-fix | **Overlay shadows ignore the theme tokens.** `--panel-shadow` and `--soft-shadow` are defined per theme (`index.css:27-28, 65-66`), but overlays hard-code dark-only black: `0 32px 80px rgba(0,0,0,.48)` (Palette, Capture, QuickAdd), `0 24px 64px rgba(0,0,0,.4)` (Rationale, StandupLayers, Desk capture), `0 0 60px rgba(0,0,0,.4)` (`TrackerTaskDetailDrawer.tsx:184`). In light mode these read as smudges. Only `TodayDialog` and `TaskPopover` use `--panel-shadow`. |
| T5 | should-fix | **The global font-size floor splits the type scale by authoring style.** `index.css:99-107` silently renders Tailwind `text-[10px]`/`text-[10.5px]` at 11px and `text-[11px]`/`text-[11.5px]` at 12px. CSS-file and inline sizes are not floored. So Today and Notes meta renders at a true 11/10.5/9.5px (`today.css:428,686,711`; `TodayPeoplePulse.tsx:88` inline 9px), while the "same" 11px chip on Tasks and Team renders at 12px. In Tailwind surfaces 11, 11.5 and 12 all collapse to 12px, so meta has no hierarchy there. |
| T6 | polish | **Scrims: nine values for one idea.** `rgba(4,8,14,.55)/blur6`, `rgba(4,8,14,.68)/blur8`, `rgba(4,8,14,.52)/blur6`, `rgba(4,8,14,.5)/blur4`, `rgba(6,10,15,.45)/blur4`, `rgba(6,10,15,.62)/blur8`, `rgba(2,6,23,.42)/blur2`, `rgba(2,6,23,.5)/blur3`, `rgb(0 0 0/.5)`, plus `bg-primary 60%` for the Tasks cheat sheet (`tasks/TaskListStates.tsx:249`). |
| T7 | polish | **Radii.** Tailwind surfaces use 6/8/12/16 and `rounded-[24px]` (QuickAdd, Availability). CSS surfaces add 5/7/9/10/14. Dialog corners are 14 (Today), 16 (Palette, Capture, Notes, Tasks sheet) and 24 (QuickAdd, Availability). |

### 1.2 Component vocabulary

**Dialog shells: five families, no single one.**

| Family | Members | Scrim / z | Focus trap |
|---|---|---|---|
| Command | `CommandPalette`, `GlobalCaptureDialog`, `QuickAddTaskModal` | 4,8,14 · z 80–401 | **none** |
| Layer | `StatusRationaleDialog`, `StandupLayers`, `ManagerDeskCaptureDialog` | 6,10,15 · z 70–81 | `useModalFocus` (2 of 3) |
| Today | `TodayDialog` (docs/53 D5) | black .5 · **z 700** | `useModalFocus`, `data-autofocus`, ⌘↵, bottom sheet on phone |
| Radix | `NotesDialogShell`, `NotesWrapUpDialog`, `NotesConflictPanel` | 4,8,14 · z 90 | Radix |
| One-offs | `AvailabilityDialog`, `RescheduleItemDialog`, `TaskShortcutsDialog` (z 9000) | varied | varied |

| ID | Sev | Finding |
|---|---|---|
| V1 | **must-fix** | **The two global overlays don't trap focus.** Palette (⌘K) and Capture (⌘I) are reachable from every surface and are `aria-modal`, but neither traps Tab. `QuickAddTaskModal` and `TrackerTaskDetailDrawer` don't either. Tab walks into the page behind the scrim. `hooks/useModalFocus.ts` is a one-line adoption. |
| V2 | should-fix | **Z-index has no ladder.** Values in use: drawers 40/50 (`TaskDrawer`), 60/61 (Developer drawer), 70/71 (stacked); dialogs 70–91; header **300**; Copilot 340/350; Palette 400/401; `TodayDialog` **700**; popovers and the cheat sheet 9000; toasts 10000. Capture and QuickAdd (z 80) sit under the header (`Header.tsx:115`, `relative z-[300]`), so the nav stays bright and clickable above their scrim, while Palette dims it *(code-inferred)*. |
| V3 | should-fix | **Drawers: two twins and a straggler.** `TaskDrawer` and `DeveloperTrackerDrawer` match on every visual value: 680px width, spring 340/34, the same scrim, shadow and reduced-motion branch. Good. But the Developer drawer hand-rolls its own Tab trap (`DeveloperTrackerDrawer.tsx:724-792`) instead of using `useModalFocus`. `TrackerTaskDetailDrawer` (the legacy fallback, `TeamTrackerPage.tsx:707`) differs on width (`max-w-lg`), scrim, shadow, trap and Esc policy (closes immediately rather than blur-first). |
| V4 | should-fix | **Menus are nearly unified. Finish the job.** `TaskPopover`/`MenuItem`/`MenuHeading` is already used by Today (`TodayActionMenu`, the shortcuts sheet), Notes (`NotesDocFooter`) and the Team drawer (`DeveloperDrawerSections`). Still bespoke: `HeaderNav` "More" (`HeaderNav.tsx:139-170`, `shadow-2xl`, its own hover-intent timer), `SavedViewsMenu`, the My Day row menu (`MyDayTaskRow.tsx:175`), and the `ManagerActionInbox` Radix popover. |
| V5 | **must-fix** | **Buttons: two primary philosophies.** Tinted primary (accent text on `--accent-glow` or an inset ring): `.today-primary` (`today.css:332`), Tasks "Plan your day" (`TaskListStates.tsx:214`), the DatePicker "Set" button, the `TaskUpdateComposer` submit (`:255`). Solid primary (accent fill): `.today-btn-primary`, `.notes-button.primary`, Standup Save, 1:1, CaptureBox, the My Day submit. Heights run 24/28/30/32px and radii 6/7/8. Both are legitimate, but the rule should be "solid only in dialog footers; tinted everywhere else". Solid needs T1 fixed. |
| V6 | should-fix | **Developer status has three encodings.** (1) Team: dot + quiet sentence-case label, tinted only for exceptions (`TrackerStatusMark`, `TrackerStatusPill.tsx:28-47`). (2) A legacy Title-Case pill, "On Track" and "At Risk" (`TrackerStatusPill.tsx:52-58`), still rendered by the Standup rail (`standup/StandupRail.tsx:87`), `AttentionCard` and `StatusRationaleDialog`, so the *redesigned* Standup shows the old pill. (3) My Day: Lucide icon + `rgba` tint (`my-day/status-config.ts`). Labels also drift: "Done for today" (My Day) vs "Done" (Team). |
| V7 | should-fix | **Task status glyph: one component, two private forks.** `TaskStatusGlyph` (`tasks/TaskMenus.tsx:40`) is used by Tasks, Standup and the drawer. My Day and the Team drawer each fork a `LeadingGlyph` (`MyDayTaskRow.tsx:183`, `TrackerDrawerItemRow.tsx:336`). The forks draw no open/active/blocked state, use `CheckCircle2`/`XCircle` at 14 vs 15px, and colour "dropped" differently (`--text-disabled` vs `--text-muted`). The same task changes glyph as it moves between surfaces. |
| V8 | should-fix | **Avatars: three looks, four `initials()`.** Tasks uses a hue-hashed circle (`TaskDetailPrimitives.tsx:131`). Standup uses a square, all-accent tile (`standup/StandupPrimitives.tsx:18`). Today uses a neutral circle with a tone ring (`today.css:677`). So the same person is a pink circle in the Tasks owner column, a cyan square in Standup, and a grey ring on Today. Initials helpers: `task-detail-format.ts:73`, `TodayWrapUp.tsx:178`, `StandupPrimitives.tsx:4`, `DeveloperPicker.tsx:17`, `FilterSidebar.tsx:79`. |
| V9 | should-fix | **Six `kbd` styles.** `.today-kbd` (the only one in `ui-monospace` rather than Geist Mono, inset ring) · `ShortcutLegend` (mono 10px, `--bg-primary`) · `MenuItem` hint (mono 10px, border) · My Day `Kbd` (**sans** 10.5px, 18px tall) · Standup `Kbd` (mono semibold with a bottom bevel) · Header/Palette/cheat-sheet inline (mono 10–11px, three variants). |
| V10 | should-fix | **Section headers: sentence case vs eyebrow.** `SectionHeader` (`TaskDetailPrimitives.tsx:14`, 13px semibold, count pill) and `.today-section-title` (13px semibold, plain count) are near twins; that is the redesign language. Uppercase tracked eyebrows persist in Standup `SectionLabel`, the 1:1 `ColumnHeader` (`OneOnOneWorkspace.tsx:727-740`), the Standup help grid, the palette groups, `.today-subhead` and `MenuHeading`. The Team board group header is its own 12.5px h3 (`TrackerRosterBoard.tsx:412`). Eyebrows are fine for menu and palette group labels only. |
| V11 | polish | **Five segmented controls.** Header nav (elevated pill + soft shadow + accent text), Team view switcher (`TeamTrackerViewSwitcher.tsx:35-58`, elevated + black `rgba` shadow + inset border), Notes kind toggle (`notes.css:50-85`, tertiary fill, primary text), `.today-segment` (separate outlined pills, accent tint), and the Capture target switcher (animated `layoutId` pill, colour per target). |
| V12 | polish | **Empty states.** Tasks (`TaskListStates.tsx:205-218`: 22px icon, 13.5px title, 12px body, tinted CTA) is the best. Team uses a dashed 220px card (`TrackerRosterBoard.tsx:456`), the 1:1 uses dashed boxes, and Today uses inline one-liners. Loading skeletons are missing on the Team board, which uses text. |
| V13 | should-fix | **Toasts are the loudest element in a calm app.** Translucent tone-tinted glass with `backdrop-blur` (`ToastContext.tsx:119-125`), an x-80 slide that ignores reduced motion, and a `hover:bg-white/10` close button that is invisible in light mode. Undo windows: Tasks, Today and My Day use 6s (three separate constants: `useTaskListMutations.ts:22`, `useTodayActions.ts:33`, inline in `useMyDayHandlers.ts:63`), but Team uses **8s** (`TeamTrackerPage.tsx:197`). |

**Where `TaskDetail*.tsx` could be the shared set.** `FOCUS_RING`,
`SectionHeader`, `IconButton`, `Avatar`, `ShortcutLegend`, `PropertyRow`/
`PropertyButton`, `DatePickerPopover`, `InlineTextField`, `useTaskShortcuts`
and `TaskPopover`/`MenuItem` are generic already. My Day (`MyDayUI.tsx:3`),
Notes (`NotesDialogPrimitives.tsx:4`) and the Team drawer import them from
`components/tasks/`. They are the de facto design system, living in a
feature folder.

### 1.3 Density and typography rhythm

| ID | Sev | Finding |
|---|---|---|
| D1 | should-fix | **Page headlines span 13–28px.** Today's h1 is 13px (`today.css:219`, a band title by design, docs/53 D2). Tasks and Team are 19px bold (`TaskToolbar.tsx:122`, `TeamTrackerPage.tsx:464`). My Day is 26/28px (`MyDayHeader.tsx:58`). Notes is a 17px sidebar h1 plus a 24px document heading (`notes.css:290`). Standup is 14–15px (`StandupMode.tsx:545,581`). Two of these are deliberate (Today's band, the Notes document), but Tasks/Team/My Day should share one page-title step. |
| D2 | should-fix | **"A task row" has four geometries.** Tasks: 38px min, 13px medium title (`TaskListRow.tsx:164,207`). Standup: 40px, 13px (`StandupTaskList.tsx:109`; docs/50 §8 says 36). Today: 44px, 13.5px (`today.css:447,493`). My Day: about 44px (py-3), 13.5px medium (`MyDayTaskRow.tsx:80,101`). Team drawer: 13.5px, and 14px semibold for the current item (`TrackerDrawerItemRow.tsx:112-115`). Pick 13px (the Tasks spec) for list rows and 13.5px only where a row is the page's hero. |
| D3 | should-fix | **Focus and selection mean different things.** Tasks' focused row: tertiary tint, plus a 2px inset accent ring on `:focus-visible` (`TaskListRow.tsx:159-161`). Standup: tertiary tint plus a **2px accent left bar** (`StandupTaskList.tsx:105-107`), described as "as `/tasks`", which it isn't. Today's keyboard-active row: an inset `--border-active` ring, while the **left accent bar means "featured / start here"** (`today.css:456-463`). The same mark means "focused" on one surface and "recommended" on the next. Ring colour also varies between `--accent` and `--border-active` (see the `FOCUS_RING` vs `.notes-button:focus-visible` outline, `notes.css:1325`). |
| D4 | polish | **Content measure.** Today 1040px, Tasks 1180px, Team 1600px, Notes 680–720px, with no shared container token. Canvas: Today, Notes and Standup paint flat `--bg-primary`; Tasks, Team and My Day show the gradient `--bg-canvas`. The page background shifts as you switch tabs. |

### 1.4 Motion

| ID | Sev | Finding |
|---|---|---|
| M1 | should-fix | **Reduced motion covers CSS, not Framer.** The global rule (`index.css:128-137`) kills CSS transitions only. Framer animations honour the OS setting only inside `<MotionConfig reducedMotion="user">` (My Day `MyDayPage.tsx:213`, Desk) or where `useReducedMotion` is wired (the two drawers, Copilot, parts of Tasks and Standup). Still animating transforms for reduced-motion users: Palette, Capture, QuickAdd, `StatusRationaleDialog`, `StandupLayers`, `AvailabilityDialog`, the Header mount, and all toasts. |
| M2 | polish | **One easing, too many durations.** `ease [0.16,1,0.3,1]` is the de facto curve (15 uses), good. Durations: 0.1, 0.12, 0.15, 0.16, 0.18, 0.2, 0.22, 0.24, 0.25, 0.3, 0.4 (My Day sections stagger at 0.4s, the slowest in the app). There are six different spring configs. CSS: Today 120–160ms, Notes 120ms, index.css 150–220ms. Overlay entries diverge: Palette y−12, Capture y+20, Rationale 14vh drop, Today none. |
| M3 | polish | **Row entry motion is local.** Today rows fade up 2px (`today.css:451`), the roster staggers (`TrackerRosterBoard.tsx:294`), and Tasks animates only real status changes (a deliberate docs/51 P3 choice). Let Tasks' rule ("animate change, not mount") be the house rule. |

### 1.5 Keyboard vocabulary

The biggest seam. Current map for shared letters:

| Key | Tasks list | Task drawer | Today | Standup | Dev drawer | My Day |
|---|---|---|---|---|---|---|
| `s` | Schedule | Schedule | Snooze → tomorrow | **Set as current** | **Status** | — |
| `a` | Assign | Assign | — | **Add task** | **Add task** | — |
| `d` | — | **Details** | — | **Done** | — | — |
| `e`/Space | Toggle done | Done/Reopen | Primary action | — | — | — |
| `n` | New in group | — | — | **Next developer** | — | New task |
| `p` | Priority | Priority | — | **Previous developer** | — | — |
| `r` | — | — | — | Reassign | — | — |
| `f` | — | — | Follow up (capture) | Flag for follow-up | — | — |
| `z` | — | — | Undo | — | — | — |
| `?` | Modal sheet | — | Popover sheet | Modal grid | — | **none** |

| ID | Sev | Finding |
|---|---|---|
| K1 | **must-fix** | **Same key, different intent across one flow.** In Standup, `s` makes a task current, `d` marks it done and `a` adds a task. Press Enter to open that task's drawer and `s` now schedules, `d` opens details and `a` assigns (`TaskDrawer.tsx:314-319`; `standup/StandupLayers.tsx:8-46`). The Team developer drawer maps `S` to status (`DeveloperTrackerDrawer.tsx:256`). |
| K2 | should-fix | **Four cheat-sheet formats.** Tasks: a modal, action left / key right, one flat list (`TaskListStates.tsx:220-276`). Standup: a modal grid, key left, grouped (`StandupLayers.tsx:116-137`). Today and Notes: an anchored `TaskPopover` (`TodayRhythmHeader.tsx:103`, `NotesDocFooter.tsx:6-19`). Drawers: an inline legend with **uppercase** keys ("J / K", "E", "S") that are pressed lowercase. My Day and the Team board have no `?` at all. |
| K3 | should-fix | **The submit key for the same intent varies.** Logging a check-in: Enter submits in Standup (`StandupLayers.tsx:160`), the Dev drawer (`:681`), My Day (`QuickUpdates.tsx:78`), `TaskUpdateComposer` (`:135`) and CaptureBox (`:322`). Today's check-in dialog alone treats Enter as a newline and needs ⌘↵ (`TodayCheckInDialog.tsx:55` + `TodayDialog.tsx:44`). |
| K4 | polish | **Date stepping.** My Day uses `[` `]` and `T` (`useMyDayShortcuts.ts:36-44`). Notes uses `⌥↑` `⌥↓` and `⌥T` (`NotesDocFooter.tsx:13-14`). The intent is the same. Notes needs a modifier (it's an editor) but can mirror the glyphs: `⌥[` `⌥]` `⌥T`. |
| K5 | polish | **Undo.** `z` exists only on Today. Tasks, Team and My Day offer Undo only as a toast button. |

### 1.6 Iconography

| ID | Sev | Finding |
|---|---|---|
| I1 | should-fix | **One icon, two meanings, on one screen.** In Standup, `Flag` marks a *high-priority task* (`StandupTaskList.tsx:123`, danger) and a *person flagged for follow-up* (`StandupRail.tsx:94`, accent; `StandupPersonHeader.tsx:82`). Priority `Flag` is also filled and `--text-primary` on Tasks (`TaskListRow.tsx:116`) but outlined and danger in Standup. `BellRing` means *snooze* on Today (`TodayActionMenu.tsx:42`) and *follow-up due* on Tasks. The Team drawer's "Capture follow-up" uses `Briefcase` (`DeveloperTrackerDrawer.tsx:274`). |
| I2 | polish | **Size bands by surface.** Today and My Day cluster at 14–15px, Tasks, Team and Notes at 12–13px, and Capture at 10px (16 uses). Team alone uses 17 distinct sizes (5 to 44). Suggested: 13px inline or in menus, 15px leading row glyph, 16px toolbar, 22px empty state. |
| I3 | polish | **Alias hygiene.** `CheckCircle2`/`CircleCheck`, `XCircle`/`CircleX` and `AlertTriangle`/`TriangleAlert` are the same glyphs imported under both names. Harmless visually, but it hides whether the vocabulary is shared. |

Labels: the header gives Copilot, Search and Capture text labels with `kbd`
at `lg`. Settings and Theme are icon-only with `title`. Tasks row signals are
icon-only with tooltips (spec'd). This is consistent enough; leave it.

### 1.7 Unrevised shared surfaces

**1:1 workspace (`/team?dev=<id>&panel=one-on-one`, `OneOnOneWorkspace.tsx`):
visibly behind the bar.**

- **must-fix — double Esc.** Its `window` Esc listener (`:69-74`) closes
  unconditionally. It doesn't check `defaultPrevented`, an open layer, or a
  focused field. Opening a task from the agenda stacks `TaskDrawer`, so one
  Esc closes both layers. Esc while typing in session notes also leaves the
  workspace *(code-inferred)*.
- Native `<select>`s (`:72-89`), HTML5 drag-and-drop (every other list uses
  Framer `Reorder`), uppercase column headers, 10px mono counts, 10–12px body
  text, bordered column cards (card-in-card, which docs/50 §8 bans), no task
  status glyph on agenda task items (`:276`), `#22c55e`, and `#fff` on accent
  (T1). No keyboard model and no `?`. It feels like a pre-redesign screen
  inside the redesigned Team surface.

**Global Capture (`GlobalCaptureDialog.tsx` + `CaptureBox.tsx`): half-migrated.**

- Under Phase 3 the target switcher is gone, but `isDesk` is forced true
  (`:77`). The whole dialog wears the **amber Desk accent** (gradient header,
  amber Zap tile, date pill), yet its submit button is **solid cyan**
  (`CaptureBox.tsx:422`) and its destination (Tasks) is cyan. The header
  Capture button is amber too (`Header.tsx:245-254`), and so is the Tasks nav
  item (`lib/nav-pages.ts:49`).
- The palette still says "type to add to **Desk**" (`CommandPalette.tsx:283,298`)
  while the nav says Tasks.
- No focus trap (V1), sits under the header z-index (V2), not in the
  reduced-motion net (M1).

### 1.8 Cross-surface journeys

| ID | Sev | Finding |
|---|---|---|
| J1 | **must-fix** | **"Open task T-n" lands in three places, chosen by ownership.** From Today or ⌘K, a developer-owned task navigates to the Team board with a drawer (`/team?task=`). A manager-owned task goes to Tasks with a drawer (`/tasks?task=`). A drift item goes to the full page (`/t/T-n`) (`App.tsx:615-689`; `palette/paletteItems.ts:238-239`). Notes and My Day instead open `TaskDrawer` **in place** (`NoteDocument.tsx`, `MyDayPage.tsx`). From Today you lose your place: the queue's keyboard-active row is plain component state (`useTodayKeyboardTriage.ts:21`), so Back returns to the top *(code-inferred)*. Of the entry points, only Notes and My Day keep your context. |
| J2 | should-fix | **"Capture a follow-up" has four dialogs.** Today (`f`) uses `TodayDialog`. Notes uses `NotesFollowUpDialog` (Radix). The Team developer drawer opens the **legacy amber `ManagerDeskCaptureDialog`** (`DeveloperTrackerDrawer.tsx:274,520`). Global ⌘I uses `CaptureBox`. The fields, submit key, shell and accent all differ. |
| J3 | polish | **Today → Standup → drawer carries state well.** `Start standup` deep-links `?mode=standup` (`App.tsx:632-640`), Standup resumes at the first unreviewed person, and a dev target deep-links `?dev=`. The seams are only visual: the legacy status pill in the rail (V6) and the Flag ambiguity (I1). |
| J4 | polish | **⌘K → check-in result** opens the developer drawer but not the check-in itself (`paletteItems.ts` checkins → `{type:'developer'}`). |

---

## 2. One vocabulary: proposal

Everything below already exists. The move is to promote it out of feature
folders into `client/src/components/ui/` (primitives) and `index.css`
(tokens), then point surfaces at it.

**Tokens (`index.css`).**

- `--on-accent`: `#09090B` in dark (8.2:1). For light, fills need a darker
  cyan, `#0E7490` + `#fff` at 5.4:1, so add `--accent-solid` for fills only.
  Generalises My Day's `var(--bg-primary)` fix.
- `--scrim` (one colour + blur) and `--overlay-shadow` (= `--panel-shadow`).
- A z ladder: `--z-drawer` 50, `--z-dialog` 400, `--z-popover` 500,
  `--z-toast` 600, all above the header's 300.
- `--ease-out: cubic-bezier(.16,1,.3,1)`, `--dur-fast` 120ms (hover),
  `--dur-overlay` 180ms; drawers keep spring 340/34.
- Tone via `--tone` (from `today.css:7-11`) for every tinted chip, pill,
  avatar ring and toast.
- Type steps: 11 meta · 12 secondary · 13 row/body · 15 dialog title · 19
  page title; then delete the floor hack (T5).
- Radii: 6 chip · 8 control · 12 card · 14 overlay.

**Primitives (`components/ui/`), each from its strongest owner.**

| Primitive | Source | Replaces |
|---|---|---|
| `Dialog` | `TodayDialog` (focus trap, autofocus, ⌘↵, phone sheet) + `.today-dialog*` | Command, Layer and Radix families, one-offs |
| `Drawer` | `TaskDrawer` shell (twin of the Developer drawer) + `useModalFocus` | the Developer drawer's own trap, `TrackerTaskDetailDrawer` shell |
| `Popover`, `MenuItem`, `MenuHeading`, `MenuDivider` | `tasks/TaskPopover.tsx` | HeaderNav More, SavedViewsMenu, My Day row menu |
| `Button` (`primary` tinted 28 · `solid` 30 · `ghost` 28 · `quiet`), `IconButton` 28/32 | `today.css:332-392` + `TaskDetailPrimitives.IconButton` | `.notes-button`, inline `#fff`-on-accent buttons |
| `Chip` (tone) | `.today-chip` / `StandupPrimitives.ToneChip` (same idea) | status `rgba` configs |
| `TaskStatusGlyph` | `tasks/TaskMenus.tsx:40` | both `LeadingGlyph` forks |
| `DevStatusMark` | `TrackerStatusMark` + `STATUS_META` (+ My Day prompts as data) | legacy `TrackerStatusPill`, My Day `status-config` visuals |
| `Avatar` + one `initials()` | `TaskDetailPrimitives.Avatar` (hue) + optional tone ring from `.today-avatar` | Standup square, `.today-avatar`, 4 helpers |
| `KeyChip` (task/Jira) | `TaskKeyChip` + muted mono Jira chip | indigo Notes chip, accent roster ref |
| `SectionHeader` | `TaskDetailPrimitives.SectionHeader` | `SectionLabel`, 1:1 `ColumnHeader`, board group h3 |
| `EmptyState` | `TaskListStates` empty block | dashed cards |
| `Kbd`, `ShortcutSheet`, `ShortcutLegend` | Standup's grouped `KEY_HELP` data shape, rendered in a `TaskPopover` (Today/Notes pattern); lowercase keys | 6 kbd styles, 4 sheet formats |
| `ListRow` idiom | Tasks row (13px, ~40px). Focus = tertiary tint + inset 2px `--border-active`. The left accent bar is reserved for "featured". | per-surface row CSS |
| Toast | Keep the provider; restyle to `--bg-elevated` + `--tone` icon and edge, `--overlay-shadow`, reduced-motion aware, one `UNDO_WINDOW_MS` | glass tints, the 8s outlier |

**Keyboard grammar** (from Tasks, the most complete map):
`j/k` move · `Enter`/`o` open · `e`/Space done or primary · `s` *when*
(schedule/snooze) · `a` assign · `n` new · `c` check-in · `u` update · `f`
follow-up · `l` labels · `p` priority · `#` drop · `x` select · `z` undo · `/`
search · `?` sheet · `Esc` close one layer (blur a field first). Standup
remaps: set-current → `.`, done → `e`, add task → `n`, reassign → `a`,
next/prev person → `→`/`←` only (drop `n`/`p`). Dev drawer status →
`⇧S`. Enter submits one-line and composer fields; ⌘↵ submits dialogs and
multi-field forms. That makes the Today check-in dialog Enter-to-save, like
every other check-in composer.

---

## 3. Ordered fix list (cheap normalisations first)

1. **`<MotionConfig reducedMotion="user">` at the app root** (M1). One line;
   retire the per-page wrappers.
2. **`--on-accent` / `--accent-solid` tokens** and swap every `#fff`-on-accent
   (T1). About 12 sites.
3. **Theme-safe tints:** replace the `rgba(6,182,212…)` and
   `rgba(217,169,78…)` literals with `color-mix(var(--token))`; `#22c55e` →
   `--success`; indigo Jira chip → the muted mono chip (T2, T3).
4. **Scrim, shadow and z tokens,** applied to every overlay (T4, T6, V2).
   Fixes Capture sitting under the header.
5. **Focus traps:** `useModalFocus` in Palette, Capture, QuickAdd,
   `TrackerTaskDetailDrawer`, and replacing the Developer drawer's hand-rolled
   trap (V1, V3).
6. **1:1 Esc guard:** respect `defaultPrevented`, editable targets and upper
   layers, like `DeveloperTrackerDrawer.tsx:740-750` (§1.7).
7. **Naming and accent under Phase 3:** Tasks nav, Capture button and Capture
   dialog go to `--accent`; palette copy "add to Tasks" (§1.7).
8. **Status vocabulary:** Standup rail, `AttentionCard` and Rationale switch to
   `TrackerStatusMark`; one label set ("Done", not "Done for today"; no Title
   Case); My Day tints derive from `STATUS_META` (V6).
9. **`TaskStatusGlyph` everywhere** a task appears (V7).
10. **Keyboard grammar** (K1), then one `ShortcutSheet` + `?` on My Day and
    the Team board (K2), Enter-to-save in the Today check-in (K3), `z` undo on
    Tasks (K5).
11. **Promote primitives to `components/ui/`:** `Kbd`, `Avatar` +
    `initials`, `SectionHeader`, `Chip`, `EmptyState`, `Button` classes
    (V4, V5, V8–V12).
12. **One `Dialog` shell** (from `TodayDialog`) and port the other families;
    the follow-up capture flows then share one form (V1, J2).
13. **Task opening in place:** a global `TaskDrawer` host (like the palette's)
    that any surface can open without navigating; keep `/t/T-n` for
    deep links (J1).
14. **Type scale:** page-title step, row geometry, remove the floor hack
    (T5, D1, D2, D3).
15. **1:1 workspace pass** onto the shared primitives (§1.7).
16. Polish: segmented control, content measure, canvas, icon sizes and
    aliases, toast restyle (V11, D4, I2, I3, V13).

---

## 4. What to leave alone

- **The palette and mood:** one cyan accent, Geist, calm dark, tone colours
  only for meaning. This part is already one product.
- **Today's band h1 at 13px** and the **Notes document heading/editor
  scale** (15px/1.6). Both are deliberate (docs/53 D2, docs/52 D2) and read
  as "command strip" and "writing surface", not as drift.
- **Amber on `/desk` itself** while the legacy Desk exists. Only stop amber
  leaking into Phase 3 Tasks and Capture.
- **Radix in Notes:** a better base than hand-rolled traps. The unified
  `Dialog` may adopt Radix internally, as long as it keeps `TodayDialog`'s
  API and look.
- **Tasks' "animate change, not mount"** status glyph, the drawers'
  blur-then-close Esc, and Standup's session and wrap-up flow (docs/50 v2).
- **Per-surface row density where the job differs:** the Team roster's
  60px person rows and Today's two-line queue rows are different objects
  from task rows. Unify task rows, not every row.
- **Mode-local keys that don't collide:** Standup `w` wrap-up, `v`
  private/shared, `y` accept suggestion; Tasks `g`-chords; Notes editor
  chords.

---

## 5. Implementation status (branch `consistency-pass`)

All 16 steps of §3 are done. Tokens and primitives now live in
`client/src/index.css` and `client/src/components/ui/`: `Dialog`, `Popover`,
`Kbd`/`KeySpec`, `ShortcutSheet`/`ShortcutList`/`ShortcutLegend`,
`Avatar`/`initials`, `DevStatus`, `SectionHeader`, `IconButton`,
`EmptyState` and `focus`. The CSS classes are `ui-btn*`, `ui-icon-btn`,
`ui-link`, `ui-chip` + `tone-*`, `ui-field`, `ui-segment`, `ui-tabs`,
`ui-dialog*`, `ui-kbd` and `ui-page-title`.

Deviations and what's left:

- **Radii:** overlays use 16px (the existing majority), not the 14px
  proposed in §2.
- **Keyboard:** the standup people keys are ← → only; the `n`/`p` aliases are
  gone. In the Team drawer, status moved to `⇧s` and new task to `n`. My Day
  also accepts `c` for check-in. Notes also accepts `⌥[` `⌥]`. The Team board
  now has `j/k`, `o`, `/`, `[ ]`, `t` and `?`.
- **Dialogs:** the Command palette keeps its own layout (it's a search
  surface, not a form) but uses the shared tokens. Notes keeps Radix and
  wears the shared card. `RescheduleItemDialog` belongs to the legacy Desk
  and only got the tokens.
- **Follow-ups:** Today, Notes, the Team drawer and ⌘I now share one shell
  and accent. Each keeps its own form, because they create different
  records.
- **Not done:** J4 (⌘K check-in → the specific check-in) and I2 (a
  size-band sweep of icons). `QuickAddTaskModal` has no callers and is a
  candidate for deletion.
- **Not checked visually:** everything is validated by typecheck, build and
  1009 client tests, but no one has looked at it in a running app yet.
