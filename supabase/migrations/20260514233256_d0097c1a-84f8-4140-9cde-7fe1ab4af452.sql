
CREATE TABLE public.botmaker_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  channel text,
  sender_type text,
  conversation_id text,
  customer_phone text,
  customer_name text,
  message_text text,
  auth_valid boolean NOT NULL DEFAULT false,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX botmaker_events_conversation_id_idx ON public.botmaker_events(conversation_id);
CREATE INDEX botmaker_events_customer_phone_idx ON public.botmaker_events(customer_phone);
CREATE INDEX botmaker_events_created_at_idx ON public.botmaker_events(created_at DESC);

CREATE TABLE public.botmaker_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  botmaker_conversation_id text UNIQUE,
  customer_phone text,
  customer_name text,
  channel text,
  last_message text,
  last_message_at timestamptz,
  last_sender_type text,
  linked_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  linked_booking_request_id uuid REFERENCES public.booking_requests(id) ON DELETE SET NULL,
  linked_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX botmaker_conversations_phone_idx ON public.botmaker_conversations(customer_phone);
CREATE INDEX botmaker_conversations_last_idx ON public.botmaker_conversations(last_message_at DESC);

CREATE TABLE public.botmaker_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.botmaker_conversations(id) ON DELETE CASCADE,
  botmaker_message_id text,
  direction text,
  sender_type text,
  message_type text DEFAULT 'text',
  message_text text,
  customer_phone text,
  customer_name text,
  channel text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX botmaker_messages_conversation_idx ON public.botmaker_messages(conversation_id);
CREATE INDEX botmaker_messages_phone_idx ON public.botmaker_messages(customer_phone);
CREATE INDEX botmaker_messages_created_at_idx ON public.botmaker_messages(created_at DESC);

ALTER TABLE public.botmaker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.botmaker_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.botmaker_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "botmaker_events admin all" ON public.botmaker_events
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "botmaker_conversations admin all" ON public.botmaker_conversations
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "botmaker_messages admin all" ON public.botmaker_messages
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER botmaker_conversations_updated
  BEFORE UPDATE ON public.botmaker_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
