-- Full Botmaker -> WhatsApp Cloud API cutover, part 1: rename the storage layer.
--
-- Botmaker (the vendor/BSP) is retired entirely -- no rollback path is being kept. The
-- conversation/message inbox tables and the deterministic tool layer were always
-- channel-agnostic in practice (see docs/n8n-whatsapp-cloudapi-cutover.md); they just carried
-- the old vendor's name. This migration renames them to reflect what they actually are now:
-- the WhatsApp inbox n8n's Cloud API integration reads/writes, still backing /admin/mensajes.
--
-- Historical data is preserved (RENAME, not drop+recreate). The literal string 'botmaker' that
-- appears in a few `source`/`booking_source`/`provider` CHECK constraints is left alone --
-- those are provenance values on old rows (bookings/logs actually created via Botmaker), not
-- code identifiers, and rewriting history there would misrepresent it.

ALTER TABLE IF EXISTS public.botmaker_conversations RENAME TO whatsapp_conversations;
ALTER TABLE IF EXISTS public.botmaker_messages RENAME TO whatsapp_messages;
ALTER TABLE IF EXISTS public.botmaker_events RENAME TO whatsapp_events;

ALTER TABLE IF EXISTS public.whatsapp_conversations
  RENAME COLUMN botmaker_conversation_id TO external_conversation_id;
ALTER TABLE IF EXISTS public.whatsapp_messages
  RENAME COLUMN botmaker_message_id TO external_message_id;

ALTER TABLE IF EXISTS public.conversation_assignments
  RENAME COLUMN botmaker_conversation_id TO conversation_id;

-- Named inbox_conversation_id, not conversation_id: whatsapp_agent_conversations already has its
-- own unrelated id space referenced elsewhere as "conversation_id" (e.g.
-- whatsapp_agent_messages.conversation_id points at THIS table's own id) -- this column instead
-- points at whatsapp_conversations(id), the admin-inbox conversation, so it needs its own name.
ALTER TABLE IF EXISTS public.whatsapp_agent_conversations
  RENAME COLUMN botmaker_conversation_id TO inbox_conversation_id;

ALTER TABLE IF EXISTS public.payment_receipts
  RENAME COLUMN botmaker_message_id TO whatsapp_message_id;

-- Cosmetic renames (indexes/trigger/policies) -- functionally inert, just keeping names honest.
ALTER INDEX IF EXISTS botmaker_conversations_phone_idx RENAME TO whatsapp_conversations_phone_idx;
ALTER INDEX IF EXISTS botmaker_conversations_last_idx RENAME TO whatsapp_conversations_last_idx;
ALTER INDEX IF EXISTS botmaker_conversations_routing_type_idx RENAME TO whatsapp_conversations_routing_type_idx;
ALTER INDEX IF EXISTS botmaker_conversations_routing_operator_idx RENAME TO whatsapp_conversations_routing_operator_idx;
ALTER INDEX IF EXISTS botmaker_messages_conversation_idx RENAME TO whatsapp_messages_conversation_idx;
ALTER INDEX IF EXISTS botmaker_messages_phone_idx RENAME TO whatsapp_messages_phone_idx;
ALTER INDEX IF EXISTS botmaker_messages_created_at_idx RENAME TO whatsapp_messages_created_at_idx;
ALTER INDEX IF EXISTS botmaker_events_conversation_id_idx RENAME TO whatsapp_events_conversation_id_idx;
ALTER INDEX IF EXISTS botmaker_events_customer_phone_idx RENAME TO whatsapp_events_customer_phone_idx;
ALTER INDEX IF EXISTS botmaker_events_created_at_idx RENAME TO whatsapp_events_created_at_idx;
ALTER INDEX IF EXISTS whatsapp_agent_conversations_botmaker_conv_idx RENAME TO whatsapp_agent_conversations_inbox_conversation_idx;

ALTER TRIGGER botmaker_conversations_updated ON public.whatsapp_conversations RENAME TO whatsapp_conversations_updated;

DROP POLICY IF EXISTS "botmaker_events admin all" ON public.whatsapp_events;
CREATE POLICY "whatsapp_events admin all" ON public.whatsapp_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "botmaker_conversations admin all" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations admin all" ON public.whatsapp_conversations
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "botmaker_messages admin all" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages admin all" ON public.whatsapp_messages
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bookings.booking_source: add 'whatsapp' as the go-forward value for "admin manually created
-- this booking from a WhatsApp conversation" (src/components/admin/mensajes-detail.tsx). The
-- 'botmaker' value stays allowed and untouched on existing rows -- it is provenance for bookings
-- actually created via the retired Botmaker flow, not something new code will ever write again.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_source_check
  CHECK (booking_source IN (
    'website', 'admin', 'botmaker', 'manual', 'subscription', 'admin_subscription', 'whatsapp_agent', 'whatsapp'
  ));

COMMENT ON COLUMN public.whatsapp_conversations.transport IS
  'Transport that created this conversation, e.g. "cloud_api" (n8n). "botmaker" only appears on
   rows created before the cutover -- Botmaker is retired and never writes this column anymore.';
