# Washhero — n8n WhatsApp Cutover: Washero Edge-Function Change Notes

> Companion to `docs/n8n-whatsapp-cloudapi-cutover.md` and `docs/n8n-whatsapp-meta-templates.md`.
> These are the **Washero-side reproduction/change notes** for the transport-only swap, plus the
> exact files touched on branch `feat/n8n-whatsapp-cloudapi-cutover`.

## 1. `supabase/functions/_shared/cloud-api-outbound.ts` — SUPERSEDED for outbound (kept methods)

`sendCloudWhatsApp()` / `sendCloudTemplateMessage()` (direct `graph.facebook.com` POSTs using
`WHATSAPP_CLOUD_API_TOKEN`) were **removed** — outbound now routes through the n8n gateway webhook
(see §2). What remains in this module are the shared helpers `whatsapp-automation.ts` still imports:

- `hasOutboundTemplateLogChannelOnly(...)` — **provider-agnostic** template dedupe (channel-only) so
  a confirmation doesn't double-fire across a transport flip.
- `OutboundLogStatus`, `SendCloudMessageResult` — shared result/status types.
- `sanitizeForLog(...)` — secret-key redaction for `communication_logs.raw_payload`.

Secrets: `WHATSAPP_CLOUD_API_TOKEN` / `WHATSAPP_CLOUD_PHONE_NUMBER_ID` are **DEPRECATED / DO NOT SET**.

## 1b. n8n gateway transport (new)

`_shared/whatsapp-automation.ts` now ships its own `sendViaN8nGateway(...)` which POSTs to the
`N8N_WHATSAPP_WEBHOOK_URL` (the "WhatsApp Outbound Gateway", `xLrRt4VrVGgFYwko`) with header
`N8N_WHATSAPP_WEBHOOK_HEADER` = `N8N_WHATSAPP_WEBHOOK_SECRET` (default header `x-washero-outbound-secret`).
It mirrors the old module's `communication_logs` writes (`provider = "whatsapp_n8n_gateway"`),
`sanitizeForLog`-style redaction, never-throws + logs convention, and a 10s timeout.

## 2. `supabase/functions/_shared/whatsapp-automation.ts` — n8n gateway transport

Kept a `resolveTransport()` toggle (`WASHERO_TRANSPORT`): `cloud_api` (**default**) | `botmaker` (rollback).
Under `cloud_api`, both sends now go through the n8n "WhatsApp Outbound Gateway" webhook:

- `sendTemplateViaTransport(...)` → POST `kind:"template"` with `template_key`, `template_name` and
  `variables` = the named per-template vars (matched to the gateway's sendTemplate branches).
- `sendTextViaTransport(...)` → POST `kind:"text"` with the free-form `text` (used for manual sends,
  `payment_confirmed`/`booking_reminder_tomorrow` free-text resends, operator session text).
- `hasOutboundTemplateLogAny(...)` dedupes channel-only under `cloud_api` (unchanged).
- `notifyBookingCreated`, `notifyTransferInstructions`, `notifyPaymentConfirmed` signatures are
  unchanged; their sends route via the adapter. Return type stays a `WasheroSendResult` union.

Gateway secrets: `N8N_WHATSAPP_WEBHOOK_URL`, `N8N_WHATSAPP_WEBHOOK_SECRET`,
`N8N_WHATSAPP_WEBHOOK_HEADER`. Order-sensitive `cloudParameters` arrays are still passed by callers but
are **no longer used** by the gateway transport — n8n reads named `variables` instead.

## 3. `supabase/functions/send-booking-reminders/index.ts`

Now uses `hasOutboundTemplateLogAny` + `sendTextViaTransport` so reminders respect the toggle and
dedupe across transports.

## 4. `supabase/functions/operator-send-whatsapp-message/index.ts`

Operator operational templates now send through `sendTemplateViaTransport`. Added an ordered
`cloudParameters` map per operator action key; **the order must match the approved Meta templates**.

## 4a. `supabase/functions/send-whatsapp-message/index.ts`

The admin/manual outbound function now sends through `sendTextViaTransport`, so manual sends also
respect `WASHERO_TRANSPORT`. The `request`/`response` diagnostic fields of the response were removed
for cross-transport parity (they remain visible in `communication_logs.raw_payload`).

## 5. `supabase/functions/whatsapp-tools/index.ts` + migration

- Payload accepts an optional `transport` field (`botmaker` default | `cloud_api`).
- `resolveConversationRow` records it if the column exists; falls back gracefully so the endpoint
  keeps working during rollout even before the migration is applied.
- New migration `supabase/migrations/20260821000000_botmaker_conversation_transport.sql` adds
  `whatsapp_conversations.transport text` (idempotent).

## 6. What is intentionally NOT changed

- Booking business logic, atomic RPCs, coverage/pricing/slot files — untouched.
- The 13 tools in `_shared/whatsapp-agent/tools.ts` and the `whatsapp-tools` dispatch — untouched.
- `botmaker_*` tables and `/admin/mensajes` queries — reused as-is (plus the additive `transport` tag).
- `whatsapp-agent` (Claude) path stays disabled; no Anthropic key.

## 7. Validation required before deploy

These are **Deno** modules; this repo's root `tsc` covers only `src/**`, and Deno is not available
in the current environment. Before deploying, run from the functions directory:
- `deno check supabase/functions/_shared/cloud-api-outbound.ts`
- `deno check supabase/functions/_shared/whatsapp-automation.ts`
- `deno check supabase/functions/whatsapp-tools/index.ts`
- `deno check supabase/functions/send-booking-reminders/index.ts`
- `deno check supabase/functions/operator-send-whatsapp-message/index.ts`

Then deploy: `supabase functions deploy cloud-api-outbound` is N/A (shared module); deploy the
functions that import it (`send-booking-reminders`, `operator-send-whatsapp-message`) and re-deploy
`whatsapp-tools`. Apply the migration via `supabase db push` / SQL editor.
