# n8n workflows

Version-controlled copies of the n8n workflows. The live workflows run in n8n;
these files are for review and recovery.

| File | n8n workflow | Phase | Status |
| --- | --- | --- | --- |
| `vip-realty-whatsapp-inbound.json` | VIP Realty — WhatsApp Inbound | 4 | Inactive until credentials are configured |
| `vip-realty-submission-extraction.json` | VIP Realty — Submission Extraction | 5 | Inactive until credentials are configured |
| `vip-realty-property-extraction-ai.json` | VIP Realty — Property Extraction (AI) | 5 | Sub-workflow, called only by Submission Extraction |

Exports contain **no secrets**. Credentials are referenced by name only and must
be created in n8n credential storage:

- `VIP Realty WhatsApp (Meta app)` — type `whatsAppTriggerApi` (Meta app client ID and secret)
- `VIP Realty Supabase (service role)` — type `supabaseApi` (project host and service-role key)
- AI: the n8n managed Anthropic credential ("Gateway credits") on *Extract property (AI)*

To restore, import the JSON in n8n and select those credentials. In the two Phase 5
exports, replace the `<id of …>` placeholders with the real workflow ids (the
sub-workflow reference and its allowed caller). The extraction prompt source of
truth is `automation/prompts/property-extraction-v1.md`; the Code node
*Build extraction request* embeds the identical text.

Architecture, testing and rollback: `docs/rebuild/phase-04-whatsapp-n8n-foundation.md`
and `docs/rebuild/phase-05-session-buffering-ai-extraction.md`.
