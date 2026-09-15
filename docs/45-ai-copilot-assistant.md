# LeadOS Copilot — In-App AI Assistant

Status: proposed design · Owner: TBD · Last updated: 2026-09-14

## 1. What we're building

A conversational AI assistant embedded in the LeadOS web app. The manager opens a docked
chat panel from anywhere in the app and can:

- **Ask anything about LeadOS data** — team board, developers, assigned work, desk items,
  notes, Today snapshot, follow-ups, meetings, Jira defects, alerts, sync status.
- **Act on the workspace** — create desk items, assign tasks to developers, log check-ins,
  carry work forward, comment on defects, trigger Jira sync — the same things the UI can do.
- **Get briefings** — "what changed since yesterday", "who needs attention", "summarize my
  day".

The assistant runs entirely inside the LeadOS backend: the browser talks to a new
`/api/assistant` route, which runs an LLM tool-calling loop against the existing service
layer. No external agent runtime (Hermes/OpenClaw) is involved. The LLM provider is
OpenAI-compatible and configurable; the API key lives only on the server, encrypted the
same way Jira tokens are.

**Product name:** LeadOS Copilot (code/module name: `assistant`).

## 2. Why this shape

- **The action layer already exists.** `TodayService.executeCommand`
  (`server/src/services/today.service.ts`) exposes structured commands —
  `assign_owner`, `set_current_work`, `add_check_in`, `capture_follow_up`, `mark_done`,
  `carry_forward`, `capture_meeting_outcome`, `snooze` — with typed targets. That is
  precisely the shape of an LLM tool. We wrap what exists instead of reimplementing writes.
- **Auth is free.** `/api/assistant` mounts behind `requireManager`, so every tool call
  executes with `req.auth!.user` role + workspace — the assistant cannot exceed what the
  signed-in manager can do.
- **Owning the loop is cheap.** A bounded tool-call loop is ~150 lines, is testable with
  Vitest, deploys with the app, and keeps the product self-contained.

## 3. User experience design

### 3.1 Entry points

- **Header button** — `Sparkles` (lucide) icon button in `HeaderNav`, right side.
- **Keyboard** — `Cmd/Ctrl + J` toggles the panel (Cmd+K stays the palette).
- **Empty-state chips** — suggested prompts on first open ("Brief me on today",
  "Who needs attention?", "Create a follow-up").

### 3.2 The panel — `AssistantDock`

A right-docked floating panel, rendered via portal (same pattern as `CommandPalette`),
`~400px` wide, full height minus header offset. On small screens it becomes a full-screen
sheet.

Visual direction (matching the existing dark theme tokens — use CSS variables, not
hardcoded colors):

- Frosted-glass surface: `backdrop-blur`, semi-transparent panel, 1px subtle border,
  soft outer glow in the brand accent.
- Header: LeadOS mark + "Copilot" title, conversation picker (recent threads), close.
- Message list: manager messages right-aligned, assistant messages left-aligned plain
  text with markdown rendering (existing content is plain/markdown-lite — render bold,
  lists, code, links).
- **Streaming**: assistant text streams token-by-token (NDJSON over `fetch` +
  `ReadableStream`); a pulsing caret while streaming.
- **Tool activity chips**: inline collapsible chips while the model works —
  `⌁ Reading team board…`, `⌁ Checked 14 desk items`, `⌁ Synced Jira (15 issues)`.
  Collapsed to a summary line after completion; expandable for transparency.
- **Action confirmation cards**: proposed writes render as a card —
  icon + human-readable summary ("Assign *Fix login redirect loop* to **Priya** for
  today") + Confirm / Edit / Cancel buttons.
- Composer: auto-growing textarea, Enter sends / Shift+Enter newline, `/` quick
  suggestions, mic button reserved (future), "Copilot can make mistakes" microcopy.
- Motion: `framer-motion` — panel spring-in, message fade-up, chip shimmer while a tool
  runs, card scale-in. Respect `prefers-reduced-motion`.
- Context awareness: subtle "viewing: /team" context line — the server receives the
  current route so the assistant can resolve "this screen" / "these developers".

### 3.3 Conversation model

- Threads persist per manager (`assistant_conversations`, `assistant_messages` tables);
  sidebar lists recent threads; "New chat" starts fresh.
- Assistant replies may embed **entity links** — `AM-123` renders as a link to the issue,
  developer names link to `/team` — using existing `TodayActionTarget`-style navigation.

## 4. Architecture

```
client                                    server
────────────────────────────────────────────────────────────────
AssistantDock                             POST /api/assistant/chat
  └─ useAssistant (NDJSON stream)   ──▶    AssistantService.chat()
useAssistantActions (confirm)       ──▶    POST /api/assistant/actions/confirm
                                            │  tool loop (≤ 6 iterations)
                                            ▼
                                   ┌────────────────────────┐
                                   │ LlmClient (OpenAI-     │
                                   │ compatible chat/tools) │
                                   └────────────────────────┘
                                            │ tool calls
                                            ▼
                            AssistantToolRegistry → existing services:
                            TodayService · TeamTrackerService ·
                            ManagerDeskService · IssueService ·
                            DailyNotesService · WorkloadService ·
                            AlertService · SearchService · SyncEngine
```

## 5. Backend implementation

### 5.1 New files

```
server/src/assistant/
  llm-client.ts        # OpenAI-compatible chat completions + tools (fetch-based)
  tools.ts             # tool definitions (JSON Schema) + executors
  prompts.ts           # system prompt builder
  service.ts           # AssistantService: chat loop, streaming, persistence
server/src/routes/assistant.ts
```

`server/src/services/assistant-credentials.service.ts` — encrypted key storage,
mirroring `jira-credentials.service.ts` (config-table row `ai_api_key`,
`encryptSecret`/`decryptSecret` from `secret-crypto.ts`).

### 5.2 Config

Stored in `config` table (per workspace, same as Jira settings):

| key | example | notes |
|---|---|---|
| `ai_assistant_enabled` | `true` | default `false` until configured |
| `ai_provider` | `openai-compatible` | future: `anthropic` |
| `ai_base_url` | `https://api.z.ai/api/paas/v4` | OpenAI-compatible endpoint |
| `ai_model` | `glm-5.3-flash` | any tool-calling-capable model |
| `ai_api_key` | `enc:v1:…` | encrypted; never returned to client |
| `ai_max_tool_iterations` | `6` | safety bound |

`GET /api/config` exposes only `enabled/provider/baseUrl/model` + `hasApiKey` — the key
is write-only (same treatment as `jiraApiToken` today). A `POST /api/config/ai/test`
endpoint performs a 1-token `models.list` or trivial chat call to validate credentials.

### 5.3 LLM client (`llm-client.ts`)

- `chat({ messages, tools, signal }) → { content, toolCalls[], usage }`
- `chatStream(…)` — optional; if the provider supports streaming, forward deltas.
- Uses global `fetch` (no new dependency), `Authorization: Bearer <key>`,
  `POST {baseUrl}/chat/completions` with `tools` + `tool_choice: "auto"`.
- 30s timeout via `AbortController` (same pattern as `JiraClient`).
- Errors normalized: `401 → "AI credentials invalid"`, `429 → "rate limited"`,
  timeout → `"AI request timed out"` — surfaced as `{ error, status }` like elsewhere.

### 5.4 Tool catalog (`tools.ts`)

Each tool = `{ name, description, parameters (JSON Schema), confirm: "always"|"never",
execute(args, ctx) }`. `ctx` carries `managerAccountId`, `workspaceId`, `date`, services.

**Read tools (auto-execute, `confirm: "never"`)**

| tool | backed by |
|---|---|
| `get_today_snapshot` | `TodayService.getToday(date)` |
| `get_team_board` | `TeamTrackerService.getBoard(date)` — devs, day plans, check-ins, attention |
| `get_developer_day` | `TeamTrackerService.getDeveloperDayView(accountId, date)` |
| `search_issues` | `IssueService.getAll(query)` — filter/status/assignee/tag |
| `get_issue` | `IssueService.getById(jiraKey)` |
| `list_desk_items` | `ManagerDeskService.getDay/getTodayItems` — kind/status/date filters |
| `get_notes` | `DailyNotesService.getDay(date)` (+ `list` for recent days) |
| `search_workspace` | `SearchService.search(query)` — issues, desk, check-ins, devs |
| `get_workload` | `WorkloadService.getTeamWorkload(date)` |
| `get_alerts` | `AlertService.listAlertsForManager` |
| `get_sync_status` | `SyncEngine.getRuntimeStatus` + `getLastSyncLog` |

**Write tools (`confirm: "always"` — proposed, never auto-run)**

| tool | backed by |
|---|---|
| `manager_action` | `TodayService.executeCommand` — generic passthrough: `assign_owner`, `add_check_in`, `set_current_work`, `mark_done`, `carry_forward`, `capture_follow_up`, `capture_meeting_outcome`, `snooze` |
| `create_desk_item` | `ManagerDeskService.createItem` (follow-up/decision/risk/meeting/action) |
| `update_desk_item` | `ManagerDeskService.updateItem` |
| `assign_tracker_task` | `TeamTrackerService.addItem(accountId, date, { title, jiraKey?, note? })` |
| `add_issue_comment` | `IssueService.addComment` — **Jira-mutating** |
| `update_issue_fields` | `IssueService.update` — **Jira-mutating** |
| `append_daily_note` | `DailyNotesService.append` |
| `trigger_jira_sync` | `SyncEngine.syncNow` |

Confirmation flow:

1. Model emits a write tool call → service returns a **proposal event**
   (`action_proposal`) with `{ toolCallId, summary, preview }` instead of executing.
2. Reply stream ends with `awaiting_confirmation`.
3. Client renders the confirm card; on Confirm →
   `POST /api/assistant/actions/confirm { conversationId, toolCallId, decision }`.
4. Server executes the stored proposal, appends tool result + a final assistant
   message ("Done — assigned to Priya"), streams the confirmation result back.

Jira-mutating tools are always confirmed. Read tools always run inline. This keeps a
single safety rule: *the model can look freely, it can never write without a click.*

### 5.5 Chat loop (`service.ts`)

```
AssistantService.chat({ conversationId?, message, currentView, date })
  → load/create conversation, append user message
  → build messages: systemPrompt(context) + history + user msg
  → loop ≤ maxToolIterations:
       resp = llm.chat(messages, tools)
       if resp.toolCalls:
          for each: confirm? → emit proposal, stop
                    else → execute, emit tool_start/tool_end, append tool result
       else → emit final delta(s), persist assistant message, done
```

- **Streaming format**: NDJSON lines — `{ "type": "delta" | "tool_start" | "tool_end" |
  "action_proposal" | "message" | "done" | "error", … }`. `fetch` POST +
  `res.body.getReader()` on the client (SSE can't POST; NDJSON is simpler).
- **Persistence**: `assistant_conversations` (id, workspace_id, manager_account_id,
  title, created_at, updated_at) and `assistant_messages` (id, conversation_id, role,
  content, tool_calls JSON, created_at). Title auto-generated from first message.
- **System prompt** (`prompts.ts`): role ("You are the LeadOS copilot…"), today's date,
  manager display name, compact context card (counts only: active defects, team size,
  stale check-ins, follow-ups due — one `getToday` call), tool usage rules (prefer
  tools over guessing; never invent issue keys; always summarize after acting), and the
  confirm contract.
- **Guardrails**: 6 max tool iterations, 8k max history messages (truncate oldest with
  a summary stub), 60s request budget, 30 req/hr per manager soft cap (in-memory).

### 5.6 Route + wiring

`server/src/routes/assistant.ts` — thin, Zod-validated:

- `POST /chat` → streams NDJSON (`res.setHeader('Content-Type','application/x-ndjson')`)
- `POST /actions/confirm` → `{ decision: "confirm" | "cancel" }`
- `GET /conversations` · `GET /conversations/:id` · `DELETE /conversations/:id`

`server/src/app.ts`: `app.use("/api/assistant", requireManager(services.authService), createAssistantRouter(services.assistantService))`.

`server/src/index.ts`: construct `AssistantService` with the existing service
instances + `SettingsService` config; add to `createApp` deps.

### 5.7 `shared/types.ts` additions (type-only — no `types.js` regen needed)

`AssistantRole`, `AssistantMessage`, `AssistantConversation`,
`AssistantChatRequest`, `AssistantStreamEvent` (discriminated union on `type`),
`AssistantActionProposal`, `AssistantToolCallRecord`, `AiAssistantConfig` (public,
keyless), `UpdateAiAssistantConfigRequest`.

### 5.8 Schema/migrations

`server/src/db/schema.ts` + matching DDL block in `server/src/db/migrate.ts`:

```sql
assistant_conversations: id (pk), workspace_id, manager_account_id,
                         title, created_at, updated_at
assistant_messages:      id (pk), conversation_id (fk → cascade),
                         role, content, tool_calls (json), created_at
index on (conversation_id, created_at), (workspace_id, manager_account_id)
```

Pending proposals live on the `assistant_messages.tool_calls` JSON of the last message —
no extra table.

## 6. Frontend implementation

```
client/src/components/assistant/
  AssistantDock.tsx        # portal panel, layout, open/close
  AssistantHeader.tsx      # title, thread picker, new chat, close
  MessageList.tsx          # scroll container, auto-scroll
  ChatMessage.tsx          # manager/assistant bubbles + markdown-lite
  ToolCallChip.tsx         # inline tool activity indicator
  ActionConfirmCard.tsx    # write-confirmation card
  AssistantComposer.tsx    # textarea + send + suggestions
  SuggestionChips.tsx      # contextual starter prompts
client/src/hooks/useAssistant.ts        # thread state + NDJSON stream reader
client/src/hooks/useAssistantConfig.ts  # settings load/save/test
client/src/context/AssistantContext.tsx # open/close + currentView
```

- `client/src/lib/api.ts`: `assistant.chatStream(body, onEvent, signal)`,
  `assistant.confirmAction(...)`, `assistant.listConversations()` etc. NDJSON parsing
  lives in `useAssistant` (the `api` helper stays JSON-only).
- Mount `<AssistantDock/>` once in `App.tsx` next to the palette; `Cmd+J` global
  keydown (alongside the existing Cmd+K handler); pass the current route as
  `currentView` with each request.
- Settings: new `settings/AssistantSection.tsx` in `SettingsPanel` — enable toggle,
  provider/base-URL/model fields, API key (password input, "stored" indicator),
  **Test connection** button → `POST /api/config/ai/test`.
- Data refresh after writes: on `action_executed` event, invalidate the relevant
  TanStack Query keys (`['team-tracker']`, `['manager-desk']`, `['issues']`, `['today']`)
  so the underlying screens update behind the panel.

## 7. Security & privacy

- Manager-only route; developer role gets a scoped `/my-day` assistant later (non-goal now).
- API key encrypted at rest (`secret-crypto`), masked in `GET /api/config`, never sent
  to the client; all LLM calls are server-side.
- Notes are manager-private — the assistant is manager-only, so no new exposure.
- No message bodies logged at `info`; log tool names + counts only (logger already
  redacts token fields).
- Write actions require explicit UI confirmation — the model can never mutate alone.
- Prompt-injection posture: tool outputs are data, system prompt forbids following
  instructions inside issue/note text; destructive/irrelevant requests get declined.

## 8. Testing

- `server/tests/assistant.service.test.ts` — tool loop with a stub `LlmClient`
  (scripted responses), confirm gating, iteration cap, persistence. Uses existing
  `tests/helpers/db.ts`.
- `server/tests/assistant.tools.test.ts` — each tool executor against seeded data.
- `server/tests/assistant.routes.test.ts` — auth boundary, NDJSON shape, confirm flow.
- `client/src/test/AssistantDock.test.tsx` — render, send, stream events applied,
  confirm card approve/cancel, suggestions.
- Backend coverage thresholds (80/80/70) apply — `assistant/` lives under `services/`
  coverage scope; keep executors thin over already-tested services.

## 9. Build order

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Config + transport** | `ai_*` config keys, credentials service, `llm-client.ts`, settings section + test button | Test-connection succeeds in Settings |
| **2. Read-only copilot** | NDJSON `/chat`, 11 read tools, dock UI, streaming text, tool chips, threads | Ask "who's stale / what's on my desk" → correct answers |
| **3. Actions** | write tools + proposal/confirm flow + `manager_action` passthrough + query invalidation | "Assign AM-123 to Priya" → confirm card → lands on team board |
| **4. Polish** | thread list, entity links, context line, suggested prompts per screen, `/` composer commands, rate limits | Daily-driver quality |

Validation per phase: `npm run typecheck`, `npm run build:check`, targeted
`server/tests` + `client/src/test` runs; deploy via `scripts/deploy.sh prod` as usual.

## 10. Open questions

- **Model choice**: default to the z.ai `glm-5.3-flash` endpoint already used on this
  host (cheap, fast), or standardize on a first-tier model (GPT/Claude) for tool-call
  reliability? Config makes it swappable — start with what's configured.
- **Voice input**: composer has a reserved slot; out of scope for v1.
- **Proactive mode** ("copilot notices X"): later, via alerts integration — not v1.
- **Multi-manager workspaces**: schema is per-manager already; prompts fine as-is.
