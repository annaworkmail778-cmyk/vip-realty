/* ----------------------------------------------------------------------------
   Time handling for viewings.

   One rule underpins all of this: a viewing time is a wall-clock time in
   Asia/Yerevan. It is stored as a plain date + plain time, never as a UTC
   instant the browser might reinterpret. Nothing here ever converts a slot
   through the visitor's local zone, which is what causes "customer picked
   15:00, admin sees 14:00" bugs.
---------------------------------------------------------------------------- */

export const BUSINESS_TIMEZONE = "Asia/Yerevan";

/** A calendar day as `YYYY-MM-DD`. */
export type DateString = string;
/** A wall-clock time as `HH:MM` or `HH:MM:SS`. */
export type TimeString = string;

const partsIn = (date: Date, timeZone = BUSINESS_TIMEZONE) => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = p.value;
  return out;
};

/** Today in the agency's timezone, not the visitor's. */
export function businessToday(now = new Date()): DateString {
  const p = partsIn(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Current wall-clock time in the agency's timezone, as `HH:MM`. */
export function businessNowTime(now = new Date()): TimeString {
  const p = partsIn(now);
  return `${p.hour}:${p.minute}`;
}

export const toMinutes = (t: TimeString) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export const fromMinutes = (mins: number): TimeString =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** `HH:MM:SS` → `HH:MM`. Postgres returns the longer form. */
export const shortTime = (t: TimeString) => t.slice(0, 5);

export function addDays(date: DateString, days: number): DateString {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: DateString, to: DateString): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 0 = Sunday, matching Postgres `extract(dow)`. */
export function weekday(date: DateString): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* --------------------------------- display -------------------------------- */

const dateFormatter = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });

/** "Monday, 14 September 2026" */
export const formatDateLong = (date: DateString) =>
  dateFormatter({ weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));

/** "Mon 14 Sep" */
export const formatDateShort = (date: DateString) =>
  dateFormatter({ weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${date}T12:00:00Z`));

/** "September 2026" */
export const formatMonth = (date: DateString) =>
  dateFormatter({ month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));

/**
 * Customer-facing times read as "2:30 PM"; the admin screens use the 24-hour
 * form the agency works in.
 */
export function formatTime12(t: TimeString): string {
  const mins = toMinutes(shortTime(t));
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const formatTime24 = (t: TimeString) => shortTime(t);

/** Fixed +04:00 — Armenia has had no daylight saving since 2012. */
export const YEREVAN_UTC_OFFSET = "+04:00";

/** The instant a slot begins, for calendar files and reminder scheduling. */
export const slotInstant = (date: DateString, time: TimeString): Date =>
  new Date(`${date}T${shortTime(time)}:00${YEREVAN_UTC_OFFSET}`);

/** Compact UTC stamp for .ics files: 20260914T103000Z */
export const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
