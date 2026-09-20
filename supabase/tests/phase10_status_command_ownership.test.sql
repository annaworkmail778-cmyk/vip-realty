-- Phase 10 regression: WhatsApp status commands still respect ownership after the ingestion patch.
-- Run as a privileged role. Raises on the first mismatch; creates and DELETES its own `zz-phase10-cmd` fixtures.
-- Synthetic identifiers only (business numbers 99999000000012x, BSUIDs AM.zzphase10cmdx).
do $t$
declare a uuid; b uuid; a1 uuid; a2 uuid; b1 uuid; p uuid; r jsonb; v_slug text := 'zz-phase10-cmd-listing';
begin
  a := (admin_save_agency(null, jsonb_build_object('name','zz-phase10-cmd A','slug','zz-phase10-cmd-a','whatsapp_phone_number_id','999990000000121'), null, 'zz-phase10-cmd') ->> 'agency_id')::uuid;
  b := (admin_save_agency(null, jsonb_build_object('name','zz-phase10-cmd B','slug','zz-phase10-cmd-b','whatsapp_phone_number_id','999990000000122'), null, 'zz-phase10-cmd') ->> 'agency_id')::uuid;
  a1 := (admin_save_agent(null, jsonb_build_object('agency_id',a,'name','zz-phase10-cmd A1','whatsapp_user_id','AM.zzphase10cmd1'), null, 'zz-phase10-cmd') ->> 'agent_id')::uuid;
  a2 := (admin_save_agent(null, jsonb_build_object('agency_id',a,'name','zz-phase10-cmd A2','whatsapp_user_id','AM.zzphase10cmd2'), null, 'zz-phase10-cmd') ->> 'agent_id')::uuid;
  b1 := (admin_save_agent(null, jsonb_build_object('agency_id',b,'name','zz-phase10-cmd B1','whatsapp_user_id','AM.zzphase10cmd5'), null, 'zz-phase10-cmd') ->> 'agent_id')::uuid;

  insert into properties (slug, title, intent, property_type, city, price, currency, listing_status, review_status,
                          source, agency_id, agent_id)
  values (v_slug, 'zz-phase10-cmd listing', 'buy', 'apartment', 'Yerevan', 100000, 'USD', 'draft', 'approved',
          'admin', a, a1) returning id into p;
  update properties set listing_status = 'published' where id = p;

  -- another agency's agent
  r := ingest_whatsapp_message(jsonb_build_object('schema_version',2,'provider','whatsapp_cloud',
    'recipient_phone_number_id','999990000000122','provider_message_id','wamid.zz-phase10-cmd-b',
    'sender_user_id','AM.zzphase10cmd5','provider_timestamp','2026-09-20T09:00:00Z','provider_message_type','text',
    'message_type','text','text_body','sold '||v_slug,'raw_payload',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('id','x')))), 'zz-phase10-cmd');
  if (r -> 'status_command' ->> 'applied')::boolean is not false
     or (select listing_status from properties where id = p) <> 'published' then
    raise exception 'cross-agency status command was not blocked: %', r;
  end if;

  -- same agency, different agent
  r := ingest_whatsapp_message(jsonb_build_object('schema_version',2,'provider','whatsapp_cloud',
    'recipient_phone_number_id','999990000000121','provider_message_id','wamid.zz-phase10-cmd-a2',
    'sender_user_id','AM.zzphase10cmd2','provider_timestamp','2026-09-20T09:01:00Z','provider_message_type','text',
    'message_type','text','text_body','sold '||v_slug,'raw_payload',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('id','x')))), 'zz-phase10-cmd');
  if (r -> 'status_command' ->> 'applied')::boolean is not false
     or (select listing_status from properties where id = p) <> 'published' then
    raise exception 'cross-agent status command was not blocked: %', r;
  end if;

  -- the owner, while deactivated
  perform admin_save_agent(a1, jsonb_build_object('is_active', false), (select updated_at from agents where id=a1), 'zz-phase10-cmd');
  r := ingest_whatsapp_message(jsonb_build_object('schema_version',2,'provider','whatsapp_cloud',
    'recipient_phone_number_id','999990000000121','provider_message_id','wamid.zz-phase10-cmd-a1-inactive',
    'sender_user_id','AM.zzphase10cmd1','provider_timestamp','2026-09-20T09:02:00Z','provider_message_type','text',
    'message_type','text','text_body','sold '||v_slug,'raw_payload',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('id','x')))), 'zz-phase10-cmd');
  if r ->> 'processing_status' <> 'unresolved_sender' or (select listing_status from properties where id = p) <> 'published' then
    raise exception 'inactive owner status command was not blocked: %', r;
  end if;
  perform admin_save_agent(a1, jsonb_build_object('is_active', true), (select updated_at from agents where id=a1), 'zz-phase10-cmd');

  -- the owner, active: applies
  r := ingest_whatsapp_message(jsonb_build_object('schema_version',2,'provider','whatsapp_cloud',
    'recipient_phone_number_id','999990000000121','provider_message_id','wamid.zz-phase10-cmd-a1',
    'sender_user_id','AM.zzphase10cmd1','provider_timestamp','2026-09-20T09:03:00Z','provider_message_type','text',
    'message_type','text','text_body','sold '||v_slug,'raw_payload',jsonb_build_object('messages',jsonb_build_array(jsonb_build_object('id','x')))), 'zz-phase10-cmd');
  if (r -> 'status_command' ->> 'applied')::boolean is not true
     or (select listing_status from properties where id = p) <> 'sold' then
    raise exception 'owner status command did not apply: %', r;
  end if;

  delete from automation_events where agency_id in (a,b) or property_id = p or correlation_id like 'zz-phase10-cmd%';
  delete from whatsapp_messages where agency_id in (a,b);
  delete from submission_sessions where agency_id in (a,b);
  delete from properties where id = p;
  delete from agents where agency_id in (a,b);
  delete from agencies where id in (a,b);
  raise notice 'phase10 status command ownership: 4 assertions passed';
end $t$;
