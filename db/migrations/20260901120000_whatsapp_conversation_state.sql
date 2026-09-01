-- Per-phone-number state for the deterministic (button-driven) WhatsApp booking flow.
--
-- The AI agent still handles free text and judgment calls (angry customer, unrecognized
-- input, editing/cancelling existing bookings), but the *new booking* happy path is now a
-- plain state machine driven entirely by n8n: read state -> match the tapped button/expected
-- input -> write next state -> send the next step's message. One row per phone number; `data`
-- accumulates whatever the flow has collected so far (service_id, vehicle_type, address, etc.)
-- so nothing needs to be re-asked mid-flow.
create table if not exists public.whatsapp_conversation_state (
  customer_phone text primary key,
  state text not null default 'none',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger whatsapp_conversation_state_updated_at
  before update on public.whatsapp_conversation_state
  for each row execute function update_updated_at_column();

alter table public.whatsapp_conversation_state enable row level security;

create policy "whatsapp_conversation_state admin all" on public.whatsapp_conversation_state
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
