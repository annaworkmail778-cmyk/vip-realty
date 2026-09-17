"use client";

import { useMemo, useState } from "react";
import { BookingActions } from "./BookingActions";
import { StatusPill } from "./pieces";
import {
  addDays, businessToday, formatDateLong, formatDateShort, formatMonth, formatTime24, weekday,
} from "@/lib/booking/time";
import type { Booking } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   Month, week and day views over the same booking list.

   Cancelled viewings stay visible but dimmed rather than disappearing: an
   agent looking at Thursday needs to know a slot was released, not just that
   it is empty.
---------------------------------------------------------------------------- */

type View = "month" | "week" | "day";

export function ViewingCalendar({
  bookings, initialView, initialDate,
}: {
  bookings: Booking[];
  initialView: View;
  initialDate: string;
}) {
  const [view, setView] = useState<View>(initialView);
  const [cursor, setCursor] = useState(initialDate);
  const [selected, setSelected] = useState<string | null>(null);

  const today = businessToday();

  const byDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date)!.push(b);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [bookings]);

  const step = (dir: number) => {
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(dir > 0 ? addDays(`${cursor.slice(0, 7)}-28`, 7) : addDays(`${cursor.slice(0, 7)}-01`, -1));
  };

  const current = bookings.find((b) => b.reference === selected) ?? null;

  const title = view === "month" ? formatMonth(cursor)
    : view === "week" ? `Week of ${formatDateShort(startOfWeek(cursor))}`
    : formatDateLong(cursor);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className="nav-sq">←</button>
          <button type="button" onClick={() => setCursor(today)} className="label border border-ivory/15 px-4 py-2.5 text-ivory/70 transition-colors duration-300 hover:border-champagne hover:text-champagne">
            Today
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next" className="nav-sq">→</button>
          <p className="ml-3 font-display text-[1.45rem] leading-none">{title}</p>
        </div>

        <div className="flex border border-ivory/12">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`label px-4 py-2.5 transition-colors duration-300 ${
                view === v ? "bg-espresso/70 text-champagne" : "text-ivory/50 hover:text-ivory"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "month" && <MonthView cursor={cursor} today={today} byDate={byDate} onPick={setSelected} onDay={(d) => { setCursor(d); setView("day"); }} />}
      {view === "week" && <WeekView cursor={cursor} today={today} byDate={byDate} onPick={setSelected} />}
      {view === "day" && <DayView cursor={cursor} byDate={byDate} onPick={setSelected} />}

      {current && (
        <div className="fixed inset-0 z-[120] flex justify-end" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-[36rem] overflow-y-auto border-l border-ivory/12 bg-ink p-7 booking-panel-in">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="label text-champagne">{current.reference}</p>
                <h2 className="mt-2 font-display text-[1.7rem] leading-none">{current.customerName}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="label text-ivory/40 hover:text-ivory">Close ✕</button>
            </div>
            <div className="mt-7"><BookingActions booking={current} onDone={() => setSelected(null)} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

const startOfWeek = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

function MonthView({
  cursor, today, byDate, onPick, onDay,
}: {
  cursor: string; today: string; byDate: Map<string, Booking[]>;
  onPick: (ref: string) => void; onDay: (date: string) => void;
}) {
  const first = `${cursor.slice(0, 7)}-01`;
  const lead = (weekday(first) + 6) % 7;
  const days = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);

  return (
    <div className="mt-6 grid grid-cols-7 gap-px border border-ivory/10 bg-ivory/10">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className="label bg-ink px-2 py-2.5 text-center text-ivory/30">{d}</div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`p${i}`} className="min-h-[6.5rem] bg-ink/50" />;
        const list = byDate.get(date) ?? [];
        const live = list.filter((b) => b.status !== "cancelled");
        return (
          <div key={date} className={`min-h-[6.5rem] bg-ink p-2 ${date === today ? "ring-1 ring-inset ring-champagne/40" : ""}`}>
            <button type="button" onClick={() => onDay(date)} className="label text-ivory/45 transition-colors hover:text-champagne">
              {Number(date.slice(8))}
              {live.length > 0 && <span className="ml-1.5 text-champagne">· {live.length}</span>}
            </button>
            <div className="mt-1.5 space-y-1">
              {list.slice(0, 3).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onPick(b.reference)}
                  className={`block w-full truncate border-l-2 pl-1.5 text-left text-[0.68rem] leading-tight transition-colors duration-200 hover:text-champagne ${
                    b.status === "cancelled" ? "border-ivory/15 text-ivory/25 line-through" : "border-champagne/70 text-ivory/80"
                  }`}
                >
                  {formatTime24(b.startTime)} {b.customerName}
                </button>
              ))}
              {list.length > 3 && <p className="label text-[0.55rem] text-ivory/30">+{list.length - 3} more</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({
  cursor, today, byDate, onPick,
}: { cursor: string; today: string; byDate: Map<string, Booking[]>; onPick: (ref: string) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="mt-6 grid gap-px border border-ivory/10 bg-ivory/10 md:grid-cols-7">
      {days.map((date) => {
        const list = byDate.get(date) ?? [];
        return (
          <div key={date} className={`min-h-[14rem] bg-ink p-3 ${date === today ? "ring-1 ring-inset ring-champagne/40" : ""}`}>
            <p className="label text-ivory/40">{formatDateShort(date)}</p>
            <div className="mt-3 space-y-2">
              {list.length === 0 && <p className="label text-[0.55rem] text-ivory/20">—</p>}
              {list.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onPick(b.reference)}
                  className={`block w-full border-l-2 pl-2 text-left transition-colors duration-200 hover:bg-ivory/[0.04] ${
                    b.status === "cancelled" ? "border-ivory/15 opacity-40" : "border-champagne/70"
                  }`}
                >
                  <span className="label block text-champagne">{formatTime24(b.startTime)}</span>
                  <span className="block truncate text-[0.8rem] text-ivory">{b.customerName}</span>
                  <span className="label block truncate text-[0.55rem] text-ivory/40">{b.propertyTitle}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  cursor, byDate, onPick,
}: { cursor: string; byDate: Map<string, Booking[]>; onPick: (ref: string) => void }) {
  const list = byDate.get(cursor) ?? [];

  return (
    <div className="mt-6 border border-ivory/10">
      {list.length === 0 && <p className="label px-5 py-12 text-ivory/25">No viewings on this day.</p>}
      {list.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onPick(b.reference)}
          className={`flex w-full flex-wrap items-center gap-x-6 gap-y-2 border-b border-ivory/8 px-5 py-4 text-left transition-colors duration-200 hover:bg-ivory/[0.03] ${
            b.status === "cancelled" ? "opacity-45" : ""
          }`}
        >
          <span className="label w-24 shrink-0 text-champagne">
            {formatTime24(b.startTime)}–{formatTime24(b.endTime)}
          </span>
          <span className="min-w-[9rem] flex-1 text-[0.95rem] text-ivory">{b.customerName}</span>
          <span className="label min-w-[9rem] flex-1 text-ivory/55">{b.propertyTitle}</span>
          <span className="label text-ivory/40">{b.customerPhone}</span>
          <span className="label hidden text-ivory/40 lg:block">{b.customerEmail}</span>
          <StatusPill status={b.status} />
        </button>
      ))}
    </div>
  );
}
