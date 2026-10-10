# UI/UX design review and upgrade plan

Reviewed 2026-10-10 (a Saturday) against client `1f8569e`, which is unchanged through `db016b4`. Server commits SR-01 to SR-04 landed during the review and do not touch the UI. Evidence is the running app on a scratch database: 313 screenshots in [`screenshots/ux-review/`](screenshots/ux-review/), axe-core runs, a scripted keyboard pass and measured step counts, plus code references. This is a plan only: no application code, styles, schema or data were changed. Item IDs are `UXD-nn`, so they don't clash with `UX-nn` in docs/56.

> Numbering: the brief asked for `docs/71-…`, but `71` (task reliability) and `72` (self-registration) already exist and docs/56 links to both. This doc is `73` so that those references stay unambiguous.

## 1. Verdict and top 10

**LeadOS is a calm, competent product with one strong visual language and three older dialects next to it.** The best surfaces read as one considered system: the Tasks list, Notes, Projects, My Day, Capture, the palette and the public landing page. They share flat hairline lists, 13px rows, one cyan accent and colour that appears only for exceptions. Dark mode parity is genuinely good. The keyboard model is deep. Undo, optimistic writes and virtualised lists are already there (204 tasks render about 23 rows).

What still falls short of "world-class" is mostly **noise and drift, not missing features**:

- **Too many equal-weight actions.** Today's queue shows 12 bordered buttons in one column ([10-today-desktop-light](screenshots/ux-review/10-today-desktop-light.jpg)). Every row shouts, so no row leads.
- **Three older dialects.** Work, Settings and the Setup Wizard still use uppercase tracked eyebrows, letter-prefixed chips, monospace dates and the legacy amber Desk accent ([10-work](screenshots/ux-review/10-work-desktop-light.jpg), [40-work-triage](screenshots/ux-review/40-work-triage-desktop-light.jpg), [80-settings-team](screenshots/ux-review/80-settings-team-desktop-light.jpg), [01-setup-step1](screenshots/ux-review/01-setup-step1-desktop-light.jpg)). The code has 133 `uppercase` uses in 61 files.
- **Today composition.** 7 of the 12 queue rows are Jira defects. A meeting at 16:30 is flagged "Needs outcome" at 14:10. One meeting appears in both the queue and My plan. The nav badge says "Today 16" while the page says "Queue 12" (82 vs 12 under heavy load).
- **Small-but-everywhere accessibility gaps.** The header Capture button is 3.68:1 (axe, every page, light). The palette lets Tab escape to `<body>`. There is no skip link, every page has two `<h1>`s, and phone header targets are 32px.
- **Too many steps for routine edits.** Rows have no inline date, owner or priority controls, so rescheduling takes 3 clicks and moving a task to a project takes 4.

**Overall: 7.5/10** (docs/UX-REVIEW graded it 7/10 two weeks ago; its P0/P1 list is done). The foundation is right. The upgrade is subtraction plus one consistent pass over the older surfaces.

### Top 10, ranked by impact ÷ effort

| # | Change | Evidence | Impact | Effort | Item |
|---|---|---|---|---|---|
| 1 | Contrast and landmark fixes: Capture fill uses `--accent-solid`, Notes chip and Settings avatar text, palette focus trap, skip link, one `<h1>` | axe on 9 routes; keyboard script §6.4 | High | S | UXD-01, UXD-07 |
| 2 | Quiet row actions: one bordered action per list, the rest ghost | Today 12 bordered buttons; wrap-up; Team drawer | High | S | UXD-04, UXD-11 |
| 3 | Today composition: at most 3 defect rows plus one aggregate row, meetings flagged only after they end, no queue/plan duplicates, nav count = queue count | [10-today](screenshots/ux-review/10-today-desktop-light.jpg), [93-heavy-today](screenshots/ux-review/93-heavy-today-desktop-light.jpg) | High | M | UXD-10 |
| 4 | Tasks toolbar: Project filter joins the toolbar (saves a 54px band), one-row phone toolbar | [10-tasks](screenshots/ux-review/10-tasks-desktop-light.jpg), [10-tasks-phone](screenshots/ux-review/10-tasks-phone-light.jpg) | High | S | UXD-12 |
| 5 | Inline row edit for date, owner and priority (3 clicks → 2) | row has only done/open/⋯ (measured) | High | M | UXD-13 |
| 6 | One type scale (19 sizes → 6) and sentence-case labels everywhere | grep §3.1; Settings/Work/Wizard shots | High | M | UXD-02, UXD-03 |
| 7 | Work table and triage panel on the shared idiom: severity as text, no amber, no letter-prefixed chips, no empty columns | [10-work](screenshots/ux-review/10-work-desktop-light.jpg), [40-work-triage](screenshots/ux-review/40-work-triage-desktop-light.jpg) | Med-High | M | UXD-20, UXD-21 |
| 8 | Header: a user menu holds theme, shortcuts, settings and sign-out; 44px phone targets; one-row tablet header | 3-row tablet header; sign-out only in Settings | Medium | M | UXD-06 |
| 9 | Toasts at bottom-right (they currently cover Capture); friendly error copy; branded boot error | [54-toast-undo](screenshots/ux-review/54-toast-undo-desktop-light.jpg), [90-error-*](screenshots/ux-review/90-error-api-down-cold-desktop-light.jpg) | Medium | S | UXD-07, UXD-27 |
| 10 | Move to project in 2 clicks; the palette finds projects | 4 clicks measured; "atlas" returns no project | Medium | S/M | UXD-16, UXD-26 |

**Keep; do not break:** the Tasks list idiom (flat sections, 13px rows, muted mono keys, lingering rows, Undo); Capture with the grammar preview chips; the palette; Notes (CodeMirror, Saved · time, Turn into…, Wrap up); Projects directory; My Day; Standup wrap-up's two-column "follow-through / team recap"; the drawer property list; dark-mode palette; reduced-motion handling (`MotionConfig` at root); URL-as-state; virtualised lists; the landing page.

## 2. Design principles: "LeadOS good taste"

Derived from the best current screens (Tasks list, Notes, Projects, My Day, the landing replicas).

1. **One accent, one job.** Cyan means "you can act here" or "you are here". Red means a missed deadline or a blocked person, amber means something is slipping, and nothing else gets colour. No amber brand and no glows.
2. **Quiet until needed.** Secondary actions are ghost text. A border or fill appears on hover or focus, or on the one featured row. One solid button per dialog and one bordered action per list.
3. **Hairlines, not boxes.** Lists are flat with 1px dividers. Cards are only for real objects (a project, a person, a dialog). Never put a card inside a card, and never put a dashed box around an empty field.
4. **Sentence case, plain counts.** "Queue 12", not "QUEUE · 12". Uppercase is allowed only in kbd caps and palette or menu group labels.
5. **Six type sizes, three weights.** 11 / 12 / 13 / 15 / 19 / 24px at weights 400 / 500 / 600. Rows are 13px. A page has one 19px title.
6. **Say it the manager's way.** No ISO dates, raw enums (`open`, `TO DO`), internal names (Desk, System, Tracker, Arm) or developer-speak.
7. **One line answers what, when and who.** A row carries at most three metadata items at 1280px. Everything else lives in the drawer, and context the page already implies is not repeated (for example the project name inside its own project).
8. **Motion answers actions.** Transitions last 120–180ms with `--ease-out` and respect reduced motion. Drawers don't blur the list they annotate, and toasts never cover primary chrome.

## 3. Foundation findings and changes

### 3.1 Tokens

| Token area | Current (evidence) | Proposed | Consumed in |
|---|---|---|---|
| **Type scale** | 19 sizes in use. Tailwind arbitrary sizes: 12px ×647, 13px ×307, **12.5px ×142**, 11px ×119, 14px ×19, 15px ×12, 13.5/11.5 ×10 each, plus 10–32px one-offs. CSS adds 11.5/12.5/13.5/14.5/15.5. Half-pixel steps blur the hierarchy. | Add `--fs-11` 11/16, `--fs-12` 12/18, `--fs-13` 13/20, `--fs-15` 15/22, `--fs-19` 19/26 and `--fs-24` 24/30 to `index.css`, plus a Tailwind `fontSize` map (`text-meta`, `text-ui`, `text-body`, `text-title-sm`, `text-title`, `text-display`). Mapping: 10–11.5 → 11 (meta) or 12 (controls); 12.5 → 12 for controls and buttons, 13 for reading text; 13.5 → 13; 14–14.5 → 15 for titles, otherwise 13; 16–18 → 15; 20 → 19; 26–28 → 24. The landing page is exempt. | Every `text-[Npx]`, `ui-btn*` (12/12.5 → 12), `ui-dialog-title` (14.5 → 15), `TodayCountBadge` (10.5 → 11), `my-day` greeting (26/28 → 24) |
| **Weights** | 400/500/550/600/700 (`ui-chip` 550, `font-bold` in Settings/Work) | 400 body, 500 labels and controls, 600 titles and names. 550 → 500, 700 → 600. | `.ui-chip`, `SettingsPanel`, `DefectTable` |
| **Radius** | Tailwind `rounded-lg` ×291, `xl` ×158, `md` ×157, plus arbitrary 9/12/14/16/18/20/24/28px (47 uses). CSS adds 4–16px. Header controls are 10–12px, `ui-btn` is 7px, `ui-field` is 8px. | Four steps: chip 6px (`rounded-md`), control 8px (`rounded-lg`, also `ui-btn`, `ui-icon-btn`, header buttons and search), card 12px (`rounded-xl`), overlay 16px (`rounded-2xl`), plus `full` for avatars and pills. Remove every `rounded-[Npx]`. | `index.css` `.ui-btn*` / `.ui-icon-btn` / `.header-*`, `SetupWizard` (24px cards, pill inputs), `QuickAdd`/`Availability` (24px) |
| **Elevation** | `.dashboard-panel` and `.my-day-section` use gradient fill, `--panel-shadow` and `backdrop-filter: blur(12px)`. Cards carry `--soft-shadow`. Drawers blur the list behind (`--scrim-blur`). | e0 flat with a hairline (lists, page sections). e1 card = 1px `--border`, no shadow. e2 overlay = `--overlay-shadow` (popover, dialog, toast, Copilot dock). e3 drawer = `--drawer-shadow` over `--scrim-soft` with **no blur**. Dialogs keep `--scrim` and blur. | `.dashboard-panel`, `.my-day-section`, `TaskDrawer`, `DeveloperTrackerDrawer`, Team table card |
| **Accent fill** | `.header-primary-btn` is `--accent` with white text: **3.68:1** (axe, every page, light). `--accent-solid` exists and measures 5.36:1. | `.header-primary-btn { background: var(--accent-solid) }`. Never put text on `--accent`. | `index.css`, `themeTokens.test.ts` |
| **Accent as text** | Notes `.cm-note-chip` text is `--accent` on its tint: **3.08:1** (axe). Task times `15:00` and Work keys `AM-4101` are accent mono bold. | Chip text uses `--accent-text`. Times use `--text-secondary` tabular sans; keys use `--text-muted` mono, as in Tasks. Accent is reserved for interactive or selected elements. | `notes.css`, `TaskListRow`, `DefectTable` |
| **Severity** | `PriorityCell` is a colour-only glowing dot with off-palette pink `#EC4899` and a hover glow (`table/PriorityCell.tsx:1-25`) | Text chip "Sev 1" … "Sev 4". Sev 1 uses `tone-danger`, Sev 2 `tone-warning`, Sev 3 and 4 a quiet chip. No glow and no pink. | `PriorityCell`, triage header |
| **Priority** | The list shows a black filled flag; the drawer shows a red flag and red "High" ([22-task-drawer](screenshots/ux-review/22-task-drawer-desktop-light.jpg)) | High = filled flag in `--text-primary` everywhere, with "High" in primary text. Red is for deadlines only (docs/51 D1). | `TaskDetailFields`, `TaskListRow` |
| **Overdue** | Every overdue row carries a filled amber pill, so 63 rows become a wall ([93-heavy-tasks-my](screenshots/ux-review/93-heavy-tasks-my-desktop-light.jpg)) | Inside the "Overdue" group, show days as `--task-warning-text` text with no fill; the group label already states the state. Keep the pill elsewhere. | `TaskListRow`, `task-list.ts` |
| **Amber** | `--md-accent` is used in 31 files, including canonical surfaces: Setup Wizard, the triage "Add task" card, `TrackerItemRow`, `TaskTimeline`, `my-day` | Use `--md-accent` only under `components/manager-desk/` (legacy `/desk`). Elsewhere use `--accent` or a tone. | UXD-08 file list |
| **Kbd glyphs** | 28 hard-coded `⌘` strings in TSX bypass `formatShortcutKeys`, so Linux sees "Ctrl+K" in the header but "⌘I", "⌘⇧F" and "⌘⇧E" elsewhere | Route every shortcut string through `KeySpec` or `formatShortcutKeys` | `TaskListStates`, `NotesSidebar`, `CaptureBox`, Notes hints |

### 3.2 Shared primitives (`components/ui/`)

Current state: `Dialog`, `Popover`/`MenuItem`, `Kbd`, `ShortcutSheet`, `Avatar`, `DevStatus`, `SectionHeader`, `EmptyState`, `IconButton` and `QueryReadError`, plus CSS classes `ui-btn*`, `ui-chip`, `ui-field`, `ui-tabs` and `ui-segment`. Gaps that cause drift:

| Primitive | Why (evidence) | Spec |
|---|---|---|
| `PageHeader` | Page titles run 13px (Settings section title), 19px (Tasks/Team) and 13px plus subtitle (Work: "Work / Defects, owners, due dates"). `.ui-page-title` has only 4 consumers. | `<PageHeader title count? actions? />`: a 52px row with a 19px/600 title, plain count and right-aligned actions; an optional 44px toolbar row below. Consumers: Tasks, Team, Work, Settings (section title), 1:1s, Weekly review. |
| `ui-label` (CSS) | 66 tracked uppercase labels (`letter-spacing ≥ .06em`) in Settings, Work, Triage, Wizard, review.css, standup.css and Today wrap-up | 11px/500, `--text-muted`, sentence case, count after a space. Replaces `.triage-section-label` and the Settings/Wizard eyebrows. `SectionHeader` stays for 13px section titles. |
| `ui-row-action` (CSS) | Bordered `ui-btn` repeated on every row (Today queue ×12, wrap-up, plan) | 28px ghost button with `--accent-text` and no border. It gets the `ui-btn` inset ring when the row is hovered, focused or `[data-featured]`. On `(pointer: coarse)` it is 44px. |
| `Select` | 23 files use bare `<select>`: the Tasks Project filter (37px, browser chrome), Standup status, Settings | Keep the native element for accessibility, styled as `ui-field` (36px, 8px radius, chevron icon, focus ring). |
| Row focus vs featured | Today's featured first row and a keyboard-focused row both get a tint plus a 3px left bar, so two rows look selected ([70-keyboard-today-jj](screenshots/ux-review/70-keyboard-today-jj-desktop-light.jpg)) | Featured gets a 6% tint and no bar; focus gets the bar plus an 8% tint (`.ui-row-focus`). |

### 3.3 App shell, header and navigation

| Finding | Evidence | Change |
|---|---|---|
| Two `<h1>`s per page ("LeadOS" and the page title); no skip link | keyboard script: `h1s on tasks: ['LeadOS','Planned today']`, `skip links: 0` | Wordmark becomes a link to `/`; add a "Skip to content" link targeting `<main id="main">`. Team, Work and Settings lack `<main>` (axe `landmark-one-main`); Team and Weekly review have duplicate banners. |
| Six right-side controls (Copilot, shortcuts, theme, settings, Capture, plus search) and no identity or sign-out outside Settings | [10-today](screenshots/ux-review/10-today-desktop-light.jpg); sign-out sits at the bottom of the Settings rail | Header keeps Search, Copilot and Capture, and adds an **avatar menu** with Theme (Light/Dark/System), Keyboard shortcuts `?`, Settings and Sign out. That removes 3 icons. |
| The Today badge disagrees with the page | "Today 16" vs "Queue 12"; heavy load 82 vs 12. `TodayCountBadge` reads `manager-actions totalCount`. | The badge equals the Today queue total and comes from the same source as the "Queue N" header (UXD-10). |
| Tablet header uses 3 rows (~135px) | [10-today-tablet](screenshots/ux-review/10-today-tablet-light.jpg) | With 3 icons removed, 768–1023px fits on one row (Capture becomes icon-only). |
| Phone targets are 32px; Work's sidebar button clips the wordmark ("LeadO") | touch audit: Today 22/38 controls under 44px, Team 35/35; [10-work-phone](screenshots/ux-review/10-work-phone-light.jpg) | Nav tabs and header buttons get 44px hit areas (padding, not visual size). Work's rail button moves into the Work toolbar. |
| More menu: Esc returns focus to the header container, not the More button (P7-04 still open) | keyboard script | Focus returns to the trigger. Use `Popover` from `ui/`. |

### 3.4 Light/dark, motion, accessibility

- **Parity is good.** The only dark-only issue found is the bright `#06B6D4` header fill next to quiet chrome, which is acceptable. Light mode has all the contrast failures: 3.68 Capture, 3.08 Notes chip, 1.89 Settings avatar initials (amber `#f59e0b` on `#f9f0df`).
- **Motion:** root `MotionConfig reducedMotion="user"` is in place (`main.tsx:22`). Two issues: drawers blur the list behind them (see the elevation row), and programmatic focus on the Standup wrap-up `<h1>` draws a 2px ring box ([32-standup-wrapup](screenshots/ux-review/32-standup-wrapup-desktop-light.jpg)). Use `:focus:not(:focus-visible) { outline: none }` for `tabIndex=-1` headings.
- **Keyboard:** the Today stage-strip buttons ("1 defect due", "1 follow-up") show **no focus ring**. The palette loses focus to `<body>` on every second Tab. Capture keeps focus but restores it to `<body>` on Esc. Today `j/k` and Tasks `j/k` work and are visible.
- **200% zoom** (720px CSS viewport) does not scroll horizontally on Today or Tasks ([92-zoom200-*](screenshots/ux-review/92-zoom200-today-light.jpg)).

## 4. Click-count audit

Counted from a fresh page load in the seeded workspace. **M** = performed by script, **C** = counted on screen. Rows marked ⚠ take more than 3 steps where 1–2 should do.

| # | Job | Current (mouse) | Current (keys) | Ideal | Friction |
|---|---|---|---|---|---|
| 1 | Capture a task | 2 clicks + typing (M) | Ctrl+I, type, Enter (M) | same | None. `#atlas` is read as a Jira key and warns "isn't recognized" even though a project of that name exists ([50-capture-preview](screenshots/ux-review/50-capture-preview-desktop-light.jpg)). |
| 2 | Mark a task done | 1 on the status circle in Tasks or My plan (C) | `j…` then `e` | 1 | — |
| 3 | Reschedule or defer | 3: ⋯ → Schedule… → Tomorrow (M); drawer also 3 | focus row, `s`, `m` | **2**: click the row date → pick | The row exposes only Done/Open/⋯ (M); the date isn't clickable |
| 4 ⚠ | Plan today from Inbox | Tasks → Inbox → tick rows → Schedule → Today = 4 + 1 per row (C) | `g i`, `x`…, `s t` | 2 + 1 per row | Today's "4 to triage in Inbox" link leaves the page; no inline triage |
| 5 | See what needs attention | 0 clicks, but 12 queue rows + 6 plan rows + 3 panels to scan; 7/12 queue rows are defects (C) | — | 0 clicks, ≤8 queue rows | Defect flood, a not-yet-held meeting flagged, duplicate rows (UXD-10) |
| 6 | Add a note | Notes → click editor = 2 (C) | Ctrl+K "notes" ↵ | 1 | — |
| 7 | Follow-up or task from a note | Turn into… → Task → Capture = 3 (C) | caret, Ctrl+Shift+E, Enter (M) | 2 | Good |
| 8 | Check on a teammate | Team → row = 2 (M) | Ctrl+K name ↵ | 2 | Drawer meta lines are noisy (§5.10) |
| 9 ⚠ | Run a 1:1 | Team → 1:1s → person → Start = 4 (C) | Ctrl+K "1:1 priya" ↵, Start | 2 | Not checked: whether Today offers a "Start" row when a 1:1 is due today (none was due in the seed) |
| 10 | Run standup | Today (morning) → Start standup = 1; Team → Standup = 2 (C) | — | 1 | — |
| 11 ⚠ | Add a task to a project | ⋯ → Move to project… → pick → Move = 4 (M) | none | **2**: ⋯ → Project ▸ pick, with Undo | The dialog preselects "No project" and its primary reads "Remove from project" for a task that has none ([24-tasks-move-to-project](screenshots/ux-review/24-tasks-move-to-project-desktop-light.jpg)) |
| 12 | Find anything | Ctrl+K, type, ↵ (M) | same | same | Projects and tracks aren't indexed ("atlas" → tasks and a note only) |
| 13 | Change priority, owner or date | ⋯ → Priority… → High = 3 (C); drawer 3 | `p` / `a` / `s` on focused row = 2 | **1–2** | No inline edit on rows (UXD-13) |
| 14 ⚠ | Triage a Jira defect from Today | "Assign owner" → Work (`?filter=unassigned`) with the issue panel open, but the list read "0 visible defects" → pick person chip → type a description → Add = 4+ (M) | — | 2: owner picker on the row | The label promises a Jira assignment the app can't make (docs/53 F8 still open) ([12-today-assign-owner-result](screenshots/ux-review/12-today-assign-owner-result-desktop-light.jpg)) |
| 15 | Review the week | Ctrl+K "weekly" ↵, then 6 steps, ≥8 clicks | — | same | Progress is shown three ways (bar, "Step 1 of 6", numbered rail) |

**Prioritised friction fixes:** inline row edit (#3, #13) → UXD-13; Move to project submenu (#11) → UXD-16; Today composition and "Assign owner" honesty (#5, #14) → UXD-10; Today Inbox count opens the Inbox view in a drawer-sized panel without leaving Today (#4) → **deferred** (open question §10). Missing shortcuts: no key for "move to project" (propose `m`, free in the list map); no global `g`-chord outside Tasks (leave as is: the palette covers it).

## 5. Screen-by-screen review

Each entry gives what works, what doesn't (with a screenshot), the change, and impact/effort.

### 5.1 Landing and sign-in: keep

**Works:** confident type, a real live capture demo, product replicas, a clean sign-in dialog and deep-link sign-in ([00-landing](screenshots/ux-review/00-landing-desktop-light.jpg), [00-signin-dialog](screenshots/ux-review/00-signin-dialog-desktop-dark.jpg)). The landing's Today replica (one action per row, "Needs you · 2") is a cleaner Today than the real one, and it is the target for UXD-10/11.
**Doesn't:** the Copilot placeholder says "Ask about your team, work, or desk…" (also `AssistantComposer.tsx:78`, `MessageList.tsx:177`).
**Change:** say "…team, tasks or notes…" (UXD-29). Impact low, effort S.

### 5.2 Setup Wizard: second dialect

**Doesn't:** amber accent throughout, uppercase "WORKSPACE SETUP / STEP 1 OF 2 / USERNAME", 46px pill inputs, Title Case "Create Account", and two step chips both labelled "with Jira" ([01-setup-step1](screenshots/ux-review/01-setup-step1-desktop-light.jpg), [01-setup-step2](screenshots/ux-review/01-setup-step2-desktop-light.jpg)).
**Change:** cyan tokens, `ui-field` inputs, sentence case, step chips "Account · Jira · Owner mapping · Team". Medium impact (first impression), effort S/M. UXD-25.

### 5.3 Header, navigation and More menu

See §3.3. Desktop layout after UXD-06:
```
[■ LeadOS]  Today 12  Tasks  Team  Work  Notes  [ Search or jump to…  Ctrl K ]  ✦  [+ Capture]  (MP)
                                                                         avatar menu: Theme · Shortcuts ? · Settings · Sign out
```
High impact (every page), effort M.

### 5.4 Today

**Works:** the stage strip (one line), the featured first row, keyboard triage, wrap-up swapping to the main column with "Done · Tomorrow · Drop" and "Move the rest to tomorrow · 12" ([11-today-wrapup](screenshots/ux-review/11-today-wrapup-desktop-light.jpg)), and the morning Standup card.
**Doesn't:**
- The queue is 7/12 Jira rows, 3 of them "Assign owner" ([10-today](screenshots/ux-review/10-today-desktop-light.jpg)).
- "Atlas go/no-go review" at 16:30 shows "Needs outcome" at 14:10; `buildMeetingActions` (`today.service.ts:1557`) sets the signal without checking `endsAt`.
- "Architecture sync" appears in both the queue and My plan.
- The action column is 12 cyan-outlined buttons, and "Open issue" is the only borderless one.
- "Updated 0 seconds ago".
- At wrap-up the side queue truncates titles to about 8 characters ("Marcu…", "AM-4101 Chec…").
- Phone queue titles clip at the right edge with no ellipsis ([10-today-phone](screenshots/ux-review/10-today-phone-light.jpg)).
- The stage-strip buttons have no focus ring.

**Change (UXD-10, UXD-11):**
```
Queue 9                                                     3 done today
▌Marcus Lee · Blocked — waiting on sandbox keys · 1h        [Follow up]  ⋯   ← featured: the only bordered action
 ETA for the payments sandbox keys · Overdue Fri             Done        ⋯   ← ghost actions
 AM-4101 Checkout fails with promo + gift card · Overdue     Open        ⋯
 …
 4 more defects need an owner or are overdue                 Open Work →
```
High impact, effort M.

### 5.5 Tasks list and views

**Works:** flat sections, rail counts, Move all to today, bulk bar with key hints ([23-tasks-bulk](screenshots/ux-review/23-tasks-bulk-desktop-light.jpg)), row menu with accelerators, Waiting grouped by person, Meetings buckets.
**Doesn't:**
- A full-width "Project [All projects ▾]" band (native select, 54px) on every view, even in a workspace with no projects ([02-empty-tasks](screenshots/ux-review/02-empty-tasks-desktop-light.jpg)).
- The keyboard icon floats on its own row on phones ([10-tasks-phone](screenshots/ux-review/10-tasks-phone-light.jpg)).
- Waiting rows carry 5–6 metadata items ("Check 1d late" + "Waiting since today" + bell + "You" + "4d overdue"), with two lateness signals on one row ([20-tasks-view-waiting](screenshots/ux-review/20-tasks-view-waiting-desktop-light.jpg)).
- Meeting rows show both "Capture outcome" and "Needs outcome".
- Times are accent mono bold.
- Inside a project, every row repeats "Atlas payments migration / Migration" ([21-projects-detail](screenshots/ux-review/21-projects-detail-desktop-light.jpg)).

**Change:**
```
Planned today 10                         [Search this view /] [Project: All ▾] [View options]
```
Hide project context when the list is project-scoped. Waiting rows show at most "Check 1d late · Marcus". Meeting rows get one tone-dot action. UXD-12/13. High impact, effort S/M.

### 5.6 Task drawer and task page

**Works:** property list, "No one / Set a time / No deadline" muted empties, `j/k` stepping, full-page view ([22-task-drawer](screenshots/ux-review/22-task-drawer-desktop-light.jpg), [22-task-page](screenshots/ux-review/22-task-page-desktop-light.jpg)).
**Doesn't:**
- A permanent two-line shortcut legend in the drawer and again on the page.
- Priority shows in red.
- "▶ Subtask project · inherits parent unless changed" (native disclosure plus jargon).
- The activity "Mentioned in note on 2026-10-10: turday catch-up / - [] Ask Tom…" is cut mid-word from the raw markdown (`daily-notes.service.ts:641` slices ±80 characters) and attributed to "System (maya)".
- The drawer blurs the list behind it.

**Change:** a "Shortcuts ?" link in the drawer header instead of the legend; neutral priority; subtask project as a tooltip on "Subtasks"; excerpts trimmed to the whole note line with markdown stripped and a friendly date ("Sat 10 Oct · from your note"); no blur. UXD-14. Medium impact, effort S/M.

### 5.7 Projects and tracks: keep, with one fix

The directory and detail pages are calm and readable ([21-projects-directory](screenshots/ux-review/21-projects-directory-desktop-light.jpg)). "Next check · Oct 9" is shown in accent while already past; use warning text when it's in the past. The native "▶ Latest summary" disclosure should be a chevron button. UXD-12 covers the repeated path. Low-medium impact, effort S.

### 5.8 Capture, palette and Copilot

**Capture works:** preview chips, typeahead names, bottom sheet on phone ([50-capture-preview-phone](screenshots/ux-review/50-capture-preview-phone-light.jpg)).
**Capture doesn't:** the warning for `#name` is amber and implies an error; "Add to a project" uses a native ▶; the footer hint wraps to two lines.
**Palette:** good grouping, but no project results, and Tab escapes the dialog ([51-palette-query](screenshots/ux-review/51-palette-query-desktop-light.jpg)).
**Copilot dock:** a clean empty state ([52-copilot](screenshots/ux-review/52-copilot-desktop-light.jpg)); live use not verified.
**Change:** UXD-15 (copy and disclosure), UXD-07 (trap), UXD-26 (projects in search). Medium impact, effort S.

### 5.9 Team board

**Works:** scannable table, status chips only for exceptions, left bars on at-risk/blocked rows, a skeleton that matches the layout ([91-loading-team](screenshots/ux-review/91-loading-team-desktop-light.jpg)).
**Doesn't:**
- "Nothing planned" repeated 5 times in Up next.
- A 5-segment meter for "1 open".
- The toolbar appears only after load, shifting rows by about 44px.
- On phone, 300px of chrome sits above the first person ([10-team-phone](screenshots/ux-review/10-team-phone-dark.jpg)).

**Change:** a muted "—" for empty Up next; show the meter only when there are 2 or more items; render the toolbar skeleton too; on phone, collapse the count chips into the search row. UXD-22. Medium impact, effort S.

### 5.10 Team drawer and 1:1 workspace

**Drawer doesn't:**
- Raw status words ("open · Updated 9m ago · Undated · Next check not scheduled").
- The blocked card mixes a bordered "Set check" with a text "Follow up".
- "Current work" is a dashed empty box with no action ([30-team-drawer](screenshots/ux-review/30-team-drawer-desktop-light.jpg)).

**1:1 workspace** renders under the Team board toolbar (search and Standup don't apply there), and shows Ctrl+Shift kbd footers on touch ([31-one-on-one](screenshots/ux-review/31-one-on-one-desktop-light.jpg)).
**Change:** `TASK_STATUS_META` labels; drop negative meta ("Undated", "not scheduled"); "Follow up" as the one primary; "Start a planned task" as a ghost action; hide the board toolbar when `panel=one-on-one`. UXD-22. Medium impact, effort S/M.

### 5.11 Standup

**Works:** focused full-screen mode with no global header, wrap-up "Your follow-through / Team recap" ([32-standup-wrapup](screenshots/ux-review/32-standup-wrapup-desktop-light.jpg)).
**Doesn't:**
- A native `<select>` for status.
- Uppercase "ORDER" and "CURRENT".
- The current task is shown twice (row plus card).
- The keyboard footer shows on phones ([32-standup-phone](screenshots/ux-review/32-standup-phone-light.jpg)).
- The wrap-up `<h1>` shows a focus box.

**Change:** a `DevStatusMark` menu, sentence case, one work card, footer hidden on `(pointer: coarse)`. UXD-23. Medium impact, effort S.

### 5.12 Work (defects) and triage

**Doesn't:**
- Uppercase headers.
- A `DUE DATE` header that wraps.
- Always-empty TAGS and LINKED columns.
- Accent mono keys.
- Colour-only severity dots with glow.
- Lavender "To Do" pills.
- Tile sub-labels that add nothing ("active", "24h", "moving").
- "0 FOCUS".
- "WORKLOAD … · load 0" ([10-work](screenshots/ux-review/10-work-desktop-light.jpg)).

The triage panel adds:
- Uppercase sections.
- Letter-prefixed chips ("P Highest", "A Marcus Lee", "D Oct 8").
- An amber "AM-4101 Marcus Lee [Add task]" card.
- ISO dates in suggestions ("2026-10-14 → 2026-10-11") ([40-work-triage](screenshots/ux-review/40-work-triage-desktop-light.jpg)).

On phone, the tiles take 230px ([10-work-phone](screenshots/ux-review/10-work-phone-light.jpg)).
**Change (UXD-20/21):**
```
Work   All 11 · New 0 · Due today 1 · Overdue 3 · In progress 3          Signals 5   Views ▾
Sev    Key       Title                                   Assignee        Due        Status
Sev 1  AM-4101   Checkout fails with promo + gift card   (ML) Marcus Lee  Thu 8 Oct  ● To do
```
Preserve all defect dashboard behaviour, filters and saved views. Medium-high impact, effort M.

### 5.13 Notes: keep

The calmest screen ([10-notes](screenshots/ux-review/10-notes-desktop-light.jpg)). Fix the T-chip contrast (3.08:1) and the "⌘⇧F" glyph on non-Mac. Low impact, effort S.

### 5.14 Settings

**Doesn't:**
- The section title is 13px while its groups are 11px tracked uppercase ("TEAM MODE", "TRACKED TEAM"), so the hierarchy is inverted.
- Copy remnants: "used in Team, Desk, and developer access", "43 desk tasks", "TYPE CLEAR MANAGER DESK TO CONFIRM", "Arm Reset", "The standard Save footer is intentionally hidden here."
- Jira shows a green "127.0.0.1:9" for a host that has never synced.
- The avatar initials are 1.89:1 ([80-settings-team](screenshots/ux-review/80-settings-team-desktop-light.jpg), [81-settings-destructive-dialog](screenshots/ux-review/81-settings-destructive-dialog-desktop-light.jpg)).

**Change:** `PageHeader` for the section title, `ui-label` groups, a copy pass (typed phrases stay server-checked; only the visible label becomes "Type CLEAR MANAGER DESK to confirm"), neutral Jira status until a sync succeeds, and sidebar group headings Workspace / People / Integrations / Data (the cheap half of P7-07). UXD-24. Medium impact, effort M.

### 5.15 My Day (developer): keep

Clear "Now / Up next / Check in", good phone layout ([95-myday](screenshots/ux-review/95-myday-desktop-light.jpg), [95-myday-phone](screenshots/ux-review/95-myday-phone-dark.jpg)). The only change is the amber "From your lead" label (part of UXD-08).

### 5.16 Weekly review: keep

Clear steps and a pinned footer ([60-weekly-review](screenshots/ux-review/60-weekly-review-desktop-light.jpg)). Uppercase "MINE · 4", "JIRA" → `ui-label` (UXD-03). Drop the redundant "Step 1 of 6" text; the rail and bar already say it.

### 5.17 Toasts, confirmations, empty, loading and error states

- The Undo toast sits top-right **over the Capture button** ([54-toast-undo](screenshots/ux-review/54-toast-undo-desktop-light.jpg)).
- The destructive card uses "Arm Reset", then a typed phrase.
- Empty states are good: Tasks, Team (inline "Add person"), Notes ([02-empty-*](screenshots/ux-review/02-empty-today-desktop-light.jpg)).
- Errors show raw server text ("boom") ([90-error-tasks-500](screenshots/ux-review/90-error-tasks-500-desktop-light.jpg)), a terse "Today didn't load", and a cold boot with no shell or brand: "Could not load setup" ([90-error-api-down-cold](screenshots/ux-review/90-error-api-down-cold-desktop-light.jpg)).

**Change:** UXD-07 (toasts bottom-right, above the Copilot dock z-order), UXD-27 (error copy map: "Couldn't load Inbox. Check your connection, then retry." with server detail behind "Details"; a branded boot error page).

## 6. Cross-cutting issues

### 6.1 Consistency divergences

| Pattern | Divergence | Fix |
|---|---|---|
| Section labels | Sentence case (Tasks, Today, Notes) vs uppercase tracked (Settings, Work, Triage, Wizard, Review, Standup, wrap-up) | `ui-label` (UXD-03) |
| Primary row action | Bordered tinted (Today, wrap-up "Done", Tasks "Capture outcome") vs text (Today "Open issue", wrap-up "Tomorrow/Drop") | `ui-row-action` (UXD-04) |
| Disclosures | Native `▶ <details>` in Capture, drawer subtasks, project summary, Today row menu (11 files) vs chevron buttons elsewhere | Chevron `ui-btn-ghost` + `aria-expanded` (UXD-05) |
| Selects | Native browser-styled selects in 23 files | `Select` primitive (UXD-05) |
| Chips with prefixes | Work triage "P/A/D" letter chips vs `Avatar`/icon chips in Tasks | Icon chips + `Avatar` (UXD-21) |
| Keys | Accent mono (Work, task times) vs muted mono (Tasks) | Muted mono (UXD-01/20) |
| Kbd glyphs | `⌘` hard-coded ×28 vs `formatShortcutKeys` | `KeySpec` everywhere (UXD-05) |
| Accent | Amber in Wizard, triage card, tracker rows, timeline, My Day | Cyan/tone (UXD-08) |
| Inline styles | 2,118 `style={{` occurrences make drift easy | Don't rewrite. New and touched code uses classes and tokens; lint is a non-goal |

### 6.2 Microcopy

Replace "Updated 0 seconds ago" → "Updated just now"; "Assign owner" (navigates) → "Open in Work"; "Arm Reset" → "Reset…"; "System (maya)" → "From your note"; raw `open` / `blocked` / `TO DO` → status labels; "Subtask project · inherits parent unless changed" → "Subtasks use this task's project"; "Danger zone" stays; "Desk" (5 live strings, §5.1/5.14) → Tasks; ISO dates in suggestions and activity → "Wed 14 Oct". The tone is good elsewhere: Projects, Capture and My Day copy is plain and direct.

### 6.3 Responsive

- **Phone:** header targets 32px → 44px; Today rows clip without ellipsis; the Tasks toolbar takes 3 rows (select + title, search + options, kbd icon) plus the Project band, so the first task starts at y≈345; Work tiles take 230px; kbd footers show on touch (Standup, 1:1, drawers).
- **Tablet:** the header uses 3 rows; at 768px the Tasks rail stays and squeezes rows to two lines.
- No horizontal page scroll at 375px except a text overflow flagged on Work.

### 6.4 Accessibility summary (axe and keyboard)

axe (WCAG 2.1 AA + best practice) on 9 routes × (desktop light, desktop dark, phone light):

- Dark: clean apart from landmarks.
- Light: `color-contrast` serious at 1–2 nodes per page (Capture 3.68, Notes chip 3.08, Settings avatar 1.89).
- `landmark-one-main` on Team, Work and Settings; `landmark-no-duplicate-banner` on Team and Review; `region` 28–33 nodes on Team and Work; `empty-table-header` ×2 on Work.

Keyboard: no skip link; palette trap leaks; stage-strip focus is invisible; More menu focus is not restored; Capture and palette restore focus to `<body>` when opened by shortcut (acceptable, but better to restore the previously focused element). Toasts are announced (`role="alert"` for errors; P7-01).

### 6.5 Performance feel

Lists are virtualised (Tasks rendered 23 of 204 rows). Dev-mode route loads were 2.0–3.8s including `networkidle`, which is not representative. Visible shifts: the Team toolbar appears after data loads (+44px), and the Tasks "Project" band renders before the list. Today keeps a session snapshot, so it paints instantly on revisit. There are no flashes of empty content in the loading states that were seen.

## 7. Status of earlier reviews

| Review | Done (verified ✓ in app, or per docs/56 ticks) | Not done | Stale |
|---|---|---|---|
| [UX-REVIEW](UX-REVIEW.md) (10-04) | P0-1…P2-12 via UX-01…35. Seen ✓: header subtitle gone, Today count on nav, inbox icon (collab only), wrap-up in the main column, Work OPEN column gone, Settings opens on Navigation, 1:1 overview dates, zero-roster Team | UX-36…40 (Batch J: Start-here clusters, Copy nudge, 1:1 templates, Recent changes, contextual Copilot). Partial: UX-31 "tags only when present" (the TAGS column still renders empty) | — |
| [51 Tasks](51-tasks-workspace-review.md) | F1–F16, F19, U1, A1–A5, R1–R3, D2 (flat sections), D6 (mentions) ✓ | U3 hint footer; D3 empty meta columns; F17 search by owner (not verified); R4 long-press; P3 virtualisation ✓ was done later (P02) | U2 (actions overlaying the date): the row now has fixed controls |
| [52 Notes](52-notes-screen-review.md) | F1 CodeMirror, F2/F3 merge, U2 sidebar, U3 steady save, D4 "Turn into…", F9 "From this note", day context strip, EOD wrap-up ✓ | F12 search highlight and jump-to-match (not verified) | "Bare textarea" findings |
| [53 Today](53-today-screen-review.md) | F1–F3, F6/F7, D2 one-line strip, U1 band removed, R1/R2 mobile, keyboard ✓ (per docs/63 and seen) | **F8 "Assign owner" still navigates** (seen); **F12 defect flood** (7/12, seen); sync row → broad Settings (not verified) | F17 footer (footer removed) |
| [54 Consistency](54-consistency-audit.md) | §5 says steps 1–16 done; tokens and `ui/` exist ✓ | **V1 palette trap** (fails, §6.4); **V10 eyebrows** remain in 61 files; T3 off-palette `#EC4899`; amber leak (§3.1); J4, I2 | `QuickAddTaskModal` (deleted, WQ-07) |
| [58 One-stop](58-manager-one-stop-review.md) | Canonical start, nav defaults, weekly review, durable inbox (R12) ✓ | Recurrence, telemetry, full person command centre | "Fresh workspace starts legacy" |
| [62 Standup](62-standup-mode-review.md) | STANDUP-01…05; header occlusion fixed ✓ (no global header) | Native status select, uppercase rail, duplicate work card, kbd footer on touch | Feed or retry claims superseded by STANDUP-02/03 |
| [63 Today](63-today-screen-review.md) | Roadmap 1–8 (§13) ✓ | "Update overdue" relabel; Ask-first primary for participants | — |
| [65 Experience](65-application-experience-review.md) | R1–R12 ✓ | — | R7 "header uses 148px on 390px": now about 84px |
| [67 Tracks](67-project-tracks-review.md) | Built as Projects → Tracks (HIER-01…06) ✓, a deliberate superset | — | "No separate Projects" (superseded) |
| [69 Projects UX](69-projects-ux-redesign.md) | PROJ-UX-01…03 ✓ | New: repeated project path inside project lists (§5.5) | — |

Also still open in docs/56: P7-04 (one `<h1>`, More menu keys, phone nav), P7-07 (Settings IA) and P7-10 (1:1 toggle). UXD-06 and UXD-24 absorb the UI half of P7-04 and P7-07.

## 8. Implementation plan

Rules: sequential on `main`, **one commit per item** (`type(scope): summary (UXD-nn)`), tick the item and add a Progress-log row in docs/56 in the same commit. **Every item is checked in a real browser (scratch DB and ports, mocked Jira) in light and dark at 1440px and 375px**, with before/after shots named as in the appendix. Behaviour, data contracts, role boundaries, URL state and the defect dashboard are unchanged unless an item says otherwise. Each phase leaves the app consistent and can ship on its own.

### Phase 1: Foundation (tokens and primitives)

- **UXD-01 Contrast and accent fixes (S)**
  - Scope: `.header-primary-btn` → `--accent-solid`. `.cm-note-chip` text → `--accent-text`. Settings avatar uses `Avatar`. Task times and Work keys stop using accent text.
  - Files: `index.css`, `notes.css`, `SettingsPanel.tsx`, `TaskListRow.tsx`, `DefectTable.tsx`.
  - Accept: axe light shows zero `color-contrast` on the 9 routes. `themeTokens.test.ts` asserts header fill ≥ 4.5:1. Visual check of the header in both themes.
  - Depends on: none.
- **UXD-02 Type scale tokens (M)**
  - Scope: add `--fs-*` and the Tailwind `fontSize` map; replace half-pixel and one-off sizes per §3.1; set weights to 400/500/600.
  - Files: `index.css`, `tailwind.config`, all `text-[Npx]` sites (mechanical, reviewed per folder), feature CSS.
  - Accept: `grep -E "text-\[(10|10\.5|11\.5|12\.5|13\.5|14\.5)px\]"` returns 0. Six sizes are in use (landing exempt). Screens re-shot with no clipped text.
  - Depends on: none.
- **UXD-03 Sentence-case labels (M)**
  - Scope: add `ui-label`; remove uppercase and tracking outside kbd, palette and menu headings.
  - Files: `SettingsPanel`, `DefectTable`, `TriagePanel` and `.triage-section-label`, `SetupWizard`, `review.css`, `standup.css`, `TodayWrapUp`, `FilterSidebar`, `WorkloadBar`, `TrackerItemRow`.
  - Accept: `grep -c uppercase` drops from 133 to ≤ 15 (kbd, palette, menus, legacy `/desk`). Tests asserting uppercase text are updated.
  - Depends on: UXD-02.
- **UXD-04 Row action hierarchy (S)**
  - Scope: add `ui-row-action` (ghost; ring on row hover/focus/featured; 44px on coarse pointers). Separate featured from focus (§3.2).
  - Files: `index.css`, `TodayActionRow`, `TodayWrapUp`, `TodayPlanPanel`, `TaskListRow` (meeting action), `DeveloperDrawerSections`.
  - Accept: Today shows ≤1 bordered action per list at rest. Keyboard focus is distinguishable from the featured row. `TodayPage.test` / `today-triage.test` still pass.
  - Depends on: none.
- **UXD-05 `Select`, disclosure and `KeySpec` adoption (S/M)**
  - Scope: styled native `Select`; a chevron `Disclosure` button replacing `<details>` in Capture, drawer subtasks, project summary and Today menu; all `⌘` strings via `KeySpec`.
  - Files: `components/ui/Select.tsx`, `Disclosure.tsx`, the files listed in §6.1.
  - Accept: no bare `<select>` outside `/desk`. No `⌘` literal in TSX. On Linux, every shortcut reads "Ctrl".
  - Depends on: UXD-02.
- **UXD-06 Shell: header and landmarks (M)**
  - Scope: avatar menu (Theme Light/Dark/System, Shortcuts, Settings, Sign out); wordmark as a link (not `<h1>`); skip link; `<main id="main">` on every page; Today badge = queue total; 44px phone targets; one-row tablet header; Work rail button moved off the wordmark. Absorbs the UI part of P7-04.
  - Files: `Header.tsx`, `HeaderNav.tsx`, `TodayCountLink.tsx`, `DashboardLayout.tsx`, `TeamTrackerPage.tsx`, `SettingsPanel.tsx`, `WeeklyReviewMode.tsx`.
  - Accept: axe shows no landmark violations; one `<h1>` per page; touch audit shows 0 header controls under 44px at 375px; badge equals "Queue N".
  - Tests: `Header.test`, `HeaderInboxMove.test`, `nav-availability.test`.
  - Depends on: UXD-01.
- **UXD-07 Overlay behaviour (S)**
  - Scope: palette focus trap; restore focus to the previously focused element after Capture/palette/More close; drawers use `--scrim-soft` without blur; toasts bottom-right with `z-toast`, clear of the Copilot dock; `tabIndex=-1` headings show no ring; Today stage-strip buttons get a focus ring.
  - Files: `CommandPalette.tsx`, `GlobalCaptureDialog.tsx`, `HeaderNav.tsx`, `TaskDrawer.tsx`, `DeveloperTrackerDrawer.tsx`, `ToastContext.tsx`, `index.css`, `TodayRhythmHeader.tsx`.
  - Accept: the keyboard script's 12 Tabs all stay in the palette; a toast never overlaps the header. Tests: `ToastContext.test`, `CommandPaletteSearch.test`.
  - Depends on: none.
- **UXD-08 Retire amber outside `/desk` (S)**
  - Scope: replace `--md-accent` with `--accent` or a tone in canonical surfaces.
  - Files: `SetupWizard`, `TriageDeskSection`, `TrackerItemRow`, `TrackerDrawerItemRow`, `TaskTimeline`, `my-day/RecentActivity`, `MyDayTaskParts`, `capture-preview.tsx`, `DeskCaptureForm`.
  - Accept: `grep md-accent` matches only `components/manager-desk/` and `index.css`.
  - Depends on: none.

### Phase 2: Daily screens (Today, Tasks, Capture)

- **UXD-10 Today composition (M, server + client)**
  - Scope: at most 3 defect rows plus one aggregate row "N more defects need an owner or are overdue → Work"; meeting "Needs outcome" only after `endsAt` (or start + 30m), before that "At 16:30" without an action; a task in the queue isn't repeated in My plan; "Assign owner" → "Open in Work" and lands on the issue with the list filtered to include it; header badge = `queue.total`.
  - Files: `today.service.ts` (`buildIssueActions`, `buildMeetingActions`, ranking), `today-layout.ts`, `TodayActionQueue.tsx`, `useManagerActions`.
  - Accept: seeded workspace shows ≤ 9 queue rows, no future meeting flagged, and no title in both queue and plan.
  - Tests: server `today` service tests for the cap, meeting timing and dedupe; client `today-layout.test`.
  - Depends on: UXD-04.
- **UXD-11 Today visual polish (S)**
  - Scope: "Updated just now"; at wrap-up the side queue is title-only compact rows (no chips, no context line); phone rows ellipsize (`min-width:0` on title containers); remove the page keyboard icon (moved to the avatar menu and `?`).
  - Files: `TodayRhythmHeader.tsx`, `TodayActionRow.tsx`, `today.css`.
  - Accept: at 1440px wrap-up, side-queue titles show ≥ 30 characters; at 375px no text runs past the row edge.
  - Depends on: UXD-04, UXD-06.
- **UXD-12 Tasks toolbar and row density (S/M)**
  - Scope: the Project filter becomes a toolbar chip/popover (`Project: All ▾`) and the 54px band goes; phone toolbar is one row; project context hidden in project-scoped lists; Waiting rows show at most 3 metadata items (one lateness signal); meeting rows show a single action; overdue days as text inside the Overdue group.
  - Files: `TaskToolbar.tsx`, `ProjectFilters.tsx`, `TasksPage.tsx`, `TaskListRow.tsx`, `task-list.ts`.
  - Accept: the first task row's top is at y ≤ 220px at 1440px (now y≈255) and y ≤ 270px at 375px (now y≈345); URL `project=` still works and saved views are unchanged.
  - Tests: `TasksPage.test`, `tasks.test`.
  - Depends on: UXD-05.
- **UXD-13 Inline row edits (M)**
  - Scope: the row date opens `DatePickerPopover`, owner opens the assign menu, the flag opens the priority menu, each with existing Undo; add `m` = Move to project.
  - Files: `TaskListRow.tsx`, `TaskMenus.tsx`, `useTaskListMutations.ts`.
  - Accept: reschedule takes 2 clicks; keyboard map unchanged plus `m`; touch targets are 44px on coarse pointers.
  - Tests: `useTaskListMutations.test`, row interaction tests.
  - Depends on: UXD-12.
- **UXD-14 Drawer and task page polish (S/M)**
  - Scope: legend → "Shortcuts ?" link; neutral priority; subtask-project tooltip; note-ref excerpts are whole lines with markdown stripped, a friendly date and "From your note".
  - Files: `TaskDrawer.tsx`, `TaskDetailFields.tsx`, `TaskDetailRelations.tsx`, `TaskTimeline.tsx`, `daily-notes.service.ts:641`.
  - Accept: no ISO date or `- [ ]` in activity. Tests: server excerpt unit test, `TaskDrawer.test`.
  - Depends on: UXD-05.
- **UXD-15 Capture copy (S)**
  - Scope: `#name` warning copy "Not a Jira key — kept as text" in muted tone; chevron disclosure; one-line footer hint.
  - Files: `CaptureBox.tsx`, `capture-preview.tsx`.
  - Accept: `CaptureBox.test` passes with the new strings.
  - Depends on: UXD-05.
- **UXD-16 Move to project in two clicks (S/M)**
  - Scope: a "Project ▸" submenu in the row and drawer menus applies via the existing guarded preview/bulk endpoints with an Undo toast; the dialog stays for bulk and subtasks, defaults to the current project and disables its primary until something changes.
  - Files: `TaskMenus.tsx`, `PlacementPicker.tsx`, `useTaskPlacement*`.
  - Accept: 2 clicks measured; guarded failure shows a retry toast.
  - Depends on: UXD-13.

### Phase 3: The rest

- **UXD-20 Work table and toolbar (M)**
  - Scope: sentence-case headers; hide columns empty for every visible row; severity chips; muted keys; sans tabular dates with tone; status as dot + label; `Avatar`; tiles without sub-labels; phone tiles as a horizontal chip row; workload chips "Aisha · 1 today".
  - Files: `DefectTable.tsx`, `PriorityCell.tsx`, `WorkFocusStrip.tsx`, `WorkloadBar.tsx`, `DashboardLayout.tsx`.
  - Accept: the defect dashboard keeps every filter, sort, saved view and selection.
  - Tests: `DefectTable.test`, `WorkFocusStrip.test`, `WorkloadBar.test`.
  - Depends on: UXD-02, UXD-03.
- **UXD-21 Triage panel (M)**
  - Scope: `SectionHeader`/`ui-label`; icon chips instead of P/A/D letters; the "Add to Team board" card in accent tint; friendly dates in suggestions.
  - Files: `TriagePanel.tsx`, `TriageProperties.tsx`, `SuggestionBar.tsx`, `TriageDeskSection.tsx`.
  - Tests: `TriagePanel.test`.
  - Depends on: UXD-08, UXD-20.
- **UXD-22 Team board, drawer and 1:1 (S/M)**
  - Scope: §5.9 and §5.10 changes.
  - Files: `TrackerRosterBoard.tsx`, `TeamTrackerPage.tsx`, `DeveloperDrawerSections.tsx`, `PersonCommitments.tsx`, `OneOnOneWorkspace.tsx`.
  - Accept: no raw status words; one primary in the blocked card. Tests: `TeamTracker.test`.
  - Depends on: UXD-04.
- **UXD-23 Standup (S)**
  - Scope: status menu, sentence case, one work card, footer hidden on touch.
  - Files: `StandupPersonHeader.tsx`, `StandupRail.tsx`, `StandupTaskList.tsx`, `StandupActionBar.tsx`, `standup.css`.
  - Tests: `StandupMode.test`, `standup-wrapup.test`.
  - Depends on: UXD-03, UXD-05.
- **UXD-24 Settings (M)**
  - Scope: `PageHeader` section titles, `ui-label` groups, sidebar group headings, the copy pass from §5.14, neutral Jira status. Typed confirmation phrases are unchanged on the server.
  - Files: `SettingsPanel.tsx`, `SettingsMaintenanceSection.tsx`, section files.
  - Tests: `SettingsPanel.test`, `SettingsDataSection.test`.
  - Depends on: UXD-03, UXD-06.
- **UXD-25 Setup Wizard (S/M)**
  - Scope: tokens, `ui-field`, sentence case, distinct step labels.
  - Files: `SetupWizard.tsx`.
  - Tests: `SetupWizard.test`.
  - Depends on: UXD-08.
- **UXD-26 Palette finds projects (S)**
  - Scope: projects and tracks as palette results that open `?view=projects&project=`. Manager-only and private-scoped.
  - Files: `search.service.ts`, `paletteItems.ts`.
  - Tests: server search test (scope isolation), `paletteItems.test`.
  - Depends on: none.
- **UXD-27 Error and boot states (S)**
  - Scope: a map from status to plain copy with server detail behind "Details"; a branded boot error page with Retry; "Today didn't load" gains the reason line.
  - Files: `lib/api.ts` (error shape untouched), `QueryReadError.tsx`, `App.tsx` boot branch, `TodayPage.tsx`.
  - Accept: no raw server message is shown as the headline.
  - Depends on: none.
- **UXD-28 Projects polish (S)**
  - Scope: a past "Next check" shows in warning tone; chevron summary disclosure.
  - Files: `ProjectOverview.tsx`.
  - Depends on: UXD-05.
- **UXD-29 Copy sweep (S)**
  - Scope: remaining "desk" strings (Copilot placeholder and empty state, Team Members copy, toast), "Updated just now", status labels.
  - Accept: `grep -i "desk"` in live (non-`manager-desk/`) UI strings returns only the `/desk` route.
  - Depends on: none.

Effort totals: Phase 1 ≈ 2–3 days, Phase 2 ≈ 3–4 days, Phase 3 ≈ 4–5 days.

## 9. Test and verification plan

- **Visual:** reuse the scratch setup from the appendix. For each item, re-shoot the affected screens at 1440 and 375 in both themes under the same file names with an `-after` suffix, and compare side by side. Phase exits re-shoot the full sweep (`10-*`).
- **Accessibility:** run axe (wcag2a/aa, 21aa, best-practice) on the 9 routes after each phase. The target is zero serious issues and zero landmark issues. Re-run the keyboard script (§6.4) for tab order, the palette trap and focus return. Run the touch audit at 375px (no header or nav control under 44px). Contrast tokens are covered by `themeTokens.test.ts`, extended with the header fill and chip texts.
- **Tests likely to change:** `Header.test`, `HeaderInboxMove.test`, `TodayPage.test`, `TodayPlan.test`, `today-layout.test`, `today-triage.test`, `TasksPage.test`, `tasks.test`, `TaskDrawer.test`, `CaptureBox.test`, `GlobalCaptureDialog.test`, `CommandPaletteSearch.test`, `paletteItems.test`, `DefectTable.test`, `WorkFocusStrip.test`, `WorkloadBar.test`, `TriagePanel.test`, `TeamTracker.test`, `StandupMode.test`, `standup-wrapup.test`, `SettingsPanel.test`, `SettingsDataSection.test`, `SetupWizard.test`, `ToastContext.test`, `themeTokens.test`. On the server, Today service tests for UXD-10, search scope tests for UXD-26, and a daily-notes excerpt test for UXD-14.
- **Gates per item:** `npm run typecheck`, `npm run build:check`, targeted tests; `npm run lint` and `format:check` per phase.

## 10. Risks, open questions and out-of-scope ideas

**Risks:** UXD-02 is a wide mechanical change, so do it per folder with screenshots to catch clipped text. UXD-10 changes what reaches Today; keep the cap configurable in code (not a setting) and test ranking. Moving the theme toggle into a menu adds a click for people who toggle often; Light/Dark/System makes that rare.

**Open questions (owner to decide):**
1. Should Today's "4 to triage in Inbox" open an inline triage panel (one fewer page change), or keep the link? The recommendation is the link for now, revisited after UXD-13.
2. Should the defect cap be 3 rows in solo mode? With Jira as the manager's main job, 5 may be better.
3. Should the Tasks selection checkbox return to hover-only on pointer-fine devices? It was made always-visible deliberately (R5); I'd keep it.

**Considered and rejected:**
- A new component library (Radix Themes, shadcn): the primitives exist; drift is adoption, not capability.
- Replacing inline styles wholesale (2,118 sites): high effort, low visible gain; fix as files are touched.
- A Today "Start here" hero card (UX-36): the featured first row plus the defect cap gets 80% of it without a new panel.
- A dense/comfortable density toggle: adds settings surface for a solo-first app.
- Custom brand typeface: Geist suits the product and the landing proves it scales.
- Swipe gestures on phone rows: hidden affordance with low discoverability; 44px visible actions are clearer.
- Reworking the Work page into cards on desktop: the table is right for triage; only restyle it.
- Removing the app frame (inset rounded panel): it's part of the identity and costs only 12px.

## 11. Appendix

### Screenshot index (`docs/screenshots/ux-review/`, JPEG, 313 files)

The naming pattern is `<nn>-<screen>[-<state>]-<desktop|laptop|tablet|phone>-<light|dark>.jpg` (desktop 1440×900, laptop 1280×800, tablet 768×1024, phone 375×812).

| Prefix | Content |
|---|---|
| `00-` | Landing (4 + 6 scroll frames), sign-in dialog, deep-link sign-in |
| `01-` | Setup Wizard step 1/2, first Today after setup |
| `02-empty-` | Empty Today, Tasks, Projects, Team, Work, Notes, Settings (desktop light, phone dark) |
| `10-` | Today, Tasks, Team, Work, Notes and Settings at all 4 sizes × 2 themes (48 shots) |
| `11–12-` | Today morning, midday and wrap-up (incl. phone dark), follow-up dialog, row menu, Assign owner result |
| `15-` | More menu (desktop light, phone dark) |
| `20–25-` | Tasks views (Inbox, Waiting, Meetings, My tasks, Needs attention, High priority, Closed, Later), Projects directory/detail/track, drawer (task, waiting, meeting), task page, bulk, row menu, View options, Schedule menu, Move to project, Notes Turn into / line → task / Wrap up |
| `30–32-` | Team drawer, 1:1 workspace and overview, Standup and its wrap-up |
| `40-` | Work triage panel |
| `50–54-` | Capture (empty, typeahead, preview), palette, Copilot, shortcut sheet, Undo toast |
| `60-` | Weekly review |
| `70-` | Keyboard focus (Today, `j/k` on Today and Tasks) |
| `80–81-` | Every Settings section, destructive reset |
| `90–93-` | API-down boot, 500 errors, loading skeletons, 200% zoom, heavy load (desktop light, laptop dark, phone light) |
| `95-` | My Day sign-in and My Day (4 variants) |

Variants for `20–60`: desktop light/dark, phone light/dark, tablet light.

### Seed dataset

A fresh scratch DB (migrated, never `data/`), with backups redirected to the scratchpad. Jira was pointed at `http://127.0.0.1:9` with auto-sync off, and the API server ran without watch mode.

- **Workspace:** solo mode, manager "Maya Patel", created through the Setup Wizard ("Just me", Jira skipped).
- **Roster of 6:** Priya, Marcus, Aisha, Tom, Noah, and "Alexandria Montgomery-Okafor" for long-name testing.
- **About 45 tasks across every lane:** 5 planned today, 3 overdue, 4 upcoming, 4 Inbox, 2 Later, 4 waiting (developer and external contact), 7 developer-owned (blocked/active/open), 3 meetings (past, today 16:30, future), 3 done and 1 dropped, a parent with 3 subtasks, and long titles and labels.
- **Projects:** "Atlas payments migration" with tracks Migration, Testing and Security, plus "Q4 hiring", with 19 placements.
- **Team activity:** 4 check-ins and day statuses (blocked, at risk, on track), 2 task events, 1:1 series for 3 people with agendas.
- **Notes and Jira:** notes for Fri and Sat, and 12 mocked Jira issues (assigned, unassigned, overdue, done) with a successful sync-log row.
- **Developer login:** "priya" for My Day.
- **Heavy load:** +213 tasks with up to 6 labels each, dates −10…+14 days, every 6th developer-owned.

### Not assessed

- Real screen readers (axe and DOM checks only), Safari, Firefox, and real touch devices (emulated touch only).
- Copilot with a live provider; real Jira sync, write-back and the Jira directory.
- Collaborative mode with active developer participation; the inbox popover was not seen because it's collab-only.
- Production-build performance (dev server only).
- Drag-and-drop in the 1:1 agenda; legacy `/desk` (Phase 3 redirects it to `/tasks`, confirmed).
- Staleness signals over time (all touches were minutes old on a Saturday).
- A 1:1 due today on Today.
- The "0 visible defects" list after "Assign owner" may be a load-timing artifact; it needs a re-check before UXD-10.
