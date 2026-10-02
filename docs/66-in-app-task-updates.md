# In-app task updates (R12)

Implemented as the bounded reopening of P4-01 from docs/56. Recurrence, milestones, outbound delivery and the remaining P4 features stay deferred.

## Delivery and read state

`task_events` remains the canonical event store, owned by `TaskEventsService`. Appends and delivery inserts share the task write transaction. `task_inbox` stores a recipient user, event reference, actor reference, kind and read timestamp; it copies no task title, body, private note or label. The workspace/user/event unique index deduplicates delivery, including request replay and repeated private-to-shared changes. There is no historical backfill.

In collaborative, canonical workspaces, new assignments and shared instructions reach active owners with a login. Shared replies and raised/cleared blockers reach the tracking manager; shared developer-owned tasks without a tracking manager reach workspace managers. Manager-owned tasks stay with their owner/tracking manager. Actors never receive their own updates; a manager's self-linked roster identity also suppresses self chasing through a second developer login. Manager captures for non-login developers retain their existing workflows and produce no artificial developer recipient. Solo workspaces generate and expose no inbox updates.

The recipient, active account, workspace, current task access, shared visibility, redaction and deletion are checked on list/count, mark-read and exact-event reads. Developers lose previous deliveries after reassignment. New owners receive the new assignment, not a copy of earlier deliveries. Private notes/context and all agenda or `one_on_one`-origin tasks are excluded, including legacy developer-owned preparation. Existing task/history permissions remain in force.

## Surfaces and API

Managers reuse the header action inbox; Today exposes only durable updates there because it already owns the attention queue. Developers use the same inbox content from My Day without querying manager endpoints. Unread/All, older pages and read/unread controls use native links/buttons with touch targets and keyboard focus. Updates poll every 30 seconds and refresh on focus. Read state changes after server acknowledgement; failures retain state and offer scoped retries even after navigation unmounts the inbox. Logout (including failed logout), session loss and account changes revoke pending callbacks and existing retry actions through the QueryClient's auth epoch.

- `GET /api/task-inbox?unread=true&limit=20&cursor=<id>`: personal cursor page, maximum 50; unread count covers all currently accessible deliveries.
- `POST /api/task-inbox/read`: 1–100 distinct delivery IDs plus `read`; rejects the entire batch if any ID is unavailable. Repeated reads preserve the first read timestamp.
- `GET /api/task-inbox/events/:id?taskKey=T-n`: authorized exact event, including events beyond the initial timeline page.

Links open `/t/T-n?event=<id>` and focus the exact update using the existing timeline rendering. Alias normalization retains a valid event target. Cache keys and delayed acknowledgements retain the initiating auth scope. User deletion cascades recipient deliveries; canonical task/reset cleanup prunes removed event references. Logical event references permit the existing canonical event-table rebuilds.

Validation uses fresh test databases, mocked auth/Jira and synthetic browser responses. No runtime data, provider delivery, push or deployment is involved.
