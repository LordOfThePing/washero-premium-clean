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

## Delivery paths (DECIDED: centralized n8n gateway)

1. **Lifecycle + operator + payment messages** → Supabase Edge Functions (`_shared/whatsapp-automation.ts`)
   POST to the **n8n "WhatsApp Outbound Gateway"** webhook, which sends via n8n's own `WhatsApp account`
   credential. Meta credentials live **only** in n8n. (See `n8n-whatsapp-cloudapi-cutover.md` §5.2.)
2. **Interactive replies from the booking agent** → n8n's own **WhatsApp send / sendTemplate** nodes.

Template delivery for `payment_confirmed`/`booking_reminder_tomorrow` is a **pending n8n-UI step**: add the two
`Route Template` switch branches + sendTemplate nodes (`Send Template Payment Confirmed`, `Send Template
Reminder`) in the n8n canvas (the automation API cannot re-index a switch fan-out). Variable order above.

## Env / credential requirements

| Secret / credential | Where | Purpose |
|---|---|---|
| `N8N_WHATSAPP_WEBHOOK_URL` | Supabase Edge secrets | the gateway webhook's production URL |
| `N8N_WHATSAPP_WEBHOOK_SECRET` | Supabase Edge secrets | matches the dedicated gateway webhook-auth credential |
| `N8N_WHATSAPP_WEBHOOK_HEADER` (default `x-washero-outbound-secret`) | Supabase Edge secrets | header name the gateway checks |
| `Washero Outbound Webhook Auth` (`httpHeaderAuth`) | n8n credential | gateway webhook incoming auth (dedicated — NOT whatsapp-tools') |
| n8n `whatsAppTriggerApi` | n8n credential | Inbound webhook |
| n8n `whatsAppApi` | n8n credential | n8n outbound send (gateway + agent) |
| n8n `httpHeaderAuth` (carries `x-whatsapp-tools-secret`) | n8n credential | `whatsapp-tools` calls (inbound tool auth only) |
| `WHATSAPP_TOOLS_SECRET` | Supabase Edge secrets | `whatsapp-tools` auth |
| `WHATSAPP_CLOUD_API_TOKEN` / `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | **DEPRECATED — do NOT set** | old direct-to-Meta path, removed |

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
