"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminActorRef } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* ----------------------------------------------------------------------------
   Admin writes for agencies, agents, listing content and gallery order.

   Same contract as Phase 8's lifecycle actions: the server re-checks the admin
   session, builds a value object from a FIXED whitelist of form fields (nothing
   the browser sends can name another column), and calls exactly one database
   function. The database validates, enforces ownership and publication rules,
   detects stale edits (state_version / updated_at) and writes the audit event.
---------------------------------------------------------------------------- */

export type ActionState = { ok: boolean; message: string; field?: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const optional = (fd: FormData, name: string) => (text(fd, name) === "" ? null : text(fd, name));
const checkbox = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "true";

/** "12.5" -> 12.5, "" -> null, anything else -> undefined (reported as invalid). */
const numeric = (fd: FormData, name: string): number | null | undefined => {
  const raw = text(fd, name);
  if (raw === "") return null;
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

type Rpc = { ok?: boolean; outcome?: string; reason?: string; field?: string; other_agent?: string; max?: number;
             count?: number; blockers?: unknown; fields?: unknown; review_reset?: boolean; listing_status?: string };

const FIELD_LABELS: Record<string, string> = {
  name: "Name", slug: "Slug", display_name: "Public display name", legal_name: "Legal name",
  public_phone: "Public phone", public_whatsapp: "Public WhatsApp number", public_email: "Public email",
  office_address: "Office address", office_hours: "Opening hours", whatsapp_phone_number_id: "WhatsApp number id",
  is_active: "Active", is_site_primary: "Website agency", agency_id: "Agency", whatsapp_user_id: "WhatsApp user id",
  whatsapp_phone: "WhatsApp phone", phone: "Phone", email: "Email", title: "Title", description: "Description",
  intent: "Listing intent", property_type: "Property type", price: "Price", currency: "Currency",
  price_period: "Price period", area_sqm: "Area", land_area_sqm: "Land area", rooms: "Rooms", bedrooms: "Bedrooms",
  bathrooms: "Bathrooms", floor: "Floor", total_floors: "Total floors", year_built: "Year built", city: "City",
  district: "District", address: "Address", features: "Features", country: "Country", publication: "Publication rules",
};

const label = (field?: string) => (field ? FIELD_LABELS[field] ?? field : "This value");

function failure(result: Rpc | null, kind: "agency" | "agent" | "listing" | "images"): ActionState {
  const field = typeof result?.field === "string" ? result.field : undefined;
  const reason = result?.reason;
  switch (result?.outcome) {
    case "stale":
      return { ok: false, message: "Someone else changed this since you opened it. Reload the page and try again." };
    case "not_found":
      return { ok: false, message: reason === "message" ? "That message no longer exists." : "Not found." };
    case "not_editable":
      return { ok: false, message: "Legacy listings without an agency cannot be edited here." };
    case "invalid_state":
      return { ok: false, message: `This listing is ${result.listing_status ?? "closed"}; restore it to draft first.` };
    case "blocked":
      return { ok: false, message: "That change would break the publication rules, so nothing was saved." };
    case "invalid_request":
      if (reason === "unknown_field" || reason === "field_not_editable") {
        return { ok: false, message: `${label(field)} cannot be changed here.`, field };
      }
      if (reason === "image_mismatch") return { ok: false, message: "The photo list did not match this listing." };
      if (reason === "identity_conflict") {
        return { ok: false, message: "That identity conflicts with the one already registered for this agent." };
      }
      if (reason === "identity_in_use") return { ok: false, message: "Another agent already uses that identity." };
      if (reason === "agency_mismatch") return { ok: false, message: "That message belongs to another agency." };
      if (reason === "not_direct_message") return { ok: false, message: "Only direct messages can be linked." };
      if (reason === "no_identity") return { ok: false, message: "That message carries no WhatsApp identity." };
      return { ok: false, message: "The request was not valid." };
    case "invalid_value": {
      const messages: Record<string, string> = {
        required: `${label(field)} is required.`,
        type: `${label(field)} has the wrong format.`,
        format: `${label(field)} has the wrong format.`,
        placeholder: `${label(field)} still looks like a placeholder. Enter the agency's real value.`,
        in_use: result?.other_agent
          ? `${label(field)} is already registered to ${result.other_agent}.`
          : `${label(field)} is already used by another record.`,
        immutable: `${label(field)} cannot be changed after creation.`,
        too_long: `${label(field)} is too long (max ${result?.max ?? ""} characters).`,
        whole_number: `${label(field)} must be a whole number.`,
        out_of_range: `${label(field)} is out of range.`,
        control_characters: `${label(field)} contains invalid characters.`,
        constraint: `${label(field)} is not allowed by the database rules.`,
        not_found: "The selected agency no longer exists.",
        agency_inactive: "That agency is inactive. Reactivate it first.",
        agent_has_history: "This agent already has listings or messages, so their agency cannot change. Create a new agent instead.",
        has_published_listings: `This agency still has ${result?.count ?? "published"} published listing(s). Unpublish them first.`,
        site_agency_must_be_active: "The website agency must stay active.",
        choose_another_site_agency: "Make another agency the website agency instead.",
      };
      return { ok: false, message: messages[reason ?? ""] ?? `${label(field)} is not valid.`, field };
    }
    default:
      return { ok: false, message: `The ${kind} could not be saved. Try again.` };
  }
}

type Context =
  | { error: NonNullable<ActionState> }
  | { actor: string; db: NonNullable<ReturnType<typeof supabaseAdmin>> };

async function context(): Promise<Context> {
  const actor = await adminActorRef();
  if (!actor) return { error: { ok: false, message: "Your admin session has expired. Sign in again." } };
  const db = supabaseAdmin();
  if (!db) return { error: { ok: false, message: "Management is not configured on this server." } };
  return { actor, db };
}

function refreshAdmin(paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

/* ------------------------------------------------------------------ agencies */
export async function saveAgencyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const id = text(fd, "id");
  if (id !== "" && !UUID.test(id)) return { ok: false, message: "Unknown agency." };

  const values: Record<string, unknown> = {
    name: optional(fd, "name"),
    display_name: optional(fd, "display_name"),
    legal_name: optional(fd, "legal_name"),
    public_phone: optional(fd, "public_phone"),
    public_whatsapp: optional(fd, "public_whatsapp"),
    public_email: optional(fd, "public_email"),
    office_address: optional(fd, "office_address"),
    office_hours: optional(fd, "office_hours"),
    whatsapp_phone_number_id: optional(fd, "whatsapp_phone_number_id"),
    is_active: checkbox(fd, "is_active"),
  };
  // Only ever set the website agency, never unset it from this form.
  if (checkbox(fd, "is_site_primary")) values.is_site_primary = true;
  if (id === "") values.slug = optional(fd, "slug");

  const { data, error } = await ctx.db.rpc("admin_save_agency", {
    p_agency_id: id === "" ? null : id,
    p_values: values,
    p_expected_updated_at: optional(fd, "updated_at"),
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] save agency failed", { code: error.code });
    return { ok: false, message: "The agency could not be saved. Try again." };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(result, "agency");

  refreshAdmin(["/admin/agency", "/admin/operations", "/", "/properties"]);
  if (id === "") redirect("/admin/agency");
  return { ok: true, message: result.outcome === "unchanged" ? "No changes to save." : "Agency saved." };
}

/* -------------------------------------------------------------------- agents */
export async function saveAgentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const id = text(fd, "id");
  if (id !== "" && !UUID.test(id)) return { ok: false, message: "Unknown agent." };
  const agencyId = text(fd, "agency_id");
  if (agencyId !== "" && !UUID.test(agencyId)) return { ok: false, message: "Unknown agency." };

  const values: Record<string, unknown> = {
    name: optional(fd, "name"),
    whatsapp_user_id: optional(fd, "whatsapp_user_id"),
    whatsapp_phone: optional(fd, "whatsapp_phone"),
    phone: optional(fd, "phone"),
    email: optional(fd, "email"),
    is_active: checkbox(fd, "is_active"),
  };
  if (agencyId !== "") values.agency_id = agencyId;

  const { data, error } = await ctx.db.rpc("admin_save_agent", {
    p_agent_id: id === "" ? null : id,
    p_values: values,
    p_expected_updated_at: optional(fd, "updated_at"),
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] save agent failed", { code: error.code });
    return { ok: false, message: "The agent could not be saved. Try again." };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(result, "agent");

  refreshAdmin(["/admin/agents", "/admin/operations"]);
  if (id === "") redirect("/admin/agents");
  return { ok: true, message: result.outcome === "unchanged" ? "No changes to save." : "Agent saved." };
}

/** Registers a real WhatsApp identity from a stored message (never typed by hand). */
export async function linkIdentityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  const agentId = text(fd, "agent_id");
  const messageId = text(fd, "message_id");
  if (!UUID.test(agentId) || !UUID.test(messageId)) return { ok: false, message: "Choose an agent to link." };

  const { data, error } = await ctx.db.rpc("admin_link_agent_identity", {
    p_agent_id: agentId,
    p_message_id: messageId,
    p_expected_updated_at: optional(fd, "updated_at"),
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] link identity failed", { code: error.code });
    return { ok: false, message: "The identity could not be linked. Try again." };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(result, "agent");

  refreshAdmin(["/admin/agents", "/admin/operations"]);
  return {
    ok: true,
    message: result.outcome === "already"
      ? "That identity was already registered for this agent."
      : "Identity registered. The agent's next message will be recognised.",
  };
}

/* ------------------------------------------------------------- listing edits */
const LISTING_TEXT = ["title", "description", "city", "district", "address"] as const;
const LISTING_CODE = ["intent", "property_type", "currency", "price_period", "country"] as const;
const LISTING_NUMBER = ["price", "area_sqm", "land_area_sqm", "rooms", "bedrooms", "bathrooms", "floor",
  "total_floors", "year_built"] as const;

export async function updateListingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const id = text(fd, "id");
  const version = Number(text(fd, "version"));
  if (!UUID.test(id) || !Number.isInteger(version)) return { ok: false, message: "Unknown listing." };

  const changes: Record<string, unknown> = {};
  for (const f of LISTING_TEXT) changes[f] = optional(fd, f);
  for (const f of LISTING_CODE) changes[f] = optional(fd, f);
  for (const f of LISTING_NUMBER) {
    const n = numeric(fd, f);
    if (n === undefined) return { ok: false, message: `${label(f)} must be a number.`, field: f };
    changes[f] = n;
  }
  const negotiable = text(fd, "price_negotiable");
  changes.price_negotiable = negotiable === "" ? null : negotiable === "yes";
  changes.features = text(fd, "features")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((s) => s !== "");

  const { data, error } = await ctx.db.rpc("admin_update_property", {
    p_property_id: id,
    p_expected_version: version,
    p_changes: changes,
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] listing edit failed", { code: error.code });
    return { ok: false, message: "The listing could not be saved. Try again." };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(result, "listing");

  refreshAdmin(["/admin/properties", `/admin/properties/${id}`, `/admin/properties/${id}/edit`, "/properties", "/"]);
  if (result.outcome === "unchanged") return { ok: true, message: "No changes to save." };
  const count = Array.isArray(result.fields) ? result.fields.length : 0;
  return {
    ok: true,
    message: `Saved ${count} change${count === 1 ? "" : "s"}.`
      + (result.review_reset ? " The listing went back to pending review." : ""),
  };
}

export async function arrangeImagesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const id = text(fd, "id");
  const version = Number(text(fd, "version"));
  const order = text(fd, "order").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const primary = text(fd, "primary");
  if (!UUID.test(id) || !Number.isInteger(version) || order.some((x) => !UUID.test(x))) {
    return { ok: false, message: "The photo order was not valid." };
  }
  if (primary !== "" && !UUID.test(primary)) return { ok: false, message: "The cover photo was not valid." };

  const { data, error } = await ctx.db.rpc("admin_arrange_property_images", {
    p_property_id: id,
    p_expected_version: version,
    p_image_ids: order,
    p_primary_image_id: primary === "" ? null : primary,
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] arrange images failed", { code: error.code });
    return { ok: false, message: "The photos could not be reordered. Try again." };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(result, "images");

  refreshAdmin(["/admin/properties", `/admin/properties/${id}`, "/properties", "/"]);
  return { ok: true, message: result.outcome === "unchanged" ? "Photos already in that order." : "Photo order saved." };
}
