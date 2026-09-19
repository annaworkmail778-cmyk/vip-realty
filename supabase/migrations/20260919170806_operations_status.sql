-- Phase 9 — operator diagnostics.
--
-- admin_operations_status(): one read-only snapshot of pipeline health for the admin "Operations" page and for
-- operators running SQL. It returns COUNTS, timestamps and event codes only — never raw WhatsApp payloads, message
-- text, phone numbers, business-scoped user ids, Storage paths or credentials. Service role only (like every other
-- admin_* object). SECURITY INVOKER: it cannot see more than its caller.

create or replace function public.admin_operations_status()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'generated_at', now(),

    -- Can the pipeline route anything at all? (Configuration readiness, not credentials.)
    'readiness', jsonb_build_object(
      'agencies', (select count(*) from agencies),
      'agencies_with_whatsapp_number', (select count(*) from agencies where whatsapp_phone_number_id is not null),
      'active_agents', (select count(*) from agents where is_active),
      'active_agents_with_identity', (select count(*) from agents
                                        where is_active and (whatsapp_user_id is not null or whatsapp_phone is not null))
    ),

    'messages', jsonb_build_object(
      'last_received_at', (select max(received_at) from whatsapp_messages),
      'last_24h', (select count(*) from whatsapp_messages where received_at > now() - interval '24 hours'),
      'by_status', coalesce((select jsonb_object_agg(processing_status, n) from
                     (select processing_status, count(*) n from whatsapp_messages group by 1) s), '{}'::jsonb),
      'failed', (select count(*) from whatsapp_messages where processing_status = 'failed'),
      'unresolved_sender', (select count(*) from whatsapp_messages where processing_status = 'unresolved_sender')
    ),

    'sessions', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from
                     (select status, count(*) n from submission_sessions group by 1) s), '{}'::jsonb),
      'ready_waiting_over_15m', (select count(*) from submission_sessions
                                  where status = 'ready' and last_message_at < now() - interval '15 minutes'),
      'processing_over_15m', (select count(*) from submission_sessions
                               where status = 'processing' and processing_started_at < now() - interval '15 minutes')
    ),

    'extractions', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from
                     (select status, count(*) n from extraction_results group by 1) s), '{}'::jsonb),
      'failed_last_24h', (select count(*) from extraction_results
                           where status = 'failed' and created_at > now() - interval '24 hours')
    ),

    'media', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(download_status, n) from
                     (select download_status, count(*) n from whatsapp_media group by 1) s), '{}'::jsonb),
      'held', (select count(*) from whatsapp_media
                where download_status in ('validated', 'uploaded') and status_reason like 'held:%'),
      'expired_leases', (select count(*) from whatsapp_media where lease_expires_at < now()),
      'deadline_passed_unfinished', (select count(*) from whatsapp_media
                                      where download_deadline_at < now()
                                        and download_status in ('received', 'downloading'))
    ),

    'listings', jsonb_build_object(
      'drafts_pending_review', (select count(*) from properties
                                 where listing_status = 'draft' and coalesce(review_status, 'pending') = 'pending'),
      'approved_not_published', (select count(*) from properties
                                  where listing_status = 'draft' and review_status = 'approved'),
      'rejected', (select count(*) from properties where listing_status = 'draft' and review_status = 'rejected'),
      -- Pending drafts with no agency (the 6 legacy records) can never be published; counted separately so the page
      -- can exclude them from the review backlog.
      'drafts_without_agency', (select count(*) from properties
                                 where listing_status = 'draft' and agency_id is null
                                   and coalesce(review_status, 'pending') = 'pending'),
      'by_listing_status', coalesce((select jsonb_object_agg(listing_status, n) from
                             (select listing_status, count(*) n from properties group by 1) s), '{}'::jsonb),
      'publicly_visible', (select count(*) from published_property_listings)
    ),

    'inquiries', jsonb_build_object(
      'new', (select count(*) from inquiries where status = 'new'),
      'last_24h', (select count(*) from inquiries where created_at > now() - interval '24 hours')
    ),

    'status_commands_7d', jsonb_build_object(
      'applied', (select count(*) from automation_events
                   where event_type = 'property.status_changed' and created_at > now() - interval '7 days'),
      'rejected', (select count(*) from automation_events
                    where event_type = 'property.status_command_rejected' and created_at > now() - interval '7 days'),
      'duplicate', (select count(*) from automation_events
                     where event_type = 'property.status_command_duplicate' and created_at > now() - interval '7 days'),
      'ignored', (select count(*) from automation_events
                   where event_type = 'whatsapp.command_ignored' and created_at > now() - interval '7 days')
    ),

    'events', jsonb_build_object(
      'last_event_at', (select max(created_at) from automation_events),
      'last_24h_by_severity', coalesce((select jsonb_object_agg(severity, n) from
                                (select severity, count(*) n from automation_events
                                  where created_at > now() - interval '24 hours' group by 1) s), '{}'::jsonb),
      -- Recent warnings/errors: codes and ids only. `reason` is passed through only when it is a short machine code.
      'recent_problems', coalesce((select jsonb_agg(p order by p.created_at desc) from (
          select e.id, e.event_type, e.severity, e.source, e.created_at, e.session_id, e.property_id,
                 case when e.details->>'reason' ~ '^[a-z0-9_:.\-]{1,64}$' then e.details->>'reason' end as reason
            from automation_events e
           where e.severity in ('warning', 'error') and e.created_at > now() - interval '7 days'
           order by e.created_at desc
           limit 25) p), '[]'::jsonb)
    ),

    'storage', coalesce((select jsonb_object_agg(bucket_id, n) from
                  (select bucket_id, count(*) n from storage.objects
                    where bucket_id in ('property-images', 'whatsapp-media') group by 1) s), '{}'::jsonb)
  );
$$;

comment on function public.admin_operations_status() is
  'Phase 9 operator diagnostics: counts, timestamps and event codes only (no payloads, phones, user ids, paths or secrets). Service role only.';

revoke execute on function public.admin_operations_status() from public, anon, authenticated;
grant execute on function public.admin_operations_status() to service_role;
