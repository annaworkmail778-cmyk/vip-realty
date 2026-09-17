import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_SETTINGS, type BookingFilter, type BookingStore } from "./store";
import type {
  Blackout, Booking, BookingError, BookingResult, BookingSettings, BookingStatus,
  CreateBookingInput, DateOverride, DayAvailability, NotificationEvent, PropertyRecord,
  ScheduleRule, Slot,
} from "./types";
import { addDays, shortTime, type DateString, type TimeString } from "./time";

/* ----------------------------------------------------------------------------
   Supabase implementation.

   Availability and every mutation go through database functions rather than
   being assembled here, so the rules that decide what is bookable live in one
   place and apply even to a caller that bypasses this file.
---------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

const BOOKING_SELECT =
  "*, properties!inner(slug, title, location, address)";

function toProperty(r: Row): PropertyRecord {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    location: r.location as string,
    address: (r.address as string) ?? null,
    propertyType: r.property_type as string,
    status: r.status as string,
    viewingMode: r.viewing_mode as PropertyRecord["viewingMode"],
    viewingDurationMinutes: r.viewing_duration_minutes as number,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    pricePeriod: (r.price_period as PropertyRecord["pricePeriod"]) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

function toBooking(r: Row, withToken = false): Booking {
  const p = (r.properties ?? {}) as Row;
  return {
    id: r.id as string,
    reference: r.booking_reference as string,
    propertyId: r.property_id as string,
    propertySlug: (p.slug as string) ?? "",
    propertyTitle: (p.title as string) ?? "",
    propertyLocation: (p.location as string) ?? "",
    propertyAddress: (p.address as string) ?? null,
    customerName: r.customer_name as string,
    customerPhone: r.customer_phone as string,
    customerEmail: r.customer_email as string,
    customerMessage: (r.customer_message as string) ?? null,
    contactConsent: Boolean(r.contact_consent),
    date: r.viewing_date as DateString,
    startTime: shortTime(r.viewing_start_time as string),
    endTime: shortTime(r.viewing_end_time as string),
    startsAt: r.starts_at as string,
    viewingType: r.viewing_type as Booking["viewingType"],
    status: r.status as BookingStatus,
    confirmationStatus: r.confirmation_status as Booking["confirmationStatus"],
    source: r.source as Booking["source"],
    cancelledBy: (r.cancelled_by as Booking["cancelledBy"]) ?? null,
    cancellationReason: (r.cancellation_reason as string) ?? null,
    internalNote: (r.internal_note as string) ?? null,
    createdAt: r.created_at as string,
    ...(withToken ? { manageToken: r.manage_token as string } : {}),
  };
}

export class SupabaseBookingStore implements BookingStore {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  /* ------------------------------------------------------------ properties */

  async listProperties(): Promise<PropertyRecord[]> {
    const { data, error } = await this.db.from("properties").select("*").order("slug");
    if (error) throw error;
    return (data ?? []).map(toProperty);
  }

  async getProperty(slug: string): Promise<PropertyRecord | null> {
    const { data, error } = await this.db.from("properties").select("*").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return data ? toProperty(data) : null;
  }

  async setPropertyViewingMode(slug: string, mode: PropertyRecord["viewingMode"], durationMinutes?: number) {
    const patch: Row = { viewing_mode: mode };
    if (durationMinutes) patch.viewing_duration_minutes = durationMinutes;
    const { error } = await this.db.from("properties").update(patch).eq("slug", slug);
    if (error) throw error;
  }

  /* ---------------------------------------------------------- availability */

  private async propertyId(slug: string): Promise<string | null> {
    const { data } = await this.db.from("properties").select("id").eq("slug", slug).maybeSingle();
    return (data?.id as string) ?? null;
  }

  async slotsForDate(slug: string, date: DateString): Promise<Slot[]> {
    const id = await this.propertyId(slug);
    if (!id) return [];
    const { data, error } = await this.db.rpc("viewing_slots_for_date", { p_property: id, p_date: date });
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      startTime: shortTime(r.start_time as string),
      endTime: shortTime(r.end_time as string),
      isOpen: Boolean(r.is_open),
      reason: (r.reason as string) ?? null,
    }));
  }

  async availability(slug: string, from: DateString, to: DateString): Promise<DayAvailability[]> {
    const id = await this.propertyId(slug);
    if (!id) return [];
    const { data, error } = await this.db.rpc("viewing_open_slots", {
      p_property: id, p_from: from, p_to: to,
    });
    if (error) throw error;

    const byDate = new Map<DateString, Slot[]>();
    for (const r of (data ?? []) as Row[]) {
      const d = r.slot_date as DateString;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push({
        startTime: shortTime(r.start_time as string),
        endTime: shortTime(r.end_time as string),
        isOpen: true,
        reason: null,
      });
    }

    const days: DayAvailability[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const slots = byDate.get(d) ?? [];
      days.push({ date: d, slots, openCount: slots.length });
    }
    return days;
  }

  /* -------------------------------------------------------------- bookings */

  private async bookingById(id: string, withToken = false): Promise<Booking | null> {
    const { data, error } = await this.db.from("viewing_bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toBooking(data, withToken) : null;
  }

  /** Turns the `{ok,...}` jsonb the database functions return into a result. */
  private async fromRpc(payload: unknown, withToken = false): Promise<BookingResult> {
    const res = (payload ?? {}) as Row;
    if (!res.ok) return { ok: false, error: (res.error as BookingError) ?? "invalid_input" };
    const raw = res.booking as Row;
    const booking = await this.bookingById(raw.id as string, withToken);
    if (!booking) return { ok: false, error: "not_found" };
    return { ok: true, booking, ...(res.already ? { already: true } : {}) };
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const { data, error } = await this.db.rpc("create_viewing_booking", {
      p_property_slug: input.propertySlug,
      p_date: input.date,
      p_start_time: input.startTime,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email,
      p_message: input.message ?? null,
      p_consent: input.consent ?? false,
      p_viewing_type: input.viewingType ?? "in_person",
      p_source: input.source ?? "website",
    });
    if (error) throw error;
    return this.fromRpc(data, true);
  }

  async getBooking(reference: string, token?: string): Promise<Booking | null> {
    let q = this.db.from("viewing_bookings").select(BOOKING_SELECT).eq("booking_reference", reference);
    if (token) q = q.eq("manage_token", token);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toBooking(data, Boolean(token)) : null;
  }

  async listBookings(filter: BookingFilter = {}): Promise<Booking[]> {
    let q = this.db.from("viewing_bookings").select(BOOKING_SELECT);
    if (filter.from) q = q.gte("viewing_date", filter.from);
    if (filter.to) q = q.lte("viewing_date", filter.to);
    if (filter.status?.length) q = q.in("status", filter.status);
    if (filter.propertySlug) q = q.eq("properties.slug", filter.propertySlug);
    if (filter.search) {
      const s = `%${filter.search}%`;
      q = q.or(`customer_name.ilike.${s},customer_email.ilike.${s},customer_phone.ilike.${s},booking_reference.ilike.${s}`);
    }
    q = q.order("viewing_date", { ascending: true }).order("viewing_start_time", { ascending: true });
    if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => toBooking(r));
  }

  async cancelBooking(reference: string, by: "customer" | "admin" | "system", token?: string, reason?: string) {
    const { data, error } = await this.db.rpc("cancel_viewing_booking", {
      p_reference: reference,
      p_token: token ?? "00000000-0000-0000-0000-000000000000",
      p_by: by,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return this.fromRpc(data);
  }

  async confirmBooking(reference: string, token: string) {
    const { data, error } = await this.db.rpc("confirm_viewing_booking", {
      p_reference: reference, p_token: token,
    });
    if (error) throw error;
    return this.fromRpc(data);
  }

  async rescheduleBooking(reference: string, date: DateString, startTime: TimeString, by: "customer" | "admin") {
    const { data, error } = await this.db.rpc("reschedule_viewing_booking", {
      p_reference: reference, p_date: date, p_start_time: startTime, p_by: by,
    });
    if (error) throw error;
    return this.fromRpc(data);
  }

  async setBookingStatus(reference: string, status: BookingStatus, note?: string): Promise<BookingResult> {
    const patch: Row = { status };
    if (note !== undefined) patch.internal_note = note;
    if (status === "cancelled") {
      patch.cancelled_by = "admin";
      patch.cancelled_at = new Date().toISOString();
    }
    const { data, error } = await this.db
      .from("viewing_bookings").update(patch).eq("booking_reference", reference)
      .select(BOOKING_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "not_found" };

    const event =
      status === "completed" ? "viewing.completed"
      : status === "no_show" ? "viewing.no_show"
      : status === "cancelled" ? "booking.cancelled"
      : status === "confirmed" ? "booking.confirmed"
      : null;
    if (event) await this.queueNotification(event, data.id as string, { reference, by: "admin" });

    return { ok: true, booking: toBooking(data) };
  }

  /* ---------------------------------------------------------- availability */

  async listRules(propertySlug?: string | null): Promise<ScheduleRule[]> {
    let q = this.db.from("viewing_schedule_rules").select("*, properties(slug)");
    if (propertySlug === null) q = q.is("property_id", null);
    else if (propertySlug) {
      const id = await this.propertyId(propertySlug);
      q = q.eq("property_id", id ?? "");
    }
    const { data, error } = await q.order("weekday").order("start_time");
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      propertyId: (r.property_id as string) ?? null,
      propertySlug: ((r.properties as Row)?.slug as string) ?? null,
      weekday: r.weekday as number,
      startTime: shortTime(r.start_time as string),
      endTime: shortTime(r.end_time as string),
      slotMinutes: r.slot_minutes as number,
      isActive: Boolean(r.is_active),
    }));
  }

  async saveRule(rule: Omit<ScheduleRule, "id" | "propertyId"> & { id?: string }) {
    const propertyId = rule.propertySlug ? await this.propertyId(rule.propertySlug) : null;
    const row: Row = {
      property_id: propertyId,
      weekday: rule.weekday,
      start_time: rule.startTime,
      end_time: rule.endTime,
      slot_minutes: rule.slotMinutes,
      is_active: rule.isActive,
    };
    const { error } = rule.id
      ? await this.db.from("viewing_schedule_rules").update(row).eq("id", rule.id)
      : await this.db.from("viewing_schedule_rules").insert(row);
    if (error) throw error;
  }

  async deleteRule(id: string) {
    const { error } = await this.db.from("viewing_schedule_rules").delete().eq("id", id);
    if (error) throw error;
  }

  async listBlackouts(from: DateString, to: DateString): Promise<Blackout[]> {
    const { data, error } = await this.db
      .from("viewing_blackouts").select("*, properties(slug)")
      .gte("date", from).lte("date", to).order("date");
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      propertyId: (r.property_id as string) ?? null,
      propertySlug: ((r.properties as Row)?.slug as string) ?? null,
      date: r.date as DateString,
      startTime: r.start_time ? shortTime(r.start_time as string) : null,
      endTime: r.end_time ? shortTime(r.end_time as string) : null,
      reason: (r.reason as string) ?? null,
    }));
  }

  async addBlackout(input: { propertySlug: string | null; date: DateString; startTime?: TimeString | null; endTime?: TimeString | null; reason?: string }) {
    const propertyId = input.propertySlug ? await this.propertyId(input.propertySlug) : null;
    const { error } = await this.db.from("viewing_blackouts").insert({
      property_id: propertyId,
      date: input.date,
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      reason: input.reason ?? null,
    });
    if (error) throw error;
  }

  async deleteBlackout(id: string) {
    const { error } = await this.db.from("viewing_blackouts").delete().eq("id", id);
    if (error) throw error;
  }

  async listDateOverrides(propertySlug: string | null, from: DateString, to: DateString): Promise<DateOverride[]> {
    let q = this.db.from("viewing_availability").select("*, properties(slug)").gte("date", from).lte("date", to);
    if (propertySlug) {
      const id = await this.propertyId(propertySlug);
      q = q.eq("property_id", id ?? "");
    }
    const { data, error } = await q.order("date").order("start_time");
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      propertyId: (r.property_id as string) ?? null,
      propertySlug: ((r.properties as Row)?.slug as string) ?? null,
      date: r.date as DateString,
      startTime: shortTime(r.start_time as string),
      endTime: shortTime(r.end_time as string),
      isAvailable: Boolean(r.is_available),
      note: (r.note as string) ?? null,
    }));
  }

  async saveDateOverride(input: { propertySlug: string | null; date: DateString; startTime: TimeString; endTime: TimeString; isAvailable: boolean; note?: string }) {
    const propertyId = input.propertySlug ? await this.propertyId(input.propertySlug) : null;
    const { error } = await this.db.from("viewing_availability").upsert({
      property_id: propertyId,
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      is_available: input.isAvailable,
      note: input.note ?? null,
    }, { onConflict: "property_id,date,start_time" });
    if (error) throw error;
  }

  async deleteDateOverride(id: string) {
    const { error } = await this.db.from("viewing_availability").delete().eq("id", id);
    if (error) throw error;
  }

  /* --------------------------------------------------------- notifications */

  async listNotificationEvents(limit = 60): Promise<NotificationEvent[]> {
    const { data, error } = await this.db
      .from("notification_events")
      .select("*, viewing_bookings(booking_reference)")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      event: r.event as string,
      channel: r.channel as string,
      bookingId: (r.booking_id as string) ?? null,
      bookingReference: ((r.viewing_bookings as Row)?.booking_reference as string) ?? null,
      status: r.status as NotificationEvent["status"],
      attempts: r.attempts as number,
      lastError: (r.last_error as string) ?? null,
      payload: (r.payload as Record<string, unknown>) ?? {},
      createdAt: r.created_at as string,
      deliveredAt: (r.delivered_at as string) ?? null,
    }));
  }

  async queueNotification(event: string, bookingId: string | null, payload: Record<string, unknown> = {}, channel = "telegram") {
    const { error } = await this.db.from("notification_events").insert({
      event, booking_id: bookingId, payload, channel,
    });
    if (error) throw error;
  }

  async claimQueuedNotifications(limit = 20): Promise<NotificationEvent[]> {
    const { data, error } = await this.db
      .from("notification_events")
      .select("*, viewing_bookings(booking_reference)")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .order("created_at").limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      event: r.event as string,
      channel: r.channel as string,
      bookingId: (r.booking_id as string) ?? null,
      bookingReference: ((r.viewing_bookings as Row)?.booking_reference as string) ?? null,
      status: "queued" as const,
      attempts: r.attempts as number,
      lastError: null,
      payload: (r.payload as Record<string, unknown>) ?? {},
      createdAt: r.created_at as string,
      deliveredAt: null,
    }));
  }

  async markNotification(id: string, status: "sent" | "failed" | "skipped", error?: string) {
    const { data } = await this.db.from("notification_events").select("attempts").eq("id", id).maybeSingle();
    const { error: err } = await this.db.from("notification_events").update({
      status,
      attempts: ((data?.attempts as number) ?? 0) + 1,
      last_error: error ?? null,
      delivered_at: status === "sent" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (err) throw err;
  }

  /* ------------------------------------------------------------- settings */

  async getSettings(): Promise<BookingSettings> {
    const { data } = await this.db.from("viewing_settings").select("value").eq("key", "booking").maybeSingle();
    const v = (data?.value ?? {}) as Row;
    return {
      timezone: (v.timezone as string) ?? DEFAULT_SETTINGS.timezone,
      minLeadMinutes: (v.min_lead_minutes as number) ?? DEFAULT_SETTINGS.minLeadMinutes,
      maxDaysAhead: (v.max_days_ahead as number) ?? DEFAULT_SETTINGS.maxDaysAhead,
      defaultSlotMinutes: (v.default_slot_minutes as number) ?? DEFAULT_SETTINGS.defaultSlotMinutes,
      autoCancelUnconfirmed: Boolean(v.auto_cancel_unconfirmed),
      reminderHoursBefore: (v.reminder_hours_before as number) ?? DEFAULT_SETTINGS.reminderHoursBefore,
    };
  }

  async saveSettings(patch: Partial<BookingSettings>) {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    const { error } = await this.db.from("viewing_settings").upsert({
      key: "booking",
      value: {
        timezone: next.timezone,
        min_lead_minutes: next.minLeadMinutes,
        max_days_ahead: next.maxDaysAhead,
        default_slot_minutes: next.defaultSlotMinutes,
        auto_cancel_unconfirmed: next.autoCancelUnconfirmed,
        reminder_hours_before: next.reminderHoursBefore,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) throw error;
  }

  /* ------------------------------------------------------------ scheduled */

  async queueReminders(windowHours: number): Promise<number> {
    const { data, error } = await this.db.rpc("queue_viewing_reminders", { p_window_hours: windowHours });
    if (error) throw error;
    return (data as number) ?? 0;
  }

  async expireConfirmations(): Promise<number> {
    const { data, error } = await this.db.rpc("expire_viewing_confirmations");
    if (error) throw error;
    return (data as number) ?? 0;
  }
}

export function createSupabaseStore(): SupabaseBookingStore | null {
  const db = supabaseAdmin();
  return db ? new SupabaseBookingStore(db) : null;
}
