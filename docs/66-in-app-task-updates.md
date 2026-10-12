# In-app task updates (R12)

Implemented as the bounded reopening of P4-01 from docs/56. Recurrence, milestones, outbound delivery and the remaining P4 features stay deferred.

## Delivery and read state

`task_events` remains the canonical event store, owned by `TaskEventsService`. Appends and delivery inserts share the task write transaction. `task_inbox` stores a recipient user, event reference, actor reference, kind and read timestamp; it copies no task title, body, private note or label. The workspace/user/event unique index deduplicates delivery, including request replay and repeated private-to-shared changes. There is no historical backfill.

In canonical workspaces (collaborative or solo, docs/56 MDA-10), new assignments and shared instructions reach active owners with a login. Shared replies and raised/cleared blockers reach the tracking manager; shared developer-owned tasks without a tracking manager reach workspace managers. Manager-owned tasks stay with their owner/tracking manager. Actors never receive their own updates; a manager's self-linked roster identity also suppresses self chasing through a second developer login. Manager captures for non-login developers retain their existing workflows and produce no artificial developer recipient. Solo workspaces deliver too: the owner's login is the recipient, and a manager is never told about their own actions.

Plan-date and due-date changes (`schedule` events with `field` `day` or `due_at`, never carry-forward) and priority changes (`priority` events) reach the owning developer or linked manager only, as kinds `schedule` and `priority`. The item carries `change {field, from, to}`, shared task facts only, so each client words it in its own time zone. Follow-up, waiting-on and meeting times stay private.

The recipient, active account, workspace, current task access, shared visibility, redaction and deletion are checked on list/count, mark-read and exact-event reads. Developers lose previous deliveries after reassignment. New owners receive the new assignment, not a copy of earlier deliveries. Private notes/context and all agenda or `one_on_one`-origin tasks are excluded, including legacy developer-owned preparation. Existing task/history permissions remain in force.

## Surfaces and API

Managers reuse the header action inbox; Today exposes only durable updates there because it already owns the attention queue. Developers use the same inbox content from My Day without querying manager endpoints. Unread/All, older pages and read/unread controls use native links/buttons with touch targets and keyboard focus. Updates poll every 30 seconds and refresh on focus. Read state changes after server acknowledgement; failures retain state and offer scoped retries even after navigation unmounts the inbox. Logout (including failed logout), session loss and account changes revoke pending callbacks and existing retry actions through the QueryClient's auth epoch.

- `GET /api/task-inbox?unread=true&limit=20&cursor=<id>`: personal cursor page, maximum 50; unread count covers all currently accessible deliveries.
- `POST /api/task-inbox/read`: 1–100 distinct delivery IDs plus `read`; rejects the entire batch if any ID is unavailable. Repeated reads preserve the first read timestamp.
- `GET /api/task-inbox/events/:id?taskKey=T-n`: authorized exact event, including events beyond the initial timeline page.

Links open `/t/T-n?event=<id>` and focus the exact update using the existing timeline rendering. Alias normalization retains a valid event target. Cache keys and delayed acknowledgements retain the initiating auth scope. User deletion cascades recipient deliveries; canonical task/reset cleanup prunes removed event references. Logical event references permit the existing canonical event-table rebuilds.

Validation uses fresh test databases, mocked auth/Jira and synthetic browser responses. No runtime data, provider delivery, push or deployment is involved.

## Alerts (MDA-10)

The inbox is the durable record; alerts are how a person finds out without looking at it. `useInboxAlerts` (mounted once in `App.tsx`) watches the same latest-page query, which now keeps polling in background tabs and refetches on focus.

- Only updates that arrive after the page opened alert; whatever was already waiting is the bell's job.
- Tab in use: a toast (Open for one update, View for several). Tab away: a desktop notification when the person turned alerts on **and** the browser permits it (one per burst, one per task via `tag`; clicking focuses the window, opens `/t/T-n?event=<id>` and marks it read). Either way the tab title carries `(n)` and the favicon a red dot; returning shows one "while you were away" toast unless a notification was clicked.
- Choice is per person and browser (`lead-os:<workspace>:<user>:desktop-alerts`), asked once through a dismissible My Day prompt and always reachable from the switch in the updates inbox. The browser's permission is the gate; a blocked browser shows how to unblock instead of a dead switch.
- Notifications carry actor, task key, title and the changed date or priority; the same text the inbox shows, never private notes.
- Panel (MDA-11): compact two-line rows (`inboxSummary`, `compactAge` in `lib/inbox-alerts.ts`), sticky toolbar with Unread/All, per-row read dot, one-line `Desktop alerts` footer. A notification click defers navigation until the tab is visible; the opened event shows as a dismissible callout (`?event=` is removed on dismiss).
- Out of scope: Web Push (alerts with the browser closed needs a service worker, VAPID keys and a subscription table), sound, and mobile browsers that only allow service-worker notifications (the in-tab toast and title still work).
