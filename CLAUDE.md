# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> The parent `../CLAUDE.md` already covers the high-level monorepo architecture (Node ↔ n8n ↔ OpenAI, Postgres/Mongo/Redis split, plugin system overview, follow-up system, message flow, conversation statuses). This file documents backend-specific details not in the parent. Read both.

## Backend-only commands

```bash
npm run dev                  # tsx watch src/server.ts
npm run build                # tsc (see "Known build issue" below)
npm start                    # node dist/server.js
npm run migrate              # Run all PG migrations in src/db/migrations/
npm run migrate:indexes      # MongoDB index migration for conversations
npm run setup:n8n-token      # Provision a system token for n8n callbacks
npx tsx src/db/seed.ts       # Seed admin@example.com / admin123
npx tsx scripts/monitor-followup.ts  # Live debug view of follow-up queue + Redis state
make setup                   # docker-compose up -d + migrate + seed
```

There are no automated tests (`make test` is a placeholder). When validating changes, run `npm run dev` and exercise the endpoint or use `AI_Agents_Backend.postman_collection.json`.

## Three independent Bull queues

The parent CLAUDE.md says "Bull processes messages asynchronously" — but the backend actually runs **three** Bull queues, each with its own producer/consumer pair, all on the same Redis under prefix `bull`:

| Queue name              | Producer                      | Consumer                      | Purpose                                                                                  |
| ----------------------- | ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `ai-messages`           | `message.producer.ts`         | `message.consumer.ts`         | Main user-message → n8n → AI pipeline. Concurrency 5.                                    |
| `ai-messages-debounce`  | `debounce.producer.ts`        | `debounce.consumer.ts`        | Delayed flush of grouped sequential messages from the same sender (sliding window).      |
| `ai-messages-followup`  | `followup.producer.ts`        | `followup.consumer.ts`        | Delayed proactive follow-up sends (see parent CLAUDE.md "Follow-Up System").             |

Both delayed queues (`debounce`, `followup`) use **unique job IDs per schedule** (not fixed per `conversationId`) because Bull doesn't allow reusing a `jobId` after removal. The current job ID is stashed in Redis state (`followup:{conversationId}` and the `flushJobId` field of the debounce buffer hash) so it can be cancelled when the user replies.

All three producers/consumers are started by import side-effect at `server.ts` boot and torn down in the graceful-shutdown sequence. Don't add a new queue without wiring both ends into `server.ts`.

## Debounce system (message grouping)

Not covered in the parent. When a user fires several messages in quick succession (typical on WhatsApp), the backend groups them into a single AI call.

- **Service**: `src/services/debounce.service.ts` — Redis hash buffer + Bull delayed flush job
- **Config (env)**: `DEBOUNCE_MS` (0 = disabled, default), `DEBOUNCE_MAX_MS` (hard cap, default 30000), `DEBOUNCE_MAX_MESSAGES` (default 10)
- **Behavior**: First message creates the buffer and schedules a flush. Subsequent messages append and **reschedule** the flush (sliding window). Hard cap by time or message count triggers an immediate flush.
- **Flush**: emits a single `MessageJob` to `ai-messages` with `channelMetadata.debouncedMessageIds` listing the original message IDs so the consumer can mark them all as `processing`.

When debugging "AI didn't respond to my message", first check whether `DEBOUNCE_MS > 0` — the message may still be in the buffer waiting for the timer.

## Billing / credits system

Not covered in the parent. Migration `007_billing_system.sql` introduced plans, packages, monthly cycles, and a credits ledger.

- **Service**: `src/services/credit.service.ts` — atomic deduction, balance aggregation (plan + active packages), 60s Redis cache (`getCreditBalanceCache` / `invalidateCreditBalanceCache`)
- **Cron**: `src/jobs/billing.cron.ts` — runs daily at `00:05 America/Sao_Paulo` via `node-cron`. Resets `user_plans.credits_balance` for users whose `cycle_end <= today`, then expires extra packages. Started in `server.ts` (`startBillingCron`), stopped in shutdown.
- **Admin endpoints**: `/api/admin/{plans,packages,users/:id/plan,users/:id/packages,users/:id/credits/adjust}` — gated by `adminMiddleware`
- **User endpoints**: `/api/usage/{balance,summary,history}`

When changing pricing or deduction logic, **always invalidate the cache** for affected users — stale balances surface as "user has credits but is being blocked" bugs.

## Plugin handler registry vs. defaultPlugins

There are two distinct plugin maps and they don't contain the same plugins:

- `src/plugins/index.ts` — `defaultPlugins[]`: every plugin that gets **registered in PostgreSQL** on startup (currently calendar, echo, whatsapp_baileys). This drives "what shows up in the install picker."
- `src/plugins/registry.ts` — `pluginHandlers{}`: only plugins that **expose tools or have an `execute` method** (currently just `plugin.calendar`). Driven by `tool.service.ts` for function-calling.

A plugin can live in `defaultPlugins` without being in `pluginHandlers` (e.g. echo, whatsapp_baileys — they're channels/demos, not tool providers). Adding a plugin that participates in tool calls requires entries in **both** files. The parent CLAUDE.md mentions the prefix convention (`calendar_create_event` → `plugin.calendar`) — that mapping lives in `TOOL_PREFIX_TO_PLUGIN_ID` in `tool.service.ts:37`.

System tools (always available, no plugin needed) are declared inline in `SYSTEM_TOOLS` in the same file — currently just `transfer_to_human`.

## WhatsApp Baileys session restoration

`server.ts` auto-restarts every active `plugin.whatsapp_baileys` session on boot by reading `plugin_configs.session_id` from PG and calling `whatsappSessionManager.startSession(agentId, sessionId)`. Session credential files live on disk under `whatsapp_baileys_sessions/` (gitignored, persisted across restarts). If a session won't reconnect, suspect (1) corrupted/missing credential files, (2) the `agent_plugins.is_active` flag, or (3) Baileys version mismatch — not the auth flow.

## Authentication: two systems for system-to-system calls

The parent CLAUDE.md mentions `SYSTEM_API_KEYS` env var. There's a **second**, newer mechanism:

- **`SYSTEM_API_KEYS` (env)** — static comma-separated list, simplest, used by n8n by default
- **System Tokens (DB-backed)** — migration `002_system_tokens.sql`, manageable via `/api/system-tokens` admin endpoints, supports per-token allowed-IP lists and audit logs

Both pass through `flexibleAuthMiddleware` / `systemAuthMiddleware` (`src/middleware/systemAuth.ts`). When adding a new endpoint that n8n needs to hit, use `flexibleAuthMiddleware` so it accepts either user JWT **or** system credential — not raw `authMiddleware`, which rejects system callers.

## Routing layout

There is **one** routes file (`src/routes/index.ts`) that wires every controller. No per-resource sub-routers. When adding routes, append to that file and pick the correct middleware (`authMiddleware`, `flexibleAuthMiddleware`, or `authMiddleware + adminMiddleware`).

## Migrations

`npm run migrate` runs `.sql` files in `src/db/migrations/` in filename order. Migrations are **not** idempotent by themselves — write `IF NOT EXISTS` / `IF EXISTS` guards or you'll break re-runs.

Current migrations:
- `001_initial_schema` — users, agents, agent_prompts, plugins, agent_plugins, plugin_configs, audit_logs
- `002_system_tokens` — DB-backed system tokens + audit log
- `003_add_soft_delete_to_agents`
- `004_add_ai_model_to_agents`
- `005_calendar_events` — for `plugin.calendar`
- `006_follow_up_config` — `agent_follow_up_config` + `agent_follow_up_steps` (see parent CLAUDE.md)
- `007_billing_system` — plans, user_plans, packages, user_packages, credit_transactions

## Known build issue

`tsc --noEmit` fails on `src/models/mongodb/Message.ts` — `IMessage.model` collides with Mongoose's `Document.model`. Runtime is unaffected because `tsx watch` ignores it. **Don't "fix" this by renaming the field** — n8n and the conversation persistence layer rely on `message.model` being that exact name. If you must touch this file, verify the rename is plumbed through `services/conversation.service.ts`, `services/n8n.service.ts`, and the n8n workflow JSONs.

## Docs index

The `docs/` directory has detailed write-ups for individual subsystems. When tackling a non-trivial change in one of these areas, read the relevant doc first:

- `MESSAGING_ARCHITECTURE.md`, `CHANGELOG_MESSAGING.md` — async queue pipeline
- `CONVERSATION_PERSISTENCE.md`, `README_CONVERSATIONS.md` — Mongo conversation/message model
- `WEBSOCKET_GUIDE.md` — WS protocol + frames
- `N8N_INTEGRATION.md` — webhook contract with n8n
- `SYSTEM_TOKENS.md`, `ARCHITECTURE_SYSTEM_TOKENS.md` — DB-backed token model
- `AGENDAMENTO_MENSAGENS.md` — scheduled-message flow (calendar plugin)
- `SECURITY.md` — auth/CORS/secret handling

The `CRIAR_PLUGIN_EXEMPLO.md` and `TESTE_AGENDAMENTO.md` at the repo root are walkthrough/recipe docs, not architecture — useful as references when implementing a similar feature.
