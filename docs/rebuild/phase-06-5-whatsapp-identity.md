# Phase 6.5 — WhatsApp Identity and Conversation Architecture

Status: **complete**. Branch `phase/06-5-whatsapp-identity` (from Phase 6 commit `bdb1024`).

> The sender identity model now matches the WhatsApp Cloud API. A sender is identified by Meta's **business-scoped
> user id (BSUID)**; the phone number is optional. Agents are resolved deterministically (BSUID first, registered
> phone as fallback), a conversation has a canonical id, and group messages can be represented but are **not
> processed**. Phase 5 buffering/extraction and Phase 6 draft generation are unchanged and still pass.
> No media storage, no historical import, no group ingestion, no Phase 7 work.

No secrets, tokens or credential values appear in this document or in the repository.

---

## 1. Why

Production channel: **agent → agency WhatsApp Business number → Meta Cloud API → n8n → AI → Supabase → website**.

Phase 4 assumed every inbound sender has a phone number (`messages[].from` / `contacts[].wa_id`, digits only) and
used that phone as the only key for agent lookup, session grouping and the fallback message id. Meta now
identifies users by a business-scoped user id and may **omit the phone number** (users with a WhatsApp username).
With the Phase 4 model such a message would have been rejected as `invalid_sender`, even from a registered agent.

The existing WhatsApp group of the agency is **not** a production source. It is only a one-time historical
migration source, handled in a later phase (section 13).

## 2. Audit — every phone / wa_id / from / conversation / sender assumption (inspected first)

| Location | Assumption (before) | Now |
| --- | --- | --- |
| `whatsapp_messages.sender_phone` | `NOT NULL`, E.164 | nullable; at least one of `sender_phone` / `sender_user_id` required |
| `whatsapp_messages.provider_contact_id` | digits only (`^[0-9]{5,20}$`) | phone digits **or** a BSUID |
| `agents` | only `whatsapp_phone` (unique per agency) | + `whatsapp_user_id` (BSUID, globally unique) |
| `ingest_whatsapp_message` — sender parsing | `sender_wa_id` must be digits; `v_phone := '+' \|\| wa_id` | accepts `sender_user_id`, `sender_phone`, and `sender_wa_id` holding either |
| `ingest_whatsapp_message` — agent lookup | `agents.whatsapp_phone` within the number's agency | BSUID first, phone fallback (section 6) |
| `ingest_whatsapp_message` — session key | the sender's E.164 phone | canonical conversation id (section 5) |
| `ingest_whatsapp_message` — derived message id | `sha256(recipient \| wa_id \| …)` | `sha256(recipient \| coalesce(BSUID, phone digits) \| …)` — unchanged for phone-only payloads |
| `submission_sessions.channel_conversation_key` | comment: "the sender E.164 phone number" | canonical conversation id |
| n8n *Normalize message* | `sender_wa_id = message.from`; contact matched by `wa_id`; no BSUID | extracts BSUID, phone (if present), group id; contact matched by `wa_id` or `user_id` |
| Phase 5 functions (`advance_…`, `claim_…`, `build_extraction_input`, `record_…`) | none — they use `session_id` / `agent_id` only; the sender name in the AI input comes from `agents.name` | unchanged |
| Phase 6 `generate_property_draft` | none — ownership from `session.agent_id` → `agents` (active, same agency) | unchanged |
| Website (`lib/…`, `app/…`) | none — the only WhatsApp reference is the public `wa.me` contact link | unchanged |

Display names (`contacts[].profile.name`) were already never used for identity; they are stored as
`sender_name` for humans only.

## 3. Meta identity model

**Confirmed from Meta's Cloud API documentation (see the discovery report of this phase):**

- Inbound webhooks carry the business-scoped user id in `messages[].from_user_id` and `contacts[].user_id`.
  Format: two-letter country prefix, a dot, alphanumerics (e.g. `AM.1349…`); scoped to the business portfolio.
- `messages[].from` / `contacts[].wa_id` (the phone number) **may be absent**, e.g. for users with a WhatsApp username.
- `metadata.phone_number_id` identifies the receiving business number (unchanged; routes to the agency).
- `messages[].id` (`wamid.…`) is the provider message id (unchanged; idempotency key).
- Group messages (Groups API) carry `messages[].group_id`.
- Media: webhook gives a media id; the download URL obtained from it is short-lived (minutes) and the media itself is
  retrievable only for a limited period. Nothing is downloaded in this phase.

**Handled defensively (not assumed):** `from` may contain a BSUID instead of a phone; the BSUID may appear only in
`contacts[]`; several contacts per change; phone and BSUID both present; neither present (→ rejected).

**Must be verified against a real webhook before activation** (section 14): exact BSUID length/charset in
production, whether `from` is omitted or holds the BSUID for username users, and the `group_id` format.

## 4. Schema changes

Migrations `20260918091820_whatsapp_identity_model.sql` and `20260918092512_whatsapp_identity_session_key.sql`.

`agents`
- `whatsapp_user_id text` — BSUID, check `^[A-Z]{2}\.[A-Za-z0-9]{1,128}$`, partial unique index
  `agents_whatsapp_user_id_key` (globally unique → resolves to exactly one agent and one agency).
  Set by an admin only; ingestion never writes it.

`whatsapp_messages` (the provider message id, business phone-number id, raw payload, timestamp and media
reference columns already existed)

| Column | Meaning |
| --- | --- |
| `provider_message_id` | Meta `wamid` (or `derived:<sha256>` fallback) — unchanged, unique with `provider` |
| `recipient_phone_number_id` | business number's Meta `phone_number_id` — unchanged |
| `sender_user_id` (new) | sender BSUID, nullable, format-checked, indexed |
| `sender_phone` | now **nullable**, E.164 when Meta provides it |
| `provider_contact_id` | raw `from` / `wa_id` — phone digits or a BSUID |
| `conversation_type` (new) | `direct` \| `group` (default `direct`) |
| `conversation_id` (new, not null) | canonical conversation id, format-checked, indexed with `received_at` |
| `group_id` (new) | Meta group id; required iff `conversation_type = 'group'` |
| `raw_payload`, `provider_timestamp` | unchanged |
| media reference | unchanged: `whatsapp_media` row (provider media id, mime, filename) linked by `message_id` |

Constraints: `sender_identity_present` (phone or BSUID), `group_consistency`, formats for BSUID, group id and
conversation id. Existing rows: none at migration time (backfill written for safety, 0 rows affected).

No new tables. No staging tables. RLS, grants and the public read model are unchanged.

## 5. Canonical conversation identity

```
wa:<phone_number_id>:direct:<stable sender id>
wa:<phone_number_id>:group:<group_id>          (representable only — see section 12)
```

- **Resolved agent:** `<stable sender id>` is the agent's **registered** identity — `agents.whatsapp_user_id`,
  else `agents.whatsapp_phone`. It does not depend on which identifiers a particular payload happens to carry, so
  during Meta's rollout a phone-only message followed by a BSUID + phone message from the same agent stays in one
  session (tested). Two agents can never share a key (BSUID globally unique; phone unique per agency).
- **Unresolved sender:** the payload's BSUID, else `+phone`. These messages never get a session; the id is only for
  tracing.
- Never a display name. `submission_sessions.channel_conversation_key` = this id; session lookups are additionally
  scoped to the resolved `agent_id`.

## 6. Sender resolution (inside `ingest_whatsapp_message`, one transaction)

1. **Route** by `recipient_phone_number_id` → `agencies.whatsapp_phone_number_id`. Unknown → `unroutable` (recorded).
2. **BSUID** present → `agents.whatsapp_user_id = BSUID` (global lookup).
3. Otherwise, **phone** present → `agents.whatsapp_phone = +phone` **within the routed agency**.
   If that agent has a registered BSUID and the message carries a *different* BSUID → `identity_conflict`
   (unresolved). If the agent has no BSUID yet, the phone match is accepted and the event
   `whatsapp.message_received` carries `agent_user_id_unlinked: true` so an admin can link it after checking.
   **The agent row is never modified** — no silent identity replacement (tested: `whatsapp_user_id` stays null).
4. Then the agent must be **active** (`agent_inactive`) and belong to the **agency of the business number**
   (`agency_mismatch`). The inbound message can never choose its agency.

Never used for identity: display/profile name, AI output, message text. Agents are **never created** by ingestion.

Unresolved senders (`unknown_sender`, `identity_conflict`, `agent_inactive`, `agency_mismatch`): the raw message is
stored (`agent_id` null, `processing_status = unresolved_sender`) with a `whatsapp.sender_unresolved` event
(reason, `identified_by`). No session, no command, no extraction, no property.

Defence in depth (Phase 6, unchanged): `generate_property_draft` re-checks the session's agent is active and in the
session's agency immediately before creating a draft (tested: agent moved to another agency and agent deactivated
after extraction → `ownership_failed`, no property).

**Registering an agent (admin, until an admin UI exists):** set `agents.whatsapp_user_id` (preferred) and/or
`agents.whatsapp_phone`. To learn an agent's BSUID, have the agent message the business number once; the message is
stored as `unresolved_sender` (or flagged `agent_user_id_unlinked`) with `sender_user_id`; verify out of band, then
copy the value into the agent row.

## 7. Phone fallback — rules

- Used only when no agent has the message's BSUID.
- Scoped to the agency that owns the receiving business number (an agent of another agency with the same phone is
  never matched — tested).
- Rejected when the matched agent is registered under a different BSUID.
- Phone numbers may be recycled by carriers; BSUID registration is therefore preferred, and the phone should be
  treated as a bootstrap identifier.

## 8. Idempotency

Unchanged in principle: unique `(provider, provider_message_id)`; a redelivery increments `delivery_count` and never
re-runs session logic, commands or media inserts. The key is never the phone. Fallback id when Meta omits
`messages[].id`: `sha256(recipient | coalesce(BSUID, phone digits) | epoch | type | message json)` — identical to
Phase 4 for phone-only payloads. Tested: exact redelivery, redelivery with a changed profile name/payload variant,
derived id with phone only, derived id with BSUID only, media message redelivery (one `whatsapp_media` row).

## 9. Sessions

Grouped by the canonical direct conversation id (section 5). Unchanged: 5-minute quiet period, 90-second media
settle, 60-minute cap, one open session per key (unique index), `done` / `cancel` commands, lease/claim, retries,
finish/cancel. Commands are recognised only for resolved agents' text messages in **direct** conversations.
No group behaviour, no "next property" command.

If an admin re-assigns an identifier while a session is open so that another agent's open session holds the key,
that session is handed to processing (`ready`, `close_reason = admin`, event `agent_identity_reassigned`) instead of
mixing two agents in one session.

## 10. n8n (*VIP Realty — WhatsApp Inbound*, still **inactive**)

*Normalize message* now emits event `schema_version: 2`:

| Field | Source |
| --- | --- |
| `recipient_phone_number_id` | `metadata.phone_number_id` |
| `provider_message_id` | `messages[].id` |
| `provider_timestamp` | `messages[].timestamp` (unix s → ISO) |
| `sender_user_id` | `messages[].from_user_id` → matched `contacts[].user_id` → `from` if it has BSUID format |
| `sender_phone` | `from` if phone-shaped, else matched `contacts[].wa_id` if phone-shaped, else null |
| `sender_wa_id` | raw `from` (Phase 4 field, kept for compatibility) |
| `sender_name` | `contacts[].profile.name` — display only |
| `group_id` | `messages[].group_id` |
| `message_type`, `text_body`, `media` (id, mime, filename), `context_provider_message_id`, `raw_payload` | as Phase 4 (temporary media URLs stripped) |

It does not reject a message without phone/`from`; the database decides. Tested in n8n (execution 26, pinned
fixture data, Supabase call pinned): legacy phone-only, BSUID + phone, BSUID-only image (URL stripped), BSUID in
`from`, group message — normalized output then fed unchanged to the database tests. Export updated in
`automation/n8n/vip-realty-whatsapp-inbound.json`. Two sticky notes updated (identity, agent registration).

## 11. Backward compatibility

- Phase 4 events (`sender_wa_id` digits, no `sender_user_id`) are accepted and behave exactly as before (T1).
- Existing agents with only `whatsapp_phone` keep working; their session key is `…:direct:+<phone>`.
- Phase 5 and Phase 6 SQL functions and n8n workflows are untouched and re-tested.

## 12. Group readiness (representable, not active)

Stored: `conversation_type = 'group'`, `group_id`, conversation id `wa:<pnid>:group:<group_id>`, raw payload.
Behaviour: `processing_status = ignored`, event `whatsapp.group_message_ignored` (`group_ingestion_not_enabled`),
no session, no commands (a `done` in a group is ignored — tested), no extraction, no property.

Not done (by design): no production group, no OBA requirement, no Groups API configuration, no group webhook
subscription, no participant management, no group ingestion, no routing change.

## 13. Historical migration strategy (future phase — nothing implemented)

The existing consumer group's history cannot be read by the Cloud API. The only source is a **WhatsApp chat
export** made by a group member on a phone.

1. **Export** (member's phone, "Export chat" with media) → transfer directly to a private location. The export
   contains personal data (names, phone numbers, messages, photos): never commit it, never put it in a public
   bucket, never send it to third parties beyond the AI provider already in use.
2. **Test the real export format first** (a small sample): date/time locale, multi-line messages, system lines,
   `<attached: …>` / "media omitted" markers, sender naming (contact names vs numbers), file naming.
3. **Private staging** (to be designed then; not created now): immutable import batch + raw lines + media files in a
   private storage bucket, access limited to the service role.
4. **Reconstruction**: parse into messages, map senders to registered agents **by an admin-confirmed mapping**
   (export names are not identities), group consecutive messages of one sender into candidate submissions.
5. **AI extraction** with the same prompt/validator as Phase 5.
6. **`source = 'import'`**, always **draft / review pending** — never auto-published; one draft per reconstructed
   submission, idempotent on a hash of the batch + message range.
7. **Media deduplication** by content hash (sha256) before upload.
8. **Manual review** → explicit publish (Phase 7+ admin flow).
9. **Delete the export** and staging data after verification; keep only the drafts and an audit record.

## 14. Meta prerequisites before activation

- Meta app, WhatsApp Business Account and the agency's business number (Cloud API); webhook subscribed to `messages`.
- n8n credentials: *VIP Realty WhatsApp (Meta app)* and *VIP Realty Supabase (service role)* (pending).
- `agencies.whatsapp_phone_number_id` = the number's `phone_number_id`.
- Agents registered (BSUID and/or phone), section 6.
- Capture one real inbound webhook (test number) and confirm: BSUID fields/format, `from` behaviour without phone,
  `contacts[]` shape. Adjust the format checks if Meta's production format differs.
- Groups (only if ever needed): Official Business Account, business-created groups, invite links, participant
  limits — out of scope.

## 15. Security

| Check | Result |
| --- | --- |
| Credentials committed | none (repository scan clean; exports reference credential names only) |
| Service-role key in the browser | no — only n8n and server code; website uses the publishable key |
| Public write access | none: anonymous `POST`/`PATCH` on `whatsapp_messages` / `agents` → 401 |
| Raw payload protected | `whatsapp_messages`, `automation_events` not readable anonymously (401); RLS on, no policies, no anon/authenticated grants |
| Ingestion / generation RPC | `EXECUTE` revoked from `public`, `anon`, `authenticated`; anon call → 401 |
| Agent / agency chosen by AI | impossible: resolution happens at ingestion from provider identifiers; drafts take ownership from the session |
| Display name authenticates | no (tested: unknown BSUID with a registered agent's name → `unknown_sender`) |
| Unknown sender creates property | no (tested: no session, no extraction, no property; agent count unchanged) |
| Supabase advisors | security: unchanged (RLS-no-policy INFO on private tables — intended; `submit_inquiry` anon SECURITY DEFINER — intended, Phase 3; leaked-password protection — Auth setting). performance: INFO unused indexes only (new `whatsapp_messages_sender_user_idx` unused on an empty table) |

## 16. Tests (`zz-phase65-test-*` fixtures; synthetic numbers `+3749900650x`, BSUIDs `AM.zzphase65test00xx`, business number id `999990000000065`)

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Existing phone-number payload (Phase 4 shape) | PASS — resolved by phone, session `…:direct:+37499006501` |
| 2 | BSUID + phone | PASS — resolved by BSUID, session `…:direct:AM.zzphase65test0002` |
| 3 | BSUID without phone (image) | PASS — resolved, `sender_phone` null, media row created |
| 4 | Unknown BSUID | PASS — stored `unresolved_sender` / `unknown_sender`, no session |
| 5 | Unknown phone | PASS — same; also agent of another agency by phone → `unknown_sender` |
| 6 | Duplicate webhook | PASS — `duplicate`, `delivery_count` 2, no new rows |
| 7 | Same message, different delivery attempt (changed payload/name); derived ids (phone-only, BSUID-only); media redelivery | PASS — all `duplicate` |
| 8 | Direct conversation session creation | PASS — keyed by canonical id |
| 9 | Two messages of one agent → one session (incl. BSUID in `from`, phone-only vs BSUID+phone variants) | PASS |
| 10 | Two different agents never share a session | PASS — every session: 1 agent, all messages' `agent_id` = session agent |
| 11 | Inactive agent | PASS — `agent_inactive`, no session; deactivated after extraction → `ownership_failed` |
| 12 | Agent moved to another agency | PASS — ingestion `agency_mismatch`; generation after move → `ownership_failed` |
| 13 | No fake agent creation | PASS — agents 7 before / 7 after; unlinked BSUID not written to the agent |
| 14 | Phase 5 extraction still works | PASS — advance → claim → record: valid, incomplete, invalid outcomes as before |
| 15 | Phase 6 draft generation still works | PASS — draft created (`draft`/`pending`/`whatsapp`, AI title validated), 2nd call `duplicate` |
| 16 | Legacy six properties unchanged | PASS — fingerprint `dd176f32…` before and after |
| 17 | Public listing behaviour unchanged | PASS — `published_property_listings` 0 rows before/after |
| 18 | No public draft exposure | PASS — draft slug via anon REST (view and `properties`) → `[]` |
| + | Identity conflict (phone of an agent + different BSUID) | PASS — `identity_conflict`, unresolved |
| + | Group message / `done` in a group | PASS — stored, `ignored`, no session, no command |
| + | Unknown business number / no sender identity | PASS — `unroutable` / `rejected invalid_sender` |

All test data deleted and verified: agencies, agents, messages, media, sessions, extraction results, automation
events, test property → 0 / 6 legacy properties with unchanged fingerprint. n8n test execution 26 contains only
synthetic fixture data and can be deleted in the n8n UI.

## 17. Migrations and rollback

| Version | File |
| --- | --- |
| `20260918091820` | `whatsapp_identity_model.sql` — columns, constraints, indexes, `ingest_whatsapp_message` v2 |
| `20260918092512` | `whatsapp_identity_session_key.sql` — session key from the registered agent identity, agent-scoped lookups |

Rollback (only after confirming no rows rely on the new model):

```sql
-- 1. restore the Phase 5 ingestion function: re-run the ingest_whatsapp_message definition
--    (and its revoke/grant) from supabase/migrations/20260917172539_session_buffering.sql
-- 2. drop the new model
alter table public.whatsapp_messages
  drop constraint whatsapp_messages_sender_identity_present,
  drop constraint whatsapp_messages_group_consistency,
  drop constraint whatsapp_messages_sender_user_id_format,
  drop constraint whatsapp_messages_group_id_format,
  drop constraint whatsapp_messages_conversation_id_format,
  drop constraint whatsapp_messages_conversation_type_check;
drop index public.whatsapp_messages_conversation_idx, public.whatsapp_messages_sender_user_idx;
alter table public.whatsapp_messages drop column sender_user_id, drop column conversation_type,
  drop column conversation_id, drop column group_id;
-- restore the Phase 4 provider_contact_id check (fails if a BSUID is stored there)
alter table public.whatsapp_messages drop constraint whatsapp_messages_provider_contact_id_check,
  add constraint whatsapp_messages_provider_contact_id_check
    check (provider_contact_id is null or provider_contact_id ~ '^[0-9]{5,20}$');
-- only if no row has a null sender_phone:
alter table public.whatsapp_messages alter column sender_phone set not null;
drop index public.agents_whatsapp_user_id_key;
alter table public.agents drop constraint agents_whatsapp_user_id_format, drop column whatsapp_user_id;
```

n8n: restore the previous *Normalize message* code from Git history /
n8n version history.

## 18. Limitations and what remains unimplemented

- BSUID format check is based on documented examples; verify with a real webhook (section 14).
- No admin UI to register BSUIDs; done in SQL by an admin for now.
- Sessions of an agent whose registered identity changes mid-session split at that moment (by design, admin action).
- Media storage/download, historical import pipeline, staging tables, group ingestion, replies to agents,
  publishing — not implemented (later phases).
