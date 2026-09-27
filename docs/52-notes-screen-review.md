# 52 — Notes Screen Review (`/notes`)

Status: review only. Nothing here is implemented.
Date: 2026-09-27 · Scope: `client/src/components/notes/*`, `client/src/hooks/useDailyNotes.ts`, `useDailyNoteEditor.ts`, `client/src/lib/daily-note-drafts.ts`, `server/src/routes/notes.ts`, `server/src/services/daily-notes.service.ts`, plus the one caller that writes into notes from outside (`StandupMode.tsx`).
Method: I read the code and one production screenshot (dark theme, about 1000 CSS px, today's note with history). I did not run the app. Findings that depend on runtime behaviour are inferred from the code and marked *(code-inferred)*.
Out of scope: standup summaries being appended into the scratchpad (`StandupMode.tsx:315`). A fix with a separate `kind`-ed note is already scheduled. Where that append *interacts* with other problems (conflicts, titles), I say so, but I don't re-litigate it.

Severity: **S1 must fix** (wrong or broken for the core job) · **S2 should fix** (friction you hit weekly) · **S3 polish**.

---

## 0. Verdict

**A carefully engineered textarea, not yet a thinking tool.** Persistence is better than most note apps: revision-checked saves, session-draft recovery, idempotent request IDs, flush-before-date-switch, and a real conflict panel, all well tested. But the job is "dump thoughts all day → turn some into actions → recall and close out at EOD", and the screen only does the first part well. The text is inert: `T-12`, people and Jira keys are plain characters. Actions are three form dialogs detached from the line they came from, and the note never records what it turned into. Nothing on the page helps the end-of-day review. There is also one real data bug: **"Keep both" duplicates the whole shared base on every conflict**.

---

## 1. Functionality

### 1.1 Editor

**F1 — The editor is a bare `<textarea>`. S2 (becomes S1 against the "world-class" bar).**
`NoteDocument.tsx:196`. Enter doesn't continue lists, Tab doesn't indent, there are no checkboxes, and there's no way to insert a timestamp. Text you type as markdown is never rendered, so the note looks like raw markup. `T-84`, `AM-123` and people's names are inert text. The server already recognises `T-n` tokens (`daily-notes.service.ts:135-146`) and writes backlinks onto each task's timeline. So the task knows about the note, but the note doesn't know about the task.
*Fix:* move to **CodeMirror 6** and keep the stored body as plain markdown text. That leaves storage, FTS, revisions, append and conflict handling unchanged. You get list continuation, Tab/Shift-Tab indent, `- [ ]` checkboxes (clickable through decorations), and live-rendered headings and bold. Add **entity decorations**: `T-n`, Jira keys and `@person` render as chips with hover previews and open the drawer on click. Add autocomplete on `@` (developers), `T-` (tasks) and `#` (Jira). Don't use Tiptap or ProseMirror here: changing the storage model would break the revision, append and search contracts.

### 1.2 Autosave, drafts, conflicts

**F2 — "Keep both" duplicates the shared base text. S1.**
`useDailyNoteEditor.ts:379`: `combined = remoteBody + "\n\n" + localBody`. `localBody` is the *whole* local document (the base plus your edits), and `remoteBody` is the base plus the other side's edits. Everything that existed before the fork therefore appears twice. The test (`useDailyNoteEditor.test.tsx:161`) uses disjoint strings (`'server text'` / `'local draft'`), so it can't catch this. Every "Keep both" on a real note repeats the note.
*Fix:* do a three-way merge against `baseBodyRef.current`:
1. `remote.startsWith(base)`, i.e. the remote only appended (the common case: standup, quick capture): `merged = local + remote.slice(base.length)`.
2. `local.startsWith(base)`, i.e. you only appended: `merged = remote + local.slice(base.length)`.
3. Otherwise, run a line-based diff3 (`node-diff3` is ~5 KB). If the hunks don't overlap, auto-merge. If they do, open the conflict panel with the merged proposal pre-filled.
Add a regression test where local and remote share a base.

**F3 — Server-side appends while you're typing cause a hard conflict. S1.**
The effect at `useDailyNoteEditor.ts:288-301` goes straight to `enterConflict` whenever the remote revision advances while you're dirty. Appends happen routinely. Quick capture targets Notes by default *when you are on the Notes page* (`App.tsx:1154`), and the 30 s poll (`useDailyNotes.ts:40`) picks up any other tab's writes. So capturing a thought from the page you're writing on can put a warning box in front of you and pause saving. Even after the standup fix, appends remain part of the design (capture, and later carry-forward).
*Fix:* apply rule 1 from F2 silently when the remote change is a pure append. Rebase the local draft, bump the base, and show a quiet inline "Captured text added below". Only unmergeable edits should reach the conflict panel.

**F4 — Drafts live in `sessionStorage`. S2.**
`daily-note-drafts.ts:77`. A reload recovers the draft, but closing the tab or crashing the browser loses it. The fallback copy ("Keep this page open until saved", `NoteDocument.tsx:~248`) admits as much. For a scratchpad, "I typed it, so it exists" is the whole contract.
*Fix:* use `localStorage` under the same scoped key, with a TTL (e.g. 14 days) and a cap on the number of drafts. The draft already carries its `baseBody` and `revision`, so recovering it in a different tab is safe.

**F5 — A failed save stays failed until you click Retry. S2.**
State `error` is terminal (`useDailyNoteEditor.ts:230`). There's no backoff, no `online` listener and no retry on visibility change. On a flaky connection you learn about it only when a date switch is blocked.
*Fix:* retry automatically with backoff (2/5/15/30 s), retry on the `online` event, and show "Offline — saved on this device" instead of red text while a draft exists.

**F6 — Leaving the route cancels the pending save timer. S3** *(code-inferred)*.
`useDailyNoteEditor.ts:304-310` clears the timer on unmount but doesn't flush. The textarea's `onBlur` flush usually covers this, and the draft survives in storage. Still, add a best-effort `fetch(..., { keepalive: true })` on unmount when dirty, so the server copy is current for Today, search and Copilot.

### 1.3 Action bar: text → tasks, updates, follow-ups

**F7 — Actions are detached from the text and leave no trace in the note. S1 (for the job).**
`NoteDocument.tsx:258-287`: three equal buttons at the foot of the document act on the current selection, which is kept alive with `onMouseDown preventDefault`. After you create the task, the note text is unchanged, so at EOD you can't tell which lines became actions and which are still loose. Recall depends on the note, and the note forgets.
*Fix:* after a successful create or update, write a provenance marker into the source line, e.g. `… check Deepak's 1:1 → T-84`. Render it as a chip with live status (CM6 decoration). The server already stores `dailyNoteTaskRefs` with `relation`, so the marker is only the visible half. Do the insert through the editor, so it autosaves like any other edit.

**F8 — The selection mechanic is invisible, and each action is a full form. S2.**
Nothing tells you that selecting text pre-fills the dialog. With no selection, the dialogs open blank (`NotesTaskActionDialog.tsx:82-88`). "Add as update to…" needs four decisions (text, task search, type, visibility) for what is usually "this line → that task".
*Fix:*
- Add a **line-scoped action**. With the caret on a line (or a selection), `⌘⇧T` opens Create task, `⌘⇧U` Add update and `⌘⇧F` Follow-up. The same actions appear in a small floating bubble on selection, plus a `/` slash menu at the start of a line.
- **Infer, then confirm.** If the line contains `T-n`, the update target is pre-picked. If it contains `@person`, that person becomes the assignee. Collapse type and visibility into one quiet row that defaults to *Update · Only me*.
- Replace the three footer buttons with one quiet `Turn into…` menu, kept for discoverability.

**F9 — "Follow-ups from this note" is incomplete and, in canonical mode, mislabelled. S2.**
`NoteDocument.tsx:292` renders `editor.followUps`. In canonical mode that list comes from `canonicalFollowUps` (`daily-notes.service.ts:120-132`), which selects every `relation = "created_from"` ref. So **tasks from "Create task…" appear under "Follow-ups"**. In legacy mode they don't appear at all. `update_from` refs (updates you posted) and `mentioned` refs never appear in either mode.
*Fix:* make it **"From this note"**, grouped as Created · Updated · Mentioned. Reuse the shared item row from the drawer redesign (key, status dot, owner, due), make the whole row clickable, and drop the separate "Open follow-up" text button. Return `relation` in the API (`DailyNoteResponse.refs[]`) instead of overloading `followUps`.

**F10 — Small inconsistencies between the dialogs. S3.**
- The follow-up title takes the *whole* selection, up to 500 chars and multi-line (`NotesFollowUpDialog.tsx:44`). Create task takes the first line (`NotesTaskActionDialog.tsx:88`). Use `firstLine` in both and put the rest in context.
- Follow-up defaults to "tomorrow 9:00" relative to *now* (`:19`) and files under today (`:78`), even when acting from a past note. That's arguably right, but the dialog should say "Follow up (from Sep 16 note)".
- Create task schedules on `todayIsoDate()` regardless of note date (`daily-notes.service.ts:503-504`). That's fine, but it isn't stated.
- All three dialogs hand-roll inputs with inline `style={{ background: 'var(--bg-tertiary)' … }}` instead of the shared form primitives.

### 1.4 History, search, date navigation

**F11 — Search pagination is wrong under relevance ordering. S2.**
FTS results are ordered by `bm25` (`daily-notes.service.ts:181`), but the cursor is the *date* of the last row (`:240`), and page 2 filters `date < cursor`. Page 2 therefore skips every remaining match that's more recent than the least-relevant row on page 1. This shows up once a query has more than 30 hits (e.g. a teammate's name after a few months).
*Fix:* either order search results by date (the simplest option, and arguably what a diary search wants), or use an offset or `(rank, id)` cursor for search pages.

**F12 — Search results are hard to use. S2.**
- The excerpt locator (`buildExcerpt`, `:62-84`) looks up the *whole* query string, so a multi-word query falls back to the start of the note.
- Nothing is highlighted.
- Opening a result lands at the top of the note, not at the match.
*Fix:* return FTS `snippet()` with markers, highlight them in the sidebar, and pass `?q=` to the document so it scrolls to the first match and highlights it (CM6 search cursor).

**F13 — Empty notes persist in history. S3.**
Clearing a note saves `""` (`save` doesn't delete). `deriveTitle` then yields "Daily note", which is the "Wed, Sep 16 · Daily note" row in the screenshot. *Fix:* delete the row, or filter blank bodies out of `list`.

**F14 — There's no keyboard date navigation or search focus. S2.**
The only shortcut is `⌘S` (`NoteDocument.tsx:205`).
*Fix:* `⌥↑/⌥↓` (or `[`/`]` outside the editor) for the previous/next day, `⌥T` for today and `⌘⇧F` to focus note search. List them in a `?` hint.

---

## 2. UI / UX

**U1 — There's no day context. S1 (for use-case fit; see §5).** The note opens as a blank page with no link to the day it's about.

**U2 — ~200 px of sidebar chrome sits above the first note. S2.** Title + "Only you", then the subtitle "A little space to clear your head." (`NotesSidebar.tsx:72`), then search, then a standalone **Today** row (`:92-104`) that duplicates the first list item whenever today has a note (visible in the screenshot: "Today Sun, Sep 27" directly above "Sun, Sep 27").
*Fix:* drop the subtitle. Keep "Only you" as a lock glyph with a tooltip. Remove the separate Today row and label today's list row "Today" instead. If today has no note yet, show a ghost row "Today — start writing".

**U3 — Save status is silent when all is well and loud while typing. S3.** Idle shows nothing (`statusLabel` returns `''`). Typing cycles through "Unsaved changes → Saving… → Saved" every 700 ms.
*Fix:* show a steady "Saved · 2:14 PM" (last `updatedAt`), and change it only on error or offline.

**U4 — The action buttons are disabled without explanation. S3.** `selectionActionsDisabled` (`NoteDocument.tsx:100`) greys them out on an empty note or during a conflict. Add a `title` or tooltip with the reason.

**U5 — The conflict panel makes you read two full documents. S2.** "Saved version" dumps the entire remote body (`NotesConflictPanel.tsx`). After F2/F3, the panel only appears for real overlapping edits. At that point, show the *conflicting hunks* side by side (mine / theirs / both) instead of the whole note.

**U6 — Empty state. S3.** The placeholder "Thoughts, observations, things to come back to…" plus "Start anywhere…" is pleasant but inert. A better empty state for a manager's day is the day context itself (U1/§5), plus one line teaching the tricks: "Type `@` for people, `T-` for tasks, `⌘⇧T` to turn a line into a task."

---

## 3. Visual design

**D1 — Nested scrolling. S2.** `.notes-textarea` is `flex: 1; min-height: 340px` inside `.notes-document`, which also scrolls (`notes.css:165, 260-275`). The textarea scrolls internally (the inner scrollbar is visible in the screenshot), the action bar sits pinned under it, and "From this note" is pushed below the fold inside a second scroller.
*Fix:* auto-grow the editor (CM6 does this natively), let the document column own the only scroll, and make the action footer `position: sticky; bottom: 0`.

**D2 — The type scale doesn't match the rest of the app. S2.** The body is `16px / 1.8` (`notes.css:268-269`), while the sidebar and the rest of LeadOS run at 12–13 px. Combined with blank lines between paragraphs, six short blocks fill a 1000 px viewport (see the screenshot). It reads like a different product.
*Fix:* `15px / 1.6`, with paragraph spacing from markdown blocks rather than blank lines, and a ~680–720 px measure. Keep the 26 px date heading.

**D3 — The heading block. S3.** "Sunday, September 27" sits over a subline that is just "2026 · Today" (`NoteDocument.tsx:95`). The native date input then renders `27/09/2026` in the browser's locale beside a US-format heading.
*Fix:* use one line, "Sunday, Sep 27 · Today", and show the year only when it isn't the current year. Replace the native date input with the app's date popover, formatted like the heading.

**D4 — The action footer is visually the loudest thing on the page. S3.** Three bordered buttons of equal weight, bottom-right, read as a form's submit row. After F8, keep one quiet `Turn into…` ghost button and the save status.

**D5 — The "From this note" section style is off-system. S3.** The uppercase tracked header and bordered cards (`notes.css:341-380`) don't match the redesigned drawer sections (commit `9ad100e`). Reuse the drawer's section header and item-row components.

What already works visually: a calm dark palette, generous margins, a clear sidebar/doc split, and a subtle selected-row tint. Keep the mood; this needs a tighter scale, not a redesign.

---

## 4. PABR

### 4.1 Performance

**P1 — Every autosave causes a refetch storm. S2.** `acknowledge` → `invalidateDailyNotesViews` (`useDailyNotes.ts:25-28`) invalidates the *entire* `['daily-notes']` prefix and `['global-search']`. The day query has just been set from the PUT response, and it's refetched anyway (`staleTime: 0`). The history list, every cached search-term list and the sources queries are refetched too. That's roughly 1 PUT plus 3 or more GETs for every pause in typing longer than 700 ms, on top of a 30 s poll.
*Fix:* invalidate with a predicate that excludes the `day` key. Patch the matching list row (title/excerpt/updatedAt) in place with `setQueryData`. Refetch the list and search only on blur or date switch. Raise the day poll to 60 s and pause it while `dirty` or `saving`.

**P2 — Each save rescans every mention and runs N+1 queries. S2.** `save` → `scanMentions` (`daily-notes.service.ts:135-146`) resolves every `T-n` in the body on each save: `resolve`, `resolveTask`, `canonicalTaskId` and an insert, per match. `save` then calls `getDay`, which in canonical mode runs `canonicalFollowUps` with a `getById` and a `surfaceId` per ref (`:125-129`). `getSources` in canonical mode loads *all* of the manager's refs across all notes before filtering (`:552-559`).
*Fix:* diff the mention set against the previous body and resolve only new keys. Batch the task lookups (`inArray`). Filter `getSources` by item ID in SQL.

**P3 — Search debounce and FTS are fine.** 200 ms debounce, FTS5 prefix terms, a LIKE fallback. No action.

### 4.2 Accessibility

- **A1 — The live region chatters. S2.** `aria-live="polite"` on the save status (`NoteDocument.tsx:235`) announces "Saving… Saved" at every pause. Announce only errors, conflicts and offline changes, and render the routine status without `aria-live`.
- **A2 — Focus after a dialog closes. S2.** Radix returns focus to the footer button, so the writing flow breaks. Restore focus to the editor at the saved caret position (`selectionRef`).
- **A3 — `aria-current="true"` on the selected day (`NotesSidebar.tsx:176`). S3.** Use `"date"` (or `"page"`). The sidebar `role="list"` wraps buttons correctly.
- **A4 — Conflict panel `role="alert"`. S3.** It's rendered while you type, so screen readers interrupt mid-sentence. Use `role="status"` and move focus to the panel only when the user asks.
- **A5 — Contrast.** Muted text `#9AA3B4` on `#0F1117` is about 7:1, which passes. No action.
- **A6 — Keyboard reach.** See F14 and F8. Today every action needs Tab traversal through the footer.

### 4.3 Behaviour and resilience

Strong: revision CAS with 409 → fetch → conflict, a single-flight save queue, flush before date switch with a blocking toast on failure, `beforeunload` while dirty, scope guards on every mutation, idempotent request IDs on the server. The test suite covers these (`useDailyNoteEditor.test.tsx`, 20+ cases).
Gaps: F2 (duplication), F3 (append → conflict), F4 (sessionStorage), F5 (no auto-retry or offline mode), F6 (unmount flush).

### 4.4 Responsiveness

Below 768 px, the sidebar becomes a History toggle, which works. The toolbar wraps. The three footer buttons plus the status wrap into two ragged rows. After F8, one `Turn into…` button fixes that. On mobile, put the selection bubble *above* the selection so the OS text menu doesn't cover it.

---

## 5. Use-case fit (engineering manager, daily)

The day has three moments: **morning** (what am I walking into), **during** (dump without friction, capture actions), and **EOD** (what happened, what's still loose, what carries). Today the page serves the middle moment only.

What already serves the manager: frictionless capture, privacy, the date model, search, and one-click conversion into real tasks with backlinks.
What's noise: the sidebar chrome (U2), the equal-weight footer (D4), status churn (U3), and the standup blocks (known).

To make it the one place to *think about the day* without turning it into a dashboard:

- **A day context strip**, one collapsed line under the heading that expands on click: `Standup ✓ 9:40 · 2 flagged` · `3 carried from yesterday` · `4 follow-ups due` · `1:1 with Deepak 3pm`. Each chip is a link or popover. None of it is in the note body, so it doesn't compete with your writing. Sources: the sealed standup session record, open checkboxes or unconverted lines from the previous note (see below), Desk follow-ups due today, and 1:1 sessions scheduled today.
- **"From this note"** (F9) as the recall panel: what the day produced, with live status.
- **An EOD wrap-up.** A "Wrap up day" action (`⌘⏎`, or offered after 5 pm) lists open `- [ ]` lines and lines with no provenance marker. Each gets one choice: **Task · Follow-up · Carry to tomorrow · Drop**. "Carry" appends to tomorrow's note through the existing idempotent `append` endpoint, with a `↩ from Sep 26` marker, and that feeds tomorrow's "carried" chip. This one ritual is what turns a scratchpad into a daily analysis tool.
- **Backlinks from people and tasks.** The task drawer already gets `note_ref` events. Add "Notes mentioning Deepak" to the person drawer and 1:1 panel, so pre-1:1 prep is one click.

---

## 6. Must-haves for a world-class daily-analysis note (currently missing)

1. **Lossless merge**: append-aware auto-rebase and correct three-way "keep both" (F2, F3).
2. **Structured, alive text**: lists, checkboxes and headings that render, and entity chips for tasks, Jira and people, with autocomplete (F1).
3. **Line-level actions from the keyboard**, with inference from the line's mentions (F8).
4. **Provenance in the text**: every converted line shows what it became, with live status (F7).
5. **A "From this note" recall panel** covering created, updated and mentioned items (F9).
6. **An EOD wrap-up with carry-to-tomorrow** (§5).
7. **A day context strip**: standup record, carried items, due follow-ups, 1:1s (§5, U1).
8. **Search that lands you at the match**: highlighted snippets and correct pagination (F11, F12).
9. **Durable offline-tolerant drafts**: localStorage, auto-retry, an honest offline state (F4, F5).

## 7. Remove or simplify

- Sidebar subtitle "A little space to clear your head." — remove.
- The standalone **Today** row in the sidebar — remove; label the list row instead.
- The year subline under the heading — fold into one heading line.
- The three footer buttons — collapse into one `Turn into…` menu once keyboard, bubble and slash entry points exist.
- The separate "Open follow-up" text button per row — make the row the link.
- The "Unsaved changes / Saving…" churn — replace with a steady "Saved · time".
- Blanket `['daily-notes']` invalidation and the 30 s poll while editing (P1).
- The native `<input type="date">` — replace with the app's date popover (locale mismatch).
- Standup appends into the body — already scheduled.

## 8. Recommended moves, in order

1. **Fix the merge (F2 + F3)** in `useDailyNoteEditor.ts`: append-rebase, a correct keep-both, and a shared-base test. Small and isolated. Stops note corruption.
2. **Stop the save storm (P1, P2)**: predicate invalidation, patch the list row in place, pause polling while dirty, diff-based `scanMentions`, batched ref lookups.
3. **Visual tightening (D1, D2, D3, U2, U3)**: one scroller with a sticky footer, `15/1.6` body, single-line heading, trimmed sidebar, steady save status. CSS plus small JSX changes, no behaviour risk.
4. **Resilience (F4, F5, A1)**: localStorage drafts with TTL, auto-retry and online handling, a quiet live region.
5. **Swap the textarea for CodeMirror 6 (F1)**, with the stored body still plain markdown. Ship lists, checkboxes and entity chips with autocomplete. This unlocks 6–8.
6. **Line actions + provenance (F7, F8)**: `⌘⇧T/U/F`, selection bubble, `/` menu, inference from mentions, `→ T-84` markers written back into the line. Collapse the footer.
7. **"From this note" (F9)**: return `refs[]` with `relation`, render with the drawer's item row.
8. **Day context strip + EOD wrap-up (§5)**, including carry-to-tomorrow through `append`.
9. **Search (F11, F12)**: date-ordered or offset-cursor search, `snippet()` highlights, `?q=` jump-to-match. Add "Notes mentioning…" to the person drawer.
10. **Polish**: F10, F13, F14, A2–A4, D4, D5.

Tests to add with the fixes: keep-both with a shared base; remote append while dirty auto-rebases; search pagination across more than one page of relevance-ordered hits; provenance marker inserted after create; the list row is patched without refetching the day query.
