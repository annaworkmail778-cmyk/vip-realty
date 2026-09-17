import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type BookingFilter, type BookingStore } from "./store";
import type {
  Blackout, Booking, BookingResult, BookingSettings, BookingStatus, CreateBookingInput,
  DateOverride, DayAvailability, NotificationEvent, PropertyRecord, ScheduleRule, Slot,
} from "./types";
import {
  addDays, businessNowTime, businessToday, fromMinutes, toMinutes, weekday,
  type DateString, type TimeString,
} from "./time";

/* ----------------------------------------------------------------------------
   Development store.

   Used only when SUPABASE_SERVICE_ROLE_KEY is absent, so the booking flow can
   be designed and reviewed without credentials. It writes to `.data/` — never
   to browser storage — but it is not a production backend, and the UI says so.

   The slot rules below deliberately mirror `viewing_slots_for_date` in
   supabase/migrations/20260912090100_viewing_functions.sql. If you change one,
   change the other.
---------------------------------------------------------------------------- */

interface DevData {
  properties: PropertyRecord[];
  rules: ScheduleRule[];
  overrides: DateOverride[];
  blackouts: Blackout[];
  bookings: Booking[];
  events: NotificationEvent[];
  settings: BookingSettings;
  refCounter: number;
}

const FILE = path.join(process.cwd(), ".data", "viewings.json");

const SEED_RULES = (): ScheduleRule[] => [
  ...[1, 2, 3, 4, 5].map((weekday) => ({
    id: randomUUID(), propertyId: null, propertySlug: null,
    weekday, startTime: "10:00", endTime: "19:00", slotMinutes: 90, isActive: true,
  })),
  {
    id: randomUUID(), propertyId: null, propertySlug: null,
    weekday: 6, startTime: "11:00", endTime: "16:00", slotMinutes: 90, isActive: true,
  },
];

export class DevBookingStore implements BookingStore {
  readonly kind = "development" as const;
  private cache: DevData | null = null;
  private cachedAt = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(private seedProperties: () => PropertyRecord[]) {}

  private async load(): Promise<DevData> {
    // The file is the source of truth, not this object. Next loads server
    // components and route handlers from separate bundles, so two instances of
    // this class can exist in one process; re-reading whenever the file has
    // changed keeps a booking made through the API visible to the pages.
    try {
      const mtime = (await stat(FILE)).mtimeMs;
      if (this.cache && mtime <= this.cachedAt) return this.cache;
      this.cache = JSON.parse(await readFile(FILE, "utf8")) as DevData;
      this.cachedAt = mtime;
      // Keep property metadata in step with the site's own data file.
      this.cache.properties = this.seedProperties();
    } catch {
      if (this.cache) return this.cache;
      this.cache = {
        properties: this.seedProperties(),
        rules: SEED_RULES(),
        overrides: [], blackouts: [], bookings: [], events: [],
        settings: { ...DEFAULT_SETTINGS },
        refCounter: 0,
      };
    }
    return this.cache;
  }

  private async save() {
    // Deliberately writes the in-memory object rather than re-reading: callers
    // mutate `this.cache` and then call save, so a reload here would discard
    // the change. Concurrent writers are last-write-wins, which is acceptable
    // for a development store and impossible in the Supabase one.
    const data = this.cache;
    if (!data) return;
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify(data, null, 2));
      this.cachedAt = (await stat(FILE)).mtimeMs;
    });
    return this.writing;
  }

  /* ------------------------------------------------------------ properties */

  async listProperties() { return (await this.load()).properties; }

  async getProperty(slug: string) {
    return (await this.load()).properties.find((p) => p.slug === slug) ?? null;
  }

  async setPropertyViewingMode(slug: string, mode: PropertyRecord["viewingMode"], durationMinutes?: number) {
    const d = await this.load();
    const p = d.properties.find((x) => x.slug === slug);
    if (p) {
      p.viewingMode = mode;
      if (durationMinutes) p.viewingDurationMinutes = durationMinutes;
    }
    await this.save();
  }

  /* ---------------------------------------------------------- availability */

  async slotsForDate(slug: string, date: DateString): Promise<Slot[]> {
    const d = await this.load();
    const property = d.properties.find((p) => p.slug === slug);
    if (!property || property.viewingMode !== "standard") return [];
    if (date > addDays(businessToday(), d.settings.maxDaysAhead)) return [];

    const explicit = d.overrides.filter((o) => o.propertySlug === slug && o.date === date);
    const ownRules = d.rules.filter((r) => r.propertySlug === slug && r.isActive);
    const source = ownRules.length ? ownRules : d.rules.filter((r) => r.propertySlug === null && r.isActive);

    const base: { startTime: TimeString; endTime: TimeString; isAvailable: boolean }[] = explicit.length
      ? explicit.map((o) => ({ startTime: o.startTime, endTime: o.endTime, isAvailable: o.isAvailable }))
      : source
          .filter((r) => r.weekday === weekday(date))
          .flatMap((r) => {
            const out = [];
            for (let m = toMinutes(r.startTime); m + r.slotMinutes <= toMinutes(r.endTime); m += r.slotMinutes) {
              out.push({ startTime: fromMinutes(m), endTime: fromMinutes(m + r.slotMinutes), isAvailable: true });
            }
            return out;
          });

    const today = businessToday();
    const nowMins = toMinutes(businessNowTime()) + d.settings.minLeadMinutes;

    return base
      .map((b) => {
        let reason: string | null = null;
        if (!b.isAvailable) reason = "blocked";
        else if (date < today || (date === today && toMinutes(b.startTime) < nowMins)) reason = "past";
        else if (d.blackouts.some((x) =>
          x.date === date && (x.propertySlug === slug || x.propertySlug === null) &&
          (!x.startTime || (toMinutes(b.startTime) < toMinutes(x.endTime ?? "23:59") && toMinutes(b.endTime) > toMinutes(x.startTime)))
        )) reason = "blocked";
        else if (d.bookings.some((bk) =>
          bk.propertySlug === slug && bk.date === date && bk.startTime === b.startTime &&
          (bk.status === "pending" || bk.status === "confirmed")
        )) reason = "booked";
        return { startTime: b.startTime, endTime: b.endTime, isOpen: reason === null, reason };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async availability(slug: string, from: DateString, to: DateString): Promise<DayAvailability[]> {
    const days: DayAvailability[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const slots = (await this.slotsForDate(slug, d)).filter((s) => s.isOpen);
      days.push({ date: d, slots, openCount: slots.length });
    }
    return days;
  }

  /* -------------------------------------------------------------- bookings */

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const d = await this.load();
    const property = d.properties.find((p) => p.slug === input.propertySlug);
    if (!property) return { ok: false, error: "property_not_found" };
    if (property.viewingMode !== "standard") return { ok: false, error: "viewings_not_bookable" };

    const slot = (await this.slotsForDate(input.propertySlug, input.date))
      .find((s) => s.startTime === input.startTime);
    if (!slot) return { ok: false, error: "slot_not_offered" };
    if (!slot.isOpen) return { ok: false, error: slot.reason === "booked" ? "slot_taken" : "slot_unavailable" };

    d.refCounter += 1;
    const booking: Booking = {
      id: randomUUID(),
      reference: `VIP-${businessToday().slice(0, 4)}-${String(d.refCounter).padStart(5, "0")}`,
      propertyId: property.id,
      propertySlug: property.slug,
      propertyTitle: property.title,
      propertyLocation: property.location,
      propertyAddress: property.address,
      customerName: input.name.trim(),
      customerPhone: input.phone.trim(),
      customerEmail: input.email.trim().toLowerCase(),
      customerMessage: input.message?.trim() || null,
      contactConsent: Boolean(input.consent),
      date: input.date,
      startTime: input.startTime,
      endTime: slot.endTime,
      startsAt: new Date(`${input.date}T${input.startTime}:00+04:00`).toISOString(),
      viewingType: input.viewingType ?? "in_person",
      status: "pending",
      confirmationStatus: "pending",
      source: input.source ?? "website",
      cancelledBy: null,
      cancellationReason: null,
      internalNote: null,
      createdAt: new Date().toISOString(),
      manageToken: randomUUID(),
    };
    d.bookings.push(booking);
    await this.queueNotification("booking.created", booking.id, { reference: booking.reference });
    await this.save();
    return { ok: true, booking };
  }

  private async find(reference: string) {
    return (await this.load()).bookings.find((b) => b.reference === reference) ?? null;
  }

  /** Strips the customer's manage token from anything an admin path returns. */
  private redact(b: Booking): Booking {
    return { ...b, manageToken: undefined };
  }

  async getBooking(reference: string, token?: string) {
    const b = await this.find(reference);
    if (!b) return null;
    if (token && b.manageToken !== token) return null;
    return token ? b : { ...b, manageToken: undefined };
  }

  async listBookings(filter: BookingFilter = {}): Promise<Booking[]> {
    const d = await this.load();
    return d.bookings
      .filter((b) => {
        if (filter.from && b.date < filter.from) return false;
        if (filter.to && b.date > filter.to) return false;
        if (filter.status?.length && !filter.status.includes(b.status)) return false;
        if (filter.propertySlug && b.propertySlug !== filter.propertySlug) return false;
        if (filter.search) {
          const s = filter.search.toLowerCase();
          const hay = `${b.customerName} ${b.customerEmail} ${b.customerPhone} ${b.reference}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
      .slice(0, filter.limit ?? 500)
      .map((b) => ({ ...b, manageToken: undefined }));
  }

  async cancelBooking(reference: string, by: "customer" | "admin" | "system", token?: string, reason?: string): Promise<BookingResult> {
    const b = await this.find(reference);
    if (!b || (by !== "admin" && token && b.manageToken !== token)) return { ok: false, error: "not_found" };
    if (b.status === "cancelled") return { ok: true, booking: b, already: true };
    if (b.status === "completed" || b.status === "no_show") return { ok: false, error: "not_cancellable" };
    b.status = "cancelled";
    if (by === "customer") b.confirmationStatus = "declined";
    b.cancelledBy = by;
    b.cancellationReason = reason ?? null;
    await this.queueNotification("booking.cancelled", b.id, { reference, by });
    await this.save();
    return { ok: true, booking: this.redact(b) };
  }

  async confirmBooking(reference: string, token: string): Promise<BookingResult> {
    const b = await this.find(reference);
    if (!b || b.manageToken !== token) return { ok: false, error: "not_found" };
    if (b.status === "cancelled") return { ok: false, error: "cancelled" };
    b.confirmationStatus = "confirmed";
    if (b.status === "pending") b.status = "confirmed";
    await this.queueNotification("customer.confirmed", b.id, { reference });
    await this.save();
    return { ok: true, booking: this.redact(b) };
  }

  async rescheduleBooking(reference: string, date: DateString, startTime: TimeString, by: "customer" | "admin"): Promise<BookingResult> {
    const b = await this.find(reference);
    if (!b) return { ok: false, error: "not_found" };
    if (["cancelled", "completed", "no_show"].includes(b.status)) return { ok: false, error: "not_reschedulable" };
    const slot = (await this.slotsForDate(b.propertySlug, date)).find((s) => s.startTime === startTime);
    if (!slot) return { ok: false, error: "slot_not_offered" };
    const isSame = b.date === date && b.startTime === startTime;
    if (!slot.isOpen && !isSame) return { ok: false, error: slot.reason === "booked" ? "slot_taken" : "slot_unavailable" };
    const from = { date: b.date, start_time: b.startTime };
    b.date = date;
    b.startTime = startTime;
    b.endTime = slot.endTime;
    b.confirmationStatus = "pending";
    b.startsAt = new Date(`${date}T${startTime}:00+04:00`).toISOString();
    await this.queueNotification("booking.rescheduled", b.id, { reference, from, by });
    await this.save();
    return { ok: true, booking: this.redact(b) };
  }

  async setBookingStatus(reference: string, status: BookingStatus, note?: string): Promise<BookingResult> {
    const b = await this.find(reference);
    if (!b) return { ok: false, error: "not_found" };
    b.status = status;
    if (note !== undefined) b.internalNote = note;
    if (status === "cancelled") b.cancelledBy = "admin";
    const event =
      status === "completed" ? "viewing.completed"
      : status === "no_show" ? "viewing.no_show"
      : status === "cancelled" ? "booking.cancelled"
      : status === "confirmed" ? "booking.confirmed" : null;
    if (event) await this.queueNotification(event, b.id, { reference, by: "admin" });
    await this.save();
    return { ok: true, booking: this.redact(b) };
  }

  /* ---------------------------------------------------------- availability */

  async listRules(propertySlug?: string | null) {
    const d = await this.load();
    if (propertySlug === undefined) return d.rules;
    return d.rules.filter((r) => r.propertySlug === propertySlug);
  }

  async saveRule(rule: Omit<ScheduleRule, "id" | "propertyId"> & { id?: string }) {
    const d = await this.load();
    if (rule.id) {
      const existing = d.rules.find((r) => r.id === rule.id);
      if (existing) Object.assign(existing, rule);
    } else {
      d.rules.push({ ...rule, id: randomUUID(), propertyId: null });
    }
    await this.save();
  }

  async deleteRule(id: string) {
    const d = await this.load();
    d.rules = d.rules.filter((r) => r.id !== id);
    await this.save();
  }

  async listBlackouts(from: DateString, to: DateString) {
    const d = await this.load();
    return d.blackouts.filter((b) => b.date >= from && b.date <= to);
  }

  async addBlackout(input: { propertySlug: string | null; date: DateString; startTime?: TimeString | null; endTime?: TimeString | null; reason?: string }) {
    const d = await this.load();
    d.blackouts.push({
      id: randomUUID(), propertyId: null, propertySlug: input.propertySlug,
      date: input.date, startTime: input.startTime ?? null, endTime: input.endTime ?? null,
      reason: input.reason ?? null,
    });
    await this.save();
  }

  async deleteBlackout(id: string) {
    const d = await this.load();
    d.blackouts = d.blackouts.filter((b) => b.id !== id);
    await this.save();
  }

  async listDateOverrides(propertySlug: string | null, from: DateString, to: DateString) {
    const d = await this.load();
    return d.overrides.filter((o) =>
      o.date >= from && o.date <= to && (propertySlug === null || o.propertySlug === propertySlug));
  }

  async saveDateOverride(input: { propertySlug: string | null; date: DateString; startTime: TimeString; endTime: TimeString; isAvailable: boolean; note?: string }) {
    const d = await this.load();
    const existing = d.overrides.find((o) =>
      o.propertySlug === input.propertySlug && o.date === input.date && o.startTime === input.startTime);
    if (existing) Object.assign(existing, input);
    else d.overrides.push({ ...input, id: randomUUID(), propertyId: null, note: input.note ?? null });
    await this.save();
  }

  async deleteDateOverride(id: string) {
    const d = await this.load();
    d.overrides = d.overrides.filter((o) => o.id !== id);
    await this.save();
  }

  /* --------------------------------------------------------- notifications */

  async listNotificationEvents(limit = 60) {
    const d = await this.load();
    return [...d.events].reverse().slice(0, limit);
  }

  async queueNotification(event: string, bookingId: string | null, payload: Record<string, unknown> = {}, channel = "telegram") {
    const d = await this.load();
    const reference = d.bookings.find((b) => b.id === bookingId)?.reference ?? null;
    d.events.push({
      id: randomUUID(), event, channel, bookingId, bookingReference: reference,
      status: "queued", attempts: 0, lastError: null, payload,
      createdAt: new Date().toISOString(), deliveredAt: null,
    });
    await this.save();
  }

  async claimQueuedNotifications(limit = 20) {
    const d = await this.load();
    return d.events.filter((e) => e.status === "queued").slice(0, limit);
  }

  async markNotification(id: string, status: "sent" | "failed" | "skipped", error?: string) {
    const d = await this.load();
    const e = d.events.find((x) => x.id === id);
    if (e) {
      e.status = status;
      e.attempts += 1;
      e.lastError = error ?? null;
      e.deliveredAt = status === "sent" ? new Date().toISOString() : null;
    }
    await this.save();
  }

  /* ------------------------------------------------------------- settings */

  async getSettings() { return (await this.load()).settings; }

  async saveSettings(patch: Partial<BookingSettings>) {
    const d = await this.load();
    d.settings = { ...d.settings, ...patch };
    await this.save();
  }

  async queueReminders(windowHours: number) {
    const d = await this.load();
    const now = Date.now();
    const due = d.bookings.filter((b) =>
      ["pending", "confirmed"].includes(b.status) &&
      Date.parse(b.startsAt) > now &&
      Date.parse(b.startsAt) < now + windowHours * 3_600_000 &&
      !d.events.some((e) => e.event === "reminder.customer" && e.bookingId === b.id));
    for (const b of due) await this.queueNotification("reminder.customer", b.id, {}, "email");
    return due.length;
  }

  async expireConfirmations() {
    const d = await this.load();
    const now = Date.now();
    const stale = d.bookings.filter((b) =>
      b.confirmationStatus === "pending" && ["pending", "confirmed"].includes(b.status) &&
      Date.parse(b.startsAt) < now);
    for (const b of stale) {
      b.confirmationStatus = "expired";
      await this.queueNotification("customer.not_confirmed", b.id);
    }
    await this.save();
    return stale.length;
  }
}
