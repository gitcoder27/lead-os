# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The full agent briefing (product, routes, frontend/backend maps, data/auth, commands, working rules) lives in `AGENTS.md` and is the single source of truth. Keep it current there rather than duplicating it here.

@AGENTS.md

## Claude-specific notes

Running a single test (Vitest, from the repo root):

- One server test file: `npm run test --workspace=server -- tests/<path>.test.ts`
- One client test file: `npm run test --workspace=client -- src/test/<path>.test.tsx`
- Filter by test name: append `-t "<name pattern>"`
- Watch mode in a workspace: `npx vitest --root server` (or `--root client`)

Area-specific guidance also lives in `agent/.github/instructions/backend.instructions.md` and `frontend.instructions.md`; read the relevant one before larger backend or frontend changes.
