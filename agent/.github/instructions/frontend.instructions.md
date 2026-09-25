---
description: "Use when editing React components, TanStack Query hooks, dashboard UI state, styling, or frontend tests in the client workspace."
name: "Frontend Client Guidelines"
applyTo:
  - "client/src/**/*.ts"
  - "client/src/**/*.tsx"
  - "client/src/**/*.css"
  - "client/src/test/**/*.ts"
  - "client/src/test/**/*.tsx"
---
# Frontend Guidelines

## Data Fetching and State
- Use existing TanStack Query hook patterns from `client/src/hooks/` for server state.
- Avoid ad hoc `fetch` calls in components when a reusable hook belongs in `client/src/hooks/`.
- Keep UI-only state in component state/context, and keep API state in Query hooks.

## Component Structure
- Compose dashboard UI from focused components in `client/src/components/`.
- Keep components presentational where possible; move data transforms and API concerns into hooks/utils.
- Reuse shared domain contracts (or frontend mappings of them) instead of redefining issue/developer shapes.

## API and Types
- Use `client/src/lib/api.ts` helpers for network requests to preserve consistent error handling.
- Keep client type usage aligned with `shared/types.ts` and existing `client/src/types/` mappings. `client/src/types/` holds frontend-local adaptations; prefer `shared/types.ts` directly when a shared shape already covers the need.

## UX Patterns
- Preserve existing app-level providers and patterns in `client/src/App.tsx` (Theme, Toast, QueryClient).
- The app uses **no React Router** — routing is handled via `window.history.pushState` and `popstate` in `App.tsx`. Add new views by extending the `AppView` union type and the view-switch logic there.
- Follow existing filter/triage/workload UX conventions before introducing new interaction models.

## Testing
- Use React Testing Library with Vitest in `client/src/test/`.
- Wrap tested components with `client/src/test/wrapper.tsx` to provide Query context.
- Mock hooks at module boundaries when unit-testing component rendering and interactions.

## Commands
- Preferred on Windows: `./run-node20.ps1 -Mode client-dev`, `./run-node20.ps1 -Mode client-build`, `./run-node20.ps1 -Mode client-test`.
- npm equivalents: `npm run dev --workspace=client`, `npm run build --workspace=client`, `npm run test --workspace=client`.
