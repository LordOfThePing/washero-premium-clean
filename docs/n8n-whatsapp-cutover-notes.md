# Washhero — n8n WhatsApp Cutover: Washero Edge-Function Change Notes

> Companion to `docs/n8n-whatsapp-cloudapi-cutover.md` and `docs/n8n-whatsapp-meta-templates.md`.
> These are the **Washero-side reproduction/change notes** for the transport-only swap, plus the
> exact files touched on branch `feat/n8n-whatsapp-cloudapi-cutover`.

## 1. New file: `supabase/functions/_shared/cloud-api-outbound.ts`

A WhatsApp Cloud API outbound module mirroring `botmaker-outbound.ts`:

- `sendCloudWhatsApp(admin, { phone, message, booking_id, template_key, ... })` — free-form/session
  text via `POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages`, type `text`.
- `sendCloudTemplateMessage(admin, { customerPhone, templateKey, parameters[], ... })` — approved
  template via the same endpoint, `type: template` with ordered `body` parameters.
- `hasOutboundTemplateLogChannelOnly(...)` — **provider-agnostic** template dedupe (channel-only) so
  a confirmation doesn't double-fire across a transport flip.
- `sanitizeForLog(...)` token redaction; `communication_logs.provider = "whatsapp_cloud_api"`.

Secrets (Supabase Edge secrets): `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`,
optional `WHATSAPP_CLOUD_API_VERSION`, `WHATSAPP_CLOUD_GRAPH_BASE`,
`CLOUD_TEMPLATE_NAME_<KEY>`, `CLOUD_TEMPLATE_LANGUAGE`.

## 2. `supabase/functions/_shared/whatsapp-automation.ts`

Added a **transport toggle** so existing lifecycle callers keep their signatures:

- `resolveTransport()` reads `WASHERO_TRANSPORT` env: `cloud_api` (default) | `botmaker` (rollback).
- `sendTemplateViaTransport(...)` / `sendTextViaTransport(...)` route to the Cloud API or Botmaker
  depending on the toggle.
- `hasOutboundTemplateLogAny(...)` dedupes channel-only under `cloud_api`, and stays Botmaker-only
  under rollback.
- `notifyBookingCreated`, `notifyTransferInstructions`, `notifyPaymentConfirmed` now send through
  the transport adapter. Return types changed to a `WasheroSendResult` union
  (`SendBotmakerMessageResult | SendCloudMessageResult`).

Cloud API templates use **order-sensitive** parameters; the ordered arrays in this file must be
kept in sync with the approved Meta template bodies (see the templates doc).

## 3. `supabase/functions/send-booking-reminders/index.ts`

Now uses `hasOutboundTemplateLogAny` + `sendTextViaTransport` so reminders respect the toggle and
dedupe across transports.

## 4. `supabase/functions/operator-send-whatsapp-message/index.ts`

Operator operational templates now send through `sendTemplateViaTransport`. Added an ordered
`cloudParameters` map per operator action key; **the order must match the approved Meta templates**.

## 4a. `supabase/functions/send-botmaker-message/index.ts`

The admin/manual outbound function now sends through `sendTextViaTransport`, so manual sends also
respect `WASHERO_TRANSPORT`. The `request`/`response` diagnostic fields of the response were removed
for cross-transport parity (they remain visible in `communication_logs.raw_payload`).

## 5. `supabase/functions/botmaker-tools/index.ts` + migration

- Payload accepts an optional `transport` field (`botmaker` default | `cloud_api`).
- `resolveConversationRow` records it if the column exists; falls back gracefully so the endpoint
  keeps working during rollout even before the migration is applied.
- New migration `supabase/migrations/20260821000000_botmaker_conversation_transport.sql` adds
  `botmaker_conversations.transport text` (idempotent).

## 6. What is intentionally NOT changed

- Booking business logic, atomic RPCs, coverage/pricing/slot files — untouched.
- The 13 tools in `_shared/whatsapp-agent/tools.ts` and the `botmaker-tools` dispatch — untouched.
- `botmaker_*` tables and `/admin/mensajes` queries — reused as-is (plus the additive `transport` tag).
- `whatsapp-agent` (Claude) path stays disabled; no Anthropic key.

## 7. Validation required before deploy

These are **Deno** modules; this repo's root `tsc` covers only `src/**`, and Deno is not available
in the current environment. Before deploying, run from the functions directory:
- `deno check supabase/functions/_shared/cloud-api-outbound.ts`
- `deno check supabase/functions/_shared/whatsapp-automation.ts`
- `deno check supabase/functions/botmaker-tools/index.ts`
- `deno check supabase/functions/send-booking-reminders/index.ts`
- `deno check supabase/functions/operator-send-whatsapp-message/index.ts`

Then deploy: `supabase functions deploy cloud-api-outbound` is N/A (shared module); deploy the
functions that import it (`send-booking-reminders`, `operator-send-whatsapp-message`) and re-deploy
`botmaker-tools`. Apply the migration via `supabase db push` / SQL editor.
