# Phase 4 — WhatsApp / n8n Ingestion Foundation

Status: **complete (foundation)**. Branch `phase/04-whatsapp-n8n-foundation` (from Phase 3 commit `63a49b3`).

> Inbound WhatsApp messages can now enter the system safely and be persisted as raw, traceable events.
> **Nothing else happens to them yet**: no AI extraction, no property creation or update, no media
> download, no publishing, no replies. The n8n workflow is **inactive** until credentials are configured.

No secrets, tokens or credential values appear in this document or in the repository.

> **Identity model superseded in Phase 6.5:** senders are now identified by Meta's business-scoped user id
> (BSUID) first and the phone second; the phone is optional and the session key is the canonical conversation id.
> See `docs/rebuild/phase-06-5-whatsapp-identity.md`. The phone-based statements below describe Phase 4 as built.

---

## 1. Architecture

```
Agent's WhatsApp ──► Meta WhatsApp Cloud API ──► n8n "VIP Realty — WhatsApp Inbound"
                                                   │ WhatsApp Trigger (challenge + X-Hub-Signature-256)
                                                   │ Split into message events
                                                   │ Normalize message (provider → internal event)
                                                   ▼
                                    Supabase RPC public.ingest_whatsapp_message(p_event)   [service_role]
                                       one transaction:
                                       validate → route agency → idempotent insert → media metadata
                                       → resolve agent → open/reuse session → automation_events
                                                   │
                                                   ▼
                                    outcome: stored | duplicate | rejected | unroutable
```

Responsibilities are unchanged from the blueprint: **Supabase** is the source of truth (every durable fact
lives there), **n8n** orchestrates (receives, normalizes, calls, routes — it stores no business data),
**Next.js** is untouched by this phase.

Why a database function instead of several n8n Supabase nodes: idempotency, session association and the
audit trail must succeed or fail **together**. Separate REST calls from n8n could store a message but lose
its session or event on a partial failure, and concurrent webhook deliveries could race. The function runs in
one transaction and relies on the Phase 1 unique constraints, so retries and concurrent deliveries are safe.

## 2. Existing schema (inspected before any change)

| Table | Role in ingestion | Phase 4 use |
| --- | --- | --- |
| `agencies` | Tenant. `whatsapp_phone_number_id` (unique) is the Meta business number id | Routes a webhook to an agency |
| `agents` | Staff allowed to submit. `(agency_id, whatsapp_phone)` unique, E.164, `is_active` | Resolves the sender |
| `submission_sessions` | Conversation/submission context. Partial unique index: **one `open` session per (agency, channel, conversation key)** | Opened/reused per agent conversation |
| `whatsapp_messages` | Every inbound message once. **Unique `(provider, provider_message_id)`**, `raw_payload jsonb not null`, `processing_status` | Raw message store |
| `whatsapp_media` | Media metadata and later download state. Unique `(provider, provider_media_id)` | Metadata only |
| `automation_events` | Append-only diagnostic trail (service_role cannot update/delete) | One or more events per delivery |
| `extraction_results` | AI attempts | Not used (Phase 5+) |
| `properties`, `property_images`, `published_property_listings` | Listings | Not touched |
| `inquiries` | Website leads | Not touched |

All of these are private: RLS enabled, no policies, no `anon`/`authenticated` privileges.

The Phase 1 schema was sufficient for idempotency and sessions. It was **missing** fields required by this
phase's traceability requirements (sender display name, contact id, receiving business number, duplicate
delivery tracking, fallback-id provenance) and had no status for messages from non-agents.

## 3. Database change (migration `20260917165925_whatsapp_ingestion_foundation`)

Additive and backward compatible. No table created, renamed or dropped; no existing column changed.

| Change | Purpose |
| --- | --- |
| `whatsapp_messages.sender_name` | Provider profile name (untrusted display text) |
| `whatsapp_messages.provider_contact_id` | WhatsApp `wa_id` of the sender |
| `whatsapp_messages.recipient_phone_number_id` | Business number that received it |
| `whatsapp_messages.message_id_source` (`provider` \| `derived`) | Provenance of the idempotency key |
| `whatsapp_messages.delivery_count`, `last_delivered_at` | Redeliveries are counted, not duplicated |
| `processing_status` gains `unresolved_sender` | Message kept but never processed into listings |
| `public.ingest_whatsapp_message(jsonb, text)` | Ingestion function, `SECURITY INVOKER`, pinned `search_path`, **EXECUTE granted to `service_role` only** |

**RLS impact:** none. No policy added or changed; no table made readable. The function is `SECURITY
INVOKER`, so it has no more rights than its caller (the service role used by n8n).

### Rollback

Only while no row uses `unresolved_sender` (delete or reprocess those first):

```sql
drop function public.ingest_whatsapp_message(jsonb, text);
alter table public.whatsapp_messages drop constraint whatsapp_messages_processing_status_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_processing_status_check
  check (processing_status in ('received','buffered','processing','processed','failed','ignored'));
alter table public.whatsapp_messages
  drop column sender_name, drop column provider_contact_id, drop column recipient_phone_number_id,
  drop column message_id_source, drop column delivery_count, drop column last_delivered_at;
```

Then deactivate/delete the n8n workflow. No other object depends on these additions.

## 4. Provider choice

**Meta WhatsApp Cloud API**, via n8n's native **WhatsApp Trigger** node (`n8n-nodes-base.whatsAppTrigger`).
The connected n8n instance has the WhatsApp Business Cloud nodes and no Twilio dependency; Twilio was not
introduced.

Webhook security implemented by the trigger node (verified in the n8n source):

- **Verification handshake:** on activation n8n registers the webhook subscription with the Meta app and
  answers `hub.challenge` only when `hub.verify_token` equals the node's own id. There is no user-chosen verify
  token to store or leak.
- **Payload signature:** every POST is checked against `X-Hub-Signature-256` = HMAC-SHA256 of the raw body with
  the Meta app secret from the credential. Mismatches return without starting an execution.
- `object`/`field` filtering: only `messages` updates are subscribed; status updates are reduced to `failed`
  and then skipped by the workflow.

## 5. n8n workflow

- **Name:** `VIP Realty — WhatsApp Inbound` (id `WTSYwWVfuMNK2MeO`, personal project, tags `vip-realty`,
  `phase-4`, `whatsapp`)
- **State:** **inactive** — it cannot be activated safely without credentials, and activation registers the
  Meta webhook.
- **Export:** `automation/n8n/vip-realty-whatsapp-inbound.json` (no credentials, no webhook id).

| # | Node | Behaviour |
| --- | --- | --- |
| 1 | WhatsApp Trigger | Meta webhook, signature-verified, `messages` updates |
| 2 | Split into message events | One item per inbound message (Meta batches). Status-only changes end here. A non-array `messages` becomes a `malformed_messages` event so it is recorded, not dropped |
| 3 | Normalize message | Maps the Meta message to the internal event (below). No business decisions |
| 4 | Persist inbound message (Supabase) | `POST /rest/v1/rpc/ingest_whatsapp_message` with the `supabaseApi` credential; `p_correlation_id = n8n:<execution id>`; timeout 15 s; **retry 3× (3 s apart)**; error output enabled |
| 5 | Route by ingestion outcome | `stored` / `duplicate` / `rejected` / `unroutable` / fallback `unexpected` |
| 6–9 | No-op terminals | `Stored — handoff point for Phase 5 buffering` and one per other outcome — explicit extension points |
| 10 | Fail: ingestion unavailable (retry execution) | Error output of node 4 → execution fails deliberately (event preserved) |
| 11 | Fail: unexpected ingestion response | Fallback output of node 5 |

Workflow settings: failed executions saved with data (needed for replay); successful execution data **not**
saved (the data is in Supabase — n8n does not become a second message store); timeout 120 s.
Three sticky notes explain the flow, pending credentials and the error strategy.

Later phases attach to the `Stored` terminal (buffering, extraction, media download) or run as separate
scheduled workflows reading `whatsapp_messages` / `submission_sessions`; nothing in this workflow has to be
rebuilt.

### Normalized event (`schema_version: 1`)

`provider` (`whatsapp_cloud`), `recipient_phone_number_id`, `provider_message_id`, `sender_wa_id`,
`sender_name`, `provider_timestamp` (ISO), `provider_message_type`, `message_type` (internal vocabulary;
unknown → `unsupported`), `text_body` (text body, media caption, button/interactive title, reaction emoji,
location name/address), `context_provider_message_id`, `media` (`provider_media_id`, `mime_type`, `filename`)
and `raw_payload` — the provider's own shape narrowed to this one message, with any temporary media `url`
removed. `normalization_error` is set when the payload cannot be normalized.

## 6. Traceability — what a stored message answers

| Question | Where |
| --- | --- |
| Which provider / provider message id? | `whatsapp_messages.provider`, `provider_message_id`, `message_id_source` |
| Which sender? | `sender_phone` (E.164), `provider_contact_id`, `sender_name`, `agent_id` (null if unresolved) |
| Which conversation? | `sender_phone` = `submission_sessions.channel_conversation_key`; `session_id` |
| When? | `provider_timestamp` (provider clock), `received_at` (first delivery), `last_delivered_at` |
| Type / normalized text? | `message_type`, `body` |
| Duplicate? | `delivery_count > 1`, plus `whatsapp.message_duplicate` events |
| Processing successful? | `processing_status` (`buffered` = accepted into a session; `unresolved_sender`) and the returned outcome |
| Which automation run? | `automation_events.message_id` + `correlation_id = n8n:<execution id>` |
| Original payload? | `raw_payload` (no credentials; media URLs stripped) |

## 7. Idempotency strategy

1. **Key:** `(provider, provider_message_id)` — the existing unique constraint. Meta's `wamid` is stable across
   webhook retries.
2. **Insert:** `insert … on conflict (provider, provider_message_id) do nothing returning id`. Concurrent
   deliveries serialize on the unique index; exactly one wins.
3. **Duplicate:** when nothing was inserted, the existing row's `delivery_count` is incremented, a
   `whatsapp.message_duplicate` event is written, and `outcome: duplicate` is returned with the original
   `message_id`/`session_id`. Sessions, media and agents are **not** touched again.
4. **Fallback (provider id absent):** `derived:` + SHA-256 of `recipient_phone_number_id | sender wa_id |
   provider timestamp (unix seconds) | message type | canonical JSON of the provider message object`. It needs a
   valid provider timestamp **and** the message object; otherwise the event is rejected
   (`missing_message_id`). Timestamp alone is never the key. Marked with `message_id_source = derived`.
5. Media: unique `(provider, provider_media_id)`, `on conflict do nothing`.
6. Sessions: partial unique index — at most one `open` session per conversation — with
   `on conflict … where status = 'open' do nothing`, then update (bounded 3 attempts).
7. Rejections/unroutable events are diagnostics: a retried bad delivery writes another event but never a message.

## 8. Session behaviour (deterministic foundation only)

- Only messages from an **active agent of the routed agency** get a session.
- Conversation key = sender E.164 phone; channel `whatsapp`.
- If the conversation has an `open` session it is **reused**; otherwise one is **created**
  (`status open`, `kind unknown`) and a `session.opened` event is written.
- `last_message_at = greatest(existing, message time)` and `started_at = least(existing, message time)`, where
  message time is the provider timestamp clamped to now (arrival time when absent/implausible), so
  out-of-order deliveries keep the constraint `last_message_at >= started_at`.
- The message gets `session_id` and `processing_status = buffered`.
- Phase 4 **never closes** a session and never sets `process_after`, `kind` or `property_id`. Deciding when a
  session ends and how messages become one or more property submissions is Phase 5. A closed session is never
  reopened: the next message opens a new session (tested).

A WhatsApp conversation is therefore **not** assumed to be one property.

## 9. Unknown senders

Sender phone → `agents` of the routed agency with that `whatsapp_phone`:

- **Active agent:** `agent_id` set, session as above.
- **No agent:** message stored with `agent_id = null`, `session_id = null`,
  `processing_status = unresolved_sender`; event `whatsapp.sender_unresolved` (warning, `reason: unknown_sender`).
  Media metadata is still recorded. **No agent, contact or session is created.**
- **Inactive agent:** same, with `reason: agent_inactive`.

These messages are kept for traceability/admin review and are never processed into listings. If the person is
later registered as an agent, their earlier messages stay `unresolved_sender` unless deliberately reprocessed.

**Unknown business number** (`phone_number_id` not in `agencies`): the message cannot be attributed to a tenant,
so no message row is written; an `whatsapp.message_unroutable` event (warning, `agency_id` null) stores the
reason, ids and the raw payload (≤ 64 KB) so nothing is silently lost.

## 10. Media

Stored now (`whatsapp_media`): `provider_media_id`, `mime_type` (validated, else null), `filename` (documents;
control characters and path separators replaced), link to the message (and through it the session),
`download_status = received`, `download_attempts = 0`.

Not done (Phase 5+): calling the Graph API media endpoint, downloading, SHA-256 of the file, upload to the
private `whatsapp-media` bucket, dimensions, conversion into `property_images`. Provider media URLs are
temporary and authenticated; they are **not** stored (stripped from `raw_payload`) and never reach the website.
Meta's webhook `sha256` value stays inside `raw_payload` only.

## 11. Errors and retries

| Class | Examples | Handling |
| --- | --- | --- |
| Permanent — rejected | payload not an object, `normalization_error`, provider ≠ `whatsapp_cloud`, missing raw payload, payload > 256 KB, missing business number id, invalid sender, id > 255 chars, missing id without a safe fallback | `automation_events` `whatsapp.message_rejected` (warning, reason, raw payload ≤ 64 KB); HTTP 200 with `outcome: rejected`; n8n ends normally. **Not retried** |
| Permanent — schema violation | any check/not-null/FK/format violation while persisting | Transaction part rolled back, `whatsapp.message_rejected` (error, `schema_violation`, SQLSTATE); `outcome: rejected`. Not retried |
| Permanent — unroutable | unknown `phone_number_id` | `whatsapp.message_unroutable`; `outcome: unroutable` |
| Duplicate | webhook redelivery | `outcome: duplicate`, counter incremented |
| Retryable | Supabase/network down, timeout, 5xx, lock/serialization failure, credential/auth failure | Function raises → **whole transaction rolled back** (no partial rows) → HTTP node retries 3× → still failing: error output → execution **fails on purpose** with the provider message id in the message; the normalized event stays in the saved failed execution and can be retried from n8n Executions. Bounded, no loops |

Meta always receives `200` from the trigger immediately, so our internal failures do not cause Meta redelivery
storms; Meta's own retries (network-level) are absorbed by idempotency. Error messages contain ids only, never
credentials or payload secrets.

Operational note: repeated failures are visible in n8n Executions. An n8n error workflow/alert is not configured
yet (notifications are out of scope for this phase).

## 12. Security

- **Credentials** exist only in n8n credential storage (to be created): `VIP Realty WhatsApp (Meta app)`
  (`whatsAppTriggerApi`) and `VIP Realty Supabase (service role)` (`supabaseApi`). The workflow references them by
  name; no token, secret, key or verify token is in node parameters, in Git, in docs or in the website.
- **Service-role key** stays server-side: n8n credential only. The Next.js app and its env are unchanged.
- **Ingestion RPC** callable by `service_role` only. Verified: `anon` → 401 `permission denied`, `authenticated`
  → `permission denied`.
- **Ingestion tables** remain private: anonymous REST `GET` on `whatsapp_messages`, `whatsapp_media`,
  `submission_sessions`, `automation_events`, `agents`, `agencies` → 401; anonymous `POST whatsapp_messages` → 401.
- **Webhook authenticity:** Meta signature verification by the trigger node (section 4). Sender identity is
  still only a WhatsApp phone number; authorization to submit listings is the active-agent check.
- The Supabase project URL in the workflow is not a secret (it is the public API host).
- Security advisors after the change: no new findings (same INFO `rls_enabled_no_policy` on private tables and the
  intentional `submit_inquiry` WARN from Phase 3; pre-existing Auth leaked-password WARN).

## 13. Credential and configuration requirements (pending — owner action)

1. In Meta for Developers: a WhatsApp Business app, the production business phone number, and its
   `phone_number_id`.
2. In n8n: create the two credentials above and select them on **WhatsApp Trigger** and **Persist inbound message
   (Supabase)**.
3. In Supabase (through the admin/service role, not the website): one `agencies` row for VIP Realty with
   `whatsapp_phone_number_id` = the real `phone_number_id`, and `agents` rows with real `whatsapp_phone` (E.164).
4. Activate the workflow (this registers the Meta webhook subscription), then send one real message and confirm
   `outcome: stored` in Supabase.

None of these values were invented; no agency or agent rows exist in production.

## 14. Tests

Test data used only `zz-phase4-test-*` identifiers (agency slug `zz-phase4-test-agency`, message ids
`wamid.zz-phase4-test-*`, media ids `zz-phase4-test-media-*`, correlation `zz-phase4-test:*`).

### n8n (test executions with pinned trigger data)

| Test | Result |
| --- | --- |
| Batched webhook (6 messages) + separate unknown-sender, status-only, malformed and unroutable changes | PASS — 9 message events; status update skipped |
| Normalization: text, image caption + media metadata, document filename, missing id, missing sender | PASS |
| Temporary media `url` removed from `raw_payload` | PASS |
| Malformed `messages` produces a recorded rejection event, not a silent drop | PASS |
| Switch routes `stored`, `duplicate`, `rejected`, `unroutable` to their terminals | PASS |
| Unexpected RPC response → `Fail: unexpected ingestion response` | PASS (execution failed as designed) |
| Supabase unavailable (real HTTP node, no credential) → 3 attempts (~6 s) → error output → `Fail: ingestion unavailable` with provider message id; event preserved in the failed execution; no secret in the error | PASS |

### Supabase (the exact normalized events from the n8n run, executed as `service_role`)

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Text message from active agent | PASS — `stored`, session created, `buffered` |
| 2 | Second text, same sender | PASS — same session reused |
| 3 | Image message | PASS — same session; `whatsapp_media` row (`image/jpeg`, `received`, no storage path) |
| 4 | Exact duplicate in the same webhook | PASS — `duplicate`, `delivery_count 2`, no new row |
| 5 | Message without provider id | PASS — `stored` with `derived:` key |
| 6 | Missing sender | PASS — `rejected invalid_sender`, event with raw payload |
| 7 | Unknown sender (document) | PASS — `stored`, `unresolved_sender`, no session, no agent created, media metadata kept |
| 8 | Malformed payload | PASS — `rejected malformed_messages` |
| 9 | Unknown business number | PASS — `unroutable`, event recorded, no message row |
| 10 | Same message delivered **three times** | PASS — one row, `delivery_count 3` |
| 11 | Id-less message redelivered | PASS — same derived key → `duplicate` |
| 12 | Different id-less message, same second | PASS — different derived key → stored separately |
| 13 | No id and no timestamp | PASS — `rejected missing_message_id` |
| 14 | Inactive agent | PASS — `unresolved_sender`, reason `agent_inactive` |
| 15 | Non-object event / wrong provider | PASS — `rejected` |
| 16 | Unknown message type + unparseable timestamp | PASS — stored as `unsupported`, timestamp null, session time = arrival |
| 17 | Session closed by a later phase, then new messages | PASS — new session opened and reused; closed session untouched; old message redelivery still `duplicate` |
| 18 | Transient failure (statement cancelled mid-call) | PASS — nothing persisted (0 rows, 0 events); the retry stored exactly one row; a further retry → `duplicate` |
| 19 | `authenticated` role calls the function | PASS — permission denied |
| 20 | Anonymous REST: RPC and table reads/insert | PASS — all 401 |
| 21 | Max rows per `(provider, provider_message_id)` | PASS — 1 |
| 22 | Different messages stored independently | PASS |
| — | Totals before cleanup | 12 messages, 2 sessions, 2 media, 26 events, 0 properties/extractions/images created |

### Not tested (and why)

- **Real Meta delivery and signature check** — no Meta app credentials exist; the trigger cannot be activated.
  Signature handling is n8n's own implementation (verified in source, not exercised).
- **Live n8n → Supabase HTTP success path** — no service-role credential in n8n. The n8n run and the database run
  were linked by executing the n8n-normalized events directly against the function as `service_role`.
- **True concurrent duplicate deliveries** — covered by the unique constraints and `on conflict`, not by a
  parallel load test.
- **The `schema_violation` handler** — no input reachable through validation triggers it; it is defensive.

### Regression checks

| Check | Result |
| --- | --- |
| RSVP data fingerprint | unchanged (`090be351…`) |
| 6 legacy properties (Phase 3 fingerprint and full-row fingerprint) | unchanged |
| Published listings view | unchanged (0 rows, anon 200) |
| `submit_inquiry` for an unpublished listing | unchanged (`property_unavailable`) |
| Tables without RLS / policies | 0 / 5 (unchanged) |
| Booking tables or functions | none |
| Storage objects | 0 |

### Cleanup

All `zz-phase4-test` rows were deleted and verified: agencies 0, agents 0, sessions 0, messages 0, media 0,
automation events 0, extraction results 0, property images 0, inquiries 0, storage objects 0.
The three n8n **test executions** (ids 1–3) contain only synthetic `zz-phase4-test` payloads; they can be deleted
from the workflow's Executions list in n8n (not possible through the available tooling).

## 15. Intentionally deferred

| Deferred | Phase |
| --- | --- |
| Session buffering: quiet period, done/new/cancel commands, max duration, `process_after`, closing sessions | 5 |
| AI extraction into `extraction_results`, validation, property create/update from a session | 5+ |
| Media download to the private bucket, hashing, `property_images` | later media phase |
| Sold/rented/status commands | later |
| WhatsApp replies/acknowledgements to agents | later |
| Admin views of messages, sessions, unresolved senders, inquiries | later |
| Error alerts/notifications (n8n error workflow) | later |
| Real credentials, agency/agent registration, activation | owner configuration |
