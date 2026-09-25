# Project Guidelines

## Scope
TypeScript monorepo with three workspaces: `client/` (React + Vite SPA), `server/` (Express + SQLite backend), and `shared/` (cross-layer contracts). Authentication is cookie-based with distinct manager and developer roles. See `.github/instructions/` for focused backend and frontend rules applied automatically via `applyTo`.

## Architecture
- **Frontend**: Custom SPA routing in `client/src/App.tsx` via `pushState`/`popstate` — **no React Router**. Paths: `/` (dashboard), `/team-tracker`, `/my-day`, `/manager-desk`, `/settings`.
- **UI composition**: Feature folders under `client/src/components/` — `layout/`, `overview/`, `filters/`, `table/`, `triage/`, `alerts/`, `workload/`, `team-tracker/`, `my-day/`, `manager-desk/`, `settings/`, `setup/`.
- **State**: TanStack Query hooks in `client/src/hooks/`; centralized API client in `client/src/lib/api.ts`; frontend-local type mappings in `client/src/types/`.
- **Backend**: Express routes in `server/src/routes/` (13 modules), business logic in `server/src/services/`, Zod validation via `server/src/middleware/validate.ts`.
- **Database**: SQLite via Drizzle — schema in `server/src/db/schema.ts` (15 tables). Runtime DB at `data/dashboard.db` (repo root), **not** `server/data/`.
- **Sync**: Jira client + JQL helpers in `server/src/jira/`; scheduled sync engine in `server/src/sync/engine.ts`.
- **Contracts**: `shared/types.ts` is the source of truth for all cross-layer types (dashboard, auth, Team Tracker, My Day, Manager Desk).

## Application Surfaces
- **Manager dashboard** (`/`): overview cards, alerts, filter sidebar, defect table, triage panel, workload/capacity bar.
- **Team Tracker** (`/team-tracker`): manager view of developer day plans, check-ins, carry-forward flows.
- **My Day** (`/my-day`): developer daily workspace — current/planned/completed/dropped work and check-ins.
- **Manager Desk** (`/manager-desk`): manager daily planning workspace — tasks, decisions, linked issues/developers.
- **Settings** (`/settings`): Jira config, field discovery, backup management, team and user management.
- **Setup Wizard**: first-run bootstrap for manager account, Jira connection, team selection, developer access.

## Auth
- Cookie: `dcc_session`. First account must be a manager; most API routes are manager-only.
- Developer access is primarily through `/api/my-day`.
- Jira API token stored at runtime in `server/src/runtime-credentials.ts` — separate from `.env`; never hardcode it.

## Build and Test
Run from repo root (Node 20 required):
- `npm install` — install all workspace dependencies
- `npm run dev` — backend + frontend concurrently (`npm run dev:server` / `npm run dev:client` individually)
- `npm run build` — build client then server (`client/dist` is served by backend in production via `npm run start`)
- `npm run test` — backend Vitest suite
- `npm run test --workspace=client` — frontend Vitest suite
- `npm run test:coverage` — backend coverage (thresholds: 80% lines/statements/functions, 70% branches for `services/`)
- `npm run backup:restore -- <path>` — restore a SQLite backup
- `npm run auth:create-user --workspace=server -- --username <n> --password <p> --display-name <d> --role <manager|developer>` — CLI user creation

Windows: use `./run-node20.ps1` with modes `all`, `install`, `build`, `test`, `dev`, `client-dev`, `client-build`, `client-test`.

## Code Style
- Strict TypeScript throughout; reuse `shared/types.ts` contracts instead of redefining shapes locally.
- Frontend: single quotes, `@/` import alias, `PascalCase` component files, `useX.ts` hook files.
- Backend: double quotes. Keep routes thin; push logic into `services/`.
- When adding a backend capability, update route + service + `shared/types.ts` together.

## Conventions
- Write endpoint payloads validated with Zod via `server/src/middleware/validate.ts`.
- Backend error shape: `{ error, status }` — see `server/src/middleware/errorHandler.ts`.
- Data fetching in components → use hooks from `client/src/hooks/`, not ad hoc `fetch` calls.
- Frontend tests: wrap components with `client/src/test/wrapper.tsx` for Query context.
- Backend tests: mock Jira/DB boundaries; do not call Jira directly from routes.
- Manager-only and developer-only flows are intentionally separated — preserve role expectations.

## Environment Pitfalls
- **Node 20 required.** v25+ breaks `better-sqlite3` native install.
- `npm install --ignore-scripts` skips native build — usable for TS/Vitest if DB is mocked.
- Jira credentials in `.env`; runtime token in `server/src/runtime-credentials.ts`. Never commit secrets.
- Runtime SQLite DB is `data/dashboard.db` at repo root, not inside `server/`.

## Key References
- `docs/02-system-design.md` — architecture decisions
- `docs/04-technical-plan.md` — implementation plan
- `server/src/db/schema.ts` — all 15 table definitions
- `shared/types.ts` — all domain types
- `server/tests/` and `client/src/test/` — test patterns
