# n8n workflows

Version-controlled copies of the n8n workflows. The live workflows run in n8n;
these files are for review and recovery.

| File | n8n workflow | Phase | Status |
| --- | --- | --- | --- |
| `vip-realty-whatsapp-inbound.json` | VIP Realty — WhatsApp Inbound | 4, 6.5 | Inactive until credentials are configured; since Phase 6.5 the normalizer passes the business-scoped user id (BSUID), optional phone and group id |
| `vip-realty-submission-extraction.json` | VIP Realty — Submission Extraction | 5–6 | Inactive until credentials are configured; since Phase 6 also creates non-public property drafts |
| `vip-realty-property-extraction-ai.json` | VIP Realty — Property Extraction (AI) | 5 | Sub-workflow, called only by Submission Extraction |
| `vip-realty-media-processing.json` | VIP Realty — Media Processing | 7 | Inactive until credentials are configured; downloads WhatsApp photos, validates them and attaches them to the session's draft |

Exports contain **no secrets**. Credentials are referenced by name only and must
be created in n8n credential storage:

- `VIP Realty WhatsApp (Meta app)` — type `whatsAppTriggerApi` (Meta app client ID and secret)
- `VIP Realty Supabase (service role)` — type `supabaseApi` (project host and service-role key)
- `VIP Realty WhatsApp Cloud API (access token)` — type `whatsAppApi` (WhatsApp Business Account access token
  and business account id); used only by *Media Processing* to resolve and download media
- AI: the n8n managed Anthropic credential ("Gateway credits") on *Extract property (AI)*

To restore, import the JSON in n8n and select those credentials. In the two Phase 5
exports, replace the `<id of …>` placeholders with the real workflow ids (the
sub-workflow reference and its allowed caller). The extraction prompt source of
truth is `automation/prompts/property-extraction-v1.md`; the Code node
*Build extraction request* embeds the identical text. The image validator source of
truth is `automation/media/validate-image.js`; the Media Processing Code nodes *Verify download*,
*Validate image* and *Verify gallery copy source* embed it verbatim (checked by `npm run test:media`).

Architecture, testing and rollback: `docs/rebuild/phase-04-whatsapp-n8n-foundation.md`,
`docs/rebuild/phase-05-session-buffering-ai-extraction.md`,
`docs/rebuild/phase-06-property-draft-generation.md`,
`docs/rebuild/phase-06-5-whatsapp-identity.md` and
`docs/rebuild/phase-07-media-storage.md`.
