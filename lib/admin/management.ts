import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AdminResult } from "@/lib/admin/properties";

/* ----------------------------------------------------------------------------
   Agency and agent read models for the admin (service role, behind the admin
   session). WhatsApp identities are shown here because managing them is the
   point of these screens — they never leave the admin area.
---------------------------------------------------------------------------- */

export interface AgencyRow {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  legalName: string | null;
  publicPhone: string | null;
  publicWhatsapp: string | null;
  publicEmail: string | null;
  officeAddress: string | null;
  officeHours: string | null;
  whatsappPhoneNumberId: string | null;
  isActive: boolean;
  isSitePrimary: boolean;
  updatedAt: string;
  agentCount: number;
  listingCount: number;
  publishedCount: number;
}

export interface AgentRow {
  id: string;
  agencyId: string;
  agencyName: string;
  agencyActive: boolean;
  name: string;
  isActive: boolean;
  whatsappUserId: string | null;
  whatsappPhone: string | null;
  phone: string | null;
  email: string | null;
  listingCount: number;
  publishedCount: number;
  lastMessageAt: string | null;
  hasHistory: boolean;
  updatedAt: string;
}

export interface UnlinkedSender {
  messageId: string;
  kind: "unregistered" | "bsuid_unlinked";
  agencyId: string;
  agencyName: string;
  whatsappUserId: string | null;
  senderPhone: string | null;
  profileName: string | null;
  bodyPreview: string | null;
  receivedAt: string;
  reason: string | null;
  suggestedAgentId: string | null;
  messageCount: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const bool = (v: unknown) => v === true;

function logFailure(operation: string, error: { code?: string; message?: string }) {
  console.error(`[admin] ${operation} failed`, { code: error.code });
}

export async function listAgencies(): Promise<AdminResult<AgencyRow[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const [agencies, agents, listings] = await Promise.all([
    db.from("agencies").select("id, name, slug, display_name, legal_name, public_phone, public_whatsapp, public_email, " +
      "office_address, office_hours, whatsapp_phone_number_id, is_active, is_site_primary, updated_at")
      .order("is_site_primary", { ascending: false }).order("name"),
    db.from("agents").select("agency_id").limit(5000),
    db.from("properties").select("agency_id, listing_status").limit(10_000),
  ]);
  const error = agencies.error ?? agents.error ?? listings.error;
  if (error) {
    logFailure("agencies", error);
    return { ok: false, reason: "unavailable" };
  }
  const agentCounts = new Map<string, number>();
  for (const a of (agents.data ?? []) as unknown as Row[]) {
    const id = String(a.agency_id);
    agentCounts.set(id, (agentCounts.get(id) ?? 0) + 1);
  }
  const listingCounts = new Map<string, { total: number; published: number }>();
  for (const p of (listings.data ?? []) as unknown as Row[]) {
    if (typeof p.agency_id !== "string") continue;
    const c = listingCounts.get(p.agency_id) ?? { total: 0, published: 0 };
    c.total += 1;
    if (p.listing_status === "published") c.published += 1;
    listingCounts.set(p.agency_id, c);
  }
  return {
    ok: true,
    data: ((agencies.data ?? []) as unknown as Row[]).map((a) => {
      const counts = listingCounts.get(String(a.id)) ?? { total: 0, published: 0 };
      return {
        id: String(a.id),
        name: String(a.name),
        slug: String(a.slug),
        displayName: str(a.display_name),
        legalName: str(a.legal_name),
        publicPhone: str(a.public_phone),
        publicWhatsapp: str(a.public_whatsapp),
        publicEmail: str(a.public_email),
        officeAddress: str(a.office_address),
        officeHours: str(a.office_hours),
        whatsappPhoneNumberId: str(a.whatsapp_phone_number_id),
        isActive: bool(a.is_active),
        isSitePrimary: bool(a.is_site_primary),
        updatedAt: String(a.updated_at),
        agentCount: agentCounts.get(String(a.id)) ?? 0,
        listingCount: counts.total,
        publishedCount: counts.published,
      };
    }),
  };
}

export async function getAgency(id: string): Promise<AdminResult<AgencyRow>> {
  const all = await listAgencies();
  if (!all.ok) return all;
  const found = all.data.find((a) => a.id === id);
  return found ? { ok: true, data: found } : { ok: false, reason: "not_found" };
}

export async function listAgents(): Promise<AdminResult<AgentRow[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const { data, error } = await db.from("admin_agents")
    .select("id, agency_id, agency_name, agency_active, name, is_active, whatsapp_user_id, whatsapp_phone, phone, " +
      "email, listing_count, published_count, last_message_at, has_history, updated_at")
    .order("name").limit(1000);
  if (error) {
    logFailure("agents", error);
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    data: ((data ?? []) as unknown as Row[]).map((g) => ({
      id: String(g.id),
      agencyId: String(g.agency_id),
      agencyName: String(g.agency_name),
      agencyActive: bool(g.agency_active),
      name: String(g.name),
      isActive: bool(g.is_active),
      whatsappUserId: str(g.whatsapp_user_id),
      whatsappPhone: str(g.whatsapp_phone),
      phone: str(g.phone),
      email: str(g.email),
      listingCount: int(g.listing_count),
      publishedCount: int(g.published_count),
      lastMessageAt: str(g.last_message_at),
      hasHistory: bool(g.has_history),
      updatedAt: String(g.updated_at),
    })),
  };
}

export async function getAgent(id: string): Promise<AdminResult<AgentRow>> {
  const all = await listAgents();
  if (!all.ok) return all;
  const found = all.data.find((g) => g.id === id);
  return found ? { ok: true, data: found } : { ok: false, reason: "not_found" };
}

/** Senders the pipeline could not attribute — the safe source for registering a real WhatsApp identity. */
export async function listUnlinkedSenders(): Promise<AdminResult<UnlinkedSender[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const { data, error } = await db.from("admin_unlinked_senders")
    .select("message_id, kind, agency_id, agency_name, sender_user_id, sender_phone, sender_name, body_preview, " +
      "received_at, reason, suggested_agent_id, message_count")
    .order("received_at", { ascending: false }).limit(50);
  if (error) {
    logFailure("unlinked senders", error);
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    data: ((data ?? []) as unknown as Row[]).map((s) => ({
      messageId: String(s.message_id),
      kind: s.kind === "bsuid_unlinked" ? "bsuid_unlinked" : "unregistered",
      agencyId: String(s.agency_id),
      agencyName: String(s.agency_name),
      whatsappUserId: str(s.sender_user_id),
      senderPhone: str(s.sender_phone),
      profileName: str(s.sender_name),
      bodyPreview: str(s.body_preview),
      receivedAt: String(s.received_at),
      reason: str(s.reason),
      suggestedAgentId: str(s.suggested_agent_id),
      messageCount: int(s.message_count),
    })),
  };
}
