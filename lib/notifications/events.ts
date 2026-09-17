import type { Booking } from "@/lib/booking/types";
import { formatDateLong, formatTime24 } from "@/lib/booking/time";
import { STATUS_LABELS } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   Notification events and how they read.

   Message rendering is deliberately channel-agnostic: a title, a set of
   labelled lines, and an optional link. Telegram formats it today; email, SMS
   or WhatsApp can format the same structure later without new event plumbing.
---------------------------------------------------------------------------- */

export const NOTIFICATION_EVENTS = [
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.rescheduled",
  "customer.confirmed",
  "customer.declined",
  "customer.not_confirmed",
  "viewing.completed",
  "viewing.no_show",
  "reminder.customer",
] as const;

export type NotificationEventName = (typeof NOTIFICATION_EVENTS)[number];

export const EVENT_LABELS: Record<NotificationEventName, string> = {
  "booking.created": "New booking",
  "booking.confirmed": "Booking confirmed",
  "booking.cancelled": "Booking cancelled",
  "booking.rescheduled": "Booking rescheduled",
  "customer.confirmed": "Customer confirmed",
  "customer.declined": "Customer declined",
  "customer.not_confirmed": "Customer did not confirm",
  "viewing.completed": "Viewing completed",
  "viewing.no_show": "No-show",
  "reminder.customer": "Customer reminder",
};

const HEADINGS: Record<NotificationEventName, string> = {
  "booking.created": "🏠 NEW APEX REALTY VIEWING",
  "booking.confirmed": "✅ VIEWING CONFIRMED",
  "booking.cancelled": "❌ VIEWING CANCELLED",
  "booking.rescheduled": "🔁 VIEWING RESCHEDULED",
  "customer.confirmed": "✅ CUSTOMER CONFIRMED",
  "customer.declined": "❌ CUSTOMER CANCELLED",
  "customer.not_confirmed": "⚠️ NOT CONFIRMED BY CUSTOMER",
  "viewing.completed": "🏁 VIEWING COMPLETED",
  "viewing.no_show": "🚫 NO-SHOW",
  "reminder.customer": "⏰ REMINDER SENT",
};

export interface RenderedMessage {
  heading: string;
  lines: { label: string; value: string }[];
  footer?: string;
}

export function renderMessage(
  event: NotificationEventName,
  booking: Booking,
  payload: Record<string, unknown> = {},
): RenderedMessage {
  const lines: { label: string; value: string }[] = [
    { label: "Property", value: booking.propertyTitle },
    { label: "Location", value: booking.propertyAddress ?? booking.propertyLocation },
    { label: "Customer", value: booking.customerName },
    { label: "Phone", value: booking.customerPhone },
    { label: "Email", value: booking.customerEmail },
    { label: "Date", value: formatDateLong(booking.date) },
    { label: "Time", value: `${formatTime24(booking.startTime)} – ${formatTime24(booking.endTime)} (Yerevan)` },
    { label: "Status", value: statusLine(booking) },
    { label: "Booking", value: booking.reference },
  ];

  if (event === "booking.rescheduled" && payload.from) {
    const from = payload.from as { date?: string; start_time?: string };
    if (from.date && from.start_time) {
      lines.splice(6, 0, {
        label: "Moved from",
        value: `${formatDateLong(from.date)} at ${formatTime24(from.start_time)}`,
      });
    }
  }
  if (booking.customerMessage) lines.push({ label: "Message", value: booking.customerMessage });
  if (event === "booking.cancelled" && booking.cancellationReason) {
    lines.push({ label: "Reason", value: booking.cancellationReason });
  }
  if (event === "booking.cancelled" && payload.by) {
    lines.push({ label: "Cancelled by", value: String(payload.by) });
  }

  return { heading: HEADINGS[event] ?? EVENT_LABELS[event] ?? event, lines };
}

function statusLine(b: Booking): string {
  if (b.status === "pending" && b.confirmationStatus === "pending") return "Pending confirmation";
  if (b.status === "confirmed" && b.confirmationStatus === "confirmed") return "Confirmed by customer";
  return STATUS_LABELS[b.status];
}
