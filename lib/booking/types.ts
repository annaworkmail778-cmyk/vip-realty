import type { DateString, TimeString } from "./time";

/* Domain types for the viewing system. These mirror the database exactly, so
   a column rename is a compile error rather than a runtime surprise. */

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CONFIRMATION_STATUSES = ["pending", "confirmed", "declined", "expired"] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export type ViewingMode = "standard" | "appointment_only" | "unavailable";
export type ViewingType = "in_person" | "virtual";
export type BookingSource = "website" | "admin" | "phone" | "import";
export type Actor = "customer" | "admin" | "system";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export const CONFIRMATION_LABELS: Record<ConfirmationStatus, string> = {
  pending: "Awaiting customer",
  confirmed: "Customer confirmed",
  declined: "Customer declined",
  expired: "Never confirmed",
};

export interface PropertyRecord {
  id: string;
  slug: string;
  title: string;
  location: string;
  address: string | null;
  propertyType: string;
  status: string;
  viewingMode: ViewingMode;
  viewingDurationMinutes: number;
  price: number | null;
  pricePeriod: "month" | "year" | null;
  metadata: Record<string, unknown>;
}

export interface Slot {
  startTime: TimeString;
  endTime: TimeString;
  isOpen: boolean;
  /** Why a slot is closed: 'booked' | 'blocked' | 'past'. */
  reason: string | null;
}

export interface DayAvailability {
  date: DateString;
  slots: Slot[];
  openCount: number;
}

export interface Booking {
  id: string;
  reference: string;
  propertyId: string;
  propertySlug: string;
  propertyTitle: string;
  propertyLocation: string;
  propertyAddress: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerMessage: string | null;
  contactConsent: boolean;
  date: DateString;
  startTime: TimeString;
  endTime: TimeString;
  startsAt: string;
  viewingType: ViewingType;
  status: BookingStatus;
  confirmationStatus: ConfirmationStatus;
  source: BookingSource;
  cancelledBy: Actor | null;
  cancellationReason: string | null;
  internalNote: string | null;
  createdAt: string;
  /** Only ever returned to the person who owns the booking. */
  manageToken?: string;
}

export interface CreateBookingInput {
  propertySlug: string;
  date: DateString;
  startTime: TimeString;
  name: string;
  phone: string;
  email: string;
  message?: string;
  consent?: boolean;
  viewingType?: ViewingType;
  source?: BookingSource;
}

export interface ScheduleRule {
  id: string;
  propertyId: string | null;
  propertySlug: string | null;
  weekday: number;
  startTime: TimeString;
  endTime: TimeString;
  slotMinutes: number;
  isActive: boolean;
}

export interface Blackout {
  id: string;
  propertyId: string | null;
  propertySlug: string | null;
  date: DateString;
  startTime: TimeString | null;
  endTime: TimeString | null;
  reason: string | null;
}

export interface DateOverride {
  id: string;
  propertyId: string | null;
  propertySlug: string | null;
  date: DateString;
  startTime: TimeString;
  endTime: TimeString;
  isAvailable: boolean;
  note: string | null;
}

export interface NotificationEvent {
  id: string;
  event: string;
  channel: string;
  bookingId: string | null;
  bookingReference: string | null;
  status: "queued" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  deliveredAt: string | null;
}

export interface BookingSettings {
  timezone: string;
  minLeadMinutes: number;
  maxDaysAhead: number;
  defaultSlotMinutes: number;
  autoCancelUnconfirmed: boolean;
  reminderHoursBefore: number;
}

/* Result type shared by every mutating operation. Errors are codes, not
   sentences, so the UI owns the wording and the API stays stable. */
export type BookingError =
  | "slot_taken"
  | "slot_unavailable"
  | "slot_not_offered"
  | "property_not_found"
  | "viewings_not_bookable"
  | "not_found"
  | "cancelled"
  | "not_cancellable"
  | "not_reschedulable"
  | "invalid_input"
  | "store_unavailable";

export type BookingResult =
  | { ok: true; booking: Booking; already?: boolean }
  | { ok: false; error: BookingError; message?: string; fields?: Record<string, string> };

export const ERROR_MESSAGES: Record<BookingError, string> = {
  slot_taken: "This viewing time is no longer available. Please select another time.",
  slot_unavailable: "This viewing time is no longer available. Please select another time.",
  slot_not_offered: "That time is not offered for this property. Please select another time.",
  property_not_found: "We could not find that property.",
  viewings_not_bookable: "This property is viewed by appointment. Please contact us directly.",
  not_found: "We could not find that booking.",
  cancelled: "This viewing has already been cancelled.",
  not_cancellable: "This viewing can no longer be cancelled online. Please contact us.",
  not_reschedulable: "This viewing can no longer be rescheduled. Please contact us.",
  invalid_input: "Please check the details and try again.",
  store_unavailable: "Bookings are temporarily unavailable. Please contact us directly.",
};
