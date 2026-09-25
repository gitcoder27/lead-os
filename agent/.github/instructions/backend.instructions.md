---
description: "Use when editing Express routes, services, Jira sync logic, database access, backend middleware, or server tests in this defects dashboard monorepo."
name: "Backend Server Guidelines"
applyTo:
  - "server/src/**/*.ts"
  - "server/tests/**/*.ts"
  - "shared/types.ts"
---
# Backend Guidelines

## Service and Route Boundaries
- Keep `server/src/routes/*.ts` focused on HTTP concerns: parsing input, calling services, returning responses.
- Keep business logic in `server/src/services/*.ts`; do not move scoring, triage, or suggestion logic into route files.
- Reuse existing services before adding new ones; if adding one, keep it stateless and injectable.

## Validation and Error Contract
- Validate write endpoint payloads with Zod via `server/src/middleware/validate.ts`.
- Preserve the global error response shape from `server/src/middleware/errorHandler.ts`: `{ error, status }`.
- Throw/forward typed errors instead of returning ad hoc error payloads from route handlers.

## Data and Sync
- Keep SQLite access behind Drizzle schema and connection modules in `server/src/db/`.
- Avoid direct Jira calls in routes; use jira and sync modules (`server/src/jira/`, `server/src/sync/`).
- Keep sync behavior startup-safe: config can be partial and server should still boot even if Jira sync is unavailable.

## Security and Config
- Never hardcode secrets or Jira tokens; use `.env` and `server/src/config.ts`.
- The live Jira API token is stored at runtime in `server/src/runtime-credentials.ts` — this is separate from `.env` and is managed through the config/settings flow, not hardcoded.
- Keep logs safe by preserving token/header redaction behavior in `server/src/utils/logger.ts`.
- The backup service (`server/src/services/backup.service.ts`) and `server/src/routes/backups.ts` manage SQLite backup operations; preserve their behavior when touching DB or config code.

## Testing
- Prefer hermetic unit tests in `server/tests/` with mocked DB/Jira boundaries.
- Cover happy paths, edge cases, and error paths for service methods.
- Keep backend coverage expectations aligned with current Vitest thresholds in `server/vitest.config.ts`.

## Commands
- Preferred on Windows: `./run-node20.ps1 -Mode build`, `./run-node20.ps1 -Mode test`, `./run-node20.ps1 -Mode dev`.
- Node 20 is required for reliable `better-sqlite3` installs on this project.
