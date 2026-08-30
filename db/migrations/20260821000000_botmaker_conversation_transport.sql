-- Washero — Botmaker → n8n WhatsApp Cloud API cutover (transport tag on conversations).
-- Additive, idempotent. Adds an optional `transport` column so the shared
-- botmaker_tools / botmaker_conversations store (reused as a channel-neutral inbox by
-- /admin/mensajes) can distinguish which transport created a conversation during the
-- parallel/rollback window. Runs AFTER 20260514233256_d0097c1a-... which creates the table.
ALTER TABLE public.botmaker_conversations
  ADD COLUMN IF NOT EXISTS transport text;

COMMENT ON COLUMN public.botmaker_conversations.transport IS
  'Transport that created this conversation: "botmaker" (legacy) or "cloud_api" (n8n). Used only
   for diagnostics during the WhatsApp Cloud API cutover; booking logic is channel-agnostic.';
