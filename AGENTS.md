# LeadOS Agent Context

Use this file as the initial high-level briefing for AI agents working in this repository. Keep future edits concise, current, and practical.

## Product Snapshot

LeadOS is a daily operating workspace for software engineering managers. It helps managers track people, work, Jira defects, risks, check-ins, meetings, follow-ups, and daily planning from one workspace.

Jira defects remain first-class, but Jira is now a connected work source rather than the whole product. Preserve existing defect dashboard behavior while supporting the broader LeadOS direction: manager attention, team visibility, daily execution, quick capture, and lightweight follow-through.

## Repository Shape

TypeScript monorepo with three npm workspaces:

- `client/`: React + Vite SPA. Entry points: `src/main.tsx`, `src/App.tsx`.
- `server/`: Express + SQLite backend. Runtime entry: `src/index.ts`; app factory: `src/app.ts`.
- `shared/`: cross-layer contracts in `shared/types.ts`. The committed `shared/types.js` is a CommonJS build artifact the server and its tests resolve at runtime — if runtime exports (constants, functions) are added to `types.ts`, regenerate it with `npx tsc shared/types.ts --outDir shared --module commonjs --target es2022 --strict --skipLibCheck --esModuleInterop --noUncheckedIndexedAccess`. The client aliases `shared/types` to the `.ts` source in `vite.config.ts`/`vitest.config.ts`, so it always sees live exports; type-only additions need no regeneration. `shared/capture-grammar.js` is the same kind of committed artifact for `capture-grammar.ts` (same flags, `npx tsc shared/capture-grammar.ts --outDir shared ...`); regenerate it when the grammar's runtime code changes.

Supporting folders:

- `data/`: repo-root runtime SQLite data, backups, and manual snapshots.
- `server/data/`: server-only test/config fixtures, not the runtime DB.
- `docs/`: product, architecture, workflow, deployment, and handoff docs. Current work is tracked in `docs/56-implementation-plan-solo-first.md` (plan, run rules, progress log) and specified in `docs/57-tasks-consolidation-spec.md`; production deploy and backup/restore steps are in `docs/23`.
- `agent/`: repo-local prompts and skills.
- `agent/.github/instructions/`: backend/frontend guidance for GitHub Copilot-style agents.
- `scripts/`: deploy, `check-db-artifacts.sh` (`npm run guard:data`, fails if runtime DB files are tracked), and legacy worktree scripts.

## App Surfaces and Routing

Routing is custom in `client/src/App.tsx` using `window.history.pushState` and `popstate`; the app does not use React Router.

Canonical routes:

- `/`: Today, the manager daily command view (`focus.plan` is my plan; up to three tasks can be pinned per day with `PUT /api/today/top3` and lead the queue).
- `/work`: Jira defect and work triage dashboard.
- `/team`: Team Tracker for day plans, current work, status, check-ins, attention signals, saved views, and carry-forward.
- `/tasks`: the Tasks workspace (`?view=<id>` plus filter overrides; `?task=` opens the drawer). Built-in views: Planned today, Inbox, My tasks, Waiting / Delegated (`waiting`, the old Follow-ups), Meetings (`meetings`, with `n/m actions` from child tasks), Later, Needs attention, Closed · last 7 days; saved views are per manager. Needs Phase 3 (stage `2c`); a workspace with no task data starts there (`db/canonical-start.ts`, run by `migrate()` and on workspace creation), and workspaces with legacy data keep the cutover tooling. `/desk` is the legacy Manager Desk page and the same route in a workspace without Phase 3.
- `/notes`: manager-private daily scratchpad (`?date=YYYY-MM-DD`), served by `/api/notes`; never part of Manager Desk or Today data.
- `/settings` (`?section=<id>` deep-links a section): Navigation, Day Rhythm, Attention Rules, Jira Connection, Sync Scope, Copilot, Team Members (incl. `team_mode`), Defect Tags, Task Labels, **Data & Backups** (`data`: schedule, Back up now, snapshot list and download; restore is CLI-only), Data Maintenance (typed-confirmation resets), and Developer Access. Reset configuration also needs a typed phrase, checked on the server.
- `/my-day`: developer-only daily workspace for current, planned, completed, and dropped work plus check-ins.

Legacy paths normalize in `App.tsx`: `/dashboard` -> `/work`, `/team-tracker` -> `/team`, `/manager-desk` -> `/desk`, `/today` -> `/`. `/follow-ups` and `/followups` redirect to `/tasks?view=waiting`, `/meetings` and `/meeting` to `/tasks?view=meetings` (`legacyTaskViewRedirect` in `App.tsx`; the rest of the query string is kept). The server still accepts `follow-ups` / `meetings` in action targets, nav preferences and `list_tasks` for one release (docs/57 P7-13); Today rows now target `view: "tasks"` with a `taskView`.

Header nav is Today (always first) | Tasks | Team | Work | Notes by default. Each manager's layout (`GET/PUT /api/preferences/navigation`, edited in Settings → Navigation) places every page in the top bar, the More menu, or Hidden. Team is held back until the roster has someone and Work until Jira is connected (`applyNavAvailability` / `useNavAvailability`; nothing is deleted from the saved layout), so a solo manager sees Today | Tasks | Notes. Hidden and held-back pages still open by URL and from the palette.

Work (`?filter/dev/tag/noTags`), Team (`?q/filter/sort/group/view`), and Desk (`?date`) keep their filter state in the URL (see `client/src/lib/view-params.ts`), so views are shareable; changes sync back with debounced `replaceState`. Ctrl/Cmd+K opens the global command palette (`client/src/components/palette/`), which searches issues, desk items, check-ins, and developers via `/api/search`, and can jump anywhere or run capture/sync.

First-run setup opens the Setup Wizard for manager account creation, Jira connection, manager mapping, team selection, and developer access.

## Frontend Map

Feature folders under `client/src/components/`:

- `layout/`: shell, header, navigation, dashboard layout.
- `ui/`: shared primitives: `Dialog` (the one modal shell, focus-trapped, portal), `Popover`, `Kbd`, `ShortcutSheet`, `EmptyState`.
- `actions/`: manager action inbox (header).
- `today/`: manager daily command view.
- `work/`, `filters/`, `table/`, `triage/`, `alerts/`, `workload/`: Work dashboard and defect triage.
- `team-tracker/`: manager team board and developer day tracking.
- `my-day/`: developer workspace and shared login screen.
- `manager-desk/`: Desk workspace, item drawer, rhythm lists, carry-forward, linked issue/developer workflows.
- `tasks/`: the Tasks workspace (list, views rail, drawer, menus, task page).
- `notes/`: private daily Notes workspace (sidebar history, editor, follow-up creation).
- `assistant/`: Copilot dock, chat thread, tool chips, action confirm cards.
- `capture/`: global capture dialogs and capture forms.
- `palette/`: Cmd+K command palette and global search results.
- `settings/`, `setup/`: configuration, maintenance, users, bootstrap, onboarding.
- `brand/`: LeadOS brand primitives.

Frontend conventions:

- Use TanStack Query hooks in `client/src/hooks/` for API data and mutations.
- Use `client/src/lib/api.ts` for network calls; avoid ad hoc `fetch` calls in components.
- Creating a task from the UI goes through `POST /api/capture` (the shared grammar in `shared/capture-grammar.ts`): use `useCapture` (the capture box) or `useCaptureTask` (inline add, dialogs, child tasks), and pass structured context as `defaults` (owner, date, parent, links, note source) instead of injecting tokens into the text. `POST /api/tasks` stays for services, Copilot and 1:1s; it is not a UI path. The one deliberate exception is assigning work to a developer's day (Team board add, Jira triage "Add to tracker", `useAddTrackerItem` → `POST /api/team-tracker/:id/items`): it enforces availability, takes a description and returns the board item, so it keeps its own endpoint and never runs the title through the grammar. Capture resolves dates and stored clock times in the client's zone (`clientToday` and `tz` on the request); send both from any new caller. `@`/`#`/`+` typeahead is `useCaptureTypeahead`.
- App-wide providers live in `client/src/context/` for auth, theme, and toast state.
- `client/src/types/index.ts` re-exports `shared/types`; `client/src/types/manager-desk.ts` adds UI labels/mappings.
- Prefer `@/` imports and shared contracts from `shared/types`.
- Modals use `components/ui/Dialog` (`role="alertdialog"` for destructive confirms). Destructive actions ask for a typed phrase and list what is lost, not `window.confirm`.
- Toasts (`useToast`): errors persist until dismissed and are announced as `role="alert"`; other toasts last 5 s; all pause while hovered or focused; an identical toast raised again is de-duplicated.
- Text on an accent fill uses `var(--on-accent)`, never a literal white; overlays use `var(--overlay-shadow)`.

## Backend Map

Routes live in `server/src/routes/`: `auth`, `config`, `issues`, `overview`, `team`, `team-tracker`, `my-day`, `manager-desk`, `manager-actions`, `today`, `search`, `work` (Work dashboard saved views), `alerts`, `suggestions`, `sync`, `tags`, `backups` (manager-only: list, `POST /run`, `GET /:name/download`; restore stays the `backup:restore` CLI), `assistant` (manager-only `/api/assistant` Copilot chat/confirm/conversations), `contacts` (manager-private external people a task can wait on), `tasks`, `task-views`, `task-labels`, `capture` (the shared capture grammar endpoint), `notes` (private daily notes), `one-on-ones`, and `preferences` (per-manager navigation layout).

Services live in `server/src/services/` and cover issues, workload, alerts, automation suggestions, settings/config, tags, backups, auth, Team Tracker, My Day, Manager Desk, developer availability, workspace maintenance, and board query logic.

Infrastructure:

- `server/src/db/`: Drizzle schema, SQLite connection, migrations, transactions, path helpers.
- `server/src/jira/`: Jira client, JQL helpers, Jira-facing types.
- `server/src/assistant/`: LeadOS Copilot — OpenAI-compatible LLM client, tool registry, prompts, NDJSON chat/confirm service (write tools always require confirm); tool registry covers reads + confirm-gated writes across Today, desk, tracker, issues, notes, alerts, tags, carry-forward, and saved views.
- `server/src/sync/`: scheduled Jira sync engine.
- `server/src/middleware/`: auth, validation, error handling.
- `server/src/scripts/`: restore, user creation, and Manager Desk cleanup CLI helpers.

Backend conventions:

- Keep routes thin; put validation in Zod schemas and business logic in services.
- Update route, service, and `shared/types.ts` together for backend capability changes.
- Preserve global error responses as `{ error, status }`.
- Keep Jira calls out of route handlers; use Jira/sync services.
- Use Drizzle schema and connection modules instead of scattered raw SQLite access.

## Data, Auth, and Runtime

- Runtime SQLite lives under repo-root `data/`.
- Schema is in `server/src/db/schema.ts`; migrations run on backend startup.
- Backend startup initializes backups and scheduled Jira sync in `server/src/index.ts`.
- Production serves `client/dist` for non-API routes when built.
- Workspace `team_mode` (`solo` default | `collab`, `GET/PUT /api/config/team-mode`, `features.teamMode` on every session) plus per-developer `participates` (an active developer `app_users` row maps to them) decide the freshness clock: `collab && participates` keeps the check-in clock, everyone else uses the manager-touch clock (`tracker-freshness.ts`). Participation flows (asks, stale check-ins, "Quiet since standup", idle alerts) apply only on the check-in clock. Thresholds live in one Attention rules block (`AttentionRules` in `shared/types.ts`, `GET/PUT /api/config/attention-rules`, Settings → Attention Rules); hour rules count working time (`working-hours.ts`). Writes under `/api/config` and `/api/team` clear the Today cache.
- Auth uses the `dcc_session` cookie.
- The first app account must be a manager.
- Most API routes are manager-only.
- Developer users route to `/my-day`; developer API access is primarily through `/api/my-day`.
- Jira sync scope (`jira_sync_scope_mode`): `team_and_unassigned` (default: roster plus unassigned issues, works with an empty roster), `team_assignees` (roster only) or `base_query` (exact JQL). Workspaces that already had issues or Jira settings when the default changed were pinned to `team_assignees` by the `jira_sync_scope_pin_v1` migration. `GET /api/sync/status` carries `syncScope: { mode, rosterSize }` for the Work empty-state diagnostic.
- Jira config is a mix of env vars and persisted SQLite settings. The live Jira API token is handled by runtime credentials/config flows; never hardcode or commit secrets.
- Copilot config lives in the `config` table (`ai_assistant_enabled`, `ai_provider`, `ai_base_url`, `ai_model`, `ai_max_tool_iterations`, `ai_response_style`, `ai_suggest_followups`, encrypted `ai_api_key`) via `GET/PUT /api/config/ai` + `POST /api/config/ai/test`; Cmd/Ctrl+J toggles the dock. Replies stream via provider SSE (`delta`/`reasoning_delta` NDJSON events), follow-up chips via `followups`, and `retry: true` on `/chat` regenerates the last answer.

## Commands and Validation

Run from repo root:

- Install/dev: `npm install`, `npm run dev`, `npm run dev:server`, `npm run dev:client`.
- Quality gates: `npm run lint`, `npm run format:check`, `npm run guard:data`.
- Validate/build: `npm run typecheck`, `npm run build:check`, `npm run build`, `npm run start`.
- Tests: `npm run test`, `npm run test --workspace=client`, `npm run test:coverage`.
- Ops: `npm run backup:restore -- <path-to-backup-db>`, `npm run manager-desk:cleanup-carry-forward -- <args>`, `npm run tasks:drop-legacy --workspace=server -- --workspace <id> [--apply]` (dry-run default; drops `legacy_*` archives once stage `2d` + `p2_contract` have soaked 30 days), `npm run one-on-one --workspace=server -- --workspace <id> [--status|--enable|--disable]` (`one_on_one_enabled` toggle for the manager-private 1:1 workspace, `/team?dev=<id>&panel=one-on-one`), `npm run one-on-one:topics --workspace=server -- --workspace <id> [--keys T-1,T-2 --apply]` (P0-S5: lists legacy developer-owned 1:1 topics; dry-run default; `--apply` moves the picked keys to manager ownership), `npm run team-mode --workspace=server -- --workspace <id> [--status|--set solo|collab]` (workspace `team_mode`; default `solo`, also in Settings → Team Members).
- Task migration tooling (`tasks:cutover`, `tasks:stage`, `tasks:contract`, `tasks:phase3`, `tasks:export-legacy`; see docs/57 and `docs/PHASE2_PRODUCTION_RUNBOOK.md`) is one-off; run it against a copy first.
- Users: `npm run auth:create-user --workspace=server -- --username <name> --password <password> --display-name <display> --role <manager|developer> [--developer-account-id <id>]`. Delete a user (dry run first with `--dry-run`): `npm run auth:delete-user --workspace=server -- --username <name> --workspace-id <id> --role <manager|developer> --confirm <name> [--purge-private-data]`. Reset a password (signs the user out everywhere; prefer stdin): `printf '%s' <password> | npm run auth:reset-password --workspace=server -- --username <name> --password-stdin`. Behind nginx/cloudflared set `TRUST_PROXY=loopback` (see docs/23).
- Deploy/worktrees: `npm run deploy:prod`, `npm run sync:worktrees`.

Windows users can use `run-node20.ps1` modes: `all`, `install`, `build`, `test`, `dev`, `client-dev`, `client-build`, `client-test`.

Preferred handoff validation: `npm run typecheck`, `npm run build:check`, plus targeted backend or frontend tests when behavior changed.

## Testing Notes

- Vitest is used in both workspaces.
- Backend tests: `server/tests/**/*.test.ts`, Node environment.
- Frontend tests: `client/src/test/**/*.test.tsx?`, jsdom with `client/src/test/setup.ts`.
- Backend coverage thresholds in `server/vitest.config.ts`: 80% lines/statements/functions and 70% branches for `src/services/**/*.ts`.
- Route behavior changes should usually include route-level tests and service coverage.
- Shared view logic changes should include focused frontend tests near the affected feature.

## Coding Conventions

- Use strict TypeScript and existing local patterns.
- Frontend mostly uses single quotes; backend mostly uses double quotes.
- React component filenames are `PascalCase`; hooks are `useX.ts`.
- Keep data fetching/mutations in hooks and `client/src/lib/api.ts`.
- Keep UI components focused; split large components before they become hard to maintain.
- Separate UI from business logic and data access.
- Reuse `shared/types.ts` instead of redefining API payloads locally.
- Preserve manager-only and developer-only role boundaries.
- Use `.env.example` as the local env template; do not commit secrets.

## Environment and Deployment

- Node 20 is expected for reliable `better-sqlite3` native installs.
- `.env`, `.env.local`, and `.env.development.local` load from the workspace root.
- Frontend dev proxy settings use `VITE_API_PORT` or `VITE_API_PROXY_TARGET`; non-local proxy targets require `ALLOW_REMOTE_DEV_PROXY=true`.
- Development checkout: `/home/ubuntu/Development/lead-os`.
- Production checkout: `/home/ubuntu/apps/lead-os-prod`.
- Development and production have separate working directories and SQLite data paths.
- Production manager URL defaults to `https://lead.daycommand.online`; developer URL defaults to `https://developer.daycommand.online`.
- Production deploys must run only from `/home/ubuntu/apps/lead-os-prod` or via `scripts/deploy.sh prod`, which resolves to that checkout and refuses unsafe states.

## Working Rules

- This is a solo project: work happens sequentially in `/home/ubuntu/Development/lead-os` directly on `main`. No worktrees and no task branches unless asked (`npm run sync:worktrees` is a legacy helper).
- Start from a clean `git status`, keep changes task-scoped, and make one commit per item (`type(scope): summary (ITEM-ID)`) so it can be reverted alone. Track items in docs/56 (tick the box and add a Progress log row in the same commit).
- Do not push or deploy unless asked. Never run against runtime data, and never trigger a real Jira sync or write: use test DBs and mocked Jira clients.
- Start a checkout from its own root with `npm run dev`; ports come from that checkout's env files. Do not deploy production from the development checkout.
