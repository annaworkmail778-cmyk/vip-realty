import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* ----------------------------------------------------------------------------
   Admin listing and review queries.

   Uses the service-role client because admins must see drafts. Callers are
   server components under the authenticated admin layout only. Reads go
   through the service-role-only review views (`admin_property_review`,
   `admin_media_issues`, `admin_submission_issues`); every decision about
   publishability comes from the database (`property_publication_check`), never
   from this file. Raw WhatsApp payloads, phone numbers and business-scoped user
   ids are never selected. Images are served through the authenticated admin
   image route, never through public draft URLs.
---------------------------------------------------------------------------- */

export const LISTING_STATUSES = ["draft", "published", "sold", "rented", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Review queue tabs. Draft sub-states are review states; the rest are listing states. */
export const QUEUE_FILTERS = ["review", "approved", "rejected", "published", "sold", "rented", "archived", "all"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "unavailable" | "not_found" };

export interface Publication {
  publishable: boolean;
  blockers: string[];
  warnings: string[];
  imageCount: number;
  pendingMedia: number;
}

export interface AdminQueueRow {
  id: string;
  title: string | null;
  slug: string;
  listingStatus: ListingStatus;
  reviewStatus: ReviewStatus | null;
  reviewNote: string | null;
  stateVersion: number;
  intent: string | null;
  propertyType: string | null;
  price: number | null;
  currency: string | null;
  pricePeriod: string | null;
  city: string | null;
  district: string | null;
  rooms: number | null;
  bedrooms: number | null;
  areaSqm: number | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  agencyName: string | null;
  agentName: string | null;
  agentActive: boolean | null;
  sessionId: string | null;
  sessionStatus: string | null;
  extractionStatus: string | null;
  conflictCount: number;
  issueCount: number;
  imageCount: number;
  mediaCounts: Record<string, number>;
  publication: Publication;
}

export interface ExtractionIssue { severity: string | null; code: string | null; field: string | null; message: string | null }
export interface ExtractedField { name: string; value: unknown; status: string | null; sourceMessages: number[]; evidence: string | null }
export interface ExtractionConflict { field: string | null; values: unknown[]; sourceMessages: number[]; resolution: string | null; note: string | null }

export interface AdminExtraction {
  id: string;
  attemptNumber: number | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  validationStatus: string | null;
  issues: ExtractionIssue[];
  fields: ExtractedField[];
  conflicts: ExtractionConflict[];
  notes: string[];
}

export interface SourceMessage { seq: number; id: string; type: string; body: string | null; sentAt: string | null }

export interface AdminMediaItem {
  id: string;
  seq: number | null;
  status: string;
  reason: string | null;
  detectedMime: string | null;
  fileSize: number | null;
  /** Only validated media can be previewed (through the authenticated admin route). */
  previewable: boolean;
}

export interface AdminImage {
  id: string;
  /** Authenticated admin route — never the public Storage URL. */
  url: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
  fromWhatsApp: boolean;
}

export interface AdminEvent { type: string; severity: string; createdAt: string; details: Record<string, unknown> }

export interface AdminReviewDetail extends AdminQueueRow {
  description: string | null;
  country: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  priceNegotiable: boolean | null;
  landAreaSqm: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  features: string[];
  listingStatusChangedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  extraction: AdminExtraction | null;
  messages: SourceMessage[];
  media: AdminMediaItem[];
  images: AdminImage[];
  events: AdminEvent[];
}

export interface MediaIssue {
  mediaId: string;
  status: string;
  reason: string | null;
  failedStage: string | null;
  attempts: { download: number; validation: number; attach: number };
  deadline: string | null;
  updatedAt: string;
  agencyName: string | null;
  agentName: string | null;
  sessionStatus: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  retryable: boolean;
}

export interface SubmissionIssue {
  sessionId: string;
  sessionStatus: string;
  closeReason: string | null;
  lastError: string | null;
  lastMessageAt: string | null;
  agencyName: string | null;
  agentName: string | null;
  validationStatus: string | null;
  issues: ExtractionIssue[];
  conflictCount: number;
  extractedAt: string | null;
  propertyId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const int = (v: unknown) => num(v) ?? 0;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]) =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numbers = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null) : []);

export const adminImageUrl = (imageId: string) => `/api/admin/images/property/${imageId}`;
export const adminMediaUrl = (mediaId: string) => `/api/admin/images/media/${mediaId}`;

function mapPublication(v: unknown): Publication {
  const r = isRow(v) ? v : {};
  return {
    publishable: r.publishable === true,
    blockers: strings(r.blockers),
    warnings: strings(r.warnings),
    imageCount: int(r.image_count),
    pendingMedia: int(r.pending_media),
  };
}

function mapQueueRow(row: Row): AdminQueueRow {
  const counts: Record<string, number> = {};
  if (isRow(row.media_counts)) for (const [k, v] of Object.entries(row.media_counts)) counts[k] = int(v);
  return {
    id: String(row.id),
    title: str(row.title),
    slug: String(row.slug),
    listingStatus: oneOf(row.listing_status, LISTING_STATUSES) ?? "draft",
    reviewStatus: oneOf(row.review_status, REVIEW_STATUSES),
    reviewNote: str(row.review_note),
    stateVersion: int(row.state_version),
    intent: str(row.intent),
    propertyType: str(row.property_type),
    price: num(row.price),
    currency: str(row.currency),
    pricePeriod: str(row.price_period),
    city: str(row.city),
    district: str(row.district),
    rooms: num(row.rooms),
    bedrooms: num(row.bedrooms),
    areaSqm: num(row.area_sqm),
    source: str(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    publishedAt: str(row.published_at),
    agencyName: str(row.agency_name),
    agentName: str(row.agent_name),
    agentActive: typeof row.agent_active === "boolean" ? row.agent_active : null,
    sessionId: str(row.created_from_session_id),
    sessionStatus: str(row.session_status),
    extractionStatus: str(row.extraction_status),
    conflictCount: int(row.conflict_count),
    issueCount: int(row.issue_count),
    imageCount: int(row.image_count),
    mediaCounts: counts,
    publication: mapPublication(row.publication),
  };
}

function mapIssues(v: unknown): ExtractionIssue[] {
  return (Array.isArray(v) ? v : []).filter(isRow).map((i) => ({
    severity: str(i.severity), code: str(i.code), field: str(i.field), message: str(i.message),
  }));
}

function logFailure(operation: string, error: { code?: string; message?: string }) {
  console.error(`[admin] ${operation} failed`, { code: error.code, message: error.message });
}

const QUEUE_COLUMNS =
  "id, slug, title, listing_status, review_status, review_note, state_version, intent, property_type, price, currency, " +
  "price_period, city, district, rooms, bedrooms, area_sqm, source, created_at, updated_at, published_at, agency_name, " +
  "agent_name, agent_active, created_from_session_id, session_status, extraction_status, conflict_count, issue_count, " +
  "image_count, media_counts, publication";

export async function listReviewQueue(filter: QueueFilter): Promise<AdminResult<AdminQueueRow[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  let query = db.from("admin_property_review").select(QUEUE_COLUMNS);
  if (filter === "review") query = query.eq("listing_status", "draft").or("review_status.is.null,review_status.eq.pending");
  else if (filter === "approved") query = query.eq("listing_status", "draft").eq("review_status", "approved");
  else if (filter === "rejected") query = query.eq("listing_status", "draft").eq("review_status", "rejected");
  else if (filter !== "all") query = query.eq("listing_status", filter);

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(300);
  if (error) {
    logFailure("review queue", error);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: ((data ?? []) as unknown as Row[]).map(mapQueueRow) };
}

export async function countReviewQueue(): Promise<AdminResult<Record<QueueFilter, number>>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  const { data, error } = await db.from("properties").select("listing_status, review_status").limit(10_000);
  if (error) {
    logFailure("queue counts", error);
    return { ok: false, reason: "unavailable" };
  }
  const counts: Record<QueueFilter, number> = {
    review: 0, approved: 0, rejected: 0, published: 0, sold: 0, rented: 0, archived: 0, all: 0,
  };
  for (const row of (data ?? []) as Row[]) {
    counts.all += 1;
    const status = oneOf(row.listing_status, LISTING_STATUSES);
    if (status === "draft") {
      const review = oneOf(row.review_status, REVIEW_STATUSES);
      counts[review === "approved" ? "approved" : review === "rejected" ? "rejected" : "review"] += 1;
    } else if (status) {
      counts[status] += 1;
    }
  }
  return { ok: true, data: counts };
}

const DETAIL_COLUMNS =
  "description, country, address, latitude, longitude, price_negotiable, land_area_sqm, bathrooms, floor, total_floors, " +
  "year_built, features, listing_status_changed_at, reviewed_at, reviewed_by";

export async function getReviewDetail(id: string): Promise<AdminResult<AdminReviewDetail>> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  const [queue, extra, images, events] = await Promise.all([
    db.from("admin_property_review").select(QUEUE_COLUMNS).eq("id", id).maybeSingle(),
    db.from("properties").select(DETAIL_COLUMNS).eq("id", id).maybeSingle(),
    db.from("property_images").select("id, sort_order, width, height, media_id").eq("property_id", id)
      .order("sort_order", { ascending: true }),
    db.from("automation_events").select("event_type, severity, created_at, details").eq("property_id", id)
      .order("created_at", { ascending: false }).limit(40),
  ]);
  const failed = queue.error ?? extra.error ?? images.error ?? events.error;
  if (failed) {
    logFailure("review detail", failed);
    return { ok: false, reason: "unavailable" };
  }
  if (!queue.data || !extra.data) return { ok: false, reason: "not_found" };

  const base = mapQueueRow(queue.data as unknown as Row);
  const row = extra.data as unknown as Row;

  let extraction: AdminExtraction | null = null;
  let messages: SourceMessage[] = [];
  let media: AdminMediaItem[] = [];

  const er = await db.from("extraction_results")
    .select("id, attempt_number, model, prompt_version, created_at, validation_status, validation_errors, input_message_ids, extracted_data")
    .eq("property_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (er.error) {
    logFailure("review extraction", er.error);
    return { ok: false, reason: "unavailable" };
  }

  if (er.data) {
    const e = er.data as unknown as Row;
    const data = isRow(e.extracted_data) ? e.extracted_data : {};
    const fieldsRow = isRow(data.fields) ? data.fields : {};
    extraction = {
      id: String(e.id),
      attemptNumber: num(e.attempt_number),
      model: str(e.model),
      promptVersion: str(e.prompt_version),
      createdAt: String(e.created_at),
      validationStatus: str(e.validation_status),
      issues: mapIssues(e.validation_errors),
      fields: Object.entries(fieldsRow).filter(([, f]) => isRow(f)).map(([name, f]) => {
        const fr = f as Row;
        return { name, value: fr.value ?? null, status: str(fr.status), sourceMessages: numbers(fr.source_messages), evidence: str(fr.evidence) };
      }),
      conflicts: (Array.isArray(data.conflicts) ? data.conflicts : []).filter(isRow).map((c) => ({
        field: str(c.field), values: Array.isArray(c.values) ? c.values : [], sourceMessages: numbers(c.source_messages),
        resolution: str(c.resolution), note: str(c.note),
      })),
      notes: strings(data.notes),
    };

    // seq n of the extraction input is the n-th message id (ordered by the database when the input was built)
    const ids = strings(e.input_message_ids).filter((x) => UUID.test(x));
    if (ids.length) {
      const msgs = await db.from("whatsapp_messages").select("id, message_type, body, provider_timestamp").in("id", ids);
      if (msgs.error) {
        logFailure("review messages", msgs.error);
        return { ok: false, reason: "unavailable" };
      }
      const byId = new Map(((msgs.data ?? []) as Row[]).map((m) => [String(m.id), m]));
      messages = ids.flatMap((mid, i) => {
        const m = byId.get(mid);
        return m ? [{ seq: i + 1, id: mid, type: String(m.message_type), body: str(m.body), sentAt: str(m.provider_timestamp) }] : [];
      });
    }
  }

  if (base.sessionId) {
    const sessionMsgs = await db.from("whatsapp_messages").select("id").eq("session_id", base.sessionId).limit(500);
    if (sessionMsgs.error) {
      logFailure("review session messages", sessionMsgs.error);
      return { ok: false, reason: "unavailable" };
    }
    const msgIds = ((sessionMsgs.data ?? []) as Row[]).map((m) => String(m.id));
    if (msgIds.length) {
      const wm = await db.from("whatsapp_media")
        .select("id, message_id, download_status, status_reason, detected_mime_type, file_size")
        .in("message_id", msgIds).order("created_at", { ascending: true });
      if (wm.error) {
        logFailure("review media", wm.error);
        return { ok: false, reason: "unavailable" };
      }
      const seqOf = new Map(messages.map((m) => [m.id, m.seq]));
      media = ((wm.data ?? []) as Row[]).map((m) => {
        const status = String(m.download_status);
        return {
          id: String(m.id),
          seq: seqOf.get(String(m.message_id)) ?? null,
          status,
          reason: str(m.status_reason),
          detectedMime: str(m.detected_mime_type),
          fileSize: num(m.file_size),
          previewable: ["validated", "attaching", "uploaded", "attached"].includes(status) && str(m.detected_mime_type) !== null,
        };
      });
    }
  }

  return {
    ok: true,
    data: {
      ...base,
      description: str(row.description),
      country: str(row.country),
      address: str(row.address),
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      priceNegotiable: typeof row.price_negotiable === "boolean" ? row.price_negotiable : null,
      landAreaSqm: num(row.land_area_sqm),
      bathrooms: num(row.bathrooms),
      floor: num(row.floor),
      totalFloors: num(row.total_floors),
      yearBuilt: num(row.year_built),
      features: strings(row.features),
      listingStatusChangedAt: str(row.listing_status_changed_at),
      reviewedAt: str(row.reviewed_at),
      reviewedBy: str(row.reviewed_by),
      extraction,
      messages,
      media,
      images: ((images.data ?? []) as Row[]).map((img) => ({
        id: String(img.id),
        url: adminImageUrl(String(img.id)),
        sortOrder: int(img.sort_order),
        width: num(img.width),
        height: num(img.height),
        fromWhatsApp: typeof img.media_id === "string",
      })),
      events: ((events.data ?? []) as Row[]).map((ev) => ({
        type: String(ev.event_type),
        severity: String(ev.severity),
        createdAt: String(ev.created_at),
        details: isRow(ev.details) ? ev.details : {},
      })),
    },
  };
}

export async function listMediaIssues(): Promise<AdminResult<MediaIssue[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const { data, error } = await db.from("admin_media_issues")
    .select("media_id, download_status, status_reason, failed_stage, download_attempts, validation_attempts, attach_attempts, download_deadline_at, updated_at, agency_name, agent_name, session_status, property_id, property_title")
    .order("updated_at", { ascending: false }).limit(300);
  if (error) {
    logFailure("media issues", error);
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    data: ((data ?? []) as Row[]).map((m) => ({
      mediaId: String(m.media_id),
      status: String(m.download_status),
      reason: str(m.status_reason),
      failedStage: str(m.failed_stage),
      attempts: { download: int(m.download_attempts), validation: int(m.validation_attempts), attach: int(m.attach_attempts) },
      deadline: str(m.download_deadline_at),
      updatedAt: String(m.updated_at),
      agencyName: str(m.agency_name),
      agentName: str(m.agent_name),
      sessionStatus: str(m.session_status),
      propertyId: str(m.property_id),
      propertyTitle: str(m.property_title),
      retryable: m.download_status === "failed",
    })),
  };
}

export async function listSubmissionIssues(): Promise<AdminResult<SubmissionIssue[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };
  const { data, error } = await db.from("admin_submission_issues")
    .select("session_id, session_status, close_reason, last_error, last_message_at, agency_name, agent_name, validation_status, validation_errors, conflict_count, extracted_at, property_id")
    .order("last_message_at", { ascending: false }).limit(200);
  if (error) {
    logFailure("submission issues", error);
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    data: ((data ?? []) as Row[]).map((s) => ({
      sessionId: String(s.session_id),
      sessionStatus: String(s.session_status),
      closeReason: str(s.close_reason),
      lastError: str(s.last_error),
      lastMessageAt: str(s.last_message_at),
      agencyName: str(s.agency_name),
      agentName: str(s.agent_name),
      validationStatus: str(s.validation_status),
      issues: mapIssues(s.validation_errors),
      conflictCount: int(s.conflict_count),
      extractedAt: str(s.extracted_at),
      propertyId: str(s.property_id),
    })),
  };
}
