# LeadOS

LeadOS helps software engineering managers track people, work, risks, daily planning, follow-ups, meetings, and Jira defect operations from one workspace.

Jira defects remain a first-class workflow, but the product direction is broader than a defect dashboard: Jira is treated as a connected work source inside the manager workspace.

## Implemented Scope

- Monorepo workspace setup (`client`, `server`, `shared`)
- Shared TypeScript contracts in `shared/types.ts`
- Express + TypeScript backend in `server/`
- React + TypeScript frontend in `client/`
- SQLite + Drizzle schema and startup migration
- Jira client with pagination and 429 retry handling
- Sync engine with startup sync + scheduled 5-minute sync
- Backend endpoints from design docs
- Zod validation on write endpoints
- Global JSON error handling (`{ error, status }`)
- Service-layer unit tests for workload/alerts/automation/issues
- Phase 1 product reframe toward LeadOS navigation and naming

## Browser support

The Tailwind 4 frontend requires Safari 16.4+, Chrome 111+, or Firefox 128+.
See the [Tailwind upgrade guide](https://tailwindcss.com/docs/upgrade-guide#browser-requirements).

## Repository Layout

```text
lead-os/
├── client/                    # React frontend
├── data/                      # SQLite DB location
├── docs/                      # Product and technical documentation
├── server/                    # Backend implementation
│   ├── src/
│   ├── tests/
│   └── package.json
├── shared/
│   └── types.ts
├── .env.example
├── package.json
└── tsconfig.base.json
```

## Environment Variables

Copy `.env.example` to `.env` and set:

```env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=PROJ
PORT=3002
VITE_API_PORT=3002
```

Security note: `JIRA_API_TOKEN` is read only from environment variables and is never stored in the database.

## Node 20 Script Runner (`run-node20.ps1`)

This repository uses a helper script to always run commands with your portable Node 20 runtime:

`run-node20.ps1`

It expects Node 20 at:

`%USERPROFILE%\tools\node20`

### Available Modes

- `all`: install deps, build backend, run backend tests
- `install`: install all workspace dependencies
- `build`: build backend (`server`)
- `test`: run backend tests (`server`)
- `dev`: start backend dev server (`server`)
- `client-dev`: start frontend dev server (`client`)
- `client-build`: build frontend (`client`)
- `client-test`: run frontend tests (`client`)

### Common Commands

Run from repo root (`lead-os/`):

```powershell
# One-time setup / verification
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\run-node20.ps1 -Mode install

# Backend
.\run-node20.ps1 -Mode build
.\run-node20.ps1 -Mode test
.\run-node20.ps1 -Mode dev

# Frontend
.\run-node20.ps1 -Mode client-build
.\run-node20.ps1 -Mode client-test
.\run-node20.ps1 -Mode client-dev

# End-to-end quick prep (install + backend build + backend test)
.\run-node20.ps1 -Mode all
```

### Start Full App (Backend + Frontend)

Use two terminals in repo root:

```powershell
# Terminal 1
.\run-node20.ps1 -Mode dev

# Terminal 2
.\run-node20.ps1 -Mode client-dev
```

Then open:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3002`

If `5173` is in use, Vite will automatically use `5174` (or next available port).

## Install and Run (npm alternative)

```bash
npm install
npm run dev:server
```

## Development Vs Production On This VPS

This VPS now keeps development and production in separate directories:

- development workspace: `/home/ubuntu/Development/lead-os`
- production checkout: `/home/ubuntu/apps/lead-os-prod`

The live `lead-os` service runs from the production checkout. Building in the development workspace does not update the public site.

Safe validation commands for development:

```bash
npm run typecheck
npm run build:check
```

Local dev proxy safety:

- the backend bind port is controlled by `PORT`
- the frontend dev proxy is controlled by `VITE_API_PORT` or `VITE_API_PROXY_TARGET`
- the frontend no longer derives its proxy target from `PORT`
- `npm run dev` refuses to proxy to a non-local host unless `ALLOW_REMOTE_DEV_PROXY=true` is set

Quick verification on the VPS after starting dev:

```bash
curl -s http://127.0.0.1:3002/api/auth/bootstrap
curl -s http://127.0.0.1:5173/api/auth/bootstrap
```

Those two responses should match. They should not match production on `http://127.0.0.1:3001`.

Health endpoint:

```bash
GET http://localhost:3002/api/health
```

Expected response:

```json
{ "status": "ok" }
```

## Automatic Backups

The backend now creates SQLite backups automatically using the native `better-sqlite3` backup API.

- Default schedule: every 30 minutes
- Backup location: `data/backups/`
- Extra protection: automatic backup before `POST /api/config/reset`
- Startup safety: optional startup snapshot when the latest backup is too old
- Retention: old backups are pruned automatically

Manual operations:

```bash
# List backups
GET http://localhost:3002/api/backups

# Create a backup immediately
POST http://localhost:3002/api/backups/run
```

Restore a backup only while the server is stopped:

```bash
npm run backup:restore -- data/backups/<backup-file>.db
```

## Tests

```bash
npm run test
npm run test:coverage
```

Frontend tests:

```bash
npm run test --workspace=client
```

Current tests target backend services:

- `server/tests/workload.service.test.ts`
- `server/tests/alert.service.test.ts`
- `server/tests/automation.service.test.ts`
- `server/tests/issue.service.test.ts`

## Backend API

Implemented base path: `/api`

- `GET /api/health`
- `GET /api/issues`
- `GET /api/issues/:key`
- `PATCH /api/issues/:key`
- `POST /api/issues/:key/comments`
- `GET /api/overview`
- `GET /api/team/workload`
- `GET /api/team/developers`
- `GET /api/team/:accountId/issues`
- `GET /api/alerts`
- `GET /api/suggestions/assignee/:key`
- `GET /api/suggestions/priority/:key`
- `GET /api/suggestions/duedate/:priority`
- `POST /api/sync`
- `GET /api/sync/status`
- `GET /api/config`
- `PUT /api/config`
- `POST /api/config/test`
- `GET /api/backups`
- `POST /api/backups/run`

All errors return JSON in the form:

```json
{ "error": "message", "status": 400 }
```
