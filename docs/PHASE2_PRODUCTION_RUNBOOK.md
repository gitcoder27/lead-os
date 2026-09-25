# Phase 2 Production Runbook

Canonical task model rollout for LeadOS Task & Team Management.
Spec: `TASK_TEAM_MANAGEMENT_V2_IMPLEMENTATION.md`.

**Golden rules**

- Run all commands from `/home/ubuntu/apps/lead-os-prod` (its `.env` resolves the prod DB).
- Every `--apply` creates a backup automatically — never skip it by hand-editing config.
- Never set `tasks_phase2_stage` manually, and never backdate the soak timestamps on prod.
- One workspace: `default`. Run each step once, check output, then proceed.

---

## Step 0 — Deploy code

```sh
npm run deploy:prod
```

Deploys code + inert Phase 2 schema. Nothing user-visible changes yet.
Phase 1 keys/events were already applied by the startup migration — no action needed.

## Step 1 — Shadow plan (safe, read-only)

```sh
npm run tasks:phase2-backfill --workspace=server -- --dry-run --workspace default
```

Review `data/manual-snapshots/task-phase2-report-<ts>.{json,md}`:
counts, ambiguous merge/split proposals, status mapping, field loss.

## Step 2 — Approve decisions

Create `decisions.json` from the report's `decisionsTemplate` (same `inputHash`):

```json
{
  "inputHash": "<copy from report>",
  "decisions": [
    { "proposalId": "A1-0001", "action": "keep" }
  ]
}
```

- `keep` = rows stay separate tasks. `merge` = fold into `survivorKey`.
- Hash is a fingerprint of the prod data — must be generated on prod, not reused from dev.

## Step 3 — Apply backfill

```sh
npm run tasks:phase2-backfill --workspace=server -- --apply --workspace default --decisions /path/to/decisions.json
```

## Step 4 — Verify ×2 (creates the two required receipts)

```sh
npm run tasks:phase2-backfill --workspace=server -- --verify --strict --workspace default
npm run tasks:cutover --workspace=server -- --workspace default --verify
npm run tasks:cutover --workspace=server -- --workspace default --verify
```

Expect `OK` + `consecutiveCleanRuns: 2`. "Explained drift" lines are
informational (accurate history replay vs mutated legacy rows) — not failures.
If parity diffs appear: **stop**, do not cut over.

## Step 5 — Cutover → stage 2b

```sh
npm run tasks:cutover --workspace=server -- --workspace default --dry-run
npm run tasks:cutover --workspace=server -- --workspace default --apply
```

Now live: canonical reads/writes, `taskModel: "canonical"` on the wire,
legacy task tables read-only via triggers. **Spot-check the app now.**

## Step 6 — SOAK: one week at 2b

Watch for errors. If broken: rollback (below). If clean after ≥ 7 days:

```sh
npm run tasks:stage --workspace=server -- --workspace default --to 2c --apply
```

## Step 7 — Accept 2c, then SOAK two weeks

```sh
npm run tasks:stage --workspace=server -- --workspace default --complete 2c --apply
```

## Step 8 — Contract → stage 2d  ⚠ point of no return

```sh
npm run tasks:contract --workspace=server -- --workspace default          # dry-run: prints plan
npm run tasks:contract --workspace=server -- --workspace default --apply
```

Archives legacy tables to `legacy_*`, drops the guard triggers, enforces
`task_events.task_id NOT NULL`. After this: **rollback is refused; forward-fix only.**

---

## Rollback (only at 2b/2c)

```sh
npm run tasks:export-legacy --workspace=server -- --workspace default --dry-run
npm run tasks:export-legacy --workspace=server -- --workspace default --apply
```

Regenerates legacy rows from canonical tasks, drops guards, sets stage
`rolled_back`. **Lossy**: extra labels, `priority:high` precision, `due_at`,
`parent_id`, older `day_focus` history.

## If a step refuses

- `Decisions inputHash does not match` → data changed since the reviewed report; re-run dry-run, rebuild decisions file.
- `Two clean strict verifications required` → re-run step 4; snapshot drift resets the count.
- `2b soak incomplete` / `tasks_phase2c_completed_at` → the gate is working; wait for the soak.
- `Backfill cannot run after write cutover` → already cut over; re-apply is impossible by design.
