# VIP Realty rebuild — phase index

| Phase | Document | Scope |
| --- | --- | --- |
| 0 | [phase-00-baseline.md](phase-00-baseline.md) | Baseline audit of the original site |
| 1 | [phase-01-supabase-foundation.md](phase-01-supabase-foundation.md) | Supabase schema, RLS, public read model, Storage buckets |
| 2 | [phase-02-nextjs-data-layer.md](phase-02-nextjs-data-layer.md) | Next.js reads listings from Supabase |
| 3 | [phase-03-booking-removal.md](phase-03-booking-removal.md) | Booking/viewing removed; inquiry flow |
| 4 | [phase-04-whatsapp-n8n-foundation.md](phase-04-whatsapp-n8n-foundation.md) | WhatsApp → n8n → Supabase ingestion |
| 5 | [phase-05-session-buffering-ai-extraction.md](phase-05-session-buffering-ai-extraction.md) | Session buffering and AI extraction with deterministic validation |
| 6 | [phase-06-property-draft-generation.md](phase-06-property-draft-generation.md) | Non-public property drafts from valid extractions |
| 6.5 | [phase-06-5-whatsapp-identity.md](phase-06-5-whatsapp-identity.md) | WhatsApp identity model aligned with the Cloud API (BSUID) |
| 7 | [phase-07-media-storage.md](phase-07-media-storage.md) | WhatsApp media download, validation, storage and property images |
| 8 | [phase-08-review-publish-status.md](phase-08-review-publish-status.md) | Admin review and publication, lifecycle status, deterministic WhatsApp status commands |
