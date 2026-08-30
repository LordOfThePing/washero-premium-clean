-- Inbound WhatsApp routing metadata for operator vs admin inboxes
ALTER TABLE public.botmaker_conversations
  ADD COLUMN IF NOT EXISTS routing_type text,
  ADD COLUMN IF NOT EXISTS routing_assigned_operator_id uuid
    REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_assigned_role text,
  ADD COLUMN IF NOT EXISTS routing_requires_human boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_reason text;

CREATE INDEX IF NOT EXISTS botmaker_conversations_routing_type_idx
  ON public.botmaker_conversations (routing_type);

CREATE INDEX IF NOT EXISTS botmaker_conversations_routing_operator_idx
  ON public.botmaker_conversations (routing_assigned_operator_id);

COMMENT ON COLUMN public.botmaker_conversations.routing_type IS
  'operational | commercial | supplier | unknown';
