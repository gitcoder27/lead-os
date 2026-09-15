# LeadOS Copilot v2 — Streaming, Style & Trust

Status: proposed design · Owner: TBD · Last updated: 2026-09-15

Builds on `docs/45-ai-copilot-assistant.md` (v1, implemented). This doc only covers
what changes; anything not mentioned stays as built.

## 1. What we're building

V1 proved the architecture: manager-only `/api/assistant`, tool loop over existing
services, NDJSON events, confirm-gated writes. V2 fixes what daily use exposed and
makes Copilot feel like a product, not a demo:

- **Concise by contract** — v1 answers are verbose. The only style guidance today is
  one prompt line; v2 adds an explicit response contract, a lower temperature, and a
  user-facing Concise/Detailed setting.
- **Real streaming** — v1 emits one `delta` per LLM turn, so a reply pops in after
  seconds of silence. V2 streams tokens via provider SSE end-to-end, with a
  "Thinking…" state for reasoning models.
- **Trust in writes** — edit parameters before confirming, see before→after diffs,
  undo reversible actions.
- **Guidance, not a search box** — follow-up suggestions after answers, richer
  screen context, proactive attention signals.

## 2. Why this shape / what v1 taught us

- **Prompt contract beats hope.** GLM-family models follow explicit output rules;
  "keep replies concise" alone doesn't work. V2 specifies the answer shape
  (§5.2) the same way we specify tool rules.
- **The provider already streams.** `api.z.ai` supports `stream: true` SSE including
  incremental `tool_calls`; our NDJSON `delta` event already exists — the frontend
  appends it today. The gap is entirely in `llm-client.ts` (§5.1).
- **Error mapping hid a real bug.** The provider returned `429 {"code":"1113",
  "Insufficient balance or no resource package"}` and the UI showed "rate limited",
  sending the user to debug a non-existent quota problem. V2 passes provider error
  bodies through (§5.1) so misconfigurations self-diagnose.
- **`glm-5.3-flash` reasons before it answers.** `reasoning_content` tokens burn
  time and quota invisibly in v1. V2 surfaces them as a thinking state (§5.1, §6)
  and never caps `max_tokens` on chat turns (a cap is consumed by reasoning and
  returns empty content — observed live).
- **Confirm is one-shot.** Managers noticed they can't fix a near-right proposal;
  cancel-then-retype is friction. Edit + diff + undo close the trust gap (§5.4).

## 3. User experience design

### 3.1 What changes on screen

- **Answers stream** token-by-token with the existing caret; a subtle shimmering
  "Thinking…" line shows while the model produces `reasoning_content` (replaces it
  when content starts). Tool chips unchanged.
- **Answers are shorter.** Default shape: lead line answering the question, then
  ≤5 tight bullets, then at most one follow-up offer. Numbers and entity keys bold.
  No "Certainly!", no restating the question, no narrating tool calls.
- **Follow-up chips** appear under each completed answer — 2-3 suggested next
  prompts ("Nudge all three", "Open AM-123"), same visual as `SuggestionChips`.
- **Stop button** on the composer while streaming; **regenerate** icon on the last
  assistant message.
- **Confirm cards** gain: inline-editable parameter fields, a before→after diff for
  update tools, and an **Undo** action on reversible writes for ~15s after success
  (Jira-mutating tools are never undoable — badge stays).
- **Header `Sparkles`** shows a small attention dot when alerts/stale check-ins
  exist (reuses the `['alerts']` query — no new endpoint).
- **Settings → Copilot** gains: Response style (Concise/Detailed), follow-up
  suggestions toggle, morning-brief opt-in, and a token-usage readout
  (tokens this week + per-model).

### 3.2 Composer

- `Shift+Enter` newline / `Enter` send (unchanged), draft text persists per
  conversation across dock close/open.
- `@` opens a developer picker, `#` opens an issue picker (both backed by
  `/api/search`); inserting writes the resolved `Name` / `AM-123` text. Kills
  name-resolution failures before the model sees them. (Phase 4.)

## 4. Architecture

Same shape as v1. Two additions:

```
client                                    server
────────────────────────────────────────────────────────────────
useAssistant                        POST /api/assistant/chat
  └─ NDJSON (unchanged protocol,      AssistantService.chat()
      + 2 new event types)               │ tool loop (unchanged)
                                         ▼
                              LlmClient.chatStream()  ◀── NEW: SSE
                                         │              (replaces chat()
                                         ▼               in the loop;
                              SSE parse + tool_call    chat() stays for
                              delta merge              test-connection)
```

- New NDJSON events: `reasoning_delta` (thinking UI) and `followups`
  (suggestion chips). `delta` semantics unchanged — frontend already appends.
- `assistant_messages` gains `usage` (JSON) and `feedback` (int) columns;
  `assistant_conversations` gains `pinned` and `autoTitled` flags.

## 5. Backend implementation

### 5.1 `llm-client.ts` — streaming + honest errors

- New `LlmClient.chatStream(params): Promise<LlmStream>` — same params as `chat()`,
  sends `stream: true`, returns an async iterator of:
  `{ type: "reasoning", delta }` · `{ type: "content", delta }` ·
  `{ type: "tool_call", index, id?, name?, argumentsDelta }` ·
  `{ type: "done", usage }` · `{ type: "error", error }`.
- **Tool-call merge:** SSE delivers `tool_calls` fragmented — first chunk carries
  `index`+`id`+`function.name`, later chunks carry `function.arguments` deltas.
  Merge by `index`, concat argument strings, then run existing
  `parseToolArguments` per call. Abort/timeout handling identical to `chat()`.
- **Error pass-through:** on `!response.ok`, parse `{error:{code,message}}`
  (z.ai shape; tolerate OpenAI `error.message` too) and throw
  `HttpError(status, `AI provider: ${message}`)` — keep the status mapping
  (401/403 → invalid credentials text, 429 → rate limited **plus** provider
  detail). Honor `Retry-After` when present.
- **One retry** on 429 / 5xx / network errors with 500–1500ms jitter; never on
  abort, timeout, or 4xx≠429.
- `chat()` stays for `/api/config/ai/test` and unit tests.
- `chat`/`chatStream` params gain optional `temperature` (default 0.3); never send
  `max_tokens` from the loop (reasoning models).

### 5.2 `prompts.ts` — response contract

New section appended to the system prompt (replaces the single "concise" line):

```
Response style (concise mode — default):
- Lead with the answer in the first line. No greetings, no preamble,
  never restate the question.
- Then at most 5 bullets. Overflow: show top 5 + "…and N more — ask for the list".
- Bold only entity keys and numbers (AM-123, 3 stale check-ins).
- Never narrate tool calls ("I checked the board…") — the UI already shows them.
- End with at most one follow-up offer, and only if genuinely useful.
- "Brief"/"summarize" requests may use up to ~10 bullets + a one-line takeaway.
- Detailed mode: limits relax; still lead with the answer.
```

`buildSystemPrompt` gains `style: "concise" | "detailed"` from new config key
`ai_response_style` (default `concise`).

### 5.3 `service.ts` — stream plumbing + follow-ups

- `runLoop` calls `chatStream`; forward `content` events as `delta` (existing) and
  `reasoning` events as `reasoning_delta` (new). Accumulate content for
  persistence — the persisted `message` event stays authoritative.
- **Aborted streams:** if the caller signal fires mid-content, persist the partial
  accumulated text with `stopped: true` on the record so reloads show what was
  seen.
- **Follow-ups:** after a `complete` turn, if `ai_suggest_followups` is on (default),
  make one cheap `chat()` call (`max_tokens: 80`, temperature 0.5): system "Suggest
  3 short follow-up prompts the manager might ask next, as a JSON array of strings
  under 8 words each. No other text." + the user question and assistant answer.
  Parse defensively; emit `{ type: "followups", items: string[] }` before `done`.
  Failure is silent — no followups event, normal done.
- **Regenerate:** `AssistantChatRequest` gains `retry?: true` — server deletes the
  last assistant turn (assistant + tool rows) for the conversation, then reruns
  against the last user message. No new endpoint.
- **Usage accounting:** persist `usage` on the assistant message row each turn
  (add `reasoningTokens` when the provider reports it — z.ai does).
- History summarization (>60 rows → summarize dropped segment via one LLM call)
  is a stretch item, Phase 4.

### 5.4 `tools.ts` — preview, diff, undo

Three optional capabilities on `AssistantToolDefinition`:

- `editableFields?: string[]` — arg keys the confirm card may edit. Confirm request
  gains `overrides?: Record<string, unknown>`; service merges overrides into
  `record.arguments` and **re-runs the tool's Zod schema** before executing.
- `preview?(args, ctx): Promise<{ label: string; current: string; proposed: string }[]>`
  — resolves current state at proposal time. Used first by `update_issue_fields`
  (status/priority before→after) and `assign_tracker_task` (current assignee).
  `action_proposal.preview` becomes `{ args, diff }` (backward-compatible: `diff`
  optional).
- `undoable?: boolean` + `undo(result, ctx)` — for `create_desk_item` (delete the
  item), `append_daily_note` (remove appended block). Persist an `undoPayload` on
  the tool-call record at execution; new `POST /api/assistant/actions/undo`
  `{conversationId, toolCallId}` runs it within a 15-minute window, emits
  `action_executed` with `undone: true` + invalidations. `jiraMutating` tools are
  never `undoable`.

### 5.5 Config & routes

- New config keys: `ai_response_style` (`concise`|`detailed`, default `concise`),
  `ai_suggest_followups` (default `true`), `ai_morning_brief` (default `false`).
  Extend `GET/PUT /api/config/ai` + Zod schemas.
- `POST /api/config/ai/test` — unchanged, but the 400 body now carries the
  provider's real message via §5.1 (self-diagnosing misconfig).
- New `GET /api/assistant/usage` — token totals per model for trailing 7/30 days,
  from `assistant_messages.usage`.
- New `POST /api/assistant/actions/undo` (§5.4), `POST /api/assistant/messages/:id/feedback`
  (`{value: 1 | -1 | null}`), `PATCH /api/assistant/conversations/:id` (`{title?, pinned?}`).

### 5.6 `shared/types.ts` additions (type-only)

- `AssistantStreamEvent` += `{ type: "reasoning_delta"; content: string }` and
  `{ type: "followups"; items: string[] }`.
- `AssistantChatRequest` += `retry?: boolean`, `pageContext?: { view: string; params?: Record<string,string> }`.
- `AssistantActionConfirmRequest` += `overrides?: Record<string, unknown>`.
- `AssistantActionProposal.preview` → `{ args: Record<string, unknown>; diff?: ProposalDiff[] }`.
- `AssistantMessage` += `usage?: AssistantTokenUsage`, `feedback?: 1 | -1`.
- `AiAssistantConfig` += `responseStyle`, `suggestFollowups`, `morningBrief`.
- New: `AssistantTokenUsage`, `AssistantUsageReport`, `AssistantFeedbackRequest`,
  `AssistantUndoRequest`, `AssistantConversationPatch`.

### 5.7 Schema/migrations

`schema.ts` + `migrate.ts` together, as always:

- `assistant_messages`: `usage TEXT` (JSON), `feedback INTEGER` (null/1/-1).
- `assistant_conversations`: `pinned INTEGER NOT NULL DEFAULT 0`,
  `auto_titled INTEGER NOT NULL DEFAULT 0`.
- `undoPayload` lives inside the `toolCalls` JSON record — no column needed.

### 5.8 Screen context

`AssistantChatRequest.pageContext.params` carries sanitized route params the
client already parses in `view-params.ts` — `issue`, `date`, `dev`, `filter`.
`prompts.ts` renders them into the context line ("viewing /work, issue AM-123
selected"), letting "this defect"/"her tasks" resolve without tool calls.
Never send arbitrary params — client allowlists keys.

## 6. Frontend implementation

- `assistant-stream.ts` — handle `reasoning_delta` + `followups`; everything else
  unchanged (deltas already append).
- `useAssistant` — track `reasoning` text separately from `content`; expose
  `stop()` (abort the fetch — server-side abort already works via `res.close`),
  `retry()` (send `retry: true`), `undo(toolCallId)`, `feedback(messageId, value)`.
- `ChatMessage` — thinking block (shimmer line, auto-collapses when content
  starts), thumbs up/down on hover, follow-up chips under completed answers,
  issue-key links extended to developer names → `/team`.
- `ActionConfirmCard` — editable fields per `editableFields`, diff rows for
  `preview.diff`, Jira badge unchanged.
- `MessageList` — Undo inline action on `action_executed` for undoable tools
  (15s visible window, then collapses to a "Done" line).
- `AssistantComposer` — Stop while streaming; draft persisted in context keyed by
  conversation id; `@`/`#` mention pickers (Phase 4).
- `AssistantHeader` — rename/pin in the thread picker.
- `Header` — attention dot on `Sparkles` from existing alerts query.
- `AssistantSection` — style select, followups toggle, morning-brief toggle,
  usage readout from `GET /api/assistant/usage`.

## 7. Security & privacy

- Overrides are re-validated server-side by each tool's Zod schema — the UI can
  never widen a write beyond the schema.
- Undo is server-bounded (15 min window, record-scoped) and unavailable for Jira
  mutations.
- `pageContext.params` is allowlisted client-side; treat it as untrusted text in
  the prompt regardless.
- Token usage contains counts only — never message bodies. Feedback stores an int.
- Same rules as v1: server-side key, manager-only, no body/secret logging.

## 8. Testing

- `assistant.service.test.ts` — scripted `chatStream` stub: content/reasoning
  ordering, abort-persist, retry path, followups emission (stub the suggestion
  call), overrides merge + re-validation, undo success/expiry, feedback endpoint.
- `llm-client.test.ts` (new) — SSE parsing, tool-call delta merge across chunks,
  provider error-body pass-through, retry-once behavior.
- `assistant.tools.test.ts` — `preview` diffs, `undo` executors.
- `AssistantDock.test.tsx` — streaming deltas + thinking state, stop, regenerate,
  follow-up chips, edit-and-confirm, undo, thumbs.
- Eval harness (Phase 4): `server/evals/copilot.eval.ts` — scripted scenarios with
  expected tool sequences, run manually via `npm run eval:copilot` against the
  live provider for prompt tuning; a stubbed variant runs in CI.

## 9. Build order

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Feel** | response contract + temperature; `chatStream` + SSE merge; `delta`/`reasoning_delta` streaming; thinking UI; stop button; provider error pass-through | Answers stream live, are visibly shorter, thinking state shows; a bad config prints the provider's real error |
| **2. Guidance** | follow-up suggestions + chips; `pageContext` params; regenerate; style toggle | Each answer offers next steps; "this defect" resolves on /work |
| **3. Trust** | editable fields + diff preview + undo; retry-once; usage persistence + settings readout | Wrong params fixable in-card; reversible actions undoable; token spend visible |
| **4. Ambition** | attention dot + opt-in morning brief; `@`/`#` mentions; feedback buttons; eval harness; rename/pin/auto-title; history summarization | Proactive signals; zero-friction entity refs; measurable answer quality |

Validation per phase: `npm run typecheck`, `npm run build:check`, targeted
`server/tests` + `client/src/test` runs.

## 10. Open questions

- **Thinking content in history?** Persisting `reasoning_content` bloats rows and
  adds no value to context — current plan is display-only, never sent back. Revisit
  if a provider needs it.
- **Model routing:** send trivial turns (hi/thanks) to a cheaper non-reasoning
  model? Adds a second client config; defer until usage numbers exist (Phase 3
  readout).
- **Follow-ups vs. extra latency:** the suggestions call adds ~1s after the answer;
  acceptable since it lands post-`message`, but if it feels slow, move generation
  into the main prompt (structured last line) and parse/strip it.
- **Undo window:** 15 min is arbitrary — watch whether managers want longer for
  desk items (they can always delete manually).
