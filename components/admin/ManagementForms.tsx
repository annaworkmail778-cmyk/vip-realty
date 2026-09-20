"use client";

import { useActionState, useState } from "react";
import { Field, Result, Select, Submit, TextArea, Toggle } from "@/components/admin/forms";
import {
  arrangeImagesAction, linkIdentityAction, saveAgencyAction, saveAgentAction, updateListingAction,
} from "@/lib/admin/management-actions";
import type { AgencyRow, AgentRow, UnlinkedSender } from "@/lib/admin/management";

/* ----------------------------------------------------------------------------
   Agency, agent, identity-link, listing-edit and gallery-order forms.

   Every form posts to a server action which re-checks the session and calls one
   database function. The hidden id / version / updated_at fields are NOT
   authorization — they say which record and which version the operator was
   looking at, and the database refuses anything stale.
---------------------------------------------------------------------------- */

export function AgencyForm({ agency }: { agency?: AgencyRow }) {
  const [state, action] = useActionState(saveAgencyAction, null);
  const isNew = !agency;

  return (
    <form action={action} className="max-w-2xl space-y-8">
      {agency && <input type="hidden" name="id" value={agency.id} />}
      {agency && <input type="hidden" name="updated_at" value={agency.updatedAt} />}

      <section className="space-y-5">
        <h2 className="label text-ivory/40">Agency</h2>
        <Field label="Internal name" name="name" defaultValue={agency?.name} required maxLength={160}
               hint="Used in the admin only." />
        {isNew && <Field label="Slug" name="slug" placeholder="left blank: generated from the name" maxLength={60}
                         hint="Permanent; cannot be changed later." />}
        <Toggle label="Active" name="is_active" defaultChecked={agency?.isActive ?? true}
                hint="Inactive: inbound WhatsApp is stored but never processed, and nothing new can be published." />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">Public profile (shown on the website)</h2>
        <Field label="Display name (brand)" name="display_name" defaultValue={agency?.displayName} maxLength={80}
               hint="Drives the logo, page titles and every mention of the agency on the site." />
        <Field label="Legal name" name="legal_name" defaultValue={agency?.legalName} maxLength={160}
               hint="Footer copyright line. Falls back to the display name." />
        <Field label="Public phone" name="public_phone" defaultValue={agency?.publicPhone} placeholder="+374 …"
               hint="International format. Shown as the Call action." />
        <Field label="Public WhatsApp number" name="public_whatsapp" defaultValue={agency?.publicWhatsapp}
               placeholder="+374 …" hint="International format. Used for the WhatsApp button on listings." />
        <Field label="Public email" name="public_email" type="email" defaultValue={agency?.publicEmail} maxLength={254} />
        <Field label="Office address" name="office_address" defaultValue={agency?.officeAddress} maxLength={200} />
        <Field label="Opening hours" name="office_hours" defaultValue={agency?.officeHours} maxLength={120}
               placeholder="Mon – Sat · 10:00 – 19:00" />
        <Toggle label="This is the website agency" name="is_site_primary" defaultChecked={agency?.isSitePrimary ?? isNew}
                hint="Exactly one agency provides the site's brand and contact details. Ticking this moves it here." />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">WhatsApp routing</h2>
        <Field label="WhatsApp Business number id" name="whatsapp_phone_number_id"
               defaultValue={agency?.whatsappPhoneNumberId} maxLength={30}
               hint="Meta's phone_number_id for this agency's business number (digits). Inbound messages are routed by it. Not a credential." />
      </section>

      <div className="flex items-center gap-4">
        <Submit>{isNew ? "Create agency" : "Save agency"}</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

export function AgentForm({ agent, agencies }: { agent?: AgentRow; agencies: AgencyRow[] }) {
  const [state, action] = useActionState(saveAgentAction, null);
  const isNew = !agent;
  const options = agencies.map((a) => ({ value: a.id, label: `${a.name}${a.isActive ? "" : " (inactive)"}` }));

  return (
    <form action={action} className="max-w-2xl space-y-8">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      {agent && <input type="hidden" name="updated_at" value={agent.updatedAt} />}

      <section className="space-y-5">
        <Field label="Name" name="name" defaultValue={agent?.name} required maxLength={160} />
        {isNew ? (
          <Select label="Agency" name="agency_id" options={[{ value: "", label: "Choose an agency" }, ...options]} />
        ) : agent?.hasHistory ? (
          <div>
            <p className="label text-ivory/40">Agency</p>
            <p className="mt-2 text-[0.9rem] text-ivory/85">{agent.agencyName}</p>
            <p className="label mt-1.5 text-[0.6rem] text-ivory/30">
              This agent already has listings or messages, so their agency is fixed. Create a new agent for another agency.
            </p>
          </div>
        ) : (
          <Select label="Agency" name="agency_id" defaultValue={agent?.agencyId} options={options}
                  hint="Can still be corrected: this agent has no listings or messages yet." />
        )}
        <Toggle label="Active" name="is_active" defaultChecked={agent?.isActive ?? true}
                hint="Inactive: their messages are stored but create nothing, and their status commands are ignored. Existing listings stay as they are." />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">WhatsApp identity</h2>
        <Field label="WhatsApp user id (BSUID)" name="whatsapp_user_id" defaultValue={agent?.whatsappUserId}
               placeholder="AM.xxxxxxxx" maxLength={140}
               hint="Preferred identity. Read it from an unregistered sender below rather than typing it." />
        <Field label="WhatsApp phone" name="whatsapp_phone" defaultValue={agent?.whatsappPhone} placeholder="+374 …"
               hint="Fallback identity, used only until a user id is known." />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">Internal contact (never shown publicly)</h2>
        <Field label="Phone" name="phone" defaultValue={agent?.phone} placeholder="+374 …" />
        <Field label="Email" name="email" type="email" defaultValue={agent?.email} maxLength={254} />
      </section>

      <div className="flex items-center gap-4">
        <Submit>{isNew ? "Create agent" : "Save agent"}</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Registers the identity of a stored message on an agent — no BSUID is ever typed by hand. */
export function LinkIdentityForm({ sender, agents }: { sender: UnlinkedSender; agents: AgentRow[] }) {
  const [state, action] = useActionState(linkIdentityAction, null);
  const candidates = agents.filter((a) => a.agencyId === sender.agencyId);
  const suggested = sender.suggestedAgentId ?? "";
  const [agentId, setAgentId] = useState(
    candidates.find((a) => a.id === suggested)?.id ?? candidates[0]?.id ?? "");
  // the version token must follow the selected agent, not the one first rendered
  const chosen = candidates.find((a) => a.id === agentId);

  if (candidates.length === 0) {
    return <p className="label text-ivory/30">No agents in {sender.agencyName} yet.</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="message_id" value={sender.messageId} />
      <input type="hidden" name="updated_at" value={chosen?.updatedAt ?? ""} />
      <label className="block">
        <span className="label text-ivory/40">Register to</span>
        <select
          name="agent_id"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="mt-2 border border-ivory/15 bg-transparent px-3 py-2 text-[0.85rem] text-ivory outline-none focus:border-champagne"
        >
          {candidates.map((a) => (
            <option key={a.id} value={a.id} className="bg-ink text-ivory">
              {a.name}{a.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </label>
      <Submit tone="default">Register identity</Submit>
      <Result state={state} />
    </form>
  );
}

export interface EditableListing {
  id: string;
  stateVersion: number;
  title: string | null;
  description: string | null;
  intent: string | null;
  propertyType: string | null;
  price: number | null;
  currency: string | null;
  pricePeriod: string | null;
  priceNegotiable: boolean | null;
  areaSqm: number | null;
  landAreaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  country: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  features: string[];
  listingStatus: string;
  reviewStatus: string | null;
}

const PROPERTY_TYPES = ["apartment", "penthouse", "house", "villa", "townhouse", "commercial", "office", "retail",
  "warehouse", "land", "garage", "other"];

const options = (values: string[], blank: string) =>
  [{ value: "", label: blank }, ...values.map((v) => ({ value: v, label: v }))];

export function ListingEditForm({ listing }: { listing: EditableListing }) {
  const [state, action] = useActionState(updateListingAction, null);
  const approved = listing.listingStatus === "draft" && listing.reviewStatus === "approved";

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="id" value={listing.id} />
      <input type="hidden" name="version" value={listing.stateVersion} />

      {listing.listingStatus === "published" ? (
        <p className="border border-champagne/30 bg-champagne/5 p-4 text-[0.85rem] text-ivory/80">
          This listing is live. Changes appear on the website immediately; anything that would break the publication
          rules is refused and nothing is saved.
        </p>
      ) : approved ? (
        <p className="border border-ivory/15 p-4 text-[0.85rem] text-ivory/70">
          This draft is approved. Saving a change returns it to pending review.
        </p>
      ) : null}

      <section className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" name="title" defaultValue={listing.title} maxLength={160} />
        </div>
        <Select label="Intent" name="intent" defaultValue={listing.intent} options={options(["buy", "rent"], "—")} />
        <Select label="Property type" name="property_type" defaultValue={listing.propertyType}
                options={options(PROPERTY_TYPES, "—")} />
        <Field label="Price" name="price" defaultValue={listing.price} step="any" />
        <Select label="Currency" name="currency" defaultValue={listing.currency}
                options={options(["USD", "AMD", "EUR", "RUB"], "—")} />
        <Select label="Price period (rentals)" name="price_period" defaultValue={listing.pricePeriod}
                options={options(["month", "day", "year"], "—")} />
        <Select label="Price negotiable" name="price_negotiable"
                defaultValue={listing.priceNegotiable === null ? "" : listing.priceNegotiable ? "yes" : "no"}
                options={[{ value: "", label: "—" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <h2 className="label text-ivory/40 sm:col-span-2">Location</h2>
        <Field label="City" name="city" defaultValue={listing.city} maxLength={80} />
        <Field label="District" name="district" defaultValue={listing.district} maxLength={80} />
        <Field label="Country (2 letters)" name="country" defaultValue={listing.country} maxLength={2}
               placeholder="AM" />
        <Field label="Address (never shown publicly)" name="address" defaultValue={listing.address} maxLength={200} />
      </section>

      <section className="grid gap-5 sm:grid-cols-3">
        <h2 className="label text-ivory/40 sm:col-span-3">Size</h2>
        <Field label="Area (m²)" name="area_sqm" defaultValue={listing.areaSqm} step="any" />
        <Field label="Land area (m²)" name="land_area_sqm" defaultValue={listing.landAreaSqm} step="any" />
        <Field label="Rooms" name="rooms" defaultValue={listing.rooms} />
        <Field label="Bedrooms" name="bedrooms" defaultValue={listing.bedrooms} />
        <Field label="Bathrooms" name="bathrooms" defaultValue={listing.bathrooms} />
        <Field label="Floor" name="floor" defaultValue={listing.floor} />
        <Field label="Total floors" name="total_floors" defaultValue={listing.totalFloors} />
        <Field label="Year built" name="year_built" defaultValue={listing.yearBuilt} />
      </section>

      <section className="space-y-5">
        <TextArea label="Description" name="description" defaultValue={listing.description} rows={8} maxLength={5000} />
        <Field label="Features" name="features" defaultValue={listing.features.join(", ")}
               hint="Comma separated, e.g. parking, balcony, lift. Spaces become underscores." />
      </section>

      <div className="flex items-center gap-4">
        <Submit>Save changes</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Gallery order and cover photo. Only this listing's own photos can be sent. */
export function ImageArranger({
  propertyId, version, images,
}: { propertyId: string; version: number; images: { id: string; url: string; isPrimary: boolean }[] }) {
  const [state, action] = useActionState(arrangeImagesAction, null);
  const [order, setOrder] = useState(images.map((i) => i.id));
  const [primary, setPrimary] = useState(images.find((i) => i.isPrimary)?.id ?? "");
  const byId = new Map(images.map((i) => [i.id, i]));

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  if (images.length === 0) return null;

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="id" value={propertyId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="order" value={order.join(",")} />
      <input type="hidden" name="primary" value={primary} />

      <ul className="space-y-2">
        {order.map((id, index) => {
          const img = byId.get(id);
          if (!img) return null;
          return (
            <li key={id} className="flex items-center gap-3 border border-ivory/10 bg-ink p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated admin route */}
              <img src={img.url} alt="" className="h-12 w-16 shrink-0 object-cover" loading="lazy" />
              <span className="label text-ivory/40">#{index + 1}</span>
              <label className="label flex items-center gap-2 text-ivory/60">
                <input type="radio" checked={primary === id} onChange={() => setPrimary(id)}
                       className="accent-champagne" />
                Cover
              </label>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                        className="label border border-ivory/20 px-2 py-1 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1}
                        className="label border border-ivory/20 px-2 py-1 disabled:opacity-30">↓</button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4"><Submit tone="default">Save photo order</Submit></div>
      <Result state={state} />
    </form>
  );
}
