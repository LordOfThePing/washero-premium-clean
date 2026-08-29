-- Allow the n8n gateway outbound transport and the (deprecated) Cloud API transport
-- to record their provider in communication_logs. Previously only botmaker/whatsapp/
-- email/system/manual were allowed, so an insert with provider set to any other value
-- (e.g. whatsapp_n8n_gateway) would be rejected by the CHECK constraint.
alter table public.communication_logs
  drop constraint if exists communication_logs_provider_check;

alter table public.communication_logs
  add constraint communication_logs_provider_check check (
    provider = any (array['botmaker','whatsapp','email','system','manual','whatsapp_cloud_api','whatsapp_n8n_gateway']::text[])
  );
