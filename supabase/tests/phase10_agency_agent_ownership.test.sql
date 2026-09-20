-- Phase 10 regression: agency/agent management, WhatsApp ownership and listing-edit guards.
-- Run as a privileged role (SQL editor or psql). Raises on the first mismatch; otherwise reports 'passed'.
-- Creates and DELETES its own `zz-phase10-selftest` fixtures; touches no other data.
-- Synthetic identifiers only (business numbers 99999000000011x, BSUIDs AM.zzphase10selftestx).
do $test$
declare
  n          integer := 0;
  a_id       uuid;  b_id uuid;  c_id uuid;
  a1         uuid;  a2 uuid;  b1 uuid;  c1 uuid;
  r          jsonb;
  v_prop     uuid;
  v_er       uuid;
  v_ver      integer;
  v_img1     uuid; v_img2 uuid; v_img_b uuid;
  g          agents%rowtype;
  ag         agencies%rowtype;
  c          jsonb;
  i          integer;
  ev         record;
  v_sale     constant text := 'For sale: 3-room apartment in Kentron, Yerevan. Price $250,000';
  v_output   constant text := '{"fields":{"title":{"value":"3-room apartment for sale in Kentron, Yerevan","status":"normalized","source_messages":[],"evidence":null},"description":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"intent":{"value":"buy","status":"explicit","source_messages":[1],"evidence":"For sale"},"property_type":{"value":"apartment","status":"explicit","source_messages":[1],"evidence":"apartment"},"country":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"city":{"value":"Yerevan","status":"explicit","source_messages":[1],"evidence":"Yerevan"},"district":{"value":"Kentron","status":"explicit","source_messages":[1],"evidence":"Kentron"},"address":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"latitude":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"longitude":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"price":{"value":250000,"status":"normalized","source_messages":[1],"evidence":"$250,000"},"currency":{"value":"USD","status":"normalized","source_messages":[1],"evidence":"$250,000"},"price_negotiable":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"price_period":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"area_sqm":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"land_area_sqm":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"rooms":{"value":3,"status":"normalized","source_messages":[1],"evidence":"3-room"},"bedrooms":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"bathrooms":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"floor":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"total_floors":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"year_built":{"value":null,"status":"unknown","source_messages":[],"evidence":null},"features":{"value":null,"status":"unknown","source_messages":[],"evidence":null}},"conflicts":[],"notes":[],"languages":["en"]}';
begin
  -- ------------------------------------------------------------------ agencies and agents (admin functions only)
  r := admin_save_agency(null, jsonb_build_object('name', 'zz-phase10-selftest A', 'slug', 'zz-phase10-selftest-a',
        'whatsapp_phone_number_id', '999990000000111'), null, 'zz-phase10-selftest');
  if not (r ->> 'outcome') = 'created' then raise exception 'agency A create: %', r; end if;
  a_id := (r ->> 'agency_id')::uuid; n := n + 1;

  r := admin_save_agency(null, jsonb_build_object('name', 'zz-phase10-selftest B', 'slug', 'zz-phase10-selftest-b',
        'whatsapp_phone_number_id', '999990000000112'), null, 'zz-phase10-selftest');
  b_id := (r ->> 'agency_id')::uuid; n := n + 1;

  r := admin_save_agency(null, jsonb_build_object('name', 'zz-phase10-selftest C', 'slug', 'zz-phase10-selftest-c',
        'whatsapp_phone_number_id', '999990000000113'), null, 'zz-phase10-selftest');
  c_id := (r ->> 'agency_id')::uuid; n := n + 1;

  -- placeholder contact details are refused
  r := admin_save_agency(a_id, jsonb_build_object('public_phone', '+37400000000'), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'placeholder' then raise exception 'placeholder phone accepted: %', r; end if; n := n + 1;
  r := admin_save_agency(a_id, jsonb_build_object('public_email', 'hello@example.com'), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'placeholder' then raise exception 'placeholder email accepted: %', r; end if; n := n + 1;

  -- unknown field is refused (no mass assignment)
  r := admin_save_agency(a_id, jsonb_build_object('settings', '{}'::jsonb), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'unknown_field' then raise exception 'unknown agency field accepted: %', r; end if; n := n + 1;

  -- stale agency update is refused
  select * into ag from agencies where id = a_id;
  r := admin_save_agency(a_id, jsonb_build_object('display_name', 'zz-selftest display'),
                         ag.updated_at - interval '1 second', 'zz-phase10-selftest');
  if r ->> 'outcome' <> 'stale' then raise exception 'stale agency update accepted: %', r; end if; n := n + 1;

  r := admin_save_agent(null, jsonb_build_object('agency_id', a_id, 'name', 'zz-phase10-selftest A1',
        'whatsapp_user_id', 'AM.zzphase10selftest1'), null, 'zz-phase10-selftest');
  a1 := (r ->> 'agent_id')::uuid; n := n + 1;
  r := admin_save_agent(null, jsonb_build_object('agency_id', a_id, 'name', 'zz-phase10-selftest A2',
        'whatsapp_user_id', 'AM.zzphase10selftest2'), null, 'zz-phase10-selftest');
  a2 := (r ->> 'agent_id')::uuid; n := n + 1;
  r := admin_save_agent(null, jsonb_build_object('agency_id', b_id, 'name', 'zz-phase10-selftest B1',
        'whatsapp_user_id', 'AM.zzphase10selftest5'), null, 'zz-phase10-selftest');
  b1 := (r ->> 'agent_id')::uuid; n := n + 1;
  r := admin_save_agent(null, jsonb_build_object('agency_id', c_id, 'name', 'zz-phase10-selftest C1',
        'whatsapp_user_id', 'AM.zzphase10selftest9'), null, 'zz-phase10-selftest');
  c1 := (r ->> 'agent_id')::uuid; n := n + 1;

  -- one identity, one agent (BSUID is global; a WhatsApp phone is never shared either)
  r := admin_save_agent(null, jsonb_build_object('agency_id', b_id, 'name', 'zz-phase10-selftest dup',
        'whatsapp_user_id', 'AM.zzphase10selftest1'), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'in_use' then raise exception 'duplicate BSUID accepted: %', r; end if; n := n + 1;

  r := admin_save_agent(a1, jsonb_build_object('whatsapp_phone', '+37499000111'), (select updated_at from agents where id = a1),
                        'zz-phase10-selftest');
  if not (r ->> 'ok')::boolean then raise exception 'phone registration failed: %', r; end if; n := n + 1;
  r := admin_save_agent(a2, jsonb_build_object('whatsapp_phone', '+37499000111'), (select updated_at from agents where id = a2),
                        'zz-phase10-selftest');
  if r ->> 'reason' <> 'in_use' then raise exception 'duplicate WhatsApp phone accepted: %', r; end if; n := n + 1;

  -- unknown field and bad type are refused
  r := admin_save_agent(a1, jsonb_build_object('agency_slug', 'x'), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'unknown_field' then raise exception 'unknown agent field accepted: %', r; end if; n := n + 1;
  r := admin_save_agent(a1, jsonb_build_object('is_active', 'yes'), null, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'type' then raise exception 'bad agent type accepted: %', r; end if; n := n + 1;

  -- ------------------------------------------------------------------ one submission per agent, through the pipeline
  for ev in
    select * from (values
      (1, 'AM.zzphase10selftest1', '999990000000111'),
      (2, 'AM.zzphase10selftest2', '999990000000111'),
      (3, 'AM.zzphase10selftest9', '999990000000113')
    ) x(i, uid, pn)
  loop
    i := ev.i;
    perform ingest_whatsapp_message(jsonb_build_object(
      'schema_version', 2, 'provider', 'whatsapp_cloud', 'recipient_phone_number_id', ev.pn,
      'provider_message_id', 'wamid.zz-phase10-selftest-' || i || '-text', 'sender_user_id', ev.uid,
      'sender_name', 'zz-phase10-selftest', 'provider_timestamp', '2026-09-19T22:00:00Z',
      'provider_message_type', 'text', 'message_type', 'text', 'text_body', v_sale,
      'raw_payload', jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('id', 'x')))), 'zz-phase10-selftest');
    perform ingest_whatsapp_message(jsonb_build_object(
      'schema_version', 2, 'provider', 'whatsapp_cloud', 'recipient_phone_number_id', ev.pn,
      'provider_message_id', 'wamid.zz-phase10-selftest-' || i || '-done', 'sender_user_id', ev.uid,
      'sender_name', 'zz-phase10-selftest', 'provider_timestamp', '2026-09-19T22:00:05Z',
      'provider_message_type', 'text', 'message_type', 'text', 'text_body', 'done',
      'raw_payload', jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('id', 'x')))), 'zz-phase10-selftest');
  end loop;

  update submission_sessions set process_after = now() - interval '1 second'
   where status = 'ready' and agency_id in (a_id, b_id, c_id);

  loop
    c := claim_submission_session('zz-phase10-selftest');
    exit when not coalesce((c ->> 'claimed')::boolean, false);
    perform record_extraction_result((c ->> 'attempt_id')::uuid, 'zz-selftest', 'zz-phase10-selftest', 'zz-phase10-selftest',
                                     v_output, 'zz-phase10-selftest');
  end loop;

  -- A2 deactivated, agency C deactivated: both through the admin functions
  select * into g from agents where id = a2;
  perform admin_save_agent(a2, jsonb_build_object('is_active', false), g.updated_at, 'zz-phase10-selftest');
  select * into ag from agencies where id = c_id;
  perform admin_save_agency(c_id, jsonb_build_object('is_active', false), ag.updated_at, 'zz-phase10-selftest');

  perform generate_pending_property_drafts(10, 'zz-phase10-selftest');

  -- active agency + active agent => draft created, and NO agency_inactive anywhere for it
  if not exists (select 1 from properties p join submission_sessions s on s.id = p.created_from_session_id
                  where s.agent_id = a1) then
    raise exception 'active agency + active agent produced no draft';
  end if; n := n + 1;
  if exists (select 1 from automation_events e join submission_sessions s on s.id = e.session_id
              where s.agent_id = a1 and e.event_type = 'property.ownership_failed') then
    raise exception 'valid ownership reported an ownership failure';
  end if; n := n + 1;

  -- inactive agent => agent_inactive, no draft
  if (select e.details ->> 'reason' from automation_events e join submission_sessions s on s.id = e.session_id
       where s.agent_id = a2 and e.event_type = 'property.ownership_failed' order by e.id desc limit 1)
     is distinct from 'agent_inactive' then
    raise exception 'inactive agent: wrong reason';
  end if; n := n + 1;

  -- inactive agency => agency_inactive, no draft
  if (select e.details ->> 'reason' from automation_events e join submission_sessions s on s.id = e.session_id
       where s.agency_id = c_id and e.event_type = 'property.ownership_failed' order by e.id desc limit 1)
     is distinct from 'agency_inactive' then
    raise exception 'inactive agency: wrong reason';
  end if; n := n + 1;
  if exists (select 1 from properties where agency_id = c_id) then
    raise exception 'inactive agency produced a property';
  end if; n := n + 1;

  -- cross-agency ownership (session of agency A pointed at an agent of agency B) => agency_mismatch, not agency_inactive
  select e.id into v_er from extraction_results e join submission_sessions s on s.id = e.session_id where s.agent_id = a1;
  update submission_sessions set agent_id = b1
   where id = (select session_id from extraction_results where id = v_er);
  delete from properties where created_from_session_id = (select session_id from extraction_results where id = v_er);
  update extraction_results set property_id = null where id = v_er;
  update submission_sessions set status = 'completed'
   where id = (select session_id from extraction_results where id = v_er);
  perform generate_property_draft(v_er, 'zz-phase10-selftest-cross');
  if (select e.details ->> 'reason' from automation_events e
       where e.correlation_id = 'zz-phase10-selftest-cross' and e.event_type = 'property.ownership_failed'
       order by e.id desc limit 1) is distinct from 'agency_mismatch' then
    raise exception 'cross-agency ownership: wrong reason';
  end if; n := n + 1;

  -- ------------------------------------------------------------------ ingestion into an inactive agency
  r := ingest_whatsapp_message(jsonb_build_object(
    'schema_version', 2, 'provider', 'whatsapp_cloud', 'recipient_phone_number_id', '999990000000113',
    'provider_message_id', 'wamid.zz-phase10-selftest-inactive', 'sender_user_id', 'AM.zzphase10selftest9',
    'sender_name', 'zz-phase10-selftest', 'provider_timestamp', '2026-09-19T22:30:00Z',
    'provider_message_type', 'text', 'message_type', 'text', 'text_body', v_sale,
    'raw_payload', jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('id', 'x')))), 'zz-phase10-selftest');
  if r ->> 'processing_status' <> 'unresolved_sender' or r ->> 'reason' <> 'agency_inactive' then
    raise exception 'inactive agency ingestion: %', r;
  end if; n := n + 1;
  if (r ->> 'message_id') is null then raise exception 'inactive agency message was not stored'; end if; n := n + 1;
  if exists (select 1 from properties where agency_id = c_id) then
    raise exception 'inactive agency ingestion mutated a property';
  end if; n := n + 1;

  -- ------------------------------------------------------------------ publication check follows agency state
  select id, state_version into v_prop, v_ver from properties where agency_id = b_id or agency_id = a_id limit 1;
  if v_prop is null then
    -- the cross-agency step removed A's draft; make one directly for the remaining checks
    insert into properties (slug, title, intent, property_type, city, price, currency, listing_status, review_status,
                            source, agency_id, agent_id)
    values ('zz-phase10-selftest-listing', 'zz-phase10-selftest listing', 'buy', 'apartment', 'Yerevan', 100000, 'USD',
            'draft', 'pending', 'admin', a_id, a1)
    returning id, state_version into v_prop, v_ver;
  end if;

  if (select count(*) from jsonb_array_elements_text(property_publication_check(v_prop) -> 'blockers') b
       where b = 'agency_inactive') <> 0 then
    raise exception 'active agency reported agency_inactive';
  end if; n := n + 1;

  select * into ag from agencies where id = (select agency_id from properties where id = v_prop);
  perform admin_save_agency(ag.id, jsonb_build_object('is_active', false), ag.updated_at, 'zz-phase10-selftest');
  if (select count(*) from jsonb_array_elements_text(property_publication_check(v_prop) -> 'blockers') b
       where b = 'agency_inactive') <> 1 then
    raise exception 'inactive agency was not blocked';
  end if; n := n + 1;
  select * into ag from agencies where id = ag.id;
  perform admin_save_agency(ag.id, jsonb_build_object('is_active', true), ag.updated_at, 'zz-phase10-selftest');
  if (select count(*) from jsonb_array_elements_text(property_publication_check(v_prop) -> 'blockers') b
       where b = 'agency_inactive') <> 0 then
    raise exception 'reactivated agency still blocked';
  end if; n := n + 1;

  -- ------------------------------------------------------------------ listing edit guards
  select state_version into v_ver from properties where id = v_prop;
  r := admin_update_property(v_prop, v_ver, jsonb_build_object('agency_id', b_id), 'zz-phase10-selftest');
  if r ->> 'reason' <> 'field_not_editable' then raise exception 'agency transfer through edit: %', r; end if; n := n + 1;
  r := admin_update_property(v_prop, v_ver, jsonb_build_object('state_version', 99), 'zz-phase10-selftest');
  if r ->> 'reason' <> 'field_not_editable' then raise exception 'state_version editable: %', r; end if; n := n + 1;
  r := admin_update_property(v_prop, v_ver, jsonb_build_object('title', 'zz-phase10-selftest edited'), 'zz-phase10-selftest');
  if r ->> 'outcome' <> 'updated' then raise exception 'draft edit failed: %', r; end if; n := n + 1;
  r := admin_update_property(v_prop, v_ver, jsonb_build_object('title', 'zz-phase10-selftest edited again'), 'zz-phase10-selftest');
  if r ->> 'outcome' <> 'stale' then raise exception 'stale edit accepted: %', r; end if; n := n + 1;
  select state_version into v_ver from properties where id = v_prop;
  r := admin_update_property(v_prop, v_ver, jsonb_build_object('title', 'zz-phase10-selftest edited'), 'zz-phase10-selftest');
  if r ->> 'outcome' <> 'unchanged' then raise exception 'repeat edit not idempotent: %', r; end if; n := n + 1;

  -- gallery: only this listing's own images, each once
  v_img1 := gen_random_uuid(); v_img2 := gen_random_uuid(); v_img_b := gen_random_uuid();
  insert into property_images (id, agency_id, property_id, storage_path, sort_order, is_primary)
  values (v_img1, (select agency_id from properties where id = v_prop), v_prop,
          'properties/' || v_prop || '/' || v_img1 || '.jpg', 0, true),
         (v_img2, (select agency_id from properties where id = v_prop), v_prop,
          'properties/' || v_prop || '/' || v_img2 || '.jpg', 1, false);
  select state_version into v_ver from properties where id = v_prop;
  r := admin_arrange_property_images(v_prop, v_ver, array[v_img1, v_img_b], v_img1, 'zz-phase10-selftest');
  if r ->> 'reason' <> 'image_mismatch' then raise exception 'foreign image accepted: %', r; end if; n := n + 1;
  r := admin_arrange_property_images(v_prop, v_ver, array[v_img2, v_img1], v_img2, 'zz-phase10-selftest');
  if r ->> 'outcome' <> 'arranged' then raise exception 'reorder failed: %', r; end if; n := n + 1;
  if (select id from property_images where property_id = v_prop and sort_order = 0) <> v_img2
     or not (select is_primary from property_images where id = v_img2) then
    raise exception 'reorder did not apply';
  end if; n := n + 1;

  -- ------------------------------------------------------------------ cleanup (everything this test created)
  delete from automation_events
   where agency_id in (a_id, b_id, c_id) or correlation_id like 'zz-phase10-selftest%'
      or property_id in (select id from properties where agency_id in (a_id, b_id, c_id));
  delete from property_images where agency_id in (a_id, b_id, c_id);
  update submission_sessions set property_id = null where agency_id in (a_id, b_id, c_id);
  update properties set created_from_session_id = null where agency_id in (a_id, b_id, c_id);
  delete from extraction_results where agency_id in (a_id, b_id, c_id);
  delete from whatsapp_media where agency_id in (a_id, b_id, c_id);
  delete from whatsapp_messages where agency_id in (a_id, b_id, c_id);
  delete from submission_sessions where agency_id in (a_id, b_id, c_id);
  delete from properties where agency_id in (a_id, b_id, c_id);
  delete from agents where agency_id in (a_id, b_id, c_id);
  delete from agencies where id in (a_id, b_id, c_id);

  raise notice 'phase10 agency/agent/ownership: % assertions passed', n;
end;
$test$;
