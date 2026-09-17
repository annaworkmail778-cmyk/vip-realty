# n8n workflows

Version-controlled copies of the n8n workflows. The live workflows run in n8n;
these files are for review and recovery.

| File | n8n workflow | Status |
| --- | --- | --- |
| `vip-realty-whatsapp-inbound.json` | VIP Realty — WhatsApp Inbound | Inactive until credentials are configured |

Exports contain **no secrets**. Credentials are referenced by name only and must
be created in n8n credential storage:

- `VIP Realty WhatsApp (Meta app)` — type `whatsAppTriggerApi` (Meta app client ID and secret)
- `VIP Realty Supabase (service role)` — type `supabaseApi` (project host and service-role key)

To restore, import the JSON in n8n and select those credentials on the trigger
and on the "Persist inbound message (Supabase)" node. Architecture, testing and
rollback are described in `docs/rebuild/phase-04-whatsapp-n8n-foundation.md`.
