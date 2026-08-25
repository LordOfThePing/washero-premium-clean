# Washhero — Meta WhatsApp Cloud API Template Inventory

> Maps every WhatsApp template/session message currently sent through **Botmaker** to the Meta
> **Cloud API** message types that replace them in the transport-only cutover.
> Companion to `docs/n8n-whatsapp-cloudapi-cutover.md`.

## How templates work in this codebase (Botmaker today)

- Outbound sends go through `_shared/botmaker-outbound.ts`:
  - `sendBotmakerWhatsApp()` → free-form session message.
  - `sendBotmakerTemplateMessage()` → approved **template** via Botmaker `trigger-intent`.
- Template keys map to Botmaker WaTemplate ids via `BOTMAKER_WA_TEMPLATE_RULE_IDS` in
  `_shared/botmaker-outbound.ts`.
- **Meta Cloud API rule:** you can only send a **template** if the **24h customer-service window**
  is closed (or it's the very first contact). Inside the window, use **free-form session messages**.
  This is the single most important difference from Botmaker, which abstracts window handling.

## Template inventory

All templates below must be **re-created and approved in Meta** (WhatsApp Manager → Messages →
Message templates) for the Cloud API number. Variable placeholders use `{{1}}`, `{{2}}`, ….

### A. Booking lifecycle (via `_shared/whatsapp-automation.ts`)

| template_key | Use | Variables passed | Cloud API type | Notes |
|---|---|---|---|---|
| `booking_confirmed_v2` | Booking created/confirmed notification | `firstName`, `service`, `date`, `time`, `address` | **Template** (outside window) / session (inside) | Sent from `notifyBookingCreated/Confirmed`, MercadoPago webhook, create-*booking |
| `payment_confirmed` | Payment confirmed + receipt link | `customer_name`, `invoice_number`, `total`, `customer_invoice_url` | Template / session | From `notifyPaymentConfirmed` |
| `bank_transfer_info` | Bank/transfer instructions | `customerName`, `amount`, `alias`, `cbu`, `holder`, `bank`, `date`, `time` | Template / session | From `notifyTransferInstructions` |
| `booking_reminder_tomorrow` | Day-before reminder | `firstName`, `service_name`, `scheduled_date`, `scheduled_time`, `address` | Template / session | From `send-booking-reminders`; uses formatted `fmtDate`/`fmtTime` values as a single text block |

### B. Operator operational templates (via `_shared/botmaker-operator-templates.ts`)

| template_key | Use | Variables | Cloud API type |
|---|---|---|---|
| `operator_on_the_way` | Operator en route + ETA | `firstName`, `bookingTime`, `eta` | Template / session |
| `operator_arrived_v2` | Operator arrived | `firstName`, `address` | Template / session |
| `operator_delayed_v2` | Operator delayed | `firstName` | Template / session |
| `operator_access_needed` | Need access to gate/lot | `firstName` | Template / session |
| `operator_wash_completed` | Wash done + receipt | `firstName`, `bookingDate`, `receiptUrl` | Template / session |
| `operator_payment_reminder` | Pending payment nudge | `firstName` | Template / session |

### C. Fallback / routing text (session, not template)

| message | Source | Notes |
|---|---|---|
| Unsupported file type | `Send Unsupported Response` (n8n workflow) | Free-form; needs to live in n8n agent, not template |
| Greetings / info | n8n DeepSeek agent | Session messages inside window |

## Cloud API message-type mapping (how n8n + `send-whatsapp-cloud` send these)

The Cloud API `messages` endpoint supports `type: text`, `template`, `image`, `audio`, `document`,
etc. Outbound map:

| Washero/Botmaker call | Cloud API equivalent |
|---|---|
| `sendBotmakerWhatsApp(phone, message, ...)` | `POST /<PHONE_NUMBER_ID>/messages` `{ messaging_product:"whatsapp", to, type:"text", text:{body} }` |
| `sendBotmakerTemplateMessage(..., templateKey, variables, ...)` | `POST /<PHONE_NUMBER_ID>/messages` `{ type:"template", template:{ name, language:{code:"es_AR"}, components:[{type:"body", parameters:[...]}] } }` |

## Two delivery paths (recommended split)

1. **Lifecycle + operator messages** → dedicated `send-whatsapp-cloud` Edge Function (see
   `n8n-whatsapp-cloudapi-cutover.md` §5.2), using the Cloud API token directly. Keeps reminders,
   confirmations, receipts robust and n8n-independent. Preserves `communication_logs` + dedupe.
2. **Interactive replies from the booking agent** → n8n's own **WhatsApp send / sendTemplate** nodes.

## Env / credential requirements

| Secret | Where | Purpose |
|---|---|---|
| Cloud API **access token** (`WHATSAPP_CLOUD_API_TOKEN`) | Supabase Edge secrets | `send-whatsapp-cloud` outbound |
| **Phone Number ID** (`WHATSAPP_CLOUD_PHONE_NUMBER_ID`) | Supabase Edge secrets | Messages endpoint path |
| n8n `whatsAppTriggerApi` | n8n credential | Inbound webhook |
| n8n `whatsAppApi` | n8n credential | n8n outbound send |
| n8n `httpHeaderAuth` (carries `x-botmaker-tools-secret`) | n8n credential | `botmaker-tools` calls |
| `BOTMAKER_TOOLS_SECRET` | Supabase Edge secrets | `botmaker-tools` auth (keep for both paths) |

## Meta asset IDs to collect before build

- Business WhatsApp Account ID
- Phone Number ID (the migrated number)
- WhatsApp Business App Client ID + Secret (for n8n trigger)
- System-user long-lived access token (or per-number token)

## Backfill / parity checks

- Keep a table of Cloud API template **name vs old Botmaker key** when re-creating them (e.g. name
  `booking_confirmed_v2` → `booking_confirmed` in Cloud API; Meta names/labels must be unique per
  WABA). Document the mapping here once created.
- Re-verify each template's **approved status** in Meta before relying on it outside the 24h window.
