"use client";

import { useActionState, useState } from "react";
import { Field, Result, Select, Submit, TextArea, Toggle } from "@/components/admin/forms";
import {
  arrangeImagesAction, createAgentAction, dismissSenderAction, linkIdentityAction, unlinkIdentityAction, saveAgencyAction, saveAgentAction, updateListingAction,
} from "@/lib/admin/management-actions";
import type { AgencyRow, AgentRow, UnlinkedSender } from "@/lib/admin/management";
import { useAdminT } from "@/components/admin/AdminI18n";
import { code } from "@/lib/admin/i18n";

/* ----------------------------------------------------------------------------
   Agency, agent, identity-link, listing-edit and gallery-order forms.

   Every form posts to a server action which re-checks the session and calls one
   database function. The hidden id / version / updated_at fields are NOT
   authorization — they say which record and which version the operator was
   looking at, and the database refuses anything stale.
---------------------------------------------------------------------------- */

export function AgencyForm({ agency }: { agency?: AgencyRow }) {
  const [state, action] = useActionState(saveAgencyAction, null);
  const { t } = useAdminT();
  const isNew = !agency;

  return (
    <form action={action} className="max-w-2xl space-y-8">
      {agency && <input type="hidden" name="id" value={agency.id} />}
      {agency && <input type="hidden" name="updated_at" value={agency.updatedAt} />}

      <section className="space-y-5">
        <h2 className="label text-ivory/40">{t("Agency")}</h2>
        <Field label={t("Internal name")} name="name" defaultValue={agency?.name} required maxLength={160}
               hint={t("Used in the admin only.")} />
        {isNew && <Field label={t("Slug")} name="slug" placeholder={t("left blank: generated from the name")} maxLength={60}
                         hint={t("Permanent; cannot be changed later.")} />}
        <Toggle label={t("Active")} name="is_active" defaultChecked={agency?.isActive ?? true}
                hint={t("Inactive: inbound WhatsApp is stored but never processed, and nothing new can be published.")} />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">{t("Public profile (shown on the website)")}</h2>
        <Field label={t("Display name (brand)")} name="display_name" defaultValue={agency?.displayName} maxLength={80}
               hint={t("Drives the logo, page titles and every mention of the agency on the site.")} />
        <Field label={t("Legal name")} name="legal_name" defaultValue={agency?.legalName} maxLength={160}
               hint={t("Footer copyright line. Falls back to the display name.")} />
        <Field label={t("Public phone")} name="public_phone" defaultValue={agency?.publicPhone} placeholder="+374 …"
               hint={t("International format. Shown as the Call action.")} />
        <Field label={t("Public WhatsApp number")} name="public_whatsapp" defaultValue={agency?.publicWhatsapp}
               placeholder="+374 …" hint={t("International format. Used for the WhatsApp button.")} />
        <Field label={t("Public email")} name="public_email" type="email" defaultValue={agency?.publicEmail} maxLength={254} />
        <Field label={t("Office address")} name="office_address" defaultValue={agency?.officeAddress} maxLength={200} />
        <Field label={t("Opening hours")} name="office_hours" defaultValue={agency?.officeHours} maxLength={120}
               placeholder="Mon – Sat · 10:00 – 19:00" />
        <Toggle label={t("This is the website agency")} name="is_site_primary" defaultChecked={agency?.isSitePrimary ?? isNew}
                hint={t("Exactly one agency provides the site's brand and contact details. Ticking this moves it here.")} />
      </section>

      <section className="space-y-5">
        <h2 className="label text-ivory/40">{t("WhatsApp Cloud API (optional)")}</h2>
        <Field label={t("WhatsApp Business number id")} name="whatsapp_phone_number_id"
               defaultValue={agency?.whatsappPhoneNumberId} maxLength={30}
               hint={t("Only for the official WhatsApp Cloud API. The WhatsApp group automation does not use it.")} />
      </section>

      <div className="flex items-center gap-4">
        <Submit>{isNew ? t("Create agency") : t("Save agency")}</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

export function AgentForm({ agent, agencies }: { agent: AgentRow; agencies: AgencyRow[] }) {
  const [state, action] = useActionState(saveAgentAction, null);
  const { t } = useAdminT();
  const options = agencies.map((a) => ({ value: a.id, label: `${a.name}${a.isActive ? "" : ` (${t("inactive")})`}` }));

  return (
    <form action={action} className="max-w-2xl space-y-8">
      <input type="hidden" name="id" value={agent.id} />
      <input type="hidden" name="updated_at" value={agent.updatedAt} />

      <section className="space-y-5">
        <Field label={t("Name")} name="name" defaultValue={agent.name} required maxLength={160}
               hint={t("Shown on the website next to their listings.")} />
        <Field label={t("Phone shown on listings")} name="phone" defaultValue={agent.phone} placeholder="+374 …"
               hint={t("Visitors call and WhatsApp this number from the agent's listings.")} />
        <Toggle label={t("Active")} name="is_active" defaultChecked={agent.isActive}
                hint={t("Inactive: their WhatsApp messages create nothing. Existing listings stay as they are.")} />
      </section>

      {agencies.length > 1 && (
        agent.hasHistory ? (
          <div>
            <p className="label text-ivory/40">{t("Agency")}</p>
            <p className="mt-2 text-[0.9rem] text-ivory/85">{agent.agencyName}</p>
          </div>
        ) : (
          <Select label={t("Agency")} name="agency_id" defaultValue={agent.agencyId} options={options} />
        )
      )}

      <details className="border border-ivory/10 p-4">
        <summary className="label cursor-pointer text-ivory/40">{t("More (email, WhatsApp Cloud API identity)")}</summary>
        <div className="mt-5 space-y-5">
          <Field label={t("Email (internal)")} name="email" type="email" defaultValue={agent.email} maxLength={254} />
          <Field label={t("WhatsApp user id (BSUID)")} name="whatsapp_user_id" defaultValue={agent.whatsappUserId}
                 placeholder="AM.xxxxxxxx" maxLength={140}
                 hint={t("Only for the official WhatsApp Cloud API. Group agents are linked from their messages instead.")} />
          <Field label={t("WhatsApp phone (Cloud API identity)")} name="whatsapp_phone" defaultValue={agent.whatsappPhone}
                 placeholder="+374 …" hint={t("Only for the official WhatsApp Cloud API.")} />
        </div>
      </details>

      <div className="flex items-center gap-4">
        <Submit>{t("Save agent")}</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

/** One-step agent creation: name, public phone, and (optionally) their messages in the WhatsApp group. */
export function NewAgentForm({ agencies, senders }: { agencies: AgencyRow[]; senders: UnlinkedSender[] }) {
  const [state, action] = useActionState(createAgentAction, null);
  const { t, dateLocale } = useAdminT();
  const active = agencies.filter((a) => a.isActive);
  const primary = active.find((a) => a.isSitePrimary) ?? active[0];
  const [agencyId, setAgencyId] = useState(primary?.id ?? "");
  const candidates = senders.filter((s) => s.agencyId === agencyId);
  const when = (iso: string) => new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
  }).format(new Date(iso));

  return (
    <form action={action} className="max-w-2xl space-y-8">
      <input type="hidden" name="agency_id" value={agencyId} />
      <section className="space-y-5">
        <Field label={t("Name")} name="name" required maxLength={160} placeholder={t("e.g. Anna Petrosyan")}
               hint={t("Shown on the website next to their listings.")} />
        <Field label={t("Phone shown on listings")} name="phone" required placeholder="+374 77 123456"
               hint={t("Visitors call and WhatsApp this number from the agent's listings.")} />
        {active.length > 1 && (
          <label className="block">
            <span className="label text-ivory/40">{t("Agency")}</span>
            <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}
                    className="mt-2 w-full border border-ivory/15 bg-transparent px-3 py-2.5 text-[0.9rem] text-ivory outline-none focus:border-champagne">
              {active.map((a) => <option key={a.id} value={a.id} className="bg-ink text-ivory">{a.displayName ?? a.name}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="label text-ivory/40">{t("Their WhatsApp in the listings group")}</h2>
        <p className="text-[0.85rem] leading-relaxed text-ivory/55">
          {t("Ask the agent to send any message in the WhatsApp group, then pick it here. From then on every listing they post in the group is recognised as theirs.")}
        </p>
        {candidates.length === 0 ? (
          <p className="label text-ivory/35">
            {t("No unrecognised messages in the group yet. You can create the agent now and link their message later on the Agents page.")}
          </p>
        ) : (
          <div className="space-y-2">
            <label className="flex items-start gap-3 border border-ivory/10 p-3">
              <input type="radio" name="message_id" value="" defaultChecked className="mt-1 accent-champagne" />
              <span className="label text-ivory/50">{t("Link later")}</span>
            </label>
            {candidates.map((s) => (
              <label key={s.messageId} className="flex items-start gap-3 border border-ivory/10 p-3 hover:border-ivory/25">
                <input type="radio" name="message_id" value={s.messageId} className="mt-1 accent-champagne" />
                <span className="min-w-0 text-[0.85rem]">
                  <span className="text-ivory/90">{s.profileName ?? s.senderPhone ?? t("unknown sender")}</span>
                  <span className="label ml-2 text-ivory/40">{when(s.receivedAt)} · {t("{n} message(s)", { n: s.messageCount })}</span>
                  {s.bodyPreview && <span className="mt-1 block truncate text-ivory/55">“{s.bodyPreview}”</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center gap-4">
        <Submit>{t("Add agent")}</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

/** The agent's WhatsApp-group link: shows it with an Unlink button, or lets the admin pick their message. */
export function GroupIdentityPanel({ agent, senders }: { agent: AgentRow; senders: UnlinkedSender[] }) {
  const [unlinkState, unlink] = useActionState(unlinkIdentityAction, null);
  const [linkState, link] = useActionState(linkIdentityAction, null);
  const { t, dateLocale } = useAdminT();
  const when = (iso: string) => new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
  }).format(new Date(iso));
  const candidates = senders.filter((s) => s.agencyId === agent.agencyId);

  return (
    <section className="max-w-2xl space-y-4 border border-ivory/12 p-5">
      <h2 className="label text-ivory/40">{t("Their WhatsApp in the listings group")}</h2>
      {agent.groupIdentity ? (
        <>
          <p className="text-[0.9rem] text-champagne">
            ✓ {t("Linked")}{agent.groupIdentity.profileName ? ` · ${agent.groupIdentity.profileName}` : ""}
            <span className="label ml-2 text-ivory/40">{t("since {date}", { date: when(agent.groupIdentity.linkedAt) })}</span>
          </p>
          <p className="text-[0.85rem] text-ivory/55">{t("Every listing this person posts in the group is processed as this agent's.")}</p>
          <form action={unlink} onSubmit={(e) => { if (!window.confirm(t("Unlink this WhatsApp sender from the agent? Their new messages will no longer create listings until linked again."))) e.preventDefault(); }}>
            <input type="hidden" name="identity_id" value={agent.groupIdentity.id} />
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="updated_at" value={agent.updatedAt} />
            <Submit tone="default">{t("Unlink")}</Submit>
          </form>
          <Result state={unlinkState} />
        </>
      ) : (
        <>
          <p className="text-[0.9rem] text-ivory/70">
            ✗ {t("Not linked yet — listings from this agent are not processed.")}
          </p>
          {candidates.length === 0 ? (
            <p className="label text-ivory/35">
              {t("Ask the agent to send any message in the WhatsApp group, then refresh this page.")}
            </p>
          ) : (
            <form action={link} className="space-y-2">
              <input type="hidden" name="agent_id" value={agent.id} />
              <input type="hidden" name="updated_at" value={agent.updatedAt} />
              {candidates.map((s, i) => (
                <label key={s.messageId} className="flex items-start gap-3 border border-ivory/10 p-3 hover:border-ivory/25">
                  <input type="radio" name="message_id" value={s.messageId} defaultChecked={i === 0} className="mt-1 accent-champagne" />
                  <span className="min-w-0 text-[0.85rem]">
                    <span className="text-ivory/90">{s.profileName ?? s.senderPhone ?? t("unknown sender")}</span>
                    <span className="label ml-2 text-ivory/40">{when(s.receivedAt)} · {t("{n} message(s)", { n: s.messageCount })}</span>
                    {s.bodyPreview && <span className="mt-1 block truncate text-ivory/55">“{s.bodyPreview}”</span>}
                  </span>
                </label>
              ))}
              <Submit>{t("Link")}</Submit>
              <Result state={linkState} />
            </form>
          )}
        </>
      )}
    </section>
  );
}

/** "Not an agent": hides a group member's messages from the unrecognised list. */
export function DismissSenderButton({ messageId }: { messageId: string }) {
  const [state, action] = useActionState(dismissSenderAction, null);
  const { t } = useAdminT();
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(t("Hide this person? Their messages will be ignored. You can still add them as an agent later."))) e.preventDefault(); }}>
      <input type="hidden" name="message_id" value={messageId} />
      <Submit tone="default">{t("Not an agent")}</Submit>
      <Result state={state} />
    </form>
  );
}

/** Registers the identity of a stored message on an agent — no BSUID is ever typed by hand. */
export function LinkIdentityForm({ sender, agents }: { sender: UnlinkedSender; agents: AgentRow[] }) {
  const [state, action] = useActionState(linkIdentityAction, null);
  const { t } = useAdminT();
  const candidates = agents.filter((a) => a.agencyId === sender.agencyId);
  const suggested = sender.suggestedAgentId ?? "";
  const [agentId, setAgentId] = useState(
    candidates.find((a) => a.id === suggested)?.id ?? candidates[0]?.id ?? "");
  // the version token must follow the selected agent, not the one first rendered
  const chosen = candidates.find((a) => a.id === agentId);

  if (candidates.length === 0) {
    return <p className="label text-ivory/30">{t("No agents in {agency} yet.", { agency: sender.agencyName })}</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="message_id" value={sender.messageId} />
      <input type="hidden" name="updated_at" value={chosen?.updatedAt ?? ""} />
      <label className="block">
        <span className="label text-ivory/40">{t("This is")}</span>
        <select
          name="agent_id"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="mt-2 border border-ivory/15 bg-transparent px-3 py-2 text-[0.85rem] text-ivory outline-none focus:border-champagne"
        >
          {candidates.map((a) => (
            <option key={a.id} value={a.id} className="bg-ink text-ivory">
              {a.name}{a.isActive ? "" : ` (${t("inactive")})`}
            </option>
          ))}
        </select>
      </label>
      <Submit tone="default">{t("Link")}</Submit>
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

const codeOptions = (t: (k: string) => string, values: string[]) =>
  [{ value: "", label: "—" }, ...values.map((v) => ({ value: v, label: code(t, v) }))];

export function ListingEditForm({ listing }: { listing: EditableListing }) {
  const [state, action] = useActionState(updateListingAction, null);
  const { t } = useAdminT();
  const approved = listing.listingStatus === "draft" && listing.reviewStatus === "approved";

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="id" value={listing.id} />
      <input type="hidden" name="version" value={listing.stateVersion} />

      {listing.listingStatus === "published" ? (
        <p className="border border-champagne/30 bg-champagne/5 p-4 text-[0.85rem] text-ivory/80">
          {t("This listing is live. Changes appear on the website immediately; anything that would break the publication rules is refused and nothing is saved.")}
        </p>
      ) : approved ? (
        <p className="border border-ivory/15 p-4 text-[0.85rem] text-ivory/70">
          {t("This draft is approved. Saving a change returns it to pending review.")}
        </p>
      ) : null}

      <section className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("Title")} name="title" defaultValue={listing.title} maxLength={160} />
        </div>
        <Select label={t("Intent")} name="intent" defaultValue={listing.intent} options={codeOptions(t, ["buy", "rent"])} />
        <Select label={t("Property type")} name="property_type" defaultValue={listing.propertyType}
                options={codeOptions(t, PROPERTY_TYPES)} />
        <Field label={t("Price")} name="price" defaultValue={listing.price} step="any" />
        <Select label={t("Currency")} name="currency" defaultValue={listing.currency}
                options={[{ value: "", label: "—" }, ...["USD", "AMD", "EUR", "RUB"].map((v) => ({ value: v, label: v }))]} />
        <Select label={t("Price period (rentals)")} name="price_period" defaultValue={listing.pricePeriod}
                options={codeOptions(t, ["month", "day", "year"])} />
        <Select label={t("Price negotiable")} name="price_negotiable"
                defaultValue={listing.priceNegotiable === null ? "" : listing.priceNegotiable ? "yes" : "no"}
                options={[{ value: "", label: "—" }, { value: "yes", label: t("Yes") }, { value: "no", label: t("No") }]} />
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <h2 className="label text-ivory/40 sm:col-span-2">{t("Location")}</h2>
        <Field label={t("City")} name="city" defaultValue={listing.city} maxLength={80} />
        <Field label={t("District")} name="district" defaultValue={listing.district} maxLength={80} />
        <Field label={t("Country (2 letters)")} name="country" defaultValue={listing.country} maxLength={2}
               placeholder="AM" />
        <Field label={t("Address (never shown publicly)")} name="address" defaultValue={listing.address} maxLength={200} />
      </section>

      <section className="grid gap-5 sm:grid-cols-3">
        <h2 className="label text-ivory/40 sm:col-span-3">{t("Size")}</h2>
        <Field label={t("Area (m²)")} name="area_sqm" defaultValue={listing.areaSqm} step="any" />
        <Field label={t("Land area (m²)")} name="land_area_sqm" defaultValue={listing.landAreaSqm} step="any" />
        <Field label={t("Rooms")} name="rooms" defaultValue={listing.rooms} />
        <Field label={t("Bedrooms")} name="bedrooms" defaultValue={listing.bedrooms} />
        <Field label={t("Bathrooms")} name="bathrooms" defaultValue={listing.bathrooms} />
        <Field label={t("Floor")} name="floor" defaultValue={listing.floor} />
        <Field label={t("Total floors")} name="total_floors" defaultValue={listing.totalFloors} />
        <Field label={t("Year built")} name="year_built" defaultValue={listing.yearBuilt} />
      </section>

      <section className="space-y-5">
        <TextArea label={t("Description")} name="description" defaultValue={listing.description} rows={8} maxLength={5000} />
        <Field label={t("Features")} name="features" defaultValue={listing.features.join(", ")}
               hint={t("Comma separated, in English, e.g. parking, balcony, lift. Spaces become underscores.")} />
      </section>

      <div className="flex items-center gap-4">
        <Submit>{t("Save changes")}</Submit>
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
  const { t } = useAdminT();
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
                {t("Cover")}
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

      <div className="mt-4"><Submit tone="default">{t("Save photo order")}</Submit></div>
      <Result state={state} />
    </form>
  );
}
