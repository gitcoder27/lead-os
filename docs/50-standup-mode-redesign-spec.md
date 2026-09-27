# 50 — Standup Mode Redesign

Status: implemented. Surface: `/team?mode=standup` (`StandupMode`, P3-D5/D6).

## 0. The job

A manager runs a **~10-minute daily review**: walk each developer in board
order, see what changed since yesterday, log what was said, and move on. The
mode succeeds when the manager (a) never loses their place, (b) sees the
person's day in one glance, (c) spots what actually changed without reading
everything, and (d) ends with a clear picture of who was covered and what
needs follow-up.

The old screen did the *writes* well (keymap, canonical APIs) but gave no
sense of progress, no end, and made the manager assemble the person's day
from raw rows. This redesign keeps every write path and key, and adds the
session layer around it.

Non-goals (§9): no new server persistence for sessions, no timer/meeting
facilitation, no team-wide feed.

## 1. Resolved decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **Session is client-side**, persisted in `sessionStorage` keyed by workspace date (`standup-session:<date>`), wrapped in try/catch. Reopening standup the same day resumes progress. | Accidental `Esc` must not reset "4 of 6 reviewed". No server model is warranted for an ephemeral ritual; every *write* already lands in canonical history. |
| S2 | A developer is **reviewed** when the manager moves off them (←/→, rail click, wrap-up) *or* any write for them succeeds. Rail jumps do not mark skipped people. | Matches the real behaviour: you "did" someone once you've looked and moved on. Jumping past someone must leave them visibly unreviewed. |
| S3 | New key **`f`** toggles a session-only **follow-up flag** on the person. | The most common standup outcome is "talk to them after". It needs to be one keystroke and show up in the wrap-up; turning it into a task is still `a`. |
| S4 | Moving **→ past the last developer** opens the **wrap-up**; **`w`** opens it from anywhere. `←` from wrap-up returns to the last developer. | Gives the ritual an end without a new button to hunt for. |
| S5 | The **feed is grouped by task** (check-ins form their own group), groups sorted by importance then recency. Status events render their transition (`Open → Done`); `single_current` demotions are hidden as noise. | The raw list interleaved unrelated tasks and printed bare "status" lines. |
| S6 | `StandupFeedEntry` gains optional `statusFrom`, `statusTo`, `statusReason`, `blockerAction` (type-only contract change, derived from event meta server-side). | Needed for S5; the feed previously dropped meta. No `types.js` regen (type-only). |
| S7 | The action bar replaces the plain hint line: clickable key chips grouped by scope (Navigate · Task · Person · Session). Clicking runs the same handler as the key. | Discoverable for mouse users, scannable for keyboard users, one code path. |
| S8 | Task rows adopt the `/tasks` row idiom (status glyph · muted key · title · signals · latest event line) — reusing `TaskStatusGlyph`/`TASK_STATUS_META`, not `TaskListRow` itself. | `TaskListRow` is bound to view context, selection and menus that standup doesn't have. Visual parity without coupling. |

## 2. Layout

```
┌ Top bar ─────────────────────────────────────────────────────────────────┐
│ ⇄ Standup · Sat Sep 26   [███████░░░] 4 of 6 reviewed · 1 flagged  Wrap-up  ? Exit │
├ Rail (248) ──┬ Person (flex) ───────────────────────┬ Feed (≥320) ──────┤
│ ● AS  Ayan ✓ │ DS  Deepak Singh  [On track ▾] 1:1 TODAY  ‹ 2/6 ›        │
│ ◉ DS  Deepak │ ┌ Current ─────┬ Open ┬ Blocked ┬ Done today ┬ Check-in ┐│
│ ○ R   Rohit  │ │ T-56 Check-in│  4   │   0     │    1       │ none     ││
│ ○ SN  Shubham│ └──────────────┴──────┴─────────┴────────────┴──────────┘│
│              │ ⚠ suggestion banner (when present)                        │
│ ── Wrap-up → │ OPEN TASKS · 4                                           │
│              │ ◉ T-56 Check-in request …          CURRENT  ● new        │
│              │ ○ T-68 Corticon MS                                       │
│              │   ↳ "working corticon" · 3h ago                          │
│              │ [Update T-68… composer]                                  │
│              │ DONE TODAY · 1 (muted, strikethrough)                    │
├──────────────┴──────────────────────────────────────┴───────────────────┤
│ Action bar: NAV j k ← → · TASK u s d b r ↵ · PERSON c a y f · w ?       │
└──────────────────────────────────────────────────────────────────────────┘
```

Below `lg` the feed stacks under the tasks; below `md` the rail narrows to an
avatar-only column (reviewed badges stay visible).

## 3. Components

All under `client/src/components/team-tracker/standup/`, orchestrated by
`StandupMode.tsx` (state, keymap, mutations). Pure logic lives in
`client/src/lib/standup.ts` (unit-tested).

| Component | Responsibility |
|---|---|
| `StandupTopBar` | Title, date, progress bar + "N of M reviewed", flagged count, Wrap-up / Keys / Exit buttons. |
| `StandupRail` | Roster listbox (`aria-label="Standup order"`). Per row: avatar with state ring, name, status pill, open-task count, markers (suggestion ⚠, flagged ⚑, no check-in dot). States: *current* (accent bar), *reviewed* (✓ badge on avatar, name dimmed), *unreviewed*. Trailing "Wrap-up" row. |
| `StandupPersonHeader` | Avatar, name, status select + pill, 1:1 badge (today/overdue), `‹ i/N ›` nav, then the **day strip** (§4). |
| `StandupTaskList` | Open tasks listbox (`aria-label="<name>'s tasks"`), roving focus, row idiom (S8), "new since standup" dot when the task has feed activity in the window, `latestEvent` excerpt line. The update composer sits directly under the list. "Done today" section below, expanded but collapsible, non-navigable (click opens the drawer). |
| `StandupFeed` | Grouped feed (S5): summary chips (updates / blockers / status / check-ins), group header (key + title, click → focus row if open, else open drawer), entries with type icon + tone, author tag (dev / you), relative time. |
| `StandupActionBar` | Sticky footer (S7). Disabled chips when no focused task. |
| `StandupWrapUp` | End-of-session view (§5). |
| `StandupLayers` | Existing `LayerShell` + help grid (moved, unchanged behaviour). |

## 4. Person header — day strip

Five compact cells, each label + value, tone-coded:

| Cell | Value | Tone |
|---|---|---|
| Current | `T-56 · title` (click → focus that row) or "None set" | muted when none |
| Open | count of open/active/blocked | — |
| Blocked | count | danger when > 0 |
| Done today | count of tasks with `status=done` closed today | success when > 0 |
| Check-in | "2 today · 3h ago" / "None today" (+ "last 2d ago") | warning when none today |

`nextFollowUpAt` shows as a small "Follow-up 3pm" note under the name when set.

## 5. Session & wrap-up

The person is tracked by `accountId`, not index, so a status change that
re-sorts the board never silently swaps who is on screen. On open, standup
resumes at the first unreviewed person (or the wrap-up if everyone is done).

State (`StandupSession`): `reviewed: string[]`, `flagged: string[]`,
`log: StandupLogEntry[]` where an entry is `{ accountId, kind, taskKey?, at }`,
`kind ∈ update | checkin | status | current | done | blocked | reassign | added`.

Logged on mutation success only (never optimistically). The composer gets an
optional `onPosted` callback and `CaptureBox` an optional `onCaptured`, both
additive props.

**Wrap-up view** (replaces person + feed columns; rail stays):

1. Headline — "Standup complete" when all reviewed, else "N not reviewed yet".
2. Stat tiles — Reviewed `x/N` · Updates logged · Check-ins · Tasks closed ·
   Status changes.
3. **Needs follow-up** — flagged people, plus derived: status blocked /
   at_risk / waiting, pending status suggestion, no check-in today,
   1:1 today/overdue. Each row lists reasons as chips; click → jump to person.
4. **Not reviewed** — people still unreviewed, click → jump.
5. **Logged this session** — per person, compact action list.
6. Actions: `Copy summary` (plain-text Markdown to clipboard), `Back`,
   `End standup` (Enter). `Reset session` link clears S1 storage.

## 6. States

| State | Treatment |
|---|---|
| No developers on board | Centered empty card: "No one on the board" + Exit. |
| Dev has no open tasks | Inline empty: "No open tasks" + `Add task (a)` button; done-today still shown. |
| Feed loading | 3 skeleton lines. |
| Feed error | Danger inline + Retry (`refetch`). |
| Feed empty | "Quiet since <weekday time>" with window hours. |
| All reviewed | Top bar progress turns success; rail footer pill "All reviewed — w to wrap up". |
| Suggestion present | Warning banner with `Accept (y)` (unchanged). |

## 7. Behaviours kept (regression list)

Keys `→/n ←/p j/k u v c s d b a r y Enter ? Esc` behave exactly as before;
layers still stack with `Esc` closing the top layer first; plain keys are
ignored inside fields; the keymap pauses while `suspended`; all writes go
through `useStatusUpdate`, `useAddCheckIn`, `useSetCurrentItem`,
`useReassignTrackerItem`, `useUpdateTaskDetail`, `TaskUpdateComposer`,
`CaptureBox`. Test hooks (`standup-mode`, `status-suggestion`, listbox names,
`Standup` heading, `24h window`) are preserved.

New keys: `f` flag, `w` wrap-up. In wrap-up only `←/p`, `w`, `?`, `Esc`,
`Enter` (end) are live.

## 8. Motion & visual

Geist, CSS vars only, single cyan accent (`--accent`); status colours only
for meaning. Person panel cross-fades/slides 8px on developer change
(`framer-motion`, respects reduced motion). Progress bar animates width.
Focused task row: tertiary background + 2px accent left bar (as `/tasks`).
Density: 36px rows, 11–13px type, no card-in-card padding.

## 9. Out of scope

- Sharing a session between managers (records are per-manager).
- Timers, per-person timeboxing, meeting-note generation.
- Editing check-ins or events from the feed.
- Changing board order inside standup (it follows the board sort, P3-D5).
- A browsable standup history UI (the table exists; no surface yet).

## 10. Files

- `shared/types.ts` — `StandupFeedEntry` optional fields (S6); v2 session
  contracts (`RecordStandupSessionRequest`, `StandupSessionRecord`, …).
- `server/src/services/team-tracker.service.ts` — map meta → S6 fields;
  v2 `recordStandupSession` + feed anchoring.
- `server/src/routes/team-tracker.ts` — v2 `POST /standup/session`.
- `server/src/db/{schema,migrate}.ts` — `standup_sessions` table.
- `client/src/lib/standup.ts` — session reducer, storage, day stats, feed
  grouping, follow-up reasons, summary text.
- `client/src/components/team-tracker/StandupMode.tsx` + `standup/*`.
- `client/src/components/tasks/TaskUpdateComposer.tsx` — `onPosted?`.
- `client/src/components/capture/CaptureBox.tsx` — `onCaptured?`.
- Tests: `client/src/test/standup.test.ts`, `StandupMode.test.tsx`,
  `server/tests/standup.routes.test.ts`.

## v2 — sealed standup sessions (implemented)

The original design kept the session purely client-side; twice-daily standups
made the ephemerality a real problem (a sealed round left no trace, and the
feed's "24h window" never matched the actual gap). v2 decisions:

- **V1 — `End standup` seals a durable record.** `POST
  /api/team-tracker/standup/session` writes one `standup_sessions` row
  (date, started/ended, reviewed, flagged, log, summary) and is idempotent
  on `requestId` — a retry after a lost response returns the sealed session
  instead of duplicating. `Esc`/`Exit` still leaves without sealing, so the
  client session remains resumable until End. Ending an untouched session is
  plain exit (an empty anchor would empty everyone's feed).
- **V2 — the feed window is anchored, not rolling.** `windowStart` is the
  manager's latest sealed `ended_at`; with no sealed session it falls back to
  the previous 24h/72h-Monday rolling window. `anchoredToSession` is returned
  so the UI can label it "since &lt;time&gt;" instead of "24h window". Two
  standups in a day now show exactly what changed between them.
- **V3 — flags become real follow-ups on seal.** Each flagged person produces a
  manager-owned `category:follow_up` task (`Standup follow-up: <name>`,
  `followUpAt = now`, `scheduledOn = date`) inside the same transaction — so a
  flag survives the tab close and lands in the Follow-ups view. An unknown
  flagged id is skipped rather than failing the seal.
- **V4 — the summary auto-saves to today's note.** After a successful seal the
  client appends the wrap-up markdown to `POST /api/notes/:date/append`
  (idempotent `requestId`, auto-creates the note). A note failure does not
  roll back the seal.
- **V5 — sealing clears the client session.** The next standup (same day or
  next day) starts a fresh round automatically — no manual reset needed.
  `Reset session` remains for a same-day do-over *without* recording. The
  storage key is removed synchronously before unmount; a reducer dispatch
  alone would race `onClose` and leave the sealed round resumable.
- **V6 — "Last round" recall view.** A top-bar button opens a layer showing
  the most recent sealed session (`GET /standup/session/latest`): when it
  ended, coverage, flagged people, the logged actions per person, and the
  stored summary. This is how "what did we cover in the morning standup" is
  answered inside the mode — the feed stays a pure delta since that seal.
- Task rows open the drawer on single click (matching `/tasks`); double-click
  is gone.
- Keys, layout, feed grouping and all S1–S8 decisions are unchanged.
