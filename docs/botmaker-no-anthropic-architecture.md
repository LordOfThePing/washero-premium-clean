# WASHERO WhatsApp booking — no-Anthropic architecture

Status: **design + endpoint implementation only. Nothing in this document has been deployed.**
`WHATSAPP_AGENT_MODE` stays `disabled` (its default). No Anthropic API key is requested,
required, or referenced anywhere in this architecture.

## 1. Botmaker capability audit

I have no access to the WASHERO Botmaker account or dashboard (no API credentials, no MCP tool
for Botmaker) and did not fabricate an audit. What follows is split honestly into two parts:
what the existing, already-in-production codebase **proves** this account can do, versus what
**you need to confirm** in the Botmaker dashboard before the flow design below can be finalized
against the strongest available mechanism.

### Proven from existing production code (months of live use)

| # | Capability | Evidence | Verdict |
|---|---|---|---|
| 6 | Webhooks | `supabase/functions/botmaker-webhook/index.ts` has received real inbound events (messages, assignment changes) in production for months. | **Confirmed working.** |
| 7 | Human takeover / bot muting | `conversation_assignments` table + `botmaker_conversation_assignments` migration + `/admin/mensajes` UI + `syncHumanTakeoverSignal()` (webhook-handler.ts) reacting to `senderType: "agent"` events. | **Confirmed working** — Botmaker fires a distinguishable event when a human replies via its live-agent UI, and conversation assignment/resolution is already a working feature. |
| — | WhatsApp template messaging | `BOTMAKER_WA_TEMPLATE_RULE_IDS` in `botmaker-outbound.ts` contains real, live template IDs (`washero:WaTemplate:LFLK4JK6HEG70LE3H676` etc.) actively used for booking confirmations, operator ETA, etc. | **Confirmed working and already in production cost.** |
| — | Outbound API (`trigger-intent`, `intent/v2`) | `sendBotmakerTemplateMessage()` calls `POST /chats-actions/trigger-intent` with `variables`, proven against the real Botmaker API (multiple send-mode variants tried and left configurable, suggesting real historical testing). | **Confirmed working** — Botmaker accepts server-to-Botmaker calls carrying structured variables. This is the *outbound* direction (WASHERO → Botmaker), not proof of the *inbound* direction (Botmaker flow → WASHERO) needed below. |

### NOT determinable from code — needs your confirmation in the Botmaker dashboard

The existing legacy flow (`_shared/botmaker-booking.ts`) collects booking info by having
Botmaker's bot ask questions conversationally, then packages the answers into one big **free-text
summary message**, which WASHERO's webhook parses after the fact with regexes
(`parseSummary()`). That is strong circumstantial evidence this account's flow was **not** built
around live in-flow REST calls — but it could equally be a design choice made for other reasons,
not a plan limitation. I cannot tell which without your dashboard.

| # | Capability | Where to check | Why it matters |
|---|---|---|---|
| 1 | API actions from bot flows | Flow Builder → node palette → look for "API Action" / "Webhook" / "HTTP Request" step type | If present, a flow step can call `botmaker-tools` directly and branch on the JSON response — this is what the flow spec below assumes. |
| 2 | External REST requests | Same as above — confirm the API-action node can call an arbitrary HTTPS URL (not just Botmaker-internal actions) | Required for step 2 onward below. |
| 3 | Structured request/response variables | In the API-action node config, confirm you can map response JSON fields into flow variables (not just store the raw response as text) | Needed to branch on `ok`, `inside_coverage`, `slots`, etc. |
| 4 | Intents / NLU classification | Settings → NLU / Intents, or Flow Builder's intent-trigger nodes | Determines how much natural-language flexibility ("quiero para el auto y la camioneta") the flow can support vs. strict button-driven steps. |
| 5 | Generative AI agent with external tools | Settings → look for "AI Agent" / "GenAI" / "Copilot" feature, and check your plan tier's included quota vs. paid add-on pricing | **Do not assume this is free** — per your instruction, confirm the plan tier explicitly includes it (or its cost) before considering it. |
| 8 | Persistent conversational variables | Flow Builder → Variables panel | Needed to carry `service_id`, `scheduled_date`, etc. across steps within one conversation. Very likely available on all plans (this is close to a baseline feature of any flow builder) but worth a quick confirmation. |

**Until you confirm #1–#5 and #8, this document specifies the deterministic intent-and-flow
design (your own explicitly-requested fallback) as the actual deliverable** — not a placeholder.
It is fully buildable today, requires nothing paid beyond what's already in use, and every tool
endpoint it calls is identical to what a GenAI-with-tools flow would call if #5 turns out to be
included free. Confirming #5 later is an *upgrade path* on the same backend, not a redo.

## 2. Free-plan limitations discovered

- Cannot be determined from code alone: **whether the current Botmaker plan includes API-action
  flow steps at all**, and **whether GenAI-with-tools is free or a paid add-on**. Flagging this
  explicitly rather than guessing, per your instruction not to assume free availability.
- **Confirmed limitation, not plan-dependent**: Botmaker itself has no concept of WASHERO's
  services/prices/coverage/availability — by design (per your architecture split), it must never
  calculate or infer these, so *every* number the customer sees has to come from a
  `botmaker-tools` call, with no client-side fallback if that call fails (see step 17, error
  fallback).
- **WhatsApp Business template cost is not avoidable** — see §10.

## 3. Final no-Anthropic architecture

```
WhatsApp customer
  → Botmaker (transport, flow, intents, variables, templates, live-agent inbox, human takeover)
      → HTTPS POST, x-botmaker-tools-secret header
      → supabase/functions/botmaker-tools  (NEW — this document's main deliverable)
          → _shared/whatsapp-agent/tools.ts  (UNCHANGED — same deterministic tool layer)
              → booking-core.ts / coverage.ts / pricing-items.ts / slot-capacity.ts
                  → Postgres (create_booking_atomic / cancel_booking_atomic /
                     reschedule_booking_atomic RPCs, availability_slots, bookings, ...)
      ← structured JSON {ok, ...}
  ← Botmaker renders the customer-facing reply itself
```

No Claude, no Anthropic API, no job queue, no cron worker, no LLM tool-use loop anywhere in this
path. `botmaker-tools` is a plain, synchronous, stateless HTTP dispatcher.

## 4. Code retained (KEEP — used by both architectures, unconditionally)

- `supabase/functions/_shared/booking-core.ts`, `coverage.ts`, `pricing-items.ts`,
  `slot-capacity.ts`, `logistic-availability.ts` — the actual business logic. Untouched.
- All 8 WhatsApp-agent-era migrations already applied to staging, plus the 3 booking-atomic RPCs
  (`create_booking_atomic`, `cancel_booking_atomic`, `reschedule_booking_atomic`) and
  `claim_next_whatsapp_agent_job` / `check_and_increment_rate_limit`. None are Anthropic-specific;
  all remain structurally valid and safe even fully unused.
- `supabase/functions/_shared/whatsapp-agent/tools.ts` — **the single most important reuse**: 13
  deterministic tool functions (`get_services`, `get_service_details`, `validate_service_area`,
  `get_available_dates`, `get_available_slots`, `calculate_booking_price`,
  `get_customer_by_phone`, `create_booking`, `get_booking`, `list_customer_bookings`,
  `cancel_booking`, `reschedule_booking`, `request_human_handoff`) were already written to be
  Anthropic-agnostic — they take `(admin, args, ctx)` and return plain JSON. Zero changes needed.
- `supabase/functions/_shared/whatsapp-agent/worker-auth.ts` (`isValidWorkerSecret`) — the
  constant-time shared-secret check, reused as-is for the new endpoint's auth.
- `supabase/functions/_shared/botmaker-outbound.ts`, `botmaker-booking.ts`,
  `botmaker-inbound-routing.ts`, `botmaker-operator-templates.ts` — the pre-existing Botmaker
  integration (legacy summary-parsing flow, outbound sends, human-takeover detection, operator
  routing). Entirely unrelated to Anthropic; untouched by this pivot.
- `conversation_assignments` / `botmaker_conversations` tables and their admin UI
  (`/admin/mensajes`) — reused directly as the identity/handoff mechanism for the new endpoint
  (see §4 implementation below), no new tables needed for that purpose.

## 5. Code adapted (ADAPT)

- **`supabase/functions/botmaker-tools/index.ts`** (new file, written in this pass) — thin HTTP
  wrapper: shared-secret auth → strict JSON parse → resolve/create the `botmaker_conversations`
  row for this chat → dispatch to the matching `tools.ts` function → return its JSON result
  as-is. See §7 for the full endpoint reference.
- **`request_human_handoff`** — `tools.ts`'s version is a stub by design (real state transition
  happens in `handoff.ts`, coupled to `whatsapp_agent_conversations`, which doesn't exist in this
  architecture). Adapted into a standalone implementation inside `botmaker-tools/index.ts` that
  writes directly to `conversation_assignments` — same effect (conversation shows up in
  `/admin/mensajes`, reopens if previously resolved), no dependency on the disabled in-house-agent
  tables.
- **Conversation identity** — adapted from `whatsapp_agent_conversations` (in-house-agent-only) to
  the pre-existing `botmaker_conversations` table, found-or-created by Botmaker's own
  `conversation_id`. This is also what `create_booking`'s idempotency key is built from, so a
  Botmaker flow retry/duplicate webhook still can't create two bookings.

## 6. Code not deployed

**DISABLE (Anthropic-specific, left in the repo, never invoked, not deployed) —** kept rather
than deleted, per your instruction to prefer disabling proven booking-safety work over removing
it, in case the in-house-agent path is revisited later:

- `orchestrator.ts`, `system-prompt.ts` — the Claude tool-use loop. Never called.
- `job-queue.ts`, `job-processor.ts`, `job-lease.ts` — the async job queue + renewable lease the
  Claude turn ran under. Never enqueued (nothing calls `enqueueJob` outside the disabled agent
  path), never scheduled.
- `supabase/functions/whatsapp-agent-worker/` — the cron sweep function. **Not deployed. Not
  scheduled.** `supabase/optional/whatsapp_agent_worker_schedule.sql` must **not** be run.
- `agent-mode.ts`, `webhook-handler.ts`'s `handleWhatsappAgentInbound` — already gated behind
  `WHATSAPP_AGENT_MODE`, which defaults to `disabled`. The branch in `botmaker-webhook/index.ts`
  that calls into this code physically cannot execute with the default env (no code change
  needed — it was already built this way).
- `outbound.ts` (lease-aware Botmaker send + ambiguous-delivery classification), `manual-retry.ts`,
  `supabase/functions/whatsapp-agent-manual-retry/` — only ever reachable from the disabled job
  pipeline. Left in place, unused.
- `admin-auth.ts` — generically useful (admin JWT verification), currently only consumed by the
  disabled manual-retry endpoint. Harmless to leave.
- `supabase/functions/whatsapp-agent-diagnostics/` — inspects in-house-agent state (Anthropic key
  configured, job queue depth, agent mode) that's meaningless in this architecture. Not deployed.
- `src/routes/admin.agente-whatsapp.tsx` — the admin UI for agent conversations / ambiguous
  deliveries / manual retry. Will only ever show empty state under this architecture. **Left as-is
  for now** rather than removed from the sidebar — that's a visible UI change I'd rather confirm
  with you first, since it affects what admins currently see, even though it'll show nothing.

**REMOVE (deleted): none.** Nothing here is "unnecessary complexity" in the sense of dead weight
with no future value — it's a complete, tested, working alternative architecture (in-house Claude
agent) that simply isn't the chosen path *right now*. Deleting it would throw away real,
previously-verified work (lease/concurrency safety, tool-ordering safety, ambiguous-delivery
handling) for no benefit, since leaving it disabled costs nothing at runtime.

## 7. Botmaker tool endpoints — reference

**Endpoint:** `POST https://<project-ref>.supabase.co/functions/v1/botmaker-tools`
**Auth:** header `x-botmaker-tools-secret: <BOTMAKER_TOOLS_SECRET>` (constant-time compared,
fails closed if unset — same pattern as the existing worker secret). No Supabase JWT involved;
`verify_jwt = false` in `config.toml`, matching the cron-worker function's precedent.

**Request body (all calls):**
```json
{
  "tool": "get_available_slots",
  "customer_phone": "5491122334455",
  "conversation_id": "<Botmaker's own chat/conversation id>",
  "customer_name": "Juana Pérez",
  "is_test": false,
  "args": { "...": "tool-specific, see below" }
}
```

**Response (all calls):** HTTP 200 with `{"ok": true, ...}` or `{"ok": false, "error": "...", ...}`
— business-logic failures (slot full, out of coverage, invalid args) are **not** HTTP errors, so
the flow should branch on the `ok` field, not the status code. HTTP 401/400/500 are reserved for
auth failure, malformed dispatch requests, and genuine server errors respectively.

| Tool | `args` | Success shape (abridged) | Never trusts from Botmaker |
|---|---|---|---|
| `get_services` | `{}` | `{services: [{id,name,base_price,duration_minutes}]}` | — |
| `get_service_details` | `{service_id?, service_name?}` | `{service: {id,name,duration_minutes,base_price}}` | — |
| `validate_service_area` | `{neighborhood, address_type?, private_neighborhood_name?}` | `{inside_coverage, match_type, coverage_zone_id}` | coverage result itself |
| `get_available_dates` | `{service_id, vehicle_type?, selected_extras?, date_from?, date_to?}` | `{dates: [{date, slots_available}]}` | availability |
| `get_available_slots` | `{date, service_id, vehicle_type?, selected_extras?}` | `{slots: [{start_time,end_time,remaining_capacity}]}` | availability |
| `calculate_booking_price` | `{service_id, vehicle_type, selected_extras?, vehicle_count?}` | `{total_amount, breakdown}` | price (always recomputed) |
| `get_customer_by_phone` | `{}` (uses `customer_phone`) | `{customer_exists, customer, last_booking}` | — |
| `create_booking` | `{address, neighborhood, service_id, vehicle_type, scheduled_date, scheduled_time, payment_method, ...}` | `{booking: {id, ...}}` | price/availability — revalidated atomically inside `create_booking_atomic` regardless of what the flow believed |
| `get_customer_bookings` *(tool name: `list_customer_bookings`)* | `{limit?}` | `{bookings: [...]}` | — |
| `cancel_booking` | `{booking_id}` | `{ok:true, ...}` (via `cancel_booking_atomic`) | — |
| `reschedule_booking` | `{booking_id, new_date, new_time}` | `{ok:true, ...}` (via `reschedule_booking_atomic`) | new slot availability — revalidated atomically |
| `request_human_handoff` | `{reason}` | `{ok:true, reason}` | — |
| `get_booking` *(13th, not in your original 12 — free bonus, same safety pattern, useful for cancel/reschedule lookups)* | `{booking_id}` | `{booking: {...}}` | — |

Every argument schema above is the *exact* `input_schema` already defined per tool in
`tools.ts` — nothing was invented for this document.

## 8. Complete Botmaker flow specification (deterministic intent-and-flow)

Rioplatense Spanish throughout, matching the existing legacy flow's tone. Every step that touches
a business fact calls `botmaker-tools`; Botmaker never calculates, infers, or invents a number.

---

### 1. Greeting and intent detection
- **Trigger:** first inbound message / no active flow state.
- **Message:** "¡Hola! 👋 Soy el asistente de Washero. Te ayudo a reservar tu lavado en un toque. ¿Qué necesitás?" — quick replies: `Reservar` / `Mis reservas` / `Cancelar o reprogramar` / `Hablar con una persona`.
- **Variables required:** none yet.
- **API called:** none.
- **Branches:** `Reservar`→step 2. `Mis reservas`→`get_customer_bookings` then show list. `Cancelar o reprogramar`→step 14/15. `Hablar con una persona`→step 16.
- **Retry:** n/a (no API call).
- **Handoff fallback:** unrecognized free-text input after 2 attempts → step 16.

### 2. Service selection
- **Trigger:** intent `reservar`.
- **Message:** "Estos son nuestros servicios: {{services_list}} ¿Cuál te interesa?" (quick replies built from the response).
- **Variables set:** `service_id`, `service_name`.
- **API called:** `get_services`, `args: {}`.
- **Request JSON:** `{"tool":"get_services","customer_phone":"{{phone}}","conversation_id":"{{chat_id}}","args":{}}`
- **Response JSON:** `{"ok":true,"services":[{"id":"...","name":"Lavado Completo","base_price":8500,"duration_minutes":40}, ...]}`
- **Branches:** `ok:false` or empty `services` → step 17. Selection → step 3.
- **Retry:** 1 automatic retry on `ok:false`, then step 17.
- **Handoff fallback:** step 17's terminal case.

### 3. Vehicle quantity and type
- **Message:** "¿Para cuántos vehículos? (1 o 2)" then "¿Qué tipo de vehículo — Auto, SUV o Pick-up?" (repeated per unit if 2).
- **Variables set:** `vehicle_count`, `vehicle_type` (and `vehicle_type_2` if applicable).
- **API called:** none (pure capture; validated against the enum client-side by Botmaker's own input validation node, re-validated server-side inside every downstream tool call anyway).
- **Branches:** invalid input → re-ask (Botmaker-native retry loop, no API involved).
- **Retry / handoff:** 3 failed attempts to get valid input → step 16.

### 4. Address and neighborhood
- **Message:** "Decime la dirección y el barrio." Follow-up: "¿Es un barrio privado o country?" (Sí/No).
- **Variables set:** `address`, `neighborhood`, `address_type` (`street` default or `private_neighborhood`), `private_neighborhood_name` if applicable.
- **API called:** none yet.
- **Branches:** → step 5.
- **Retry/handoff:** n/a.

### 5. Coverage validation
- **Message (success):** "¡Buenísimo, llegamos a tu zona! 🙌"
- **Message (failure):** "Por ahora no llegamos a esa zona 😕 ¿Querés que te derive con el equipo para ver alternativas?"
- **API called:** `validate_service_area`, `args: {"neighborhood":"{{neighborhood}}","address_type":"{{address_type}}","private_neighborhood_name":"{{private_neighborhood_name}}"}`.
- **Response JSON:** `{"ok":true,"inside_coverage":true,"match_type":"polygon","coverage_zone_id":"...","coverage_zone_name":"..."}`
- **Branches:** `inside_coverage:true`→step 6. `false`→offer step 16 or end politely. `ok:false`→retry then step 17.
- **Retry:** 1 automatic retry on `ok:false`.

### 6. Preferred date (real dates only)
- **Message:** "¿Qué día te queda bien? Estas son las próximas fechas con lugar: {{dates_list}}"
- **API called:** `get_available_dates`, `args: {"service_id":"{{service_id}}","vehicle_type":"{{vehicle_type}}"}`.
- **Response JSON:** `{"ok":true,"date_from":"...","date_to":"...","dates":[{"date":"2026-08-01","slots_available":4}, ...]}`
- **Variables set:** `scheduled_date` (from the buttons Botmaker renders off `dates`).
- **Branches:** empty `dates` → "No tengo lugar en los próximos días 😕" → step 16. `ok:false` → retry → step 17.

### 7. Real available-slot lookup
- **Message:** "Para el {{scheduled_date}} tengo estos horarios: {{slots_list}}"
- **API called:** `get_available_slots`, `args: {"date":"{{scheduled_date}}","service_id":"{{service_id}}","vehicle_type":"{{vehicle_type}}"}`.
- **Response JSON:** `{"ok":true,"date":"...","slots":[{"start_time":"09:00","end_time":"09:40","remaining_capacity":2}, ...]}`
- **Branches:** empty `slots` → back to step 6 (offer another date). `ok:false` → retry → step 17.

### 8. Slot selection
- **Message:** implicit — customer taps one of the buttons rendered from step 7's `slots`.
- **Variables set:** `scheduled_time`.
- **API called:** none (pure capture).
- **Branches:** → step 9.

### 9. Real price calculation
- **Message:** "El total es ${{total_amount}}. 💳 ¿Cómo preferís pagar — Transferencia, MercadoPago o pagar después?" (captures `payment_method` in the same turn).
- **API called:** `calculate_booking_price`, `args: {"service_id":"{{service_id}}","vehicle_type":"{{vehicle_type}}","vehicle_count":{{vehicle_count}}}`.
- **Response JSON:** `{"ok":true,"vehicle_count":1,"total_amount":8500,"breakdown":{...}}`
- **Branches:** `ok:false` (e.g. `invalid_extra`) → step 17.

### 10. Booking summary
- **Message:** "Revisemos: {{service_name}}, {{vehicle_count}} vehículo(s) ({{vehicle_type}}), {{scheduled_date}} a las {{scheduled_time}}, en {{address}} ({{neighborhood}}). Total: ${{total_amount}}. Pago: {{payment_method}}. ¿Está todo bien?"
- **API called:** none — pure recap of already-captured variables.
- **Branches:** → step 11.

### 11. Explicit customer confirmation
- **Message:** "Confirmás la reserva? Sí / No"
- **Variables set:** none new; captures Botmaker's own message id for this reply as `confirmation_message_id` if the flow builder exposes it (used for idempotency in step 12).
- **Branches:** `No` → ask what to change, loop to the relevant step (2–9). `Sí` → step 12.

### 12. Atomic booking creation
- **API called:** `create_booking`, `args`:
```json
{
  "address": "{{address}}", "neighborhood": "{{neighborhood}}",
  "address_type": "{{address_type}}", "private_neighborhood_name": "{{private_neighborhood_name}}",
  "service_id": "{{service_id}}", "vehicle_type": "{{vehicle_type}}",
  "scheduled_date": "{{scheduled_date}}", "scheduled_time": "{{scheduled_time}}",
  "payment_method": "{{payment_method}}",
  "confirmation_message_id": "{{confirmation_message_id}}"
}
```
- **Response JSON (success):** `{"ok":true,"booking":{"id":"...","booking_status":"confirmed","price":8500}, "service":{...}}`
- **Response JSON (failure, e.g.):** `{"ok":false,"reason":"slot_full","message":"Ese horario ya se completó.","http_status":409}`
- **Branches:** `ok:true` → step 13. `reason: slot_full | slot_not_found` → back to step 7 with an apology ("Justo se ocupó ese horario, elegí otro 🙏"). `reason: duplicate` → treat as success (idempotent replay, same booking already exists) → step 13. Anything else (`server_error`, unmapped) → step 17.
- **Retry:** **do not** blindly auto-retry a mutation on ambiguous network failure (timeout) — same principle the in-house agent's outbound-delivery work established. On a genuine network-level failure (not a structured `ok:false`), route straight to step 17/human handoff rather than re-submitting `create_booking` a second time.

### 13. Final confirmation
- **Message:** "¡Listo! ✅ Tu lavado quedó reservado para el {{scheduled_date}} a las {{scheduled_time}} en {{address}}. Reserva #{{booking.id short}}. ¡Gracias por elegir Washero! 🚗✨"
- **API called:** none — Botmaker sends this itself, inline, as the owner of customer-facing messages. (WASHERO's existing server-initiated `booking_confirmed_v2` template stays reserved for bookings created through *other* channels — admin, subscriptions — not this flow, so there's no double-send.)

### 14. Cancellation
- **Trigger:** intent `cancelar`.
- **Message:** "¿Cuál de estas reservas querés cancelar? {{bookings_list}}"
- **API called:** `get_customer_bookings` (`list_customer_bookings`), `args: {"limit":5}` → then, on selection, `cancel_booking`, `args: {"booking_id":"{{booking_id}}"}`.
- **Response JSON:** `{"ok":true, ...}` (via `cancel_booking_atomic`, which also verifies the booking belongs to this phone).
- **Message (success):** "Listo, cancelé tu reserva del {{date}}."
- **Branches:** `ok:false` → map reason, retry once, else step 17.

### 15. Rescheduling
- **Trigger:** intent `reprogramar`.
- **Message:** "¿Cuál reserva querés cambiar?" → `get_customer_bookings` → pick → "¿Para qué nuevo día?" → `get_available_slots` for the new date → pick new slot → confirm.
- **API called:** `list_customer_bookings` → `get_available_slots` → `reschedule_booking`, `args: {"booking_id":"{{booking_id}}","new_date":"{{new_date}}","new_time":"{{new_time}}"}`.
- **Branches:** same pattern as step 12 — `ok:false` with a capacity reason loops back to slot selection; anything else → step 17.

### 16. Human takeover
- **Trigger:** explicit request at any point, `inside_coverage:false` follow-up, repeated failures (step 17's threshold), or unclassifiable free text.
- **Message:** "Te paso con una persona del equipo, ya te responden por acá. 🙋"
- **API called:** `request_human_handoff`, `args: {"reason":"<short code, e.g. customer_request | out_of_coverage | repeated_tool_failure>"}`.
- **Response JSON:** `{"ok":true,"reason":"..."}`
- **Behavior after:** the conversation is opened/reopened in `conversation_assignments`, visible in `/admin/mensajes`. Whether Botmaker's own hosted bot automatically stops auto-replying once a human is assigned in **Botmaker's own UI** is the "human takeover and bot muting" capability from §1 item 7 — already proven as a working mechanism in this account (see the audit table), so this should work without further plan confirmation. If your team assigns the conversation to a human agent inside Botmaker itself, the platform's own assignment feature is what mutes the bot going forward.

### 17. Tool/API error fallback
- **Applies at every step above.** On any `ok:false` with `error` in `{"server_error","unknown_error"}`, or a network-level failure/timeout calling `botmaker-tools`:
  1. Retry the identical call **once**.
  2. If it fails again: "Uy, tuve un problema técnico 😅 Ya te derivo con una persona para que te ayude." → step 16 with `reason: "tool_error:<tool_name>"`.
- **Never** retry `create_booking` itself blindly on ambiguous failure (see step 12) — only on a clean, structured `ok:false` that isn't ambiguous about whether the booking was created.

---

## 9. Exact Botmaker dashboard configuration steps

These are actionable **today**, independent of the §1 open questions:

1. **Create the shared secret**: generate one (`openssl rand -hex 32`), set it as the Edge
   Function secret `BOTMAKER_TOOLS_SECRET` (`supabase secrets set BOTMAKER_TOOLS_SECRET=...`) —
   never commit the value.
2. **In Botmaker's Flow Builder**, for every step in §8 marked "API called": add an API-action /
   webhook step (exact node name depends on your plan — confirm via §1 item 1) configured as:
   - Method: `POST`
   - URL: `https://<project-ref>.supabase.co/functions/v1/botmaker-tools`
   - Header: `x-botmaker-tools-secret: <the secret from step 1>`
   - Header: `Content-Type: application/json`
   - Body: the exact JSON shown per step in §8, with Botmaker flow variables interpolated.
   - Map the response fields you need (`ok`, `services`, `slots`, `total_amount`, `booking.id`,
     etc.) into flow variables per Botmaker's response-mapping UI (confirm via §1 item 3).
3. **Configure quick-reply / button steps** for every list-driven message (services, dates,
   slots, bookings) — populate their options dynamically from the mapped response array.
4. **Configure the human-handoff/live-agent assignment** so that after `request_human_handoff`
   fires, the conversation is visibly flagged for a human in Botmaker's own interface too (not
   just in `/admin/mensajes`) — exact steps depend on your plan's live-agent feature, confirm
   naming in your dashboard.
5. **Confirm WhatsApp Business template approval** for the confirmation message text in step 13
   if your WhatsApp Business API tier requires pre-approved templates for the first message in a
   24-hour window (see §10).

Nothing here requires enabling `WHATSAPP_AGENT_MODE` or touching the in-house agent's admin page.

## 10. Environment variables required (no values)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BOTMAKER_TOOLS_SECRET
```

That's the complete list for this architecture. Everything already in
`supabase/functions/.env.example` under "WhatsApp AI agent (new — Claude-based)" — specifically
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `WHATSAPP_AGENT_MODE`, `WHATSAPP_AGENT_TEST_PHONES`,
`WHATSAPP_AGENT_WORKER_SECRET` — is **not required** and should stay unset in this deployment.
Existing `BOTMAKER_*` variables (`BOTMAKER_API_TOKEN`, `BOTMAKER_WEBHOOK_SECRET`, etc.) remain
required for the pre-existing outbound/webhook integration, unchanged by this document.

## 11. End-to-end test procedure

1. **Unit-level** (no live Botmaker call needed): confirm `deno check` and the existing
   `tools.test.ts` / `worker-auth.test.ts` suites still pass unmodified — they cover the reused
   logic. Add a smoke test for `botmaker-tools`'s dispatch table matching the 12+1 tool names
   (not yet written in this pass — flagged as a follow-up, not done).
2. **Direct HTTP smoke test**, before touching Botmaker at all:
   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/botmaker-tools \
     -H "x-botmaker-tools-secret: <secret>" -H "Content-Type: application/json" \
     -d '{"tool":"get_services","customer_phone":"5491100000000","conversation_id":"test-1","args":{}}'
   ```
   Expect `{"ok":true,"services":[...]}`. Repeat for `get_available_dates`,
   `validate_service_area` with a known-in-coverage and known-out-of-coverage neighborhood.
3. **Auth negative tests**: same call with a missing/wrong `x-botmaker-tools-secret` → expect 401.
   Missing `tool` → 400. Unknown `tool` name → 400.
4. **Full booking dry run against staging** (`derjqvlxhtviuqbnyiwv`, already migrated): walk one
   complete conversation through steps 1–13 using a real WhatsApp test number connected to
   Botmaker's staging/sandbox config if one exists, or via direct `curl` calls simulating each
   step in order, ending in `create_booking` — confirm exactly one `bookings` row is created, at
   the real recalculated price, and that a repeat `create_booking` call with the same
   `confirmation_message_id` returns the same booking instead of a duplicate.
5. **Cancellation/reschedule dry run**: repeat for steps 14/15 against the booking created above.
6. **Human handoff dry run**: trigger step 16, confirm a `conversation_assignments` row appears
   with `status: 'open'` and shows up in `/admin/mensajes`.
7. **Error-path test**: call `create_booking` with a `scheduled_time` you know is already full
   (or force it by creating a competing booking first) — confirm `ok:false, reason:"slot_full"`,
   not a 500 or a silently-accepted double-booking.
8. Only after all of the above pass against staging should any of this be pointed at Botmaker's
   real flow, and only after you've confirmed the §1 dashboard capabilities needed for each flow
   step to actually exist in your plan.

## 12. Costs that cannot be avoided

- **WhatsApp Business API template messages** — already a real, ongoing cost in this account
  (proven by the live `BOTMAKER_WA_TEMPLATE_RULE_IDS` in production). Nothing in this
  architecture removes that; if anything, sending the booking confirmation (step 13) via a
  WhatsApp-approved template (rather than a free-form session message) may still incur Meta's
  per-template conversation pricing depending on your WhatsApp Business API tier — this is a
  Meta/WhatsApp cost, not a Botmaker or Anthropic one, and exists independent of this
  architecture change.
- **Botmaker's own platform/subscription cost** — whatever your existing plan already costs;
  this document doesn't add a new Botmaker cost, but if capability #5 (GenAI-with-tools) turns
  out to require a paid add-on and you choose to use it later, that would be an additional,
  separate cost you'd need to evaluate against Botmaker's pricing page directly.
- **Not a cost, but a real limitation**: nothing here is "free" in the sense of zero infrastructure
  — Supabase Edge Function invocations and database usage continue as they already do today; this
  architecture doesn't change that baseline.

I am explicitly **not** claiming this solution is free — only that it avoids the Anthropic API
cost specifically, and that every other cost component already existed in this account before
this document.
