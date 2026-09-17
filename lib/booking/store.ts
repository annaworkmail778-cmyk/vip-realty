import "server-only";
import type {
  Blackout, Booking, BookingResult, BookingSettings, BookingStatus, CreateBookingInput,
  DateOverride, DayAvailability, NotificationEvent, PropertyRecord, ScheduleRule, Slot,
} from "./types";
import type { DateString, TimeString } from "./time";

/* ----------------------------------------------------------------------------
   The single data-access seam for the viewing system.

   Everything above this line — routes, server components, the reminder job —
   talks to this interface and nothing else. Today it is backed by Supabase in
   production and a file-backed store in development; adding a different
   backend later means one new implementation, not a rewrite.
---------------------------------------------------------------------------- */

export interface BookingFilter {
  from?: DateString;
  to?: DateString;
  status?: BookingStatus[];
  propertySlug?: string;
  search?: string;
  limit?: number;
}

export interface BookingStore {
  readonly kind: "supabase" | "development";

  listProperties(): Promise<PropertyRecord[]>;
  getProperty(slug: string): Promise<PropertyRecord | null>;
  setPropertyViewingMode(slug: string, mode: PropertyRecord["viewingMode"], durationMinutes?: number): Promise<void>;

  slotsForDate(slug: string, date: DateString): Promise<Slot[]>;
  availability(slug: string, from: DateString, to: DateString): Promise<DayAvailability[]>;

  createBooking(input: CreateBookingInput): Promise<BookingResult>;
  getBooking(reference: string, token?: string): Promise<Booking | null>;
  listBookings(filter?: BookingFilter): Promise<Booking[]>;
  cancelBooking(reference: string, by: "customer" | "admin" | "system", token?: string, reason?: string): Promise<BookingResult>;
  confirmBooking(reference: string, token: string): Promise<BookingResult>;
  rescheduleBooking(reference: string, date: DateString, startTime: TimeString, by: "customer" | "admin"): Promise<BookingResult>;
  setBookingStatus(reference: string, status: BookingStatus, note?: string): Promise<BookingResult>;

  listRules(propertySlug?: string | null): Promise<ScheduleRule[]>;
  saveRule(rule: Omit<ScheduleRule, "id" | "propertyId"> & { id?: string }): Promise<void>;
  deleteRule(id: string): Promise<void>;

  listBlackouts(from: DateString, to: DateString): Promise<Blackout[]>;
  addBlackout(input: { propertySlug: string | null; date: DateString; startTime?: TimeString | null; endTime?: TimeString | null; reason?: string }): Promise<void>;
  deleteBlackout(id: string): Promise<void>;

  listDateOverrides(propertySlug: string | null, from: DateString, to: DateString): Promise<DateOverride[]>;
  saveDateOverride(input: { propertySlug: string | null; date: DateString; startTime: TimeString; endTime: TimeString; isAvailable: boolean; note?: string }): Promise<void>;
  deleteDateOverride(id: string): Promise<void>;

  listNotificationEvents(limit?: number): Promise<NotificationEvent[]>;
  queueNotification(event: string, bookingId: string | null, payload?: Record<string, unknown>, channel?: string): Promise<void>;
  claimQueuedNotifications(limit?: number): Promise<NotificationEvent[]>;
  markNotification(id: string, status: "sent" | "failed" | "skipped", error?: string): Promise<void>;

  getSettings(): Promise<BookingSettings>;
  saveSettings(settings: Partial<BookingSettings>): Promise<void>;

  queueReminders(windowHours: number): Promise<number>;
  expireConfirmations(): Promise<number>;
}

export const DEFAULT_SETTINGS: BookingSettings = {
  timezone: "Asia/Yerevan",
  minLeadMinutes: 180,
  maxDaysAhead: 60,
  defaultSlotMinutes: 90,
  autoCancelUnconfirmed: false,
  reminderHoursBefore: 24,
};
