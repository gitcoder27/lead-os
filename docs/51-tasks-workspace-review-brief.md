# 51 — Tasks Workspace Review: Brief

Full review: `docs/51-tasks-workspace-review.md` · Date: 2026-09-27 · Review only, nothing implemented.
Based on a code read plus two production screenshots. I did not run the app.

## Verdict

**Good engineering, mediocre product.** The engine is genuinely strong:

- One matcher decides both lists and badge counts, so they can't disagree.
- Every action is optimistic and can be undone.
- Rows you act on stay in place until you move on.
- The URL fully describes the view, so views can be shared.
- The date rolls over correctly at midnight.

But the page mimics Linear without committing to the manager's job. View names don't match their contents, and the basics of planning a day are missing. The keyboard model has holes exactly where a manager spends time, and the visual chrome and alarm colour outweigh the content. Most fixes are changes to definitions and removals, not new features.

## The 5 findings that matter most

1. **"Waiting on others" and "Needs attention" don't mean what they say.** (S1)
   - Waiting includes a **Me** group (your own follow-ups) and every developer task you track, which is really the team's day plan.
   - The manager also shows up a second time under their developer name.
   - Needs attention flags everything parked in Later as "stale" after 5 days.
   - *Result:* the two views meant to drive action are mostly noise.
2. **It can't really build a plan.** (S1/S2)
   - There's no order within a day.
   - The schedule menu offers presets only; picking "Thursday" means opening the drawer.
   - Finished work vanishes from Today, so the day never shows progress.
3. **Two "Today"s.** (S1) The top nav's Today (`/`) *runs* the day, and `/tasks` lands on a rail view also called Today that *builds* it. They sit one click apart with different meanings.
4. **The keyboard model breaks where it matters.** (S1/S2)
   - On the focused row, the hover actions cover the date.
   - Label grouping duplicates rows, which breaks j/k, the count, and selection.
   - `n` does nothing on an empty view.
   - The drawer can't step to the next task, so triage costs Esc → j → Enter per item.
5. **Loud colour and heavy chrome for small facts; accessibility debt.** (S2)
   - A task one day late on its *scheduled* date shows red in three places, while a task 15 days late looks the same as 1.
   - Two cards and two headers wrap four tasks, and the count appears four times.
   - Accessibility: invalid listbox structure, row labels without date or owner, and task-key text below 4.5:1 contrast.

## Top recommended moves

**Must fix**

1. Redefine Waiting: exclude my own tasks (except blocked ones) and drop the blanket "developer-owned" rule. Add `later:false` to Needs attention and limit stale to manager and Inbox tasks.
2. Rename the rail view (e.g. "Planned today"), or default `/tasks` to Inbox / My tasks.
3. Keep the date visible on the focused row. Reuse the drawer's `DatePickerPopover` as the list's schedule menu.
4. Remove or dedupe Label grouping.

**Next**

- Add a collapsed "Done today" group.
- Reorder within a day by keyboard.
- Add j/k inside the drawer.
- Use red only for missed deadlines.
- Flatten the group cards.
- Fix the listbox semantics and contrast.
- Show counts in the mobile view picker, and make the bulk bar icon-only on phones.

**Remove / simplify**

- The **Upcoming** view (a subset of My tasks).
- The **Type** filter chip.
- **Label** grouping.
- The group cards, and duplicate counts.
- The follow-up chip that duplicates the bell.
- The empty-state list hack.
- `window.prompt` for renaming views.

**Keep:** the view engine and counts contract, bulk undo, lingering rows, "Move all to today", saved views, g-chords, and the URL contract.
