# LeadOS Agent Context

Use this file as the initial high-level briefing for AI agents working in this repository. Keep future edits concise, current, and practical.

## Product Snapshot

LeadOS is a daily operating workspace for software engineering managers. It helps managers track people, work, Jira defects, risks, check-ins, meetings, follow-ups, and daily planning from one workspace.

Jira defects remain first-class, but Jira is now a connected work source rather than the whole product. Preserve existing defect dashboard behavior while supporting the broader LeadOS direction: manager attention, team visibility, daily execution, quick capture, and lightweight follow-through.

## Repository Shape

TypeScript monorepo with three npm workspaces:

- `client/`: React + Vite SPA. Entry points: `src/main.tsx`, `src/App.tsx`.
- `server/`: Express + SQLite backend. Runtime entry: `src/index.ts`; app factory: `src/app.ts`.
- `shared/`: cross-layer contracts in `shared/types.ts`. The committed `shared/types.js` is a CommonJS build artifact the server and its tests resolve at runtime — if runtime exports (constants, functions) are added to `types.ts`, regenerate it with `npx tsc shared/types.ts --outDir shared --module commonjs --target es2022 --strict --skipLibCheck --esModuleInterop --noUncheckedIndexedAccess`. The client aliases `shared/types` to the `.ts` source in `vite.config.ts`/`vitest.config.ts`, so it always sees live exports; type-only additions need no regeneration.

Supporting folders:

- `data/`: repo-root runtime SQLite data, backups, and manual snapshots.
- `server/data/`: server-only test/config fixtures, not the runtime DB.
- `docs/`: product, architecture, workflow, deployment, and handoff docs.
- `agent/`: repo-local prompts and skills.
- `.github/instructions/`: backend/frontend guidance for GitHub Copilot-style agents.
- `scripts/`: deploy and worktree maintenance scripts.

## App Surfaces and Routing

Routing is custom in `client/src/App.tsx` using `window.history.pushState` and `popstate`; the app does not use React Router.

Canonical routes:

- `/`: Today, the manager daily command view.
- `/work`: Jira defect and work triage dashboard.
- `/team`: Team Tracker for day plans, current work, status, check-ins, attention signals, saved views, and carry-forward.
- `/desk`: Manager Desk for capture, planning, decisions, linked people, and linked Jira issues.
- `/follow-ups`: focused manager follow-up workflow backed by the Manager Desk data model.
- `/meetings`: lightweight meeting notes/actions workflow backed by the Manager Desk data model.
- `/notes`: manager-private daily scratchpad (`?date=YYYY-MM-DD`), served by `/api/notes`; never part of Manager Desk or Today data.
- `/settings`: Jira config, field discovery, team membership, app users, backups, and workspace maintenance.
- `/my-day`: developer-only daily workspace for current, planned, completed, and dropped work plus check-ins.

Legacy paths normalize in `App.tsx`: `/dashboard` -> `/work`, `/team-tracker` -> `/team`, `/manager-desk` -> `/desk`, `/today` -> `/`, `/followups` -> `/follow-ups`, `/meeting` -> `/meetings`.

Work (`?filter/dev/tag/noTags`), Team (`?q/filter/sort/group/view`), and Desk (`?date`) keep their filter state in the URL (see `client/src/lib/view-params.ts`), so views are shareable; changes sync back with debounced `replaceState`. Ctrl/Cmd+K opens the global command palette (`client/src/components/palette/`), which searches issues, desk items, check-ins, and developers via `/api/search`, and can jump anywhere or run capture/sync.

First-run setup opens the Setup Wizard for manager account creation, Jira connection, manager mapping, team selection, and developer access.

## Frontend Map

Feature folders under `client/src/components/`:

- `layout/`: shell, header, navigation, dashboard layout.
- `today/`: manager daily command view.
- `work/`, `overview/`, `filters/`, `table/`, `triage/`, `alerts/`, `workload/`: Work dashboard and defect triage.
- `team-tracker/`: manager team board and developer day tracking.
- `my-day/`: developer workspace and shared login screen.
- `manager-desk/`: Desk workspace, item drawer, rhythm lists, carry-forward, linked issue/developer workflows.
- `manager-memory/`: Follow-ups and Meetings views.
- `notes/`: private daily Notes workspace (sidebar history, editor, follow-up creation).
- `capture/`: global capture dialogs and capture forms.
- `palette/`: Cmd+K command palette and global search results.
- `settings/`, `setup/`: configuration, maintenance, users, bootstrap, onboarding.
- `brand/`: LeadOS brand primitives.

Frontend conventions:

- Use TanStack Query hooks in `client/src/hooks/` for API data and mutations.
- Use `client/src/lib/api.ts` for network calls; avoid ad hoc `fetch` calls in components.
- App-wide providers live in `client/src/context/` for auth, theme, and toast state.
- `client/src/types/index.ts` re-exports `shared/types`; `client/src/types/manager-desk.ts` adds UI labels/mappings.
- Prefer `@/` imports and shared contracts from `shared/types`.

## Backend Map

Routes live in `server/src/routes/`: `auth`, `config`, `issues`, `overview`, `team`, `team-tracker`, `my-day`, `manager-desk`, `manager-actions`, `search`, `work` (Work dashboard saved views), `alerts`, `suggestions`, `sync`, `tags`, `backups`.

Services live in `server/src/services/` and cover issues, workload, alerts, automation suggestions, settings/config, tags, backups, auth, Team Tracker, My Day, Manager Desk, developer availability, workspace maintenance, and board query logic.

Infrastructure:

- `server/src/db/`: Drizzle schema, SQLite connection, migrations, transactions, path helpers.
- `server/src/jira/`: Jira client, JQL helpers, Jira-facing types.
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
- Auth uses the `dcc_session` cookie.
- The first app account must be a manager.
- Most API routes are manager-only.
- Developer users route to `/my-day`; developer API access is primarily through `/api/my-day`.
- Jira config is a mix of env vars and persisted SQLite settings. The live Jira API token is handled by runtime credentials/config flows; never hardcode or commit secrets.

## Commands and Validation

Run from repo root:

- Install/dev: `npm install`, `npm run dev`, `npm run dev:server`, `npm run dev:client`.
- Validate/build: `npm run typecheck`, `npm run build:check`, `npm run build`, `npm run start`.
- Tests: `npm run test`, `npm run test --workspace=client`, `npm run test:coverage`.
- Ops: `npm run backup:restore -- <path-to-backup-db>`, `npm run manager-desk:cleanup-carry-forward -- <args>`.
- Users: `npm run auth:create-user --workspace=server -- --username <name> --password <password> --display-name <display> --role <manager|developer> [--developer-account-id <id>]`.
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

## Worktree Workflow

- Main integration workspace: `/home/ubuntu/Development/lead-os` on `main`.
- Codex worktree A: `/home/ubuntu/Development/lead-os-codex-a` on `task/codex-a`.
- Codex worktree B: `/home/ubuntu/Development/lead-os-codex-b` on `task/codex-b`.
- Start each checkout from its own root with `npm run dev`; ports come from that checkout's env files.
- Keep branches task-scoped and small.
- Do not broaden a worktree change beyond the assigned task.
- Do not deploy production from the development checkout.
