-- Admin handoff status for Botmaker conversations
CREATE TABLE public.conversation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  botmaker_conversation_id uuid NOT NULL REFERENCES public.botmaker_conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_assignments_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved'))
);

CREATE UNIQUE INDEX conversation_assignments_conversation_uidx
  ON public.conversation_assignments(botmaker_conversation_id);

CREATE INDEX conversation_assignments_status_idx
  ON public.conversation_assignments(status);

ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_assignments admin all" ON public.conversation_assignments
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER conversation_assignments_updated
  BEFORE UPDATE ON public.conversation_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
