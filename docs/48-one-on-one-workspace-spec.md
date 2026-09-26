# One-on-One Workspace — Implementation Spec

Status: proposal · Audience: product, frontend, backend · Builds on: `TASK_TEAM_MANAGEMENT_PHASE3_IMPLEMENTATION.md` (§9 deferred item, now unblocked by standup mode)

Recurring manager↔developer one-on-ones as a first-class workspace: a persistent agenda that carries across sessions, private running notes, and action items that land as canonical tasks. Not a calendar tool — no sync, no invites, no developer-visible surface in v1.

---

## 0. Gating

- New config key `one_on_one_enabled`, CLI-toggled like `tasks_phase3_enabled`. No stage prerequisite — the feature is purely additive (new tables, new routes, one nav entry).
- All surfaces are **manager-only** (`requireManager`). Developers get nothing: no API, no nav, no shared agenda in v1 (see OO-D6).
- Flag-off behavior: routes 404, nav entry hidden, zero behavior change — same parity rule as Phase 3 §0.

---

## 1. Decision record

| # | Decision | Rationale / alternatives rejected |
|---|---|---|
| OO-D1 | A 1:1 is a **series** (`one_on_one_series`) containing dated **sessions** (`one_on_one_sessions`). One series per developer per workspace. | Meetings (`kind:"meeting"` tasks) were considered and rejected: they are one-off dated items with no recurrence and no persistent agenda — a 1:1's defining feature is that its agenda survives across sessions. |
| OO-D2 | **Agenda items are canonical tasks** attached to a series via `one_on_one_agenda_items` (link + position). Freeform entries become real tasks on capture. | Keeps the v2 invariant "tasks are the persistent object." An agenda item that survives becomes follow-through: close it and it's done, carry it and it stays on the agenda. `task_links` was considered but has no position/carry semantics. |
| OO-D3 | Agenda items remain **normal open tasks** — they appear in `my-tasks`-style views like anything else; the agenda link only adds ordering and session association. | Hiding them would need a new kind or flag and complicates every view predicate. Being visible as an open task is honest — it IS an open thread. |
| OO-D4 | Sessions auto-schedule from `cadence` + `preferred_weekday`. Completing or skipping a session creates the next one. | No calendar sync (Phase-5 precedent). Cadence options: `weekly`, `biweekly`, `monthly`, `ad_hoc` (no auto-schedule — manager creates sessions manually). |
| OO-D5 | Session content = **notes** (markdown, manager-private) + the agenda. "Running record" is the session timeline + notes; long-term per-developer memory stays in `developer_notes`. | Don't duplicate `developer_notes` — the drawer keeps it as the standing scratchpad; session notes are dated record, notes field is evergreen context. |
| OO-D6 | **Manager-private v1.** No developer-shared agenda. | Matches the `developer_notes` / P3-D15 boundary. Confirmed — shared agenda is out of scope for v1. |
| OO-D7 | The workspace **lives inside the Team surface**: `/team?dev=<accountId>&panel=one-on-one` URL state (same pattern as `?mode=standup`). Series overview is a Team-level "1:1s" affordance, not a new nav page. | Confirmed — keep it in Team. `NavPageId` unchanged; no top-level route. Deep links still work since the state is in the URL. |
| OO-D8 | Action items from a session are **created as tasks** during/after the session — same mechanism as meeting action items (Wave 3c). | One pipeline, one inbox. No parallel "1:1 action" type. |
| OO-D9 | No changes to `tasks`, `task_events`, `developers`, or any existing table. Three new tables + one config key. | Additive and reversible — rollback = flag off. |

---

## 2. Data model

```sql
one_on_one_series
  id                    INTEGER PK
  workspace_id          TEXT NOT NULL DEFAULT 'default'
  developer_account_id  TEXT NOT NULL REFERENCES developers(account_id)
  cadence               TEXT NOT NULL  -- weekly | biweekly | monthly | ad_hoc
  preferred_weekday     INTEGER        -- 0–6, optional
  active                INTEGER NOT NULL DEFAULT 1
  created_at            TEXT NOT NULL
  UNIQUE(workspace_id, developer_account_id)

one_on_one_sessions
  id                    INTEGER PK
  workspace_id          TEXT NOT NULL DEFAULT 'default'
  series_id             INTEGER NOT NULL REFERENCES one_on_one_series(id) ON DELETE CASCADE
  scheduled_for         TEXT NOT NULL          -- ISO date
  status                TEXT NOT NULL          -- scheduled | done | skipped
  notes                 TEXT NOT NULL DEFAULT ''
  completed_at          TEXT
  created_at            TEXT NOT NULL
  INDEX(workspace_id, series_id, scheduled_for)

one_on_one_agenda_items
  id                    INTEGER PK
  workspace_id          TEXT NOT NULL DEFAULT 'default'
  series_id             INTEGER NOT NULL REFERENCES one_on_one_series(id) ON DELETE CASCADE
  task_id               INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
  position              INTEGER NOT NULL
  added_at              TEXT NOT NULL
  UNIQUE(workspace_id, series_id, task_id)
```

Discussion during a session happens as **task events** on the agenda tasks themselves (regular timeline entries, `meta.source: "one_on_one"` optionally) — no new event plumbing.

---

## 3. API (all `requireManager` + flag-gated)

| Route | Purpose |
|---|---|
| `GET /api/one-on-ones` | Series list: developer, cadence, next session date, open agenda count. |
| `POST /api/one-on-ones` | Create series `{ developerAccountId, cadence, preferredWeekday? }`. |
| `PATCH /api/one-on-ones/:id` | Cadence/weekday/active changes. |
| `GET /api/one-on-ones/:id` | Series detail: sessions history (desc), upcoming session, agenda (ordered). |
| `POST /api/one-on-ones/:id/sessions` | Create next session manually (also the ad_hoc path). |
| `PATCH /api/one-on-ones/:id/sessions/:sid` | `status` transitions + `notes` + `scheduledFor` reschedule. |
| `GET /api/one-on-ones/:id/agenda` / `POST` / `PATCH` / `DELETE` | Ordered agenda: attach `taskId`, reorder, detach. |
| `POST /api/one-on-ones/:id/sessions/:sid/actions` | Convenience: create task + attach to agenda in one call (wraps `TaskService.create` + link, in one transaction — the atomicity lesson from capture). |

DTOs in `shared/types.ts` (`OneOnOneSeries`, `OneOnOneSession`, `OneOnOneAgendaItem` — agenda items embed a minimal task projection). Zod request schemas in `shared/types.ts` per the D9 precedent.

---

## 4. UX

All surfaces render inside the Team canonical view (`/team`), driven by URL state — the same pattern as standup mode (`?mode=standup`). No new nav page, no top-level route.

### 4.1 Series overview — Team "1:1s" affordance
A Team-page view (e.g. `?panel=one-on-ones` or a toolbar toggle) listing every series: developer, cadence, next session (overdue red), open agenda count. Empty state: "Pick a developer to start a 1:1 series." Row click → `?dev=<accountId>&panel=one-on-one`.

### 4.2 `/team?dev=<accountId>&panel=one-on-one` — the workspace
Full-area panel inside the Team page, three columns (desktop) / stacked (narrow):

1. **Agenda** — ordered checklist of open tasks attached to the series. Drag or `Alt+↑/↓` to reorder; a capture-style input at top ("Add to agenda…" → creates a task inline, `meta.source` set). Carried items show a "carried from <date>" marker.
2. **Session** — the current/next session card: date, **Start / Complete / Skip** buttons, notes editor (markdown, autosaved debounce). Completing asks: "Reopen carried agenda items?" (default: keep open → they auto-carry).
3. **History** — past sessions, newest first: date, status, notes preview, agenda snapshot count. Expand to read.

Esc/back clears the panel state and returns to the Team board (mirrors standup's URL-state exit).

### 4.3 Entry points
- `/team` → developer drawer → "1:1" section: next session date, agenda count, "Open workspace" link. Sits beside the existing `developer_notes` section (P3-D4 wording).
- Task drawer → "Add to 1:1 agenda" action → series picker (or auto-picks the task owner's series).
- Optional capture sugar later: `/11` isn't in the grammar — v1 deliberately doesn't extend `capture-grammar` (§10).

### 4.4 Standup & Today
- Standup dev card badge: "1:1 today" / "1:1 overdue 3d" — read-only signal.
- Today: an attention item "1:1 with <dev> today/overdue" when `scheduled_for <= today` and status `scheduled`. Same pattern as the Jira-drift signal (3f) — never writes.

---

## 5. Session lifecycle

```
scheduled → done     → next session auto-created per cadence
          → skipped  → next session auto-created; agenda items keep `carried` marker
```

- **Auto-creation** happens lazily: when a session is completed/skipped, or when `GET /api/one-on-ones/:id` sees `next` missing and cadence ≠ `ad_hoc`. No cron.
- **Rescheduling** edits `scheduled_for` directly — no skip needed.
- Closing an agenda task (anywhere — drawer, tasks page, capture update) drops it from the rendered agenda; the link row stays for history (session snapshot lists what was on the agenda, with status).

---

## 6. Privacy and roles

- Everything manager-only; all routes behind `requireManager` + the flag.
- Developer DTOs never expose series/session/agenda data.
- Notes and agenda are not in `/api/my-day` responses — same boundary as former-owner projection (G1).

## 7. Copilot

- Register read tools `one_on_one_list`, `one_on_one_agenda` and a confirm-gated write `one_on_one_add_agenda` — but only when `one_on_one_enabled` (the D11 pattern: registration is flag-scoped, execute re-checks defensively).

## 8. Testing

- **Server:** series/session/agenda CRUD, carry semantics on done/skip, lazy auto-scheduling per cadence, flag-off 404s, developer-principal 403s, action-item create+attach atomicity.
- **Client:** workspace columns render, reorder, carried markers, session complete flow, drawer entry point, flag-off invisibility.
- **Parity:** all existing suites pass with flag off (flag-off = zero surface).

## 9. Rollout

1. Ship behind `one_on_one_enabled` (default off).
2. `npm run <script>`-style CLI toggle (mirror `tasks:phase3`) or a Settings toggle — decision at build time; CLI is the precedent.
3. Enable on sandbox → manual validation → enable on prod.
4. Rollback: flag off. No destructive data.

## 10. Deferred / open questions

| Item | Why deferred |
|---|---|
| Developer-shared agenda | Real product decision (OO-D6); needs dev-side design. |
| Calendar sync (GCal/Outlook) | Phase-5 precedent: explicitly out. |
| `capture-grammar` `/11` token or `+1on1` label | Grammar changes are high-blast-radius; wait for usage. |
| Talking-point templates / prep suggestions | Wait for usage data. |
| Copilot proactive prep ("your 1:1 with X is in 2h — here's the agenda") | Needs copilot-v2 proactive signals first. |
