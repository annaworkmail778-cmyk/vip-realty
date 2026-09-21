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
| 9 | [phase-09-production-hardening-e2e.md](phase-09-production-hardening-e2e.md) | Production hardening: config validation, admin auth, diagnostics, E2E status, rollback |
| 10 | [phase-10-agency-agent-listing-management.md](phase-10-agency-agent-listing-management.md) | Agency and agent management, listing editing, gallery order, configured brand and contacts |
| 11 | [phase-11-production-environment-and-e2e.md](phase-11-production-environment-and-e2e.md) | Dedicated realty Supabase project (separated from RSVP), project pinning, integration/E2E status and activation gate |
| 12 | [phase-12-production-deployment.md](phase-12-production-deployment.md) | Deployment preparation: hosting settings, security headers, local production verification (deployment blocked: no platform/domain yet) |
| 13 | [phase-13-production-launch-setup.md](phase-13-production-launch-setup.md) | Launch setup: placeholder-content gate, dead links removed, `npm run smoke` suite, exact launch blockers |
| 14 | [phase-14-connect-production-infrastructure.md](phase-14-connect-production-infrastructure.md) | Production connection attempt: every resource still unavailable (blocked, nothing simulated) |

Current status: [final-launch-readiness.md](final-launch-readiness.md). Going live (operator steps): [production-launch-checklist.md](production-launch-checklist.md).
