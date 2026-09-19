"use server";

import { revalidatePath } from "next/cache";
import { adminActorRef } from "@/lib/admin/auth";
import { BLOCKER_LABELS, label } from "@/lib/admin/labels";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* ----------------------------------------------------------------------------
   Admin mutations (server actions).

   Every action re-checks the admin session on the server, validates its
   inputs, and calls exactly one service-role database function. The database
   decides: publication rules, allowed transitions, ownership, idempotency and
   stale-state detection (the listing's state_version rendered into the form).
   The browser never supplies anything the database trusts beyond the listing
   id, the requested action and the version it was looking at.
---------------------------------------------------------------------------- */

export type ActionState = { ok: boolean; message: string; blockers?: string[] } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const version = (fd: FormData) => {
  const n = Number(text(fd, "version"));
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Rpc = { ok?: boolean; outcome?: string; reason?: string; blockers?: unknown; listing_status?: string; slug?: string };

type Context =
  | { error: NonNullable<ActionState> }
  | { actor: string; id: string; db: NonNullable<ReturnType<typeof supabaseAdmin>> };

async function context(fd: FormData, idField = "id"): Promise<Context> {
  const actor = await adminActorRef();
  if (!actor) return { error: { ok: false, message: "Your admin session has expired. Sign in again." } };
  const id = text(fd, idField);
  if (!UUID.test(id)) return { error: { ok: false, message: "Unknown listing." } };
  const db = supabaseAdmin();
  if (!db) return { error: { ok: false, message: "Listing management is not configured on this server." } };
  return { actor, id, db };
}

function failure(result: Rpc | null): ActionState {
  const outcome = result?.outcome ?? "error";
  const blockers = Array.isArray(result?.blockers) ? result!.blockers.filter((b): b is string => typeof b === "string") : [];
  const message: Record<string, string> = {
    stale: "This listing changed since you opened it. The page has been refreshed — review it again.",
    not_found: "Listing not found.",
    not_reviewable: "Legacy listings without an agency cannot be reviewed or published here.",
    invalid_state: `Only drafts can be reviewed (this listing is ${result?.listing_status ?? "not a draft"}).`,
    invalid_transition: `That change is not allowed from the current status (${result?.listing_status ?? "unknown"}).`,
    blocked: "Cannot publish yet: " + (blockers.map((b) => label(BLOCKER_LABELS, b)).join("; ") || "requirements not met") + ".",
    invalid_request: result?.reason === "reason_required"
      ? "A rejection needs a reason (3–500 characters)."
      : "The request was not valid.",
    not_requeueable: "Only failed media can be retried.",
    expired: "The WhatsApp download window has passed; this media can no longer be retried.",
  };
  return { ok: false, message: message[outcome] ?? "The action could not be completed. Try again.", blockers };
}

function refresh(id?: string) {
  revalidatePath("/admin/properties");
  revalidatePath("/admin/pipeline");
  if (id) revalidatePath(`/admin/properties/${id}`);
}

export async function reviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context(fd);
  if ("error" in ctx) return ctx.error;
  const decision = text(fd, "decision");
  if (decision !== "approve" && decision !== "reject") return { ok: false, message: "Unknown decision." };
  const reason = text(fd, "reason");
  if (decision === "reject" && (reason.length < 3 || reason.length > 500)) {
    return { ok: false, message: "A rejection needs a reason (3–500 characters)." };
  }

  const { data, error } = await ctx.db.rpc("admin_review_property", {
    p_property_id: ctx.id, p_decision: decision, p_reason: decision === "reject" ? reason : null,
    p_expected_version: version(fd), p_actor: ctx.actor,
  });
  refresh(ctx.id);
  if (error) {
    console.error("[admin] review failed", { code: error.code });
    return { ok: false, message: "The database could not be reached. Try again." };
  }
  const r = data as Rpc;
  if (!r?.ok) return failure(r);
  return { ok: true, message: r.outcome === "already" ? "Already " + (decision === "approve" ? "approved" : "rejected") + "." : decision === "approve" ? "Approved." : "Rejected." };
}

export async function publishAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context(fd);
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.db.rpc("admin_publish_property", {
    p_property_id: ctx.id, p_expected_version: version(fd), p_actor: ctx.actor,
  });
  refresh(ctx.id);
  if (error) {
    console.error("[admin] publish failed", { code: error.code });
    return { ok: false, message: "The database could not be reached. Try again." };
  }
  const r = data as Rpc;
  if (!r?.ok) return failure(r);
  if (r.slug) revalidatePath(`/properties/${r.slug}`);
  return { ok: true, message: r.outcome === "already" ? "Already published." : "Published — it is live on the website now." };
}

const TARGETS = ["sold", "rented", "archived", "draft"] as const;

export async function statusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context(fd);
  if ("error" in ctx) return ctx.error;
  const target = text(fd, "target");
  if (!(TARGETS as readonly string[]).includes(target)) return { ok: false, message: "Unknown status." };

  const { data, error } = await ctx.db.rpc("admin_set_listing_status", {
    p_property_id: ctx.id, p_target: target, p_expected_version: version(fd), p_actor: ctx.actor,
    p_reason: text(fd, "reason").slice(0, 500) || null,
  });
  refresh(ctx.id);
  if (error) {
    console.error("[admin] status change failed", { code: error.code });
    return { ok: false, message: "The database could not be reached. Try again." };
  }
  const r = data as Rpc;
  if (!r?.ok) return failure(r);
  return { ok: true, message: r.outcome === "already" ? `Already ${target}.` : `Status changed to ${target}.` };
}

export async function retryMediaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await context(fd, "media_id");
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.db.rpc("request_media_reprocessing", {
    p_media_id: ctx.id, p_reason: `retry requested by ${ctx.actor}`,
  });
  refresh();
  if (error) {
    console.error("[admin] media retry failed", { code: error.code });
    return { ok: false, message: "The database could not be reached. Try again." };
  }
  const r = data as Rpc;
  if (!r?.ok) return failure(r);
  return { ok: true, message: "Queued for another attempt. The media worker picks it up on its next run." };
}
