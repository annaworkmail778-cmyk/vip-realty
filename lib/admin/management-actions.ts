"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminActorRef } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAdminT } from "@/lib/admin/i18n.server";
import type { AdminT } from "@/lib/admin/i18n";

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

const fieldLabel = (t: AdminT, field?: string) => (field ? t(FIELD_LABELS[field] ?? field) : t("This value"));

function failure(t: AdminT, result: Rpc | null, kind: "agency" | "agent" | "listing" | "images"): ActionState {
  const label = (f?: string) => fieldLabel(t, f);
  const field = typeof result?.field === "string" ? result.field : undefined;
  const reason = result?.reason;
  switch (result?.outcome) {
    case "stale":
      return { ok: false, message: t("Someone else changed this since you opened it. Reload the page and try again.") };
    case "not_found":
      return { ok: false, message: reason === "message" ? t("That message no longer exists.") : t("Not found.") };
    case "not_editable":
      return { ok: false, message: t("Legacy listings without an agency cannot be edited here.") };
    case "invalid_state":
      return { ok: false, message: t("This listing is closed ({status}); restore it to draft first.", { status: result.listing_status ?? "—" }) };
    case "blocked":
      return { ok: false, message: t("That change would break the publication rules, so nothing was saved.") };
    case "invalid_request":
      if (reason === "unknown_field" || reason === "field_not_editable") {
        return { ok: false, message: t("{field} cannot be changed here.", { field: label(field) }), field };
      }
      if (reason === "image_mismatch") return { ok: false, message: t("The photo list did not match this listing.") };
      if (reason === "identity_conflict") {
        return { ok: false, message: t("This agent is already linked to another WhatsApp sender.") };
      }
      if (reason === "identity_in_use") return { ok: false, message: t("Another agent is already linked to that WhatsApp sender.") };
      if (reason === "agency_mismatch" || reason === "channel_mismatch") return { ok: false, message: t("That message belongs to another agency.") };
      if (reason === "not_direct_message") return { ok: false, message: t("Only direct messages can be linked.") };
      if (reason === "identity_linked") return { ok: false, message: t("This person is already linked to an agent.") };
      if (reason === "no_identity") return { ok: false, message: t("That message carries no WhatsApp identity.") };
      return { ok: false, message: t("The request was not valid.") };
    case "invalid_value": {
      const f = label(field);
      const messages: Record<string, string> = {
        required: t("{field} is required.", { field: f }),
        type: t("{field} has the wrong format.", { field: f }),
        format: t("{field} has the wrong format.", { field: f }),
        placeholder: t("{field} still looks like a placeholder. Enter the agency's real value.", { field: f }),
        in_use: result?.other_agent
          ? t("{field} is already registered to {agent}.", { field: f, agent: result.other_agent })
          : t("{field} is already used by another record.", { field: f }),
        immutable: t("{field} cannot be changed after creation.", { field: f }),
        too_long: t("{field} is too long (max {max} characters).", { field: f, max: result?.max ?? "" }),
        whole_number: t("{field} must be a whole number.", { field: f }),
        out_of_range: t("{field} is out of range.", { field: f }),
        control_characters: t("{field} contains invalid characters.", { field: f }),
        constraint: t("{field} is not allowed by the database rules.", { field: f }),
        not_found: t("The selected agency no longer exists."),
        agency_inactive: t("That agency is inactive. Reactivate it first."),
        agent_has_history: t("This agent already has listings or messages, so their agency cannot change. Create a new agent instead."),
        has_published_listings: t("This agency still has {n} published listing(s). Unpublish them first.", { n: result?.count ?? "" }),
        site_agency_must_be_active: t("The website agency must stay active."),
        choose_another_site_agency: t("Make another agency the website agency instead."),
      };
      return { ok: false, message: messages[reason ?? ""] ?? t("{field} is not valid.", { field: f }), field };
    }
    default:
      return { ok: false, message: t(`The ${kind} could not be saved. Try again.`) };
  }
}

type Context =
  | { error: NonNullable<ActionState> }
  | { actor: string; db: NonNullable<ReturnType<typeof supabaseAdmin>>; t: AdminT };

async function context(): Promise<Context> {
  const { t } = await getAdminT();
  const actor = await adminActorRef();
  if (!actor) return { error: { ok: false, message: t("Your admin session has expired. Sign in again.") } };
  const db = supabaseAdmin();
  if (!db) return { error: { ok: false, message: t("Management is not configured on this server.") } };
  return { actor, db, t };
}

function refreshAdmin(paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

/* ------------------------------------------------------------------ agencies */
export async function saveAgencyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const { t } = ctx;
  const id = text(fd, "id");
  if (id !== "" && !UUID.test(id)) return { ok: false, message: t("Unknown agency.") };

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
    return { ok: false, message: t("The agency could not be saved. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "agency");

  refreshAdmin(["/admin/agency", "/admin/operations", "/", "/properties"]);
  if (id === "") redirect("/admin/agency");
  return { ok: true, message: result.outcome === "unchanged" ? t("No changes to save.") : t("Agency saved.") };
}

/* -------------------------------------------------------------------- agents */
export async function saveAgentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const { t } = ctx;
  const id = text(fd, "id");
  if (id !== "" && !UUID.test(id)) return { ok: false, message: t("Unknown agent.") };
  const agencyId = text(fd, "agency_id");
  if (agencyId !== "" && !UUID.test(agencyId)) return { ok: false, message: t("Unknown agency.") };

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
    return { ok: false, message: t("The agent could not be saved. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "agent");

  refreshAdmin(["/admin/agents", "/admin/operations", "/properties"]);
  if (id === "") redirect("/admin/agents");
  return { ok: true, message: result.outcome === "unchanged" ? t("No changes to save.") : t("Agent saved.") };
}

/** Registers a real WhatsApp identity from a stored message (never typed by hand). */
export async function linkIdentityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  const { t } = ctx;
  const agentId = text(fd, "agent_id");
  const messageId = text(fd, "message_id");
  if (!UUID.test(agentId) || !UUID.test(messageId)) return { ok: false, message: t("Choose an agent to link.") };

  const { data, error } = await ctx.db.rpc("admin_link_agent_identity", {
    p_agent_id: agentId,
    p_message_id: messageId,
    p_expected_updated_at: optional(fd, "updated_at"),
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] link identity failed", { code: error.code });
    return { ok: false, message: t("The identity could not be linked. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "agent");

  refreshAdmin(["/admin/agents", "/admin/operations"]);
  return {
    ok: true,
    message: result.outcome === "already"
      ? t("That sender was already linked to this agent.")
      : t("Linked. The agent's listings in the WhatsApp group are now recognised."),
  };
}

/** One-step agent creation: creates the agent, then (optionally) links the chosen group message's sender. */
export async function createAgentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  const { t } = ctx;
  const agencyId = text(fd, "agency_id");
  const messageId = text(fd, "message_id");
  if (!UUID.test(agencyId)) return { ok: false, message: t("Create an agency first — every agent belongs to one.") };
  if (messageId !== "" && !UUID.test(messageId)) return { ok: false, message: t("The request was not valid.") };
  if (text(fd, "phone") === "") return { ok: false, message: t("{field} is required.", { field: t("Phone") }), field: "phone" };

  const { data, error } = await ctx.db.rpc("admin_save_agent", {
    p_agent_id: null,
    p_values: { agency_id: agencyId, name: optional(fd, "name"), phone: optional(fd, "phone"), is_active: true },
    p_expected_updated_at: null,
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] create agent failed", { code: error.code });
    return { ok: false, message: t("The agent could not be saved. Try again.") };
  }
  const created = data as (Rpc & { agent_id?: string; updated_at?: string }) | null;
  if (!created?.ok || !created.agent_id) return failure(t, created, "agent");

  if (messageId !== "") {
    const linked = await ctx.db.rpc("admin_link_agent_identity", {
      p_agent_id: created.agent_id,
      p_message_id: messageId,
      p_expected_updated_at: created.updated_at ?? null,
      p_actor: ctx.actor,
    });
    const r = linked.data as Rpc | null;
    if (linked.error || !r?.ok) {
      if (linked.error) console.error("[admin] link after create failed", { code: linked.error.code });
      refreshAdmin(["/admin/agents", "/admin/operations"]);
      const why = linked.error ? t("Try again.") : failure(t, r, "agent")?.message ?? "";
      return { ok: false, message: t("The agent was created, but their WhatsApp could not be linked: {why} Link it on the Agents page.", { why }) };
    }
  }

  refreshAdmin(["/admin/agents", "/admin/operations"]);
  redirect("/admin/agents");
}

/** Detaches an agent's WhatsApp-group sender, e.g. a phone that changed hands or a test number. */
export async function unlinkIdentityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  const { t } = ctx;
  const identityId = text(fd, "identity_id");
  if (!UUID.test(identityId)) return { ok: false, message: t("The request was not valid.") };

  const { data, error } = await ctx.db.rpc("admin_unlink_agent_identity", {
    p_identity_id: identityId,
    p_expected_updated_at: optional(fd, "updated_at"),
    p_actor: ctx.actor,
    p_reason: "admin_unlinked",
  });
  if (error) {
    console.error("[admin] unlink identity failed", { code: error.code });
    return { ok: false, message: t("The action could not be completed. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "agent");
  refreshAdmin(["/admin/agents", "/admin/agents/new", `/admin/agents/${text(fd, "agent_id")}`, "/admin/operations"]);
  return { ok: true, message: t("Unlinked. Their group messages now appear under unrecognised senders.") };
}

/** Marks a group member as not an agent: their messages stop appearing as unrecognised. */
export async function dismissSenderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  const { t } = ctx;
  const messageId = text(fd, "message_id");
  if (!UUID.test(messageId)) return { ok: false, message: t("The request was not valid.") };

  const { data, error } = await ctx.db.rpc("admin_dismiss_sender", {
    p_message_id: messageId, p_actor: ctx.actor, p_reason: "not_an_agent",
  });
  if (error) {
    console.error("[admin] dismiss sender failed", { code: error.code });
    return { ok: false, message: t("The action could not be completed. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "agent");
  refreshAdmin(["/admin/agents", "/admin/agents/new", "/admin/operations"]);
  return { ok: true, message: t("Hidden. Messages from this person are no longer listed.") };
}

/* ------------------------------------------------------------- listing edits */
const LISTING_TEXT = ["title", "description", "city", "district", "address"] as const;
const LISTING_CODE = ["intent", "property_type", "currency", "price_period", "country"] as const;
const LISTING_NUMBER = ["price", "area_sqm", "land_area_sqm", "rooms", "bedrooms", "bathrooms", "floor",
  "total_floors", "year_built"] as const;

export async function updateListingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const { t } = ctx;
  const id = text(fd, "id");
  const version = Number(text(fd, "version"));
  if (!UUID.test(id) || !Number.isInteger(version)) return { ok: false, message: t("Unknown listing.") };

  const changes: Record<string, unknown> = {};
  for (const f of LISTING_TEXT) changes[f] = optional(fd, f);
  for (const f of LISTING_CODE) changes[f] = optional(fd, f);
  for (const f of LISTING_NUMBER) {
    const n = numeric(fd, f);
    if (n === undefined) return { ok: false, message: t("{field} must be a number.", { field: fieldLabel(t, f) }), field: f };
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
    return { ok: false, message: t("The listing could not be saved. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "listing");

  refreshAdmin(["/admin/properties", `/admin/properties/${id}`, `/admin/properties/${id}/edit`, "/properties", "/"]);
  if (result.outcome === "unchanged") return { ok: true, message: t("No changes to save.") };
  const count = Array.isArray(result.fields) ? result.fields.length : 0;
  return {
    ok: true,
    message: t("Saved {n} change(s).", { n: count })
      + (result.review_reset ? " " + t("The listing went back to pending review.") : ""),
  };
}

export async function arrangeImagesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;

  const { t } = ctx;
  const id = text(fd, "id");
  const version = Number(text(fd, "version"));
  const order = text(fd, "order").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const primary = text(fd, "primary");
  if (!UUID.test(id) || !Number.isInteger(version) || order.some((x) => !UUID.test(x))) {
    return { ok: false, message: t("The photo order was not valid.") };
  }
  if (primary !== "" && !UUID.test(primary)) return { ok: false, message: t("The cover photo was not valid.") };

  const { data, error } = await ctx.db.rpc("admin_arrange_property_images", {
    p_property_id: id,
    p_expected_version: version,
    p_image_ids: order,
    p_primary_image_id: primary === "" ? null : primary,
    p_actor: ctx.actor,
  });
  if (error) {
    console.error("[admin] arrange images failed", { code: error.code });
    return { ok: false, message: t("The photos could not be reordered. Try again.") };
  }
  const result = data as Rpc | null;
  if (!result?.ok) return failure(t, result, "images");

  refreshAdmin(["/admin/properties", `/admin/properties/${id}`, "/properties", "/"]);
  return { ok: true, message: result.outcome === "unchanged" ? t("Photos already in that order.") : t("Photo order saved.") };
}
