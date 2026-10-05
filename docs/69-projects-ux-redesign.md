# Projects UX redesign

## Review — 2026-10-05

Reviewed all six screenshots in `docs/screenshots/`, the Tasks workspace, project editor, facts, filters, placement picker/dialog, and existing query hooks.

- The directory repeats “Projects” and offers task search/options that do not search or filter projects. A single project occupies a large, mostly empty region.
- Project names have small click targets. Outcomes, summaries, tracks and tasks share nearly identical text treatment; there is no clear reading order.
- Every facts row repeats zero counts and “No check scheduled”. Overdue and blocked work are visually buried. Open counts are not completion percentages and must remain honest.
- Tracks look like incidental underlined links. Their purpose, optional nature and relationship to the project task list are unclear.
- Create/edit forms do not explain outcome versus summary. Creation leaves users at the directory instead of their new project.
- Empty and archived states do not explain the next step. An archived empty project still recommends adding tasks even though placement is disabled.
- Placement requires search plus a dropdown, obscures the destination, and uses technical wording (“container”, “placement”, “visible tasks affected”).

## Direction

A quiet, compact workspace using LeadOS’s existing Geist typography, surfaces, accent and shared controls. Use a searchable list, generous click targets, hairline separators and restrained attention colors. No new framework, dependencies or global brand changes.

Inspired by [Linear’s project overview](https://linear.app/docs/project-overview) separating context from execution, and [Notion’s contextual task views](https://www.notion.com/en-gb/help/guides/getting-started-with-projects-and-tasks). Adapt these patterns to the existing private Projects → optional Tracks model.

## Items and workflows

1. **PROJ-UX-01 — review and plan.** Save this audit and record the work in docs/56.
2. **PROJ-UX-02 — browse and execute.** Replace duplicate headers with a searchable Active / Archived directory. Make rows easy to open. Give detail pages breadcrumbs, an outcome, quiet summary disclosure, meaningful attention facts and a clearly labelled optional Tracks section. Keep task search/options beside the task list, existing deep links, saved filters and inline capture. Open a newly created project/track immediately. Improve forms and archive/restore explanations, loading, retry and empty states.
3. **PROJ-UX-03 — organize tasks.** Replace the search/dropdown pair with one searchable project choice list. Keep a native optional track selector. Name the destination and exact affected task count before applying; preserve guarded previews, subtask choice, account-scope protection and Undo.

## Validation

Focused frontend tests for directory search, navigation, creation, tracks, archive/restore and placement selection/preview. Run `npm run typecheck`, `npm run build:check`, relevant frontend tests and `npm run lint`. Check desktop and narrow screens in light/dark themes with Playwright against an isolated synthetic database and a disabled/mock Jira sync engine. Check keyboard focus, overflow, empty/loading/error states, contextual capture and move/Undo. Leave supplied screenshots untouched; no runtime data, push or deployment.

## Handoff

All three items are complete. Implementation and validation results are recorded in the Projects UX section of docs/56. Existing APIs, placement guards, private ownership, task capture and Undo are preserved; no server or data-model changes were needed.
