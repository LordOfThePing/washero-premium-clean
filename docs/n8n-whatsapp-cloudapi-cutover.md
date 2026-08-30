# Washhero — Botmaker → n8n (WhatsApp Cloud API) Transport Cutover

> **Status update:** the Botmaker vendor integration has since been removed from the codebase
> entirely (no rollback path kept) and the `botmaker_*` tables/functions renamed to `whatsapp_*` /
> `whatsapp-tools` — see `supabase/migrations/20260901000000_rename_botmaker_to_whatsapp.sql` and
> `docs/README.backend-shim.md`. The rest of this document is the original design record; treat
> every `botmaker_*` table/column name and `botmaker-tools`/`botmaker-booking-tools`/
> `botmaker-webhook` function reference below as historical — the equivalents that still exist are
> `whatsapp_conversations`/`whatsapp_messages`/`whatsapp_events`, `whatsapp-tools`, and the n8n
> WhatsApp Trigger (there is no more Supabase-side inbound webhook). `WHATSAPP_TRANSPORT`/
> `WASHERO_TRANSPORT` toggles described here as future work were never built and are no longer
> needed — n8n/Cloud API is the only transport.
>
> **Scope (locked):** *transport-only swap.* Replace Botmaker as the WhatsApp transport with the
> **WhatsApp Cloud API driven through n8n**, while preserving Washero's booking business logic,
> atomic RPCs, the inbox tables, and the `/admin/mensajes` inbox. Re-create Meta-approved
> templates for the Cloud API. Migrate the **same business number** to the Cloud API.

---

## 1. Why this is a "transport-only" swap (and what that means)

Botmaker is a **BSP (Business Solution Provider)** that wraps the WhatsApp Business Platform. In
this codebase Botmaker is used in exactly two roles:

1. **Transport** — inbound webhooks, outbound send, template delivery, human-takeover events.
2. **Conversation state / booking orchestration** — Botmaker's flow builder holds `bk_*` variables
   and calls the `whatsapp-tools` / `botmaker-booking-tools` Edge Functions.

The booking logic itself (coverage, pricing, slot capacity, atomic RPCs) is **channel-agnostic**
and lives in Supabase. That logic is the part we must NOT re-implement.

> **Decision taken:** swap **role 1 (transport)** only. Role 2's per-conversation state moves into
> **n8n (LangChain agent + session memory)**, talking to the **same `whatsapp-tools` Edge Function**
> for every business fact and mutation. All business rules stay untouched.

---

## 2. The target architecture

```
WhatsApp customer
  │
  ▼
WhatsApp Cloud API (Meta) ── webhook ──▶ n8n "WhatsApp Trigger" node
  │                                            │
  │                                            ▼
  │                          n8n inbound handler (persist conversation/message)   ──▶ botmaker_*
  │                                            │                                    tables (reused)
  │                                            ▼
  │                          DeepSeek agent (already in n8n workflow)
  │                            │   calls whatsapp-tools Edge Function as tools:
  │                            │      get_services / validate_service_area
  │                            │      get_available_slots / calculate_booking_price
  │                            │      create_booking / list_customer_bookings
  │                            │      cancel_booking / reschedule_booking
  │                            │      request_human_handoff
  │                            ▼
  │                  ┌────── whatsapp-tools (Edge Function) ──────┐
  │                  │   atomic RPCs + booking-core + coverage... │   (UNCHANGED)
  │                  └────────────────────────────────────────────┘
  │                            │
  │                            ▼
  │                       Postgres (Supabase)
  ▼
n8n sends reply via WhatsApp Cloud API
  (session messages inside 24h window; approved templates outside it)
```

### What stays identical (do NOT touch)
- `_shared/booking-core.ts`, `coverage.ts`, `pricing-items.ts`, `slot-capacity.ts`,
  `logistic-availability.ts`
- Atomic RPCs (`create_booking_atomic`, `cancel_booking_atomic`, `reschedule_booking_atomic`)
- `supabase/functions/_shared/whatsapp-agent/tools.ts` (13 deterministic tools) — the **contract**
  both Botmaker and now n8n call through `whatsapp-tools`
- `supabase/functions/whatsapp-tools/index.ts` — HTTP dispatcher behind a shared secret
- `botmaker_*` tables, `communication_logs`, `conversation_assignments`, admin inbox queries

### What gets swapped
- **Inbound transport:** Botmaker webhook → **n8n WhatsApp Trigger** (Cloud API)
- **Outbound transport:** `sendBotmakerWhatsApp` / `sendBotmakerTemplateMessage` → **n8n WhatsApp
  send / sendTemplate** nodes
- **Conversation orchestration:** Botmaker flow builder → **n8n DeepSeek agent** with session memory

---

## 3. Prerequisites (Meta / n8n / infra)

### 3.1 Meta WhatsApp Business account
1. A Meta Business Manager with the business number claimed/added. Since we keep the **same
   number**, the number must be **migrated to the Cloud API** on this Meta Business. (Cloud-API
   numbers use a temporary or permanent WhatsApp access token from the Meta system user; other
   BSPs like Botmaker can be disconnected once migration is complete.)
2. A **system user** with `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions for a long-lived access token (or `whatsapp_business_messaging` + `messages` for a
   shorter-lived token for that number only).
3. **WhatsApp Business App** (the Meta app) with the WhatsApp product configured, linked to the
   Business/Phone Number ID. n8n's `whatsAppTriggerApi` credential needs the app's **Client ID**
   and **Client Secret**.
4. **Webhook subscription** registered to point at n8n's WhatsApp Trigger URL. n8n's
   `whatsAppTrigger` node uses a **Webhook**, and Meta verification uses that node's generated webhook
   path/verification token. *(Per n8n `@builderHint`: verification is automatic on activation —
   Meta must be pointed at n8n's callback URL; the "verify token" field is n8n's generated node id,
   not an arbitrary value.)*

### 3.2 n8n
- The existing **"Whatsapp bot"** workflow (`8rcHW8i99DGQ0Ldg`) is already active and uses the
  Cloud API (`whatsAppTrigger`, `whatsApp`, `httpHeaderAuth` media download, DeepSeek `lmChatDeepSeek`,
  MongoDB vector store). We **extend this workflow** with the inbound-persist → booking-agent path
  rather than creating a parallel one.
- Credentials required:
  - `whatsAppTriggerApi` (Cloud API app Client ID/Secret) — likely already configured for the trigger.
  - `whatsAppApi` — send credential for the Cloud API messages endpoint.
  - `httpHeaderAuth` — a credential carrying `x-whatsapp-tools-secret` used by the HTTP Request
    nodes that call the `whatsapp-tools` Edge Function.
  - `deepSeekApi` — already present.
- The **`whatsapp-tools` endpoint** (`https://<project-ref>.supabase.co/functions/v1/whatsapp-tools`)
  must be reachable from n8n (public HTTPS). Its auth is a shared secret header
  (`x-whatsapp-tools-secret`).

### 3.3 Washero / Supabase
- `whatsapp-tools` deployed with `WHATSAPP_TOOLS_SECRET` set.
- NO Anthropic key, `WHATSAPP_AGENT_MODE` stays `disabled` (this cutover does **not** use the
  disabled in-house Claude agent path).

---

## 4. Work breakdown

| # | Deliverable | Owner | Notes |
|---|-------------|-------|-------|
| 1 | n8n inbound handler (persist conversation + message) | n8n workflow | Mirrors `(retired; n8n receives Meta webhooks directly)/index.ts` upserts |
| 2 | n8n booking agent (DeepSeek + tools → `whatsapp-tools`) | n8n workflow | Built on the existing "Whatsapp bot" workflow |
| 3 | n8n outbound send node + template map | n8n workflow | WhatsApp `send` / `sendTemplate` |
| 4 | Washero edge changes (outbound → Cloud API, channel flag, template dedup) | Washero repo | Targeted, additive |
| 5 | Meta template re-approval | infra | See `n8n-whatsapp-meta-templates.md` |
| 6 | Parallel-run + cutover + rollback | ops | Sections 6–7 |

---

## 5. Washero-side changes (drafts in `docs/n8n-whatsapp-cutover-notes.md`)

Because inbound and outbound currently live inside **Supabase Edge Functions** that call Botmaker,
a transport-only swap touches the outbound callers. The plan keeps those functions but changes the
transport they invoke.

### 5.1 Channel flag on `botmaker_`
`botmaker_tools` `resolveConversationRow` sets `channel: "whatsapp"`. Extend to record the actual
transport, e.g. `channel: "whatsapp"` + a new optional `transport: "cloud_api" | "botmaker"` column
(or reuse `channel` as `"cloud_api_whatsapp"`). Minimal and additive. This lets `/admin/mensajes`
keep working while making it easy to see which transport a row came from during parallel run.

### 5.2 Outbound — centralized n8n gateway (DECIDED: option B)
Existing callers (`notifyBookingCreated`, `notifyTransferInstructions`, `notifyPaymentConfirmed`,
`send-booking-reminders`, `operator-send-whatsapp-message`, `send-whatsapp-message`) keep their
signatures but send **through the n8n "WhatsApp Outbound Gateway" webhook** (`xLrRt4VrVGgFYwko`).

Mechanism (**B**, locked): `_shared/whatsapp-automation.ts`'s `sendTemplateViaTransport` /
`sendTextViaTransport` POST to the gateway webhook (headerAuth-protected, dedicated credential). n8n
sends via its own `WhatsApp account` credential. Supabase holds **no** Meta access token.

- **(A, Rejected)** direct-from-Supabase Graph API (option A) is retired: it required
  `WHATSAPP_CLOUD_API_TOKEN` in Supabase. Those variables are now deprecated/unused; the direct
  senders were removed from `_shared/cloud-api-outbound.ts` (dedupe/types/redaction helpers remain).
- **Credentials:** `N8N_WHATSAPP_WEBHOOK_URL` (the gateway's production URL),
  `N8N_WHATSAPP_WEBHOOK_SECRET` (matches the dedicated `Washero Outbound Webhook Auth` n8n
  httpHeaderAuth credential), `N8N_WHATSAPP_WEBHOOK_HEADER` (default `x-washero-outbound-secret`).
- **Reasons:** centralize ALL Meta/WhatsApp credentials in n8n; rotating one n8n credential never
  leaks into Supabase or breaks the other direction.
- **Accepted trade-off:** lifecycle/operator sends now depend on n8n uptime. The Supabase→webhook
  call is failure-handled (never throws past the caller; logged and returned as ok:false), mirroring
  the old Graph-API failure convention.

### 5.3 Template dedupe preserved
`hasOutboundTemplateLog()` currently filters `channel == "whatsapp"` and `provider == "botmaker"`.
Update the `provider` filter (or make it channel-only) so dedupe continues to work after switching
transport — otherwise a confirmation fires twice during **parallel run** (once via old Botmaker
template, once via new Cloud API template).

---

## 6. Parallel run, verification, and cutover

Because a **Cloud API number** is a separate Meta-side identity, you cannot have the exact same
number live on both Botmaker and Cloud API webhooks simultaneously at the network level. The
parallel phase is therefore about **readiness/verification**, not dual number delivery:

1. **Build in n8n shadow/test (no real sends).** Import the extended workflow, and run the
   booking-agent path with `executeWorkflow` in **manual/test** mode against a **staging** Supabase
   (`derjqvlxhtviuqbnyiwv` per the existing docs) pointing at `whatsapp-tools`. Verify tool
   responses, pricing, coverage, slot filtering, and the **confirm-before-create** guardrail.
2. **Destination-verify templates** in a Meta test/QA number before approval of the real number.
3. **Stand up the Cloud API number** in Meta; configure n8n trigger + send; point Meta's webhook at
   n8n's callback for that number.
4. **Flip:** the migrated number now receives inbound events via n8n and replies via n8n/Cloud API.
   Botmaker is no longer the transport for this number, but the Botmaker account + templates remain
   available as a rollback path.
5. **Watch `/admin/mensajes`** for a few days: confirm conversations/messages persist, operator
   pushes fire, inbound payment-receipts capture, and human takeover signal works.
6. **Rollback if needed:** re-point Meta's webhook back to Botmaker and keep Cloud API outbound off
   until the templates/token are re-verified. No booking data is lost — it all lives in Supabase.

---

## 7. Rollback plan

- **Booking data** is always in Supabase (unchanged), so rollback is purely transport.
- Keep `BOTMAKER_API_TOKEN` and the `BOTMAKER_*` env vars set, and keep `sendBotmakerWhatsApp`'s code
  path intact (with a **config toggle** `WHATSAPP_TRANSPORT = botmaker | cloud_api` defaulting to
  `cloud_api`) so a flip back is a one-line env change, not a code revert.
- Keep the Meta templates for the number (don't delete them during shadow phase).

---

## 8. Security & safety notes

- **Never trust client-supplied price/availability.** Every booking mutation goes through
  `whatsapp-tools` → `create_booking_atomic`, which revalidates price/slot/coverage server-side.
  The n8n agent must **not** fabricate prices; it must call `calculate_booking_price`.
- **Only call `create_booking` after an explicit full-summary confirmation** and pass the WhatsApp
  `confirmation_message_id` so the idempotency key (`buildBookingIdempotencyKey`) prevents doubles.
- **Ambiguous failures on mutations → human handoff, never blind retry** of `create_booking`.
- `whatsapp-tools` auth is a **shared secret** (`x-whatsapp-tools-secret`). Store it in the
  `httpHeaderAuth` n8n credential; never hardcode in the workflow.
- `communication_logs` `raw_payload` must keep redacting tokens (`sanitizeForLog`). The Cloud API
  send function must never log the access token.

---

## 9. Open items (need confirmation before build is finalized)

1. Confirm the Cloud API **access token type**: permanent system-user token vs per-number token.
2. Confirm the business number's Meta **Phone Number ID** and that it can be **migrated off
   Botmaker** (BSP migration rules / portability).
3. Confirm **all** outbound triggers that must go through Cloud API vs which can remain Botmaker
   during the transition.
4. Final n8n **credential IDs** for `whatsAppTriggerApi`, `whatsAppApi`, `httpHeaderAuth`
   (to be wired on import).
5. Whether to keep `botmaker-booking-tools` (used by the **Botmaker flow**) deployed disabled, or
   remove after cutover — keeping it deployed and unused is the conservative choice.
