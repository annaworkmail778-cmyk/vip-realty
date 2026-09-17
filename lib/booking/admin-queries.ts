import "server-only";
import { getBookingStore } from "./index";
import { addDays, businessToday } from "./time";
import type { Booking } from "./types";

/* Aggregations the admin screens need. Kept here so each page is a thin
   rendering of one shaped result rather than a pile of filters. */

export interface DashboardData {
  today: Booking[];
  upcoming: Booking[];
  counts: {
    today: number;
    upcoming: number;
    pendingConfirmation: number;
    cancelled: number;
    noShow: number;
    completed: number;
  };
  recent: Booking[];
}

export async function dashboardData(): Promise<DashboardData> {
  const store = getBookingStore();
  const today = businessToday();

  const [window, historic] = await Promise.all([
    store.listBookings({ from: addDays(today, -30), to: addDays(today, 90) }),
    store.listBookings({ from: addDays(today, -365), to: today }),
  ]);

  const live = (b: Booking) => b.status === "pending" || b.status === "confirmed";

  return {
    today: window.filter((b) => b.date === today && live(b)),
    upcoming: window.filter((b) => b.date > today && live(b)).slice(0, 8),
    counts: {
      today: window.filter((b) => b.date === today && live(b)).length,
      upcoming: window.filter((b) => b.date > today && live(b)).length,
      pendingConfirmation: window.filter((b) => b.date >= today && live(b) && b.confirmationStatus === "pending").length,
      cancelled: historic.filter((b) => b.status === "cancelled").length,
      noShow: historic.filter((b) => b.status === "no_show").length,
      completed: historic.filter((b) => b.status === "completed").length,
    },
    recent: [...window].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
  };
}

export interface CustomerSummary {
  email: string;
  name: string;
  phone: string;
  bookings: number;
  lastDate: string;
  statuses: Record<string, number>;
  consent: boolean;
}

/** Customers are derived from bookings: there is no separate account system. */
export async function customerSummaries(): Promise<CustomerSummary[]> {
  const bookings = await getBookingStore().listBookings({
    from: addDays(businessToday(), -730),
    to: addDays(businessToday(), 365),
  });

  const byEmail = new Map<string, CustomerSummary>();
  for (const b of bookings) {
    const key = b.customerEmail.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.bookings += 1;
      existing.statuses[b.status] = (existing.statuses[b.status] ?? 0) + 1;
      if (b.date > existing.lastDate) {
        existing.lastDate = b.date;
        existing.name = b.customerName;
        existing.phone = b.customerPhone;
      }
      existing.consent ||= b.contactConsent;
    } else {
      byEmail.set(key, {
        email: b.customerEmail,
        name: b.customerName,
        phone: b.customerPhone,
        bookings: 1,
        lastDate: b.date,
        statuses: { [b.status]: 1 },
        consent: b.contactConsent,
      });
    }
  }

  return [...byEmail.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
