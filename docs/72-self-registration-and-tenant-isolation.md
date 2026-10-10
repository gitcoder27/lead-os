# Self-registration and tenant isolation

Created: 2026-10-10. Reviewed baseline: `1f8569e`. Research and planning only: this document changes no application code, schema or data.

> **Numbering:** the brief asked for `docs/70-self-registration-and-tenant-isolation.md`, but `docs/70` (workspace quality) and `docs/71` (task reliability) already exist and are tracked from [docs/56](56-implementation-plan-solo-first.md). This plan is `docs/72` so existing links keep working.

## 1. Summary and recommendation

**Is it safe to open LeadOS to a second manager today? No.** It is closer than expected, though. The data model is already multi-workspace. Every request takes its workspace from the session, and a two-workspace probe of 137 route calls (§12.1) found **no data leak and no cross-tenant write**. The second workspace saw none of the owner's tasks, notes, people, projects, Jira issues, Copilot data or keys, and none of the owner's rows changed. What is unsafe is **install-wide state that any manager can reach**, plus the account-creation path:

1. **Any manager controls the shared Jira scheduler.** `syncIntervalMs` accepts any positive integer ([config.ts:43](../server/src/routes/config.ts)). The one global timer runs at the *smallest* interval across workspaces ([engine.ts:240-247](../server/src/sync/engine.ts)). Verified: one call from the second manager changed the install's interval from 300 000 ms to **1 ms**, which re-syncs the owner's Jira back to back.
2. **Any manager can fill the disk with full-database snapshots.** Each "reset" writes an unthrottled copy of the *whole* install, every tenant included ([backup.service.ts:112-118](../server/src/services/backup.service.ts)). Pre-reset snapshots are pruned by age only (:282-308). Verified: 3 calls produced 3 full snapshots containing the owner's data.
3. **Server-side request forgery with the response echoed back.** The Jira and Copilot "Test connection" endpoints fetch any URL a manager gives them and return the remote response body in the error ([client.ts:92](../server/src/jira/client.ts), [llm-client.ts:176-188](../server/src/assistant/llm-client.ts)). Verified against a local "internal" service.
4. **"Install owner" means any manager in the `default` workspace** ([middleware/auth.ts:96-98](../server/src/middleware/auth.ts)). Anyone the owner ever adds as a co-manager could download every friend's data and password hash. It needs to be an explicit flag before other people's data lives here.
5. **Account creation is not atomic.** A failed second-manager creation leaves an orphan workspace (verified). A taken username returns 500, and outside production the raw SQLite message.

There is also no public registration path. `POST /api/auth/register` only bootstraps the first account or lets a signed-in manager add users to their own workspace ([auth.ts:166-214](../server/src/routes/auth.ts)).

**Recommendation.** Use **owner-generated, single-use invite links**, with an operator kill switch (`LEADOS_REGISTRATION=off|invite`, default `off`). Each invitee gets a **new, empty workspace**, created in one transaction. Before any of that, close the four Phase 0 blockers above (SR-02…SR-07) and land a **permanent route-matrix isolation test** (SR-01) that every future route must pass. Registration opens only in the last phase (SR-13), by setting the env flag on the production host.

What I chose **not** to build: open sign-up, owner approval queues, email verification and email-based reset (there is no mail infrastructure), shared workspaces between friends, per-workspace backups and restore, quotas beyond the two that matter (sync interval, snapshots), CAPTCHA, and an admin UI for all users. Section 11 lists these with reasons.

**Verified vs inferred.** Claims marked *(verified)* were confirmed by running the throwaway probe in §12.1 on a scratch database. Everything else comes from reading the code, with file and line cited.

## 2. Current state

### 2.1 Accounts, sessions and the request principal

| Piece | Behaviour | Evidence |
| --- | --- | --- |
| Account table | `app_users(id, workspace_id, username UNIQUE, display_name, password_hash, role, developer_account_id, is_active)`. **Usernames are unique across the whole install**, not per workspace. | [schema.ts:59-70](../server/src/db/schema.ts) |
| Roles | `UserRole = "admin" \| "manager" \| "developer"`. `admin` is vestigial: `requireAdmin` exists but nothing mounts it, and an `admin` user fails `requireManager`. | [shared/types.ts:968](../shared/types.ts), [middleware/auth.ts:120-135](../server/src/middleware/auth.ts) |
| Password storage | scrypt with a 16-byte salt and 64-byte key, compared with `timingSafeEqual`. Minimum 8 characters, maximum 200. | [auth.service.ts:13-14,54-74](../server/src/services/auth.service.ts) |
| Login | Looks the user up by normalised username only (lowercased, trimmed) across all workspaces, then verifies the password. Because usernames are globally unique, this is unambiguous. It returns a generic 401 for a wrong password, an unknown user, or a developer whose roster entry was removed. | [auth.service.ts:199-237](../server/src/services/auth.service.ts) |
| Session | A 32-byte random id in `app_sessions(id, user_id, …)`, lasting 7 days, with `last_seen_at` touched every 5 minutes. The table has no workspace column; the workspace comes from the joined user row on every request. | [auth.service.ts:16-17,217-224,239-299](../server/src/services/auth.service.ts), [schema.ts:72-78](../server/src/db/schema.ts) |
| Cookie | `dcc_session` (overridable with `SESSION_COOKIE_NAME`). Flags: `Path=/; HttpOnly; SameSite=Lax; Max-Age`, plus `Secure` when `NODE_ENV=production`. | [auth.service.ts:18-19,87-113](../server/src/services/auth.service.ts) |
| Principal | `requireAuth`, `requireManager` and `requireDeveloper` parse the cookie, load the session and set `req.auth = { sessionId, user }`. `AuthUser.workspaceId` is read from the database, never from the request. `accountId` is `developerAccountId ?? username`, so a manager's `manager_account_id` is their username. | [middleware/auth.ts:28-89](../server/src/middleware/auth.ts), [auth.service.ts:76-85](../server/src/services/auth.service.ts) |
| Install owner | `canManageInstall(user)` is `role === "manager" && workspaceId === "default"`. `requireInstallManager` guards `/api/backups`; `features.backups` mirrors it. | [middleware/auth.ts:91-118](../server/src/middleware/auth.ts), [auth.ts:123-131](../server/src/routes/auth.ts), [app.ts:196](../server/src/app.ts) |
| Login throttle | In memory, keyed `[ip, username]`. After 5 failures within 15 minutes it locks for 30 s, growing to 15 min. Used for `/login` and `/change-password`. There is no per-IP cap, and it resets on restart. Behind nginx it needs `TRUST_PROXY=loopback` ([docs/23](23-hostinger-domain-vps-deployment-runbook.md#client-ip-and-trust_proxy)). | [auth.ts:68-115,146-164,216-230](../server/src/routes/auth.ts) |
| Bootstrap | `GET /api/auth/bootstrap` is public and returns `{ bootstrapOpen: userCount === 0, userCount }`, where the count covers active users in **all** workspaces. | [auth.ts:133-144](../server/src/routes/auth.ts), [auth.service.ts:355-361](../server/src/services/auth.service.ts) |

**Where "first user" or "no users yet" is assumed**

- `/register`: `isBootstrap = getUserCount() === 0`. The first account must be a manager and gets a session cookie ([auth.ts:168-175,202-208](../server/src/routes/auth.ts)).
- `createUser` repeats the first-account-is-a-manager check for the CLI ([auth.service.ts:134-137](../server/src/services/auth.service.ts)).
- `resolveWorkspaceIdForNewUser` gives the first account `ensureDefaultWorkspace(owner)` ([auth.service.ts:491-511](../server/src/services/auth.service.ts), [workspace.service.ts:20-38](../server/src/services/workspace.service.ts)).
- The client shows the Setup Wizard only while `bootstrapOpen` is true. That makes it a **first run of the install**, not of each workspace ([App.tsx:1162-1174](../client/src/App.tsx)).

**`"default"` fallbacks**

- `normalizeWorkspaceId(undefined | "")` returns `"default"` ([workspace.service.ts:14-17](../server/src/services/workspace.service.ts)). A second copy lives in [runtime-credentials.ts:2-7](../server/src/runtime-credentials.ts). Almost every service method takes `workspaceId?: string` and normalises it, so **a caller that forgets the argument reads or writes the owner's workspace**. The probe found no request path that does this today (§3.2); SR-01 makes it a test failure in future.
- 41 schema columns default to `"default"`, e.g. `issues.workspace_id` ([schema.ts:12](../server/src/db/schema.ts), and the same on most tables).
- Install-level reads with no workspace argument fall back to `default` on purpose: the backup schedule and directory ([backup.service.ts:62,68,87-88,283,294,311](../server/src/services/backup.service.ts)), the scheduler's auto-sync gate ([engine.ts:35](../server/src/sync/engine.ts)), and env Jira seeding at startup ([index.ts:49-70](../server/src/index.ts)).
- A non-explicit, non-manager `createUser` falls back to the default workspace ([auth.service.ts:510](../server/src/services/auth.service.ts)).
- Env Jira values apply to `default` only ([settings.service.ts:73-75](../server/src/services/settings.service.ts), [config.ts:108-116](../server/src/routes/config.ts)).
- CLI scripts default `--workspace` to `default`, e.g. [one-on-one.ts:21](../server/src/scripts/one-on-one.ts) and [task-cutover.ts:7](../server/src/scripts/task-cutover.ts).

### 2.2 How workspaces are created today

Paths that already exist:

1. **Bootstrap.** The first manager goes into `default` ([auth.service.ts:502-504](../server/src/services/auth.service.ts)).
2. **Manager creates a user.** `POST /api/auth/register` with a manager session passes `caller.workspaceId` ([auth.ts:178-200](../server/src/routes/auth.ts)). A new *developer* or *manager* therefore joins the **caller's** workspace. *(verified: a manager created this way landed in the caller's workspace)*
3. **CLI second manager.** `auth:create-user --role manager` once users exist calls `createWorkspaceForManager`, which creates `workspace_<uuid>` named "<display>'s Workspace" ([auth.service.ts:506-508](../server/src/services/auth.service.ts), [workspace.service.ts:40-54](../server/src/services/workspace.service.ts), [create-auth-user.ts:75-80](../server/src/scripts/create-auth-user.ts)). **So separate tenants are already reachable today, through the CLI.** The original multi-workspace work is `3a5c98f`; `6c2932d` made new workspaces start on the canonical task model.

`createWorkspaceForManager` inserts the workspace row and runs `startCanonicalTasksIfEmpty`, which writes 8 config keys ending in stage `2c` with Phase 3 on ([canonical-start.ts:15-47](../server/src/db/canonical-start.ts)). The workspace insert and the user insert are **not in one transaction**: if the user insert fails, the workspace and its 8 config rows remain *(verified, §12.1)*.

**What a new workspace needs and where it comes from**

| Need | Source today | New workspace (probe) |
| --- | --- | --- |
| Task model (stage 2c, Phase 3, id seed 0) | `startCanonicalTasksIfEmpty` at creation, and `migrate()` for every workspace | Set: `features.tasksPhase3: true`, first task `T-1` *(verified)* |
| Task key sequence | Created lazily on first key ([task-keys.service.ts:86](../server/src/services/task-keys.service.ts)) | OK *(verified: separate `T-1` per workspace)* |
| System task labels | Created lazily ([task-labels.service.ts:55](../server/src/services/task-labels.service.ts)) | Present on first read *(verified)* |
| Built-in task views | Code, not rows ([task-views.service.ts:46-60](../server/src/services/task-views.service.ts)) | OK |
| Nav preferences | Code default when no row ([nav-preferences.service.ts:30-49](../server/src/services/nav-preferences.service.ts)); Team and Work are held back until there is a roster or Jira (client `applyNavAvailability`) | OK, a solo manager sees Today, Tasks and Notes |
| `team_mode` | Reads as `solo` when missing ([settings.service.ts:68-70,88-90](../server/src/services/settings.service.ts)) | `solo` *(verified)* |
| Attention rules | Defaults, with **`timeZone` = the server's zone** ([settings.service.ts:59](../server/src/services/settings.service.ts)) | Server zone (Asia/Calcutta in the probe), not the friend's |
| 1:1 workspace | `one_on_one_enabled` is off unless set by CLI ([one-on-one.service.ts:155-163](../server/src/services/one-on-one.service.ts), [scripts/one-on-one.ts](../server/src/scripts/one-on-one.ts)) | **Off** *(verified: `features.oneOnOne: false`, `/api/one-on-ones` returns 404)* |
| Copilot | Per-workspace config with built-in defaults and no key ([assistant-config.service.ts:254-299](../server/src/services/assistant-config.service.ts)) | Disabled, `hasApiKey: false` *(verified)* |
| Jira | Per-workspace config; env applies to `default` only | `jiraConfigured: false`; sync returns `skipped/jira_not_configured` ([engine.ts:135-141](../server/src/sync/engine.ts)) *(verified)* |
| Backups | Install-wide; nothing per workspace | n/a |
| Onboarding | The Setup Wizard runs only on the install's first run; Today's Getting started card works per workspace ([today.service.ts](../server/src/services/today.service.ts) `buildGettingStarted`, [TodayPage.tsx:119-127,244](../client/src/components/today/TodayPage.tsx)) | The Getting started card shows |

## 3. Isolation audit

### 3.1 Tables

Key: **WS** means the table has `workspace_id`. **Mgr** means it also has `manager_account_id` (manager-private). "Enforced" names where reads and writes add the filters. Risk applies to a self-registered tenant.

| Table | WS | Mgr | Keys and uniqueness | Enforced | Risk / notes |
| --- | --- | --- | --- | --- | --- |
| `workspaces` | id | `owner_account_id` | PK `id` | `WorkspaceService` | none |
| `app_users` | ✓ | — | `username` **globally** UNIQUE | `listUsers`/`deleteUser`/`resetPassword` add WS ([auth.service.ts:363-489](../server/src/services/auth.service.ts)); login is global by design | Enumeration: duplicate → 500 (F-05); timing (F-09) |
| `app_sessions` | via user | — | PK random id | `getUserForSession` joins the user ([auth.service.ts:239-263](../server/src/services/auth.service.ts)) | none |
| `config` | ✓ | — | PK (ws, key) | Every getter/setter is WS-keyed ([settings.service.ts:77-85](../server/src/services/settings.service.ts), [config.ts:82-100](../server/src/routes/config.ts)) | Install keys read from `default` (F-06); `sync_interval_ms` (F-01) |
| `issues` | ✓ | — | PK (ws, jira_key) | `IssueService` normalises WS throughout ([issue.service.ts:80-728](../server/src/services/issue.service.ts)) | none *(verified)* |
| `developers` | ✓ | — | PK (ws, account_id) | Services and routes filter WS ([team.ts:408-427](../server/src/routes/team.ts)) | none *(verified: cross-ids return 404 or are no-ops)* |
| `alert_dismissals` | ✓ | ✓ | UNIQUE (ws, mgr, alert) | `alert.service` | none |
| `component_map`, `issue_tags`, `issue_scope_history`, `sync_log` | ✓ | — | PKs include ws | Sync/tags | none |
| `local_tags` | ✓ | — | UNIQUE (ws, name) | `TagService` | none *(verified)* |
| `team_tracker_days` / `_items` / `_checkins` | ✓ | — | UNIQUE (ws, date, dev); items by global id | Owned-row lookup, then write by id ([team-tracker.service.ts:2085-2100,2580-2594](../server/src/services/team-tracker.service.ts)) | Private check-ins and items are shared by **managers within a workspace** (F-12) |
| `team_tracker_saved_views`, `work_saved_views`, `task_saved_views` | ✓ | ✓ | UNIQUE (ws, mgr, name) | `getOwnedSavedViewRow`, then write ([team-tracker.service.ts:1225-1262](../server/src/services/team-tracker.service.ts), [work-saved-views.service.ts:105-138](../server/src/services/work-saved-views.service.ts)) | none *(verified)* |
| `developer_availability_periods` | ✓ | — | global id | Owned lookup ([developer-availability.service.ts:145-200](../server/src/services/developer-availability.service.ts)) | none |
| `standup_sessions`, `standup_reviews`, `today_visits`, `today_check_in_asks` | ✓ | ✓ | (ws, mgr, …) | today-state / team-tracker | none |
| `manager_desk_days` / `_items` / `_links` / `_item_history` | ✓ | days, history | Items by global id | `getOwnedItemRow`, then write ([manager-desk.service.ts:788-795,962-975](../server/src/services/manager-desk.service.ts)) | Legacy surface; new workspaces start canonical |
| `daily_notes`, `daily_note_captures`, `daily_note_follow_ups`, `daily_note_task_refs`, `daily_notes_fts` | ✓ | ✓ | UNIQUE (ws, mgr, date, kind); FTS joined back with ws+mgr ([daily-notes.service.ts:683-686](../server/src/services/daily-notes.service.ts)) | Service-wide (95 `managerAccountId` uses) | none *(verified)* |
| `tasks` | ✓ | via owner/tracker | id global; UNIQUE (ws, id), (ws, task_key) | `task-visibility.ts` adds WS plus visibility ([task-visibility.ts:15-25](../server/src/services/task-visibility.ts)); keys resolve per WS | Unowned tasks are visible to all managers in a WS (F-12) *(verified: owner's `T-1` returns 404 for the friend, whose own `T-1` is separate)* |
| `task_key_sequences`, `task_key_aliases` | ✓ | — | PK ws / (ws, alias) | task-keys | none |
| `task_events`, `checkin_task_refs` | ✓ | via author | UNIQUE (ws, dedupe) | `task-events.service` filters WS and visibility; edit and redact check WS ([task-events.service.ts:366-369](../server/src/services/task-events.service.ts)) | none *(verified)* |
| `task_inbox` | ✓ | recipient user | UNIQUE (ws, recipient, event) | `task-inbox.service.ts:18`; overrides rejected (`task-inbox.routes.test.ts:87`) | none |
| `task_links`, `day_focus` | ✓ | owner | include ws | task.service | none *(verified: links to the owner's Jira key, developer or contact are refused)* |
| `task_legacy_map` | ✓ | — | PK (source_table, source_id) | migration only | none |
| `task_labels` | ✓ | — | UNIQUE (ws, name) | task-labels.service | none *(verified)* |
| `contacts` | ✓ | ✓ | UNIQUE (ws, mgr, handle) | `get` then archive by id ([contacts.service.ts:108-111](../server/src/services/contacts.service.ts)) | none *(verified)* |
| `developer_notes` | ✓ | — | PK (ws, dev) | my-day | none |
| `assistant_conversations` | ✓ | ✓ | global id | `getOwnedConversation` checks ws and mgr ([assistant/service.ts:422-433](../server/src/assistant/service.ts)) | none *(verified)* |
| `assistant_messages` | via conversation | — | FK | Reached only through an owned conversation | none |
| `assistant_memories` | ✓ | ✓ | global id | assistant-memory.service | none *(verified: the owner's memory survives the friend's DELETE)* |
| `user_nav_preferences`, `manager_self_links`, `weekly_reviews` | ✓ | ✓ | PK/UNIQUE (ws, mgr, …) | Services | none *(verified for nav and self)* |
| `one_on_one_series` / `_sessions` / `_agenda_items` | ✓ | **—** | UNIQUE (ws, dev) | WS only; no manager column ([one-on-one.service.ts](../server/src/services/one-on-one.service.ts)) | 1:1 notes are shared by **managers within a workspace** (F-12) *(verified: cross-workspace 404)* |
| `projects`, `project_tracks`, `task_placements` | ✓ | ✓ | UNIQUE (ws, mgr, name) | `ProjectsService.scope` ([projects.service.ts:24-26](../server/src/services/projects.service.ts)) | none *(verified)* |
| `data_migrations` | — | — | PK name | Install-wide markers | F-08 (DB-wide operations gated per workspace) |

**Primary keys and unique indexes that omit `workspace_id`.** `app_users.username` (intended; see the identity decision in §4.3). Autoincrement integer ids for tasks, desk and tracker items, projects, contacts, views, conversations and so on are global, so they never collide. `idx_daily_note_follow_ups_item(item_id)`, `idx_task_links_one_primary_jira(task_id)`, `idx_tracker_items_manager_desk_item_id` and `task_legacy_map` are keyed on those global ids ([migrate.ts:464,546,777](../server/src/db/migrate.ts)). Natural keys (Jira keys, tag names, label names, task keys, developer account ids, contact handles, project names) are all composite with `workspace_id`. Duplicate Jira keys across workspaces are covered by [db.migrate.test.ts:111](../server/tests/db.migrate.test.ts). **No cross-tenant collision was found.**

### 3.2 Routes

Every mount is in [app.ts:175-250](../server/src/app.ts). "Probe" means the second manager called the route with the owner's ids and keys (§12.1); the results are in [§12.2](#122-probe-results-by-route).

| Router (endpoints) | Guard | Workspace and manager source | Probe result | Risk |
| --- | --- | --- | --- | --- |
| `auth` (11) | Per route ([auth.ts](../server/src/routes/auth.ts)) | `req.auth.user.workspaceId` for users/delete/reset; register uses the caller's ws | `/users` shows only the friend's own; developer login for the owner's roster → 400; delete/reset owner's dev → 404 | F-05, F-09, F-10 |
| `task-inbox` (3) | `requireAuth` | Session ([task-inbox.service.ts:18](../server/src/services/task-inbox.service.ts)) | Empty | none |
| `issues` (12) | `requireManager` | Session → `IssueService(ws)`; Jira writes via `jira-execution` ([jira-execution.service.ts:44](../server/src/services/jira-execution.service.ts)) | List empty; `OWN-1` → 404 for GET/PATCH/exclude | none (Jira transitions and comments not probed; covered by [jira-execution.test.ts:177](../server/tests/jira-execution.test.ts)) |
| `overview`, `alerts`, `suggestions` (2+2+3) | `requireManager` | Session | Zeros, empty, 404 | none |
| `team` (11) | `requireManager` | Session ([team.ts:408-427](../server/src/routes/team.ts)) | Empty; owner's dev PATCH → 404; DELETE → 200 but no row changed | none |
| `sync` (2) | `requireManager` | `syncNow(own ws)` ([sync.ts:7-46](../server/src/routes/sync.ts)) | `jiraConfigured: false` despite the owner's env Jira | none for data; F-01, F-07 |
| `config` (15) | `requireManager` | Session for all reads and writes | No owner value visible | **F-01, F-02, F-03, F-06** |
| `backups` (3) | `requireInstallManager` | Install | 403 ×3 | F-04 |
| `tags` (6) | `requireManager` | Session | 404 for the owner's tag/issue | none |
| `today`, `manager-actions` (4+2) | `requireManager` | Session; cache key ws+mgr+date+tz ([today.service.ts:331-339](../server/src/services/today.service.ts)) | Friend's own (empty) | F-11 (performance only) |
| `team-tracker` (24) | `requireManager` | Session | Board and views empty; owner view → 404 | none (item writes covered by [multi-workspace-isolation.test.ts](../server/tests/multi-workspace-isolation.test.ts)) |
| `my-day` (15) | `requireDeveloper` inside ([my-day.ts:110](../server/src/routes/my-day.ts)) | Developer's ws + account | Manager → 403 | none (cross-ws developer covered by the existing test) |
| `manager-desk` (16) | `requireManager` inside ([manager-desk.ts:251](../server/src/routes/manager-desk.ts)) | Session | Canonical item 1 → 404; lookups empty | none |
| `search` (1) | `requireManager` | ws + mgr ([search.service.ts:71-152](../server/src/services/search.service.ts)) | Empty for the owner's marker | none |
| `tasks` (15), `capture` (1), `task-views` (4), `task-labels` (4), `task-placements` (2) | `requireManager` | `principal(req)` / `projectActor(req)` ([projects.ts:9-13](../server/src/routes/projects.ts)) | Owner's `T-1` → 404 for read/PATCH/DELETE/events/links/top3; capture refuses the owner's parent, project, contact, developer, Jira key | none |
| `projects`, `project-tracks` (6) | `requireManager` | `projectActor` | 404 "unavailable" | none |
| `one-on-ones` (13) | `requireManager` plus the per-ws flag | Session | 404 for the owner's series (with the friend's flag on too) | F-12 |
| `review`, `contacts`, `notes`, `preferences`, `work` (3+3+9+2+4) | `requireManager` | Session | Friend's own or 404 | none |
| `assistant` (8) | `requireManager` | `requestAuth(req)` ws + mgr ([assistant.ts:49-56](../server/src/routes/assistant.ts)); tools get `toolContext(auth)` ([assistant/service.ts:392](../server/src/assistant/service.ts)) | Owner's conversation → 404; memory DELETE is a no-op on the owner's row | none for data; F-03 for `ai/test` |

**Request overrides.** A grep of routes, middleware and the assistant for `req.(query|body|params|headers).(workspace|workspaceId|managerAccountId)` and `x-workspace` found nothing. `accountId` parameters are roster ids that services resolve inside the session's workspace. Task inbox rejects recipient and workspace overrides ([task-inbox.routes.test.ts:87](../server/tests/task-inbox.routes.test.ts)). **The workspace always comes from the session.**

**Unscoped `where` clauses.** A scan of services, routes, the assistant and sync for `.where()` without a workspace term returned 150 hits. All were checked. Each follows an owned or scoped lookup (`existing.id`, `row.id`), filters by a parent id from a scoped row, or belongs to `app_users`/`app_sessions`, which are global by design. Examples: [work-saved-views.service.ts:128-137](../server/src/services/work-saved-views.service.ts), [one-on-one.service.ts:590-610](../server/src/services/one-on-one.service.ts), [manager-desk.service.ts:788-795](../server/src/services/manager-desk.service.ts). **None reads or writes by a request-supplied id alone.**

**Raw SQL (`rawDb`).** Request paths: `task-keys.service.ts:86` (sequence insert, ws param) and `daily-notes.service.ts` FTS (ws+mgr, above). Everything else is migrations and one-off task migration tooling: `task-cutover`, `task-contract`, `task-legacy-drop`, `task-phase2-*`, `canonical-start`, `backup.service` (`database.backup`) and `transaction.ts`. The tooling performs **DB-wide** DDL gated on one workspace (F-08).

### 3.3 Install-wide state

| State | Scope | Can a second manager reach it? | Evidence |
| --- | --- | --- | --- |
| Jira env vars (`JIRA_*`) | `default` only | **No.** The friend's `isJiraConfigured` is false while the owner's is true *(verified)* | [settings.service.ts:73-75,131-157](../server/src/services/settings.service.ts), [index.ts:49-70](../server/src/index.ts) |
| Runtime Jira token map | Keyed by ws | No | [runtime-credentials.ts:1-29](../server/src/runtime-credentials.ts) |
| Persisted Jira token / AI keys | `config` per ws, encrypted with **one install key** | No; responses mask them (`"****"`, `hasApiKey`) *(verified)* | [jira-credentials.service.ts](../server/src/services/jira-credentials.service.ts), [secret-crypto.ts:8,29-58](../server/src/services/secret-crypto.ts), [config.ts:291](../server/src/routes/config.ts) |
| Sync scheduler (one `setInterval`) | Install | **Yes**: the interval is the minimum across workspaces; any Jira save restarts it; the start gate reads `default` | [engine.ts:33-43,240-247](../server/src/sync/engine.ts), [config.ts:385-389,552-553](../server/src/routes/config.ts) |
| Sync status / log | Per ws | No | [sync.ts](../server/src/routes/sync.ts) |
| `jira_sync_scope_mode` | Per ws | No | [settings.service.ts:177](../server/src/services/settings.service.ts) |
| Backup schedule / dir / list / download | Install (read from `default`) | List, run and download → 403 *(verified)*; but `PUT /api/config` stores backup keys in the friend's ws, restarts the backup timer and `GET /api/config` reveals the directory *(verified)* | [backups.ts](../server/src/routes/backups.ts), [config.ts:357-393,267,299](../server/src/routes/config.ts) |
| Pre-reset snapshot | Install (whole DB) | **Yes, unthrottled** *(verified)* | [backup.service.ts:112-118](../server/src/services/backup.service.ts), [config.ts:733](../server/src/routes/config.ts), [workspace-maintenance.service.ts:75-76](../server/src/services/workspace-maintenance.service.ts) |
| Restore | CLI only, whole DB | No | [docs/23 Backups and restore](23-hostinger-domain-vps-deployment-runbook.md#backups-and-restore) |
| Data Maintenance resets | Per ws (+ mgr) | Own workspace only; the owner's rows are unchanged *(verified)* | [config.ts:695-760](../server/src/routes/config.ts) |
| Developer Access (logins) | Per ws | Own workspace only; mapping to the owner's roster → 400 *(verified)* | [auth.service.ts:147-166](../server/src/services/auth.service.ts) |
| Today cache | Map keyed ws:mgr:date:tz:delta | No leak; any write clears **all** keys | [today.service.ts:176,254-265,331-339](../server/src/services/today.service.ts), [app.ts:153-164](../server/src/app.ts) |
| Copilot rate limit | Map keyed ws+mgr | No | [assistant/service.ts:356](../server/src/assistant/service.ts) |
| Standup write lock | Map keyed ws+mgr | No | [team-tracker.service.ts:89,1406-1411](../server/src/services/team-tracker.service.ts) |
| Login throttle | Map keyed ip+username | Shared counters are expected | [auth.ts:68-115](../server/src/routes/auth.ts) |
| Legacy read-only triggers / table renames | Whole DB | CLI only (operator) | [task-cutover.service.ts:52-57](../server/src/services/task-cutover.service.ts), [task-contract.service.ts:199-222](../server/src/services/task-contract.service.ts), [task-legacy-drop.service.ts:205-224](../server/src/services/task-legacy-drop.service.ts) |
| Outbound HTTP (Jira, AI) | Per ws URL | **Yes**: any host; https required for Jira in production only; AI accepts http | [config.ts:130-149,161,175,219](../server/src/routes/config.ts), [client.ts:92](../server/src/jira/client.ts), [llm-client.ts:176-188](../server/src/assistant/llm-client.ts) |

**What `canManageInstall` gates today:** the `/api/backups` routes ([app.ts:196](../server/src/app.ts)), backup fields in `PUT /api/config/settings` ([config.ts:488-491](../server/src/routes/config.ts)), and `features.backups` ([auth.ts:129](../server/src/routes/auth.ts)). It does **not** gate the backup fields in `PUT /api/config` (F-06), the scheduler interval (F-01), or pre-reset snapshots (F-02).

### 3.4 Client

- **Query cache.** `AuthProvider` derives `authScopeKey = workspace:username:role:developerAccountId`. When it changes, the provider advances the auth epoch, clears scoped drafts and caches, and calls `queryClient.clear()`; logout advances the epoch ([AuthContext.tsx:38-103](../client/src/context/AuthContext.tsx)). **No path was found where one user's cached data is shown to the next user in the same browser** (read-only; [AuthContext.test.tsx](../client/src/test/AuthContext.test.tsx) covers the hint).
- **Browser storage** is namespaced by scope (`lead-os:<scope>:…`): drafts, Today snapshots, nav cache and defect-table filters ([today-snapshot-cache.ts](../client/src/lib/today-snapshot-cache.ts), [nav-preferences-cache.ts](../client/src/lib/nav-preferences-cache.ts), [daily-note-drafts.ts](../client/src/lib/daily-note-drafts.ts)). The only unscoped keys are `theme` and `lead-os:signed-in` ([session-hint.ts:7](../client/src/lib/session-hint.ts)); neither holds workspace data.
- **Landing and sign-in.** `/` without a session is the landing page; `/login` opens the dialog; other paths use `LoginPage` ([App.tsx:1192-1208](../client/src/App.tsx)). "Request access" is an external link that appears only if `VITE_LEADOS_ACCESS_URL` is set ([LandingPage.tsx:122-133](../client/src/components/landing/LandingPage.tsx), [landing-config.ts](../client/src/lib/landing-config.ts)). There is no sign-up UI.
- **Setup Wizard** runs once per install (`bootstrapOpen`). It covers account, Jira test and save, manager mapping, team discovery and developer access ([SetupWizard.tsx:347-546](../client/src/components/setup/SetupWizard.tsx)). A self-registered manager never sees it.
- **Empty states.** A new workspace gets Today with the Getting started card, an empty Tasks and Notes, Team and Work held back, and Settings with Data & Backups hidden (`features.backups: false`) *(verified features)*.

### 3.5 Existing tests and gaps

Cross-workspace assertions already exist in: [multi-workspace-isolation.test.ts:124,291](../server/tests/multi-workspace-isolation.test.ts) (legacy tracker, desk, tags, alerts, users, My Day, reset; task keys and events), `search.service.test.ts:409-528`, `daily-notes.service.test.ts:187-350`, `daily-notes.routes.test.ts:546`, `one-on-ones.test.ts:596`, `one-on-one-privacy.test.ts:279`, `projects.service.test.ts:25`, `nav-preferences.service.test.ts:152,207`, `assistant.service.test.ts:400`, `assistant.tools.test.ts:664`, `auth-reset-password.test.ts:111`, `config.routes.test.ts:365`, `sync.engine.test.ts:519`, `jira-execution.test.ts:177`, `canonical-start.test.ts:119`, `task-inbox.routes.test.ts:87`.

**Gaps:** no single test covers *every* route as workspace B against workspace A's ids, and nothing makes a newly added route prove isolation. Also untested: the scheduler interval across workspaces, pre-reset snapshot throttling, outbound URL guarding and body reflection, orphan workspaces on failed creation, install-admin semantics, Copilot key non-fallback at route level (only the service is tested), the Today cache with two workspaces, and any registration flow.

### 3.6 Findings to fix before registration opens

Severity: **blocker** means registration must not open; high, medium and low are prioritised after that.

| ID | Sev | Finding and evidence | Failure scenario | Fix (item) |
| --- | --- | --- | --- | --- |
| F-01 | **blocker** | The global sync interval is controlled by any manager. `syncIntervalMs: z.number().int().positive()` ([config.ts:43](../server/src/routes/config.ts)); the scheduler uses the minimum across syncable workspaces ([engine.ts:240-247](../server/src/sync/engine.ts)); every Jira save calls `syncEngine.start()` ([config.ts:385-386](../server/src/routes/config.ts)). *(verified: 300000 → 1)* | Friend B saves any Jira settings with `syncIntervalMs: 1`. The server re-syncs the owner's Jira (and B's) continuously, burning CPU and the owner's Jira rate limit. | Clamp to 5–1440 minutes; a fixed 60 s tick that syncs each workspace whose *own* interval has elapsed (SR-02) |
| F-02 | **blocker** | Unthrottled whole-install snapshots on reset. `createPreResetBackup` → `createBackup` with no throttle ([backup.service.ts:112-118](../server/src/services/backup.service.ts)); only `createRequestedBackup` is throttled (:103-110); pruning caps *scheduled* snapshots only (:294-297). Called from `POST /api/config/reset` (:733) and maintenance reset ([workspace-maintenance.service.ts:75-76](../server/src/services/workspace-maintenance.service.ts)). *(verified: 3 calls → 3 full snapshots containing the owner's data)* | B scripts the reset in a loop and fills the disk with copies of everyone's data; the owner's install stops writing. | Install-wide throttle (reuse a snapshot younger than 10 min) and a count cap on pre-reset snapshots (SR-03) |
| F-03 | **blocker** | SSRF with reflection. Jira base URL: any host, http allowed outside production ([config.ts:130-149](../server/src/routes/config.ts)); the Jira error includes the raw body ([client.ts:92](../server/src/jira/client.ts)); AI `baseUrl` is any `z.string().url()` including http in production ([config.ts:161,175,219](../server/src/routes/config.ts)); the AI error appends the provider message ([llm-client.ts:176-188](../server/src/assistant/llm-client.ts)). Saved URLs are also fetched by background sync and Copilot. *(verified with a local service on 127.0.0.1: both test endpoints returned its body)* | B points "Test connection" at `http://127.0.0.1:<port>/…`, another host on the VPS network, or a metadata address, and reads the response from the error text. | Shared outbound guard: in production, https only and no private/loopback/link-local/CGNAT/ULA targets after DNS resolution, checked at save, test and request time; an operator allow-list; no raw bodies in errors (SR-04) |
| F-04 | high | Install owner is implicit: `canManageInstall` = any manager of `default` ([middleware/auth.ts:96-98](../server/src/middleware/auth.ts)); the owner adding a co-manager puts them in `default` ([auth.ts:192-200](../server/src/routes/auth.ts)). | Someone the owner adds as a co-manager can download snapshots holding every friend's data and password hashes. | Explicit `app_users.is_install_admin`, migrated from today's rule (SR-05) |
| F-05 | high | Account creation is not atomic, and duplicates surface raw errors. Workspace creation runs before the user insert, outside a transaction ([auth.service.ts:139-182](../server/src/services/auth.service.ts), [workspace.service.ts:40-54](../server/src/services/workspace.service.ts)); a `UNIQUE` violation → 500, with `"UNIQUE constraint failed: app_users.username"` outside production ([errorHandler.ts:46-52](../server/src/middleware/errorHandler.ts)). *(verified: orphan workspace plus 8 config rows; 500 body)* | Each failed sign-up leaves an empty tenant; the 500-vs-201 difference is a username-existence oracle. | One transaction; 409 "That username is taken" (SR-07) |
| F-06 | medium | `PUT /api/config` accepts all backup fields (incl. `backupDirectory`) from any manager and restarts the install backup timer, while `/settings` refuses them ([config.ts:357-393](../server/src/routes/config.ts) vs :488-491); `GET /api/config` returns the server path (:267,299). *(verified)* | Inert rows in B's workspace and an info leak of the server path; a future change reading them per workspace would act on B's input. | Same 403 rule as `/settings`; omit the path for non-admins (SR-06) |
| F-07 | medium | The scheduler gate reads `default`: `start()` checks `isAutoSyncEnabled()` with no workspace ([engine.ts:35](../server/src/sync/engine.ts)); startup starts it only if some workspace is syncable ([index.ts:142-146](../server/src/index.ts)). | If the owner turns auto-sync off, no friend's Jira auto-syncs; a friend toggling auto-sync restarts the owner's timer. | Part of SR-02 |
| F-08 | medium | DB-wide legacy operations gated on one workspace: cutover triggers ([task-cutover.service.ts:52-57](../server/src/services/task-cutover.service.ts)), `tasks:contract` renames ([task-contract.service.ts:199-222](../server/src/services/task-contract.service.ts)) and `tasks:drop-legacy` ([task-legacy-drop.service.ts:205-224](../server/src/services/task-legacy-drop.service.ts)) check only `--workspace`. | The operator contracts `default`; a friend's workspace that is not canonical-from-start (e.g. created before P3-00a) loses its legacy tables. | Plan/apply refuse unless *every* workspace is canonical-from-start or at the required stage (SR-06) |
| F-09 | low | Login timing oracle: an unknown username skips scrypt ([auth.service.ts:207-209](../server/src/services/auth.service.ts)). | Usernames across tenants can be probed by response time. | Verify against a fixed dummy hash (SR-07) |
| F-10 | low | Public `GET /api/auth/bootstrap` returns the install-wide `userCount` ([auth.ts:133-144](../server/src/routes/auth.ts)). *(verified)* | Anyone learns how many people use the install. | Return only `bootstrapOpen` once users exist (SR-07; check the client uses only `bootstrapOpen`) |
| F-11 | low | Any successful write clears the whole Today cache ([app.ts:153-164](../server/src/app.ts)). | B's activity defeats the owner's 25 s cache; performance only. | Clear by `req.auth.user.workspaceId` (SR-06) |
| F-12 | low (by design) | Within one workspace, 1:1 series and notes have no manager column, unowned tasks are visible to every manager ([task-visibility.ts:15](../server/src/services/task-visibility.ts)), and private check-ins are manager-wide. | Only co-managers sharing a workspace see each other's 1:1 notes. Self-registration must never place someone in an existing workspace. | Design rule (§4.2); no code change |
| F-13 | low (disclosure) | The operator can read all tenants: snapshots and downloads include every workspace and password hash ([docs/23](23-hostinger-domain-vps-deployment-runbook.md#backups-and-restore)); one encryption key covers all secrets ([secret-crypto.ts:8](../server/src/services/secret-crypto.ts)). | A friend assumes privacy from the host. | Sign-up copy states it (SR-11) |
| F-14 | medium | No lifecycle for a self-registered tenant: a workspace owner cannot be deleted ([auth-user-maintenance.service.test.ts:66](../server/tests/auth-user-maintenance.service.test.ts)), and there is no workspace purge or export. | A friend asks to leave; their data stays. | CLI workspace purge (SR-10) |
| F-15 | low | Throttles are in memory, per IP+username, with no per-IP cap ([auth.ts:68-115](../server/src/routes/auth.ts)). | Username spraying from one IP; counters reset on restart. | Per-IP limiter for sign-up, invite check and login (SR-09) |
| F-16 | info | New-workspace defaults: attention-rule zone = server zone ([settings.service.ts:59](../server/src/services/settings.service.ts)); 1:1 off. *(verified)* | Friend in another zone gets wrong day boundaries; 1:1s missing. | Seed at sign-up (SR-09) |

**Areas checked with no finding:** cross-tenant reads and writes on every probed route *(verified)*; Jira credential use across tenants *(verified)*; Copilot keys and conversations *(verified)*; request-supplied workspace overrides (grep); Today cache key composition (code); client cache after switching accounts (code); developer logins mapped across workspaces *(verified)*; natural-key collisions (schema review plus existing migration test).

## 4. Design

### 4.1 Registration model — owner-generated single-use invite links

**Chosen.** The install admin creates an invite: `npm run auth:invite --workspace=server -- --create --note "Priya"`. The CLI prints `https://<host>/join?invite=<token>` once. The token is 32 random bytes, base64url-encoded, and stored only as a SHA-256 hash. It is single-use, expires after 7 days by default (`--expires-days`), and can be revoked (`--revoke <id>`). Listing (`--list`) shows the note, state and expiry, never the token.

**Kill switch.** The env var `LEADOS_REGISTRATION=off|invite` defaults to `off`. When off, every sign-up and invite endpoint answers 404, the same as an unknown route, and the client shows no sign-up UI. It is an operator setting in the production `.env`, so a compromised web session cannot turn it on. Turning it off is an edit plus a restart; revoking invites gives an immediate partial off.

**Abuse controls.** The invite token *is* the bot protection, because without one nothing can be created. A per-IP limiter covers `GET /api/auth/invite` and `POST /api/auth/signup` (for example 10 attempts per 15 minutes per IP, then a 15-minute lock). Phase 0 caps the two install-wide costs a tenant can drive: the sync interval and snapshots.

**Rejected:**

- *Open sign-up:* anyone on the internet gets the SSRF and disk surface, plus spam accounts; it needs CAPTCHA and quotas.
- *Shared invite code or allow-list:* a code leaks once and admits everyone; an allow-list needs email, which does not exist.
- *Owner-approved sign-up:* needs pending-account states, an approval UI and a notification channel, and the friend waits; it adds more code than invites for no gain with a handful of known people.
- *Owner creates the account and shares a password:* that already works via CLI, but the owner learns the password and the friend must change it.

### 4.2 Account and workspace creation flow

`POST /api/auth/signup` (new endpoint, available only when `LEADOS_REGISTRATION=invite`):

1. Validate the body with Zod: username rules (§4.3), display name 1–200, password rules, optional `timeZone` (must pass `isValidTimeZone`).
2. Hash the password *before* the transaction, because scrypt is async and slow and must not hold `BEGIN IMMEDIATE`.
3. `runInTransaction` ([transaction.ts:5-29](../server/src/db/transaction.ts)):
   - Load the invite by `token_hash`. If it is missing, used, revoked or expired, return **410** "This invite link is no longer valid." The message is the same for every case.
   - Check the username is free; if not, return **409** "That username is taken."
   - `WorkspaceService.createWorkspaceForManager(username, displayName)`. This always creates a **new** workspace; sign-up never joins an existing one (F-12).
   - Insert `app_users` with role `manager` and `is_install_admin = 0`.
   - `initializeWorkspace(id, { timeZone })`: canonical start (already called), `attention_rules.timeZone`, `one_on_one_enabled = true` (decided 2026-10-10, §11).
   - Mark the invite `used_at`, `used_by_user_id`.
4. Create the session (the `authenticate` insert, or a new `createSession(userId)`), set the cookie, and return **201** `AuthSessionResponse`.

**Failure.** Any error rolls back the workspace, config, user and invite update together. The invite stays usable, and no orphan remains. A crash after commit but before the cookie leaves a valid account the friend can sign into.

**Unchanged paths.** Bootstrap (`/register` with zero users), manager-creates-user (`/register` with a session, joining the caller's workspace) and the CLI keep their current behaviour and responses. SR-07 moves the CLI's workspace creation into the same transaction, which fixes F-05 there too.

### 4.3 Identity

- **Username, not email.** There is no mail, so an email address would be unverified decoration. Keep usernames **globally unique**: login takes only a username ([auth.service.ts:201-205](../server/src/services/auth.service.ts)), so per-workspace uniqueness would force a workspace picker or a slug in the login, and nothing gains from that. **Login does not change.**
- Username rules for sign-up: 3–40 characters, `[a-z0-9._-]`, starting with a letter or digit, compared lowercased (as today). Reserved: `admin`, `root`, `system`, `support`, `leados`, `default`, `api`, `null`. Put the regex in `shared/types.ts` so the client and server agree; this is a runtime export, so regenerate `shared/types.js` (§5.4).
- **Password policy.** Keep the shared 8–200 limits (`PASSWORD_MIN_LENGTH`), refuse a password equal to the username, and refuse a short inline list of the most common passwords. Raising the minimum only for sign-up would split the change-password rules in `SignInForm`.
- **Email verification: out of scope.** **Password reset:** the operator runs the existing `auth:reset-password` ([reset-auth-password.ts](../server/src/scripts/reset-auth-password.ts)), which signs the user out everywhere, and shares the new password out of band. A self-service reset link built on the invite-token table is an optional follow-up (§11).

### 4.4 Install admin versus workspace manager

- New column `app_users.is_install_admin` (0/1). A one-time migration sets it to 1 for active managers in `default`, preserving today's behaviour exactly. `canManageInstall` becomes `role === "manager" && is_install_admin === 1`; `AuthUser` carries it server-side only. Bootstrap sets it for the first account. Granting it is CLI-only, via a `--install-admin` flag on `auth:create-user`; it is never available through the API. Self-registered managers are always 0.
- **Install admin only:** backups (list, run, download, schedule, directory), restore (CLI), invites and the registration flag (CLI and env), the user list across workspaces (CLI), outbound allow-lists (env), and the legacy migration CLIs.
- **Every workspace manager:** everything inside their own workspace, including Jira and Copilot connections, roster, developer logins, co-manager creation in their own workspace, Data Maintenance resets (with the SR-03 snapshot policy), and settings.
- **Rejected:** keeping "manager of `default`" (implicit, and silently extended by co-managers); reusing the vestigial `admin` role (it fails `requireManager` everywhere, so the operator would need two accounts).

### 4.5 Jira

- **Already per workspace.** URL, email, project, encrypted token and sync scope live in `config` per workspace; env values feed only `default` ([index.ts:49-65](../server/src/index.ts)). **Keep it.** No credential migration is needed.
- **Sync becomes truly per workspace (SR-02).** A fixed 60 s scheduler tick; per-workspace `sync_interval_ms` clamped to 5–1440 minutes on write and read; each workspace syncs when *its* auto-sync is on and *its* interval has elapsed since its last run (from `sync_log`). `start()` no longer reads `default`; saving Jira settings never restarts a shared timer.
- **No Jira is fully supported.** Sync answers `skipped/jira_not_configured` ([engine.ts:135-141](../server/src/sync/engine.ts)), Work is held back from the nav, and Today's Getting started offers Jira as optional. *(verified for a new workspace)*
- Outbound guard on the base URL (SR-04). `JIRA_ALLOWED_HOSTS`, if set in production, must include the friends' Jira hosts (for example their `*.atlassian.net`); the current check is an exact hostname match ([config.ts:132-147](../server/src/routes/config.ts)), so SR-04 adds suffix matching (`.atlassian.net`).

### 4.6 Copilot and secrets

- Config and keys are already per workspace, with no env or owner fallback: `getResolvedConfig(ws)` reads only that workspace's rows ([assistant-config.service.ts:293-299](../server/src/services/assistant-config.service.ts)), and the assistant refuses when there is no key ([assistant/service.ts:349-351](../server/src/assistant/service.ts)). *(verified: the friend has `hasApiKey: false` while the owner has a key)* **Keep it.** Add a route-level test that a workspace without a key gets the "not configured" error even when another workspace has one.
- The AI `baseUrl` goes through the SR-04 guard; error text keeps the provider's message but drops raw bodies.
- Copy: the landing page says "Powered by Claude Sonnet 5.5". That is true only for a workspace configured that way; a friend's workspace starts with no provider (docs/56 LP-02 note). SR-11 adds a line on the join page that each workspace brings its own AI key.

### 4.7 Onboarding

`/join?invite=…` → create account → **Today**, with the existing Getting started card: connect Jira (optional), add people (optional), set up Copilot (optional). There is no Setup Wizard; it stays the install's first-run flow, and its steps (Jira, team, developer access) already exist in Settings. Seeds: `team_mode` solo (default), attention-rule `timeZone` from the browser, `one_on_one_enabled = true` (decided, §11). Settings for a self-registered manager shows no Data & Backups (already hidden by `features.backups`).

### 4.8 Data lifecycle

- **Workspace deletion (SR-10):** a CLI `auth:delete-workspace -- --workspace <id> --confirm <id> [--apply]`, dry-run by default. It lists row counts per table, refuses `default`, takes a backup first, and deletes every row with that `workspace_id`, plus the dependent `assistant_messages`, `app_sessions` for its users, the FTS rows (via triggers), and the `workspaces` row, in one transaction. An in-app "delete my workspace" is out of scope for a few friends.
- **Export:** out of scope for the first release. The operator can hand over a filtered copy on request. A per-workspace JSON export is a possible follow-up.
- **Backups stay per install.** A deleted workspace remains in snapshots until they age out (14 days by default; [settings.service.ts:30](../server/src/services/settings.service.ts)) and in any off-box copies. The join page says so.
- **Size:** each friend adds kilobytes to megabytes. Scheduled snapshots can reach 96 copies (`DEFAULT_BACKUP_MAX_SCHEDULED_SNAPSHOTS`, [settings.service.ts:31](../server/src/services/settings.service.ts)) of the whole DB, so disk use grows by roughly 96 × the DB growth. Check `du -sh data/` before and after rollout.

### 4.9 Enforcement strategy

**Chosen (proportionate):**

1. **A permanent route-matrix isolation test (SR-01).** It seeds workspace A with marker strings across every table family, then calls every route as manager B, and as developer B where relevant, using A's ids and keys. It asserts that no response contains A's markers or secrets and that a hash of A's rows (§12.1 `snapshot()`) is unchanged.
2. **Manifest completeness.** The test enumerates `app._router.stack` and fails if any route is not classified in the manifest (probed / install-admin / public / skipped with a reason). Adding a route therefore forces an isolation decision.
3. **Strict workspace mode for the harness.** With `LEADOS_STRICT_WORKSPACE=1`, `normalizeWorkspaceId` throws on an empty value instead of returning `default`. Install-scope callers (backup service, scheduler, startup) pass an explicit `INSTALL_WORKSPACE_ID` (`"default"`) constant. Any service call that forgets the session's workspace then fails the harness instead of silently reading the owner's data.
4. **Install-wide regression tests** for F-01…F-07 (interval, snapshots, outbound guard, admin flag, config hygiene).

**Rejected:**

- A repository layer that requires `workspaceId` on every query: rewrites 60+ services, high regression risk, and the probe found no leak to justify it.
- A custom ESLint rule for unscoped Drizzle queries: many false positives (owned-row follow-ups), and it cannot see raw SQL.
- Row-level security: SQLite has none.

## 5. Data model and API changes

### 5.1 Schema and migrations (all additive; nothing in `default` is rewritten)

```sql
-- SR-05: explicit install admin. Default 0; one-time marker install_admin_v1.
ALTER TABLE app_users ADD COLUMN is_install_admin INTEGER NOT NULL DEFAULT 0;
UPDATE app_users SET is_install_admin = 1 WHERE workspace_id = 'default' AND role = 'manager' AND is_active = 1;

-- SR-08: invites.
CREATE TABLE IF NOT EXISTS registration_invites (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash       TEXT NOT NULL UNIQUE,          -- sha256(token), hex
  note             TEXT,
  created_by       TEXT NOT NULL,                 -- operator label / username
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  used_at          TEXT,
  used_by_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  revoked_at       TEXT
);
```

Mirror both in [schema.ts](../server/src/db/schema.ts) and `migrate()` ([migrate.ts](../server/src/db/migrate.ts)). Neither table is workspace-scoped: both are install-level. Snapshots include them (token hashes only).

### 5.2 Endpoints

| Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/auth/invite?token=` (new) | public, per-IP limited, 404 when `off` | — | `{ valid: boolean }` (`InviteCheckResponse`) | 404, 429 |
| `POST /api/auth/signup` (new) | public, per-IP limited, 404 when `off` | `SignUpRequest { inviteToken, username, displayName, password, timeZone? }` | 201 `AuthSessionResponse` plus `Set-Cookie` | 400 validation, 409 username taken, 410 invite invalid, 429 |
| `POST /api/auth/register` | unchanged | unchanged | unchanged | duplicate → **409** instead of 500 (SR-07) |
| `GET /api/auth/bootstrap` | public | — | `{ bootstrapOpen, userCount? }` — `userCount` only while it is 0 (SR-07) | — |
| `PUT /api/config` | manager | backup fields → **403** unless install admin; `syncIntervalMs` 300 000–86 400 000 | unchanged | 403, 400 |
| `GET /api/config` | manager | — | `backupDirectory` only for install admins | — |
| `POST /api/config/test`, `/connection-health`, `/fields`, `/ai/test`, `PUT /api/config/ai`, `PUT /api/config/settings` | manager | URL guard (SR-04) | Errors without raw remote bodies | 400 "That address isn't allowed" |

### 5.3 Services

- `RegistrationService` (new): `checkInvite`, `signUp` (§4.2), `createInvite`/`listInvites`/`revokeInvite` (CLI).
- `WorkspaceService.initializeWorkspace(id, { timeZone, oneOnOne })`.
- `AuthService.createUser`: transactional workspace creation; unique violation → `HttpError(409)`; `authenticate` uses a dummy-hash compare; `createSession(userId)`.
- `SyncEngine`: per-workspace due check, fixed tick, clamp.
- `BackupService.createPreResetBackup`: install-wide throttle (reuse a snapshot under 10 minutes old), and keep the newest 10 `pre-reset` snapshots.
- `net/outbound-guard.ts` (new): `assertAllowedOutboundUrl(url, { purpose })`, used by `JiraClient.request`, `OpenAiCompatibleClient`, and the config routes.
- `canManageInstall(user)` reads `isInstallAdmin`.

### 5.4 Shared types (`shared/types.ts`)

Add `RegistrationMode`, `InviteCheckResponse`, `SignUpRequest`, `USERNAME_PATTERN` and `RESERVED_USERNAMES`. **The last two are runtime exports, so regenerate the committed `shared/types.js`** with the AGENTS.md command. `AuthUser` is unchanged: `isInstallAdmin` stays server-side, and the client keeps using `features.backups`.

## 6. Client changes

- **Routing ([App.tsx](../client/src/App.tsx)).** New unauthenticated view `join` for `/join`. It reads `invite` from the query string, calls `GET /api/auth/invite`, and renders the landing page with the dialog in **Create account** mode. A missing or invalid invite shows "This invite link is no longer valid. Ask the person who sent it for a new one." with a Sign in button. With a session, `/join` goes to `/`.
- **`SignUpForm`** (`components/auth/`), alongside `SignInForm`: username (with the shared pattern and an inline hint), display name, password with confirmation (shared limits), and the browser time zone sent silently. Field-level messages for 409 and 400, one message for 410, and "Too many attempts. Try again later." for 429.
- **Copy on the join form:** "This creates your own private LeadOS workspace. Nobody else using this server can see it. The person who runs the server can access its data and backups." The landing page keeps **Sign in** only. There is no public "Sign up" button: without an invite link there is nothing to sign up with. `VITE_LEADOS_ACCESS_URL` keeps working for "Request access".
- **`AuthContext.signUp(req)`** posts and then sets the user and features like `login` ([AuthContext.tsx:86-91](../client/src/context/AuthContext.tsx)). The existing scope-change effect clears the query cache, drafts and snapshots, so a browser previously signed in as the owner shows nothing of theirs. Add a test: sign in as A, log out, sign up as B, and assert the cache is empty and the scope keys changed.
- **`api.ts`** gets `checkInvite` and `signUp`; a `useSignUp` hook in `hooks/`.
- **Empty states:** no new ones needed (Today's Getting started, the Tasks/Notes empty states and nav availability already cover a blank workspace). Verify at 390 px and 1440 px, in light and dark.

### 6.1 UI design and verification gates

Before UI implementation, read and apply [frontend-design:frontend-design](../agent/skills/frontend-design/SKILL.md), then study the landing page, `SignInForm`, brand components, shared UI, `index.css` and `ThemeContext`. Use the existing Geist typography, spacing, radii and theme tokens. Accent-fill text uses `var(--on-accent)`; overlays use `var(--overlay-shadow)`. The direction is refined minimalism consistent with the landing page: clear hierarchy, generous whitespace, restrained colour, concise human copy and purposeful motion respecting reduced motion.

For each UI item, write a short design note before coding covering layout, copy and default, focus, error, loading, success, disabled and closed states. Reuse `Dialog`, `Popover`, `EmptyState`, `useToast`, TanStack Query hooks and `lib/api.ts`; extract shared password fields/hints into `components/auth/` rather than duplicating markup. Keep the invite flow short, allow switching between Sign in and Create account when the invite permits it, validate on blur or submit, show password requirements and show/hide controls, use correct autocomplete values, prevent duplicate submission and enter the new workspace smoothly. Authentication errors follow the enumeration policy in §7.

A fresh workspace must welcome its manager and offer one obvious next action in each empty state; optional onboarding remains skippable. Verify keyboard access, focus rings, dialog focus trap/return, linked labels and descriptions, announced errors, WCAG AA contrast in both themes and mobile targets of at least 44px. Check 375px phone, tablet and desktop widths for overflow and layout shifts.

Run each changed surface in a real browser against a scratch DB and scratch ports. Capture every applicable state at phone and desktop widths in light and dark, review rendered screenshots critically, and fix rough edges before accepting the item. Save final artifacts as `docs/screenshots/sr-NN-<surface>-<state>-<width>-<theme>.png`, referencing only the item's new screenshots in its progress row. Include focused behaviour tests for validation, submit/loading/errors, mode switching and auth cache reset. Phase reports must state what was visually checked and what was not; no UI item is complete without seeing it rendered. Registration controls remain CLI/env as specified in §4; any Settings surface changed by this work meets the same bar.

## 7. Security considerations

- **Throttling:** a new per-IP limiter (`[ip]` key, in memory; restarts reset it, which is acceptable here) for invite check, sign-up and login. The existing `[ip, username]` throttle stays. `TRUST_PROXY=loopback` must be set in production, or every client shares one IP ([docs/23](23-hostinger-domain-vps-deployment-runbook.md#client-ip-and-trust_proxy)); SR-13 checks it.
- **Sessions:** sign-up issues a fresh random session, the same as login; no session fixation, because the id is always server-generated. Logout deletes the row. Seven-day expiry unchanged.
- **Password storage:** scrypt as today. The dummy-hash comparison removes the timing oracle (F-09).
- **Enumeration:** login and change-password keep generic 401s. Sign-up reveals "username taken" only *after* a valid invite, so only an invitee can probe, and the limiter bounds it. Invite errors use one message for missing, used, expired and revoked. Bootstrap stops publishing `userCount`.
- **CSRF and cookie:** `SameSite=Lax`, `HttpOnly`, `Secure` in production. JSON bodies only (`express.json`); a cross-site HTML form cannot send `application/json`, and `Lax` withholds the cookie on cross-site POST. Sign-up needs no cookie. Considered and not required: an `Origin` check on unsafe methods. Note that `lead.` and `developer.` subdomains are same-site, which matters only if one of them were compromised.
- **Secrets:** per-workspace encrypted Jira and AI keys under one install key ([secret-crypto.ts](../server/src/services/secret-crypto.ts)); responses are masked; no fallback. Invite tokens are stored hashed and shown once. The CLI never logs the token after printing it.
- **Outbound requests:** SR-04, with residual DNS-rebinding risk between check and connect accepted for a friends-only install and documented (the check also runs immediately before each request).
- **Logging:** keep usernames and ids out of error responses; the existing logs record `managerAccountId` and `workspaceId`, which is fine for the operator.

## 8. Test plan

1. **`server/tests/tenant-isolation.routes.test.ts` (SR-01, permanent).** It builds on the probe in §12.1. Seed A through the real APIs and fixtures (task with private event, note, contact, project and track, label, task view, work and board views, tag, issue, roster member plus developer login, 1:1 series and session with notes, Copilot conversation, message and memory, AI key, Jira env). Seed B empty, with the 1:1 flag on. For every manifest route, call it as B (and as B's developer for `/api/my-day`) with A's ids and keys, then assert: no A marker, key or token in the body; status in the expected set (200 empty / 404 / 403); A's `snapshot()` unchanged. Run it with `LEADOS_STRICT_WORKSPACE=1`. Manifest completeness: fail on any unclassified `app._router` route.
2. **Two-workspace end-to-end scenario:** owner bootstraps → creates an invite (service) → the friend signs up through `POST /api/auth/signup` → captures `T-1`, writes a note, connects a fake Jira (mocked client), sets up Copilot (mocked LLM) → the owner's `T-1`, note, Jira state and AI key are unchanged, and the friend's Today and Tasks show only the friend's data. The friend logs out and the owner logs in; both see their own.
3. **Install-wide regressions:** interval clamp and per-workspace due logic (a 1 ms request → 400; one workspace's interval never changes another's schedule; the owner's auto-sync off does not stop a friend's); pre-reset throttle and count cap; outbound guard (loopback, RFC1918, link-local, CGNAT, IPv6 ULA/link-local, metadata, a DNS name resolving to private → refused in production mode; the allow-list overrides; error text without the remote body); install-admin flag (migration result; a co-manager added to `default` after migration is *not* admin; self-registered never admin); `PUT /api/config` backup fields → 403 for non-admins.
4. **Registration:** kill switch off → 404 for both endpoints; valid invite → 201, cookie, new workspace, canonical config, invite used; reuse → 410; expired/revoked → 410; taken username → 409 and the invite stays unused, no orphan workspace; reserved and invalid usernames → 400; limiter → 429; a crash inside the transaction (injected) → nothing persisted.
5. **Regression of existing paths:** `auth.routes.test.ts` bootstrap and manager-creates-user cases unchanged, apart from the duplicate → 409 (update that expectation); the `create-auth-user` CLI second manager still gets a new workspace; `multi-workspace-isolation.test.ts` unchanged.
6. **Client:** `SignUpForm` validation and errors; the `/join` routing states; the AuthContext cache reset across A → logout → B sign-up; landing tests unchanged when registration is off.

## 9. Implementation plan

Rules as in docs/70 and docs/71: sequential on `main` in the development checkout; one commit per item (`type(scope): summary (SR-NN)`); tick the item here and in docs/56 with a Progress log row in the same commit; scratch databases and mocked Jira and LLM only; no runtime data, push or deploy. Preserve existing untracked screenshots; commit only screenshots created for the current UI item. The owner authorized committing this plan and continuing all items on 2026-10-10; report after each phase without pausing between items. Registration remains off, and production rollout is operator-only.

### Progress log

| Date | Item | Commit | Validation / progress |
| --- | --- | --- | --- |
| 2026-10-10 | SR-PLAN | main (this commit) | Owner approved docs/72 and continuation through all items. Preserved the reviewed design and phase order, added the required UI acceptance gates, and made production rollout operator-only. Baseline validation is recorded with SR-01. No application code or data changed. |

| 2026-10-10 | SR-01 | main (this commit) | Baseline: typecheck PASS; full test PASS (1531 server / 2085 client). Added strict explicit-scope normalization and install constant, a 200-route classified inventory, foreign-id/query/header/body and developer probes with owner-table hashes, and an injected missing-scope search regression. Initial strict test failed against existing fallback; fixtures corrected to actual capture/developer schemas. Final tenant + legacy multi-workspace suites: 6 PASS. typecheck, build:check, guard:data and diff check PASS; new test lint clean (existing touched-source warnings remain). Skipped routes have recorded focused-suite reasons in the manifest; no runtime DB, Jira, push or deploy. |

| 2026-10-10 | SR-02 | main (this commit) | Four new regressions failed against the original scheduler (1ms write, unbounded stored interval, owner auto-sync gate, premature owner run). Added an idempotent 60s scheduler and due checks using each workspace last run, bounded reads/writes to 5–1440 minutes, removed timer restart on Jira save, and start the scheduler even before a connection exists. Added a no-restart route case; existing timer expectations updated for the reviewed policy. Final four targeted suites: 59 PASS. typecheck, build:check, new-test lint, guard:data and diff check PASS. One concurrent verification hit a fixture timeout; sequential rerun passed unchanged. No runtime data or real Jira calls. |

| 2026-10-10 | SR-03 | main (this commit) | Four cross-workspace regressions reproduced multiple whole-install snapshots, concurrent reset failure and the missing count cap. Pre-reset requests now coalesce, reuse a verified snapshot younger than ten minutes even after service restart, and keep only ten pre-reset files. Owner manual backups are retained. Code recheck found the existing reason label is pre reset (spaces); preserved it and used it for matching. Added an expiry-boundary case and a real reset route test with owner-row hashing. Final backup/config suites: 50 PASS; typecheck, build:check, touched-test lint, guard:data and diff check PASS. All files and DBs are isolated in temporary test directories. |

| 2026-10-10 | SR-04 | main (this commit) | Four mocked outbound regressions failed against original Jira/AI save/test/request paths and raw body reflection. Added one production https/public-DNS/IP policy using the existing ipaddr.js 1.9.1 parser, explicit operator exceptions and exact/leading-dot Jira host rules; request-time rechecks and manual redirect handling cover background Jira and streaming/nonstreaming Copilot. All proposed AI profile URLs validate before patch writes. Removed untrusted provider text from errors, retaining status-specific messages; updated the two prior body-reflection expectations. Current provider profiles extend the plan file list but share the same policy. Final six targeted suites: 86 PASS; typecheck, build:check, new-module/test lint, touched JSON format, guard:data and diff check PASS. DNS/fetch mocked; residual rebinding documented. Offline npm metadata cache was missing, so declared the already-locked parser directly without changing its version or artifacts. |

| 2026-10-10 | SR-05 | main (this commit) | Explicit server-only install authority; active legacy default managers migrated once, new managers unprivileged, trusted CLI --install-admin. Backup list/run/download regressions and public flag stripping pass. Representative scratch-copy hashes unchanged and repeated migration preserves revocation. Real CLI scratch regression included. Seven targeted suites: 141 PASS; typecheck, build:check, touched lint, guard:data and diff check PASS. Production inspection remains operator-owned. |

### Phase 0 — Isolation blockers (registration code must not merge before these)

- [x] **SR-01 Permanent tenant-isolation harness.**
  - *Scope:* §8.1, plus strict workspace mode and the `INSTALL_WORKSPACE_ID` constant for install-scope callers.
  - *Files:* `server/tests/tenant-isolation.routes.test.ts` (new), `server/tests/helpers/tenants.ts` (new), `services/workspace.service.ts`, `runtime-credentials.ts`, `services/backup.service.ts`, `sync/engine.ts`, `index.ts` (explicit install scope).
  - *Acceptance:* every route classified; the harness passes on the current code (the probe found no leak); deleting a `workspaceId` argument in any probed service call makes it fail.
  - *Rollback:* revert (test-only, plus the constant).
- [x] **SR-02 Per-workspace sync scheduling (F-01, F-07).**
  - *Scope:* fixed tick, clamp on write and read, per-workspace due check from `sync_log`, no `default` gate, no timer restart on save.
  - *Files:* `sync/engine.ts`, `services/settings.service.ts`, `routes/config.ts`, `index.ts`, `tests/sync.engine.test.ts`, `tests/config.routes.test.ts`.
  - *Acceptance:* §8.3 interval cases; existing sync tests pass.
  - *Rollback:* revert; stored intervals stay valid.
- [x] **SR-03 Bounded pre-reset snapshots (F-02).**
  - *Files:* `services/backup.service.ts`, `tests/backup.service.test.ts`, `tests/config.routes.test.ts`.
  - *Acceptance:* N resets in 10 minutes → 1 snapshot, reused; resets still succeed; at most 10 `pre-reset` files kept; owner-requested backups unaffected.
  - *Rollback:* revert.
- [x] **SR-04 Outbound URL guard (F-03).**
  - *Files:* `server/src/net/outbound-guard.ts` (new), `jira/client.ts`, `assistant/llm-client.ts`, `routes/config.ts`, `services/assistant-config.service.ts`, `.env.example` (`OUTBOUND_ALLOWED_HOSTS`, `JIRA_ALLOWED_HOSTS` suffix form), `docs/23`, tests `outbound-guard.test.ts`, `config.routes.test.ts`, `jira.client.test.ts`, `llm-client.test.ts`.
  - *Acceptance:* §8.3 guard cases; Jira errors carry status and a short message, not the body.
  - *Rollback:* revert. The owner's production AI URL is public (confirmed 2026-10-10), so no allow-list entry is needed for it. Before deploying, check `JIRA_ALLOWED_HOSTS` in the production `.env` (§10) and switch it to the suffix form if it is set.
- [x] **SR-05 Explicit install admin (F-04).**
  - *Before starting:* production has at least one workspace besides `default` (owner, 2026-10-10). Run the §10 read-only checks on a copy first, so the migration's admin set and F-08 are reviewed against real data.
  - *Files:* `db/schema.ts`, `db/migrate.ts`, `middleware/auth.ts`, `services/auth.service.ts`, `scripts/create-auth-user.ts`, `routes/auth.ts`, tests `backups.routes.test.ts`, `config.routes.test.ts`, `db.migrate.test.ts`, `auth.routes.test.ts`.
  - *Acceptance:* the existing default managers keep backups; a later co-manager does not; the error message no longer says "default workspace".
  - *Rollback:* revert code; the column is harmless if left.
- [ ] **SR-06 Install-config hygiene (F-06, F-08, F-11).**
  - *Scope:* backup fields → 403 in `PUT /api/config`; path hidden; Today cache cleared per workspace; legacy contract/drop and cutover refuse unless every workspace qualifies.
  - *Files:* `routes/config.ts`, `app.ts`, `services/today.service.ts`, `services/task-contract.service.ts`, `services/task-legacy-drop.service.ts`, `services/task-cutover.service.ts`, related tests.
  - *Rollback:* revert.
- [ ] **SR-07 Atomic account creation and honest errors (F-05, F-09, F-10).**
  - *Files:* `services/auth.service.ts`, `services/workspace.service.ts`, `routes/auth.ts`, `client` bootstrap hook (check it only reads `bootstrapOpen`), tests `auth.routes.test.ts`, the orphan case.
  - *Acceptance:* duplicate → 409 and no orphan; bootstrap response without `userCount` after first run.
  - *Rollback:* revert.

### Phase 1 — Registration backend (merged dark: `LEADOS_REGISTRATION` defaults to `off`)

- [ ] **SR-08 Invites and kill switch.**
  - *Files:* schema/migrate, `services/registration.service.ts` (new), `scripts/invite.ts` (new; `npm run auth:invite`), `server/package.json` script, `config.ts` env schema (`LEADOS_REGISTRATION`, `LEADOS_PUBLIC_URL`), tests.
  - *Acceptance:* create/list/revoke; the token is printed once and stored hashed; expiry.
  - *Rollback:* revert; the empty table is harmless.
- [ ] **SR-09 Sign-up endpoints, limiter and workspace initialisation (F-15, F-16).**
  - *Seeds:* `one_on_one_enabled = true`, attention-rule zone from the browser, `team_mode` solo.
  - *Files:* `routes/auth.ts`, `services/registration.service.ts`, `services/workspace.service.ts`, `shared/types.ts` plus regenerated `shared/types.js`, tests §8.2 and §8.4.
  - *Acceptance:* every §8.4 case; the SR-01 harness extended with the new public routes.
  - *Rollback:* revert; with the flag off, nothing is exposed.
- [ ] **SR-10 Workspace purge CLI (F-14).**
  - *Files:* `scripts/delete-workspace.ts` (new), `services/workspace-maintenance.service.ts` or a new `workspace-purge.service.ts`, tests (every workspace table emptied for the target, `default` refused, others untouched via `snapshot()`).
  - *Rollback:* revert.

### Phase 2 — Client (inert while the flag is off)

- [ ] **SR-11 Join page and sign-up form.**
  - *Files:* `App.tsx`, `components/auth/SignUpForm.tsx` (new), `components/landing/LandingPage.tsx`, `context/AuthContext.tsx`, `lib/api.ts`, `hooks/useSignUp.ts`, tests (§8.6).
  - *Acceptance:* Playwright on a scratch DB at 1440 and 390, light and dark: invite → Today; invalid invite; taken username; owner → logout → friend shows no owner data.
  - *Rollback:* revert.
- [ ] **SR-12 First-run check for a self-registered workspace.**
  - Verify the Getting started content and Settings visibility for a non-admin manager (no Data & Backups, no install-only copy). Small copy fixes only.
  - *Files:* `components/today/TodayGettingStarted.tsx`, Settings sections as needed, tests.

### Phase 3 — Open registration

- [ ] **SR-13 Rollout.**
  - Docs: AGENTS.md (routes, auth, commands), docs/23 "Inviting friends" section.
  - Prepare and verify the operator runbook and scratch dry run (§10). The operator performs the production-copy check and enables registration after review; this implementation never touches production or enables its registration.
  - *Acceptance:* documentation and isolated dry run complete; production-specific §10 checks remain explicitly operator-owned.
  - *Rollback:* set `off` and restart; revoke outstanding invites.

## 10. Migration and rollout

- **The owner's data is untouched.** No migration rewrites rows in `default`. SR-05 adds a column and sets it for existing `default` managers; SR-08 adds a table. Both are additive and idempotent, guarded by `data_migrations` markers like the existing `jira_sync_scope_pin_v1`.
- **Before deploying Phase 0:**
  1. On the production host, take a manual snapshot: **Back up now** in Settings, or let the scheduled backup run.
  2. Copy it off the box ([docs/23](23-hostinger-domain-vps-deployment-runbook.md#copy-backups-off-the-box)).
  3. Copy the DB into a scratch path and start the new build against the copy with Jira pointed at an unroutable host (as LP-01 did).
  4. Check: migration markers, the owner keeps the Data & Backups card, `/api/sync/status` unchanged, a second test workspace cannot see the owner.
- **Read-only checks before deploying Phase 0** (production lives in `/home/ubuntu/apps/lead-os-prod`; run against a copy of its DB, never the live file):
  - Workspaces and their managers. The owner reports one more workspace besides their own, so expect at least two rows:
    `sqlite3 <copy>.db "SELECT w.id, w.owner_account_id, u.username, u.role FROM workspaces w LEFT JOIN app_users u ON u.workspace_id = w.id AND u.is_active = 1 ORDER BY w.id"`
  - Task-model stage per workspace (F-08). Any value other than `2c`/`2d` blocks `tasks:contract`/`tasks:drop-legacy` once SR-06 lands:
    `sqlite3 <copy>.db "SELECT workspace_id, value FROM config WHERE key = 'tasks_phase2_stage'"`
  - Install-admin set under SR-05: every active manager in `default` becomes admin. If the extra account is a co-manager *inside* `default` rather than its own workspace, decide whether it should stay admin and clear the flag by CLI after the migration if not.
  - Env, printing only whether the keys are present (values stay private): `grep -oE '^(JIRA_ALLOWED_HOSTS|TRUST_PROXY)=' /home/ubuntu/apps/lead-os-prod/.env`. If `JIRA_ALLOWED_HOSTS` is set, it currently allows only exact hosts; friends' Jira hosts (e.g. `.atlassian.net`) must be added in the SR-04 suffix form before invites go out. `TRUST_PROXY=loopback` must be present.
- **Deploy** with `scripts/deploy.sh prod` from `/home/ubuntu/apps/lead-os-prod` only (docs/23 "One-Command Deploy"). Phases 0–2 can deploy with registration off and change nothing for the owner.
- **Turn on:** set `LEADOS_REGISTRATION=invite` (and `LEADOS_PUBLIC_URL=https://lead.daycommand.online`) in the production `.env`, restart the service, then `npm run auth:invite --workspace=server -- --create --note "<friend>"` from the production checkout and send the link privately.
- **Turn off:** set `LEADOS_REGISTRATION=off` and restart; `--revoke` outstanding invites. Existing friend accounts keep working. To remove one, use `auth:delete-workspace` (SR-10).
- **Watch:** `du -sh data/ data/backups/` weekly for the first month, and `sync_log` error counts per workspace.

## 11. Risks, open questions and out of scope

**Owner decisions (2026-10-10):** the recommendations in §4 are accepted, and:

1. **1:1s are on for new workspaces.** Sign-up sets `one_on_one_enabled = true` (SR-09).
2. **The production AI base URL is public.** SR-04 needs no allow-list entry for the owner's Copilot.
3. **`JIRA_ALLOWED_HOSTS` is probably set** (not confirmed). Check it with the §10 command before SR-04 deploys; if set, convert it to the suffix form and add friends' Jira hosts before sending invites.
4. **Production has at least one other workspace** besides the owner's. Before SR-05 and SR-06 deploy, run the §10 read-only checks on a copy to confirm whether it is a separate workspace or a co-manager in `default` (which decides the install-admin set) and its task-model stage (F-08).

**Risks:**

- *Residual DNS rebinding* in the outbound guard (accepted, documented).
- *In-memory limiters* reset on restart (accepted).
- *One SQLite file for everyone:* a corrupt DB or bad restore affects all tenants; restore is all-or-nothing, which the operator must explain to friends.
- *Operator visibility (F-13)* is inherent to a self-hosted install. It is disclosed, not engineered away.
- *Async `runInTransaction` on one connection* lets concurrent requests' statements join an open transaction ([transaction.ts:5-29](../server/src/db/transaction.ts)). This is a pre-existing property that sign-up inherits; a rollback could undo another request's interleaved write. Keep the sign-up transaction short, with the hash computed before it.

**Out of scope, with reasons:**

- Email, verification and reset mail: no infrastructure.
- OAuth/SSO: unnecessary for a few friends.
- Open sign-up and CAPTCHA: invites remove the need.
- Approval queue: more states than invites, no benefit.
- Shared workspaces between friends: F-12 shows managers in one workspace share 1:1 and unowned-task visibility. Doing this properly is its own project.
- Per-workspace backups, restore and download: SQLite snapshots are whole-file; this needs an export format.
- Self-service account deletion and export UI: CLI first.
- Quotas on rows or storage: not needed at this scale.
- An admin UI listing all users: CLI is enough.
- An audit log.

**Still to confirm on a production copy (§10):** the exact `JIRA_ALLOWED_HOSTS` value, what the extra production workspace is, and its task-model stage.

## 12. Appendix

### 12.1 Probe (throwaway, not committed)

These files lived in the session scratchpad, not the repository: `probe/vitest.config.mjs`, `probe/probe.test.ts` and `probe/orphan.test.ts`. The run used a scratch `DASHBOARD_DB_PATH`, owner Jira env pointed at `https://127.0.0.1:9`, a stubbed `syncEngine` (no Jira call), a real `BackupService` writing to a scratch directory, and a local HTTP server on 127.0.0.1 standing in for an internal service. The probe:

1. Bootstraps the owner through `POST /api/auth/register` and runs canonical start for `default`.
2. Seeds owner data through real APIs: roster member, captured task `T-1`, private task event, note, contact, project and track, task label, task view, work view, tag, AI config with key, developer login. Direct inserts cover an issue `OWN-1`, a 1:1 series and session, a Copilot conversation, message and memory, and a board view. Every marker contains `OWNERSECRET`.
3. Creates the friend with `AuthService.createUser` (the CLI path) → `workspace_<uuid>`.
4. Hashes every owner table row (`WHERE workspace_id='default'`, plus owned messages and users) before and after.
5. Calls 84 GET and 53 write requests as the friend in two rounds (the second with the friend's 1:1 flag on), then the install-wide checks.

**Results:**

- **0 owner rows changed** and **0 responses containing owner markers or secrets.** The only marker hit was `/api/search` echoing the query string itself.
- Install-wide checks:
  - `friendJiraConfiguredDespiteOwnerEnv: false`
  - scheduler interval `300000 → 1`
  - `PUT /api/config` stored the friend's `backup_directory`/`backup_enabled` (owner's backups still enabled)
  - 3 `POST /api/config/reset` → 3 full-DB snapshots, each containing owner markers
  - `/api/config/test` and `/api/config/ai/test` returned the internal service's body
  - `friendSeesAiKey: false`
  - duplicate username → 500 `UNIQUE constraint failed: app_users.username`
  - anonymous `/register` → 401
  - `features { tasksPhase3: true, teamMode: "solo", oneOnOne: false, backups: false }`
  - bootstrap `{ bootstrapOpen: false, userCount: 4 }`
  - the friend's first task key `T-1`, with the owner's `T-1` intact
- Orphan check: duplicate second-manager `createUser` → workspaces 2 → 3 and 8 orphan config rows.

### 12.2 Probe results by route

Statuses are what the friend received using the owner's ids and keys. "Empty" means the friend's own empty data.

- **GET 200 with only the friend's data or defaults:**
  - `auth/me`, `auth/users`, `today?date`, `manager-actions?date`, `tasks/view-counts`
  - `tasks?viewDef` (inbox, all, project filter), `tasks?view=all|developer`
  - `notes`, `notes/:date`, `notes/:date/context`, `notes/sources?itemIds=1,2,3`
  - `contacts`, `projects`, `task-views`, `task-labels`
  - `team/developers|workload|self|:id/issues`, `team-tracker?date`, `team-tracker/views`, `team-tracker/standup/session/latest`
  - `work/views`, `tags`, `tags/counts`, `issues`, `overview`, `alerts`, `search`
  - `config`, `config/ai`, `config/team-mode`, `config/attention-rules`, `config/maintenance/reset-preview`
  - `sync/status`, `preferences/navigation`, `one-on-ones` (flag on), `assistant/conversations`, `assistant/memory`
  - `review/week|weeks`, `task-inbox`, `manager-desk?date`, `manager-desk/lookups/developers|issues`
- **GET 404:** `tasks/T-1`, `/detail`, `/events`; `tasks/person/<owner dev>`, `tasks/person/owner`; `projects/1`; `tags/1/usage`; `issues/OWN-1`; `one-on-ones/:id`, `/agenda`, `/suggestions`; `assistant/conversations/1`; `suggestions/assignee/OWN-1`; `manager-desk/items/1/detail`.
- **GET 403:** `backups`, `backups/:name/download`, `my-day` (manager).
- **GET 400:** `config/fields` and `config/connection-health` (the friend has no Jira).
- **Writes 404 or 400 with no change:**
  - Tasks: PATCH, DELETE, events, links; `today/top3`.
  - Capture with the owner's parent, project, contact, developer or Jira key.
  - Contacts, projects and tracks, task-placements preview, task-views, task-labels, tags, issue PATCH and exclude.
  - Team PATCH and self; work and board views; Copilot conversation DELETE; 1:1 PATCH, sessions and agenda.
  - Developer login for the owner's roster; delete or reset of the owner's developer; desk items and links.
- **Writes 200 or 204 that are no-ops on owner rows:** `DELETE team/developers/<owner dev>` and `DELETE assistant/memory/1` (both scoped; they report success either way).
- **Writes 403:** `backups/run`, `config/settings` (backup fields).
- **Writes 200 in the friend's own workspace:** `config/maintenance/reset` and `config/reset` (each snapshot the whole DB: F-02).

### 12.3 Commands run

- `git status --short`; `ls`, `grep`, `sed` and `python3` scans over `server/src` (routes, services, assistant, sync, db), `client/src` and `docs`.
- An unscoped-`where` scanner (§3.2) and a handler scanner for routes without `req.auth`.
- `npx vitest run --config <scratch>/vitest.config.mjs --root <scratch>` (probe; 1 passed), then `PROBE_FILE=orphan.test.ts …` (1 passed).
- No production or runtime data, Jira, network access beyond 127.0.0.1, push or deploy.

### 12.4 Reviewed

- **Tables:** all 56 in [schema.ts](../server/src/db/schema.ts) plus `daily_notes_fts` ([migrate.ts:591-601](../server/src/db/migrate.ts)).
- **Routes:** all 30 route files (199 handlers) and the mounts in [app.ts](../server/src/app.ts).
- **Services in depth:** auth, workspace, settings, jira-credentials, runtime-credentials, sync engine, backup, config route, today cache, assistant service, config and tools (call scan), task-cutover, contract and legacy-drop, canonical start.
- **Client:** AuthContext, App routing, LandingPage, SignInForm, SetupWizard (step and API scan), storage helpers.

### 12.5 Not fully assessed

- Copilot chat end to end with tool execution (needs an LLM). Assessed by reading `toolContext` and the tool call scan, plus existing `assistant.tools.test.ts`.
- Jira-calling routes (`issues/:key/transition|comments`, `team/discover`, real sync). Assessed by reading and existing mocked tests.
- Developer `/api/my-day` writes across workspaces in canonical mode (covered for legacy items by the existing test).
- Weekly review PUT; standup seal; notes append and follow-ups and task-updates with foreign ids (schemas rejected the probe bodies; read-only inference that they use the same scoped helpers).
- The client in a real browser: no Playwright run in this research.
- Production configuration and data: deliberately not accessed.
