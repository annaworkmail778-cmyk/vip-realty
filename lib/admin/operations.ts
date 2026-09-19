import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { adminCredential, hasPublicSupabase, hasSupabase, isProduction } from "@/lib/env";
import type { AdminResult } from "@/lib/admin/properties";

/* ----------------------------------------------------------------------------
   Operator diagnostics (Phase 9).

   Everything comes from `admin_operations_status()` (service role only), which
   returns counts, timestamps and event codes — never message text, raw WhatsApp
   payloads, phone numbers, user ids, Storage paths or credentials. The website
   configuration block reports booleans only, never a value.

   What this page cannot see: n8n workflow activation and n8n credentials (they
   live in n8n; use `npm run check:config -- --n8n`) and Meta webhook delivery
   (visible only as the "last message received" timestamp).
---------------------------------------------------------------------------- */

export type Counts = Record<string, number>;

export interface ProblemEvent {
  id: number;
  eventType: string;
  severity: string;
  source: string | null;
  createdAt: string;
  sessionId: string | null;
  propertyId: string | null;
  reason: string | null;
}

export interface OperationsStatus {
  generatedAt: string;
  readiness: { agencies: number; agenciesWithWhatsappNumber: number; activeAgents: number; activeAgentsWithIdentity: number };
  messages: { lastReceivedAt: string | null; last24h: number; byStatus: Counts; failed: number; unresolvedSender: number };
  sessions: { byStatus: Counts; readyWaitingOver15m: number; processingOver15m: number };
  extractions: { byStatus: Counts; failedLast24h: number };
  media: { byStatus: Counts; held: number; expiredLeases: number; deadlinePassedUnfinished: number };
  listings: {
    draftsPendingReview: number; approvedNotPublished: number; rejected: number; draftsWithoutAgency: number;
    byListingStatus: Counts; publiclyVisible: number;
  };
  inquiries: { new: number; last24h: number };
  statusCommands7d: { applied: number; rejected: number; duplicate: number; ignored: number };
  events: { lastEventAt: string | null; last24hBySeverity: Counts; recentProblems: ProblemEvent[] };
  storage: Counts;
}

export interface WebsiteConfig {
  production: boolean;
  publicDatabase: boolean;
  adminDatabase: boolean;
  adminCredential: "hash" | "plain" | "none";
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Row => (isRow(v) ? v : {});
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const counts = (v: unknown): Counts =>
  Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, int(n)]));

export function websiteConfig(): WebsiteConfig {
  return {
    production: isProduction,
    publicDatabase: hasPublicSupabase(),
    adminDatabase: hasSupabase(),
    adminCredential: adminCredential()?.kind ?? "none",
  };
}

export async function getOperationsStatus(): Promise<AdminResult<OperationsStatus>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const { data, error } = await db.rpc("admin_operations_status");
  if (error || !isRow(data)) {
    console.error("[admin] operations status failed", { code: error?.code });
    return { ok: false, reason: "unavailable" };
  }
  const r = obj(data.readiness), m = obj(data.messages), s = obj(data.sessions), x = obj(data.extractions);
  const md = obj(data.media), l = obj(data.listings), q = obj(data.inquiries), c = obj(data.status_commands_7d), e = obj(data.events);
  return {
    ok: true,
    data: {
      generatedAt: String(data.generated_at),
      readiness: {
        agencies: int(r.agencies), agenciesWithWhatsappNumber: int(r.agencies_with_whatsapp_number),
        activeAgents: int(r.active_agents), activeAgentsWithIdentity: int(r.active_agents_with_identity),
      },
      messages: {
        lastReceivedAt: str(m.last_received_at), last24h: int(m.last_24h), byStatus: counts(m.by_status),
        failed: int(m.failed), unresolvedSender: int(m.unresolved_sender),
      },
      sessions: { byStatus: counts(s.by_status), readyWaitingOver15m: int(s.ready_waiting_over_15m), processingOver15m: int(s.processing_over_15m) },
      extractions: { byStatus: counts(x.by_status), failedLast24h: int(x.failed_last_24h) },
      media: {
        byStatus: counts(md.by_status), held: int(md.held), expiredLeases: int(md.expired_leases),
        deadlinePassedUnfinished: int(md.deadline_passed_unfinished),
      },
      listings: {
        draftsPendingReview: int(l.drafts_pending_review), approvedNotPublished: int(l.approved_not_published),
        rejected: int(l.rejected), draftsWithoutAgency: int(l.drafts_without_agency),
        byListingStatus: counts(l.by_listing_status), publiclyVisible: int(l.publicly_visible),
      },
      inquiries: { new: int(q.new), last24h: int(q.last_24h) },
      statusCommands7d: { applied: int(c.applied), rejected: int(c.rejected), duplicate: int(c.duplicate), ignored: int(c.ignored) },
      events: {
        lastEventAt: str(e.last_event_at),
        last24hBySeverity: counts(e.last_24h_by_severity),
        recentProblems: (Array.isArray(e.recent_problems) ? e.recent_problems : []).filter(isRow).map((p) => ({
          id: int(p.id), eventType: String(p.event_type), severity: String(p.severity), source: str(p.source),
          createdAt: String(p.created_at), sessionId: str(p.session_id), propertyId: str(p.property_id), reason: str(p.reason),
        })),
      },
      storage: counts(data.storage),
    },
  };
}
