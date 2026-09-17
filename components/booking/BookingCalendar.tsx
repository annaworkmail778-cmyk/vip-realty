"use client";

import { useMemo } from "react";
import { addDays, businessToday, formatMonth, WEEKDAY_NAMES } from "@/lib/booking/time";

/* ----------------------------------------------------------------------------
   Month calendar.

   Only dates the server actually offers are selectable — availability is not
   guessed from opening hours, it is the list of dates that came back with at
   least one open slot. Everything else is visibly inert rather than hidden, so
   the shape of the month still reads.
---------------------------------------------------------------------------- */

interface Props {
  month: string;               // any date inside the month being shown
  availableDates: Set<string>;
  selected: string | null;
  minDate: string;
  maxDate: string;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
}

const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;

function monthGrid(month: string): (string | null)[] {
  const first = startOfMonth(month);
  const firstDow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const daysInMonth = new Date(
    Number(first.slice(0, 4)),
    Number(first.slice(5, 7)),
    0,
  ).getDate();

  // Monday-first, which is how Armenian calendars read.
  const lead = (firstDow + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; i < daysInMonth; i++) cells.push(addDays(first, i));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function BookingCalendar({
  month, availableDates, selected, minDate, maxDate, onSelect, onMonthChange,
}: Props) {
  const cells = useMemo(() => monthGrid(month), [month]);
  const today = businessToday();

  const prevMonth = addDays(startOfMonth(month), -1);
  const nextMonth = addDays(`${month.slice(0, 7)}-28`, 7);
  const canGoBack = prevMonth >= startOfMonth(minDate);
  const canGoForward = startOfMonth(nextMonth) <= startOfMonth(maxDate);

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-display text-[1.5rem] leading-none">{formatMonth(month)}</p>
        <div className="flex items-center gap-1">
          <MonthButton label="Previous month" disabled={!canGoBack} onClick={() => onMonthChange(startOfMonth(prevMonth))}>←</MonthButton>
          <MonthButton label="Next month" disabled={!canGoForward} onClick={() => onMonthChange(startOfMonth(nextMonth))}>→</MonthButton>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-7 gap-px" role="grid">
        {WEEKDAY_NAMES.slice(1).concat(WEEKDAY_NAMES[0]).map((d) => (
          <div key={d} className="label pb-3 text-center text-[0.55rem] text-ivory/30">{d.slice(0, 2)}</div>
        ))}

        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} aria-hidden />;
          const available = availableDates.has(date);
          const isSelected = date === selected;
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              disabled={!available}
              aria-pressed={isSelected}
              aria-label={`${date}${available ? "" : ", no viewings available"}`}
              onClick={() => onSelect(date)}
              className={[
                "relative aspect-square text-[0.9rem] transition-all duration-300",
                "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-champagne",
                isSelected
                  ? "bg-champagne text-black"
                  : available
                    ? "text-ivory hover:bg-ivory/10"
                    : "cursor-not-allowed text-ivory/20",
              ].join(" ")}
            >
              {Number(date.slice(8, 10))}
              {available && !isSelected && (
                <span className="absolute bottom-[18%] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-champagne" aria-hidden />
              )}
              {isToday && !isSelected && (
                <span className="absolute inset-x-[28%] top-[14%] h-px bg-ivory/25" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthButton({
  children, label, disabled, onClick,
}: { children: React.ReactNode; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center border border-ivory/15 text-ivory/70 transition-colors duration-300 hover:border-champagne hover:text-champagne disabled:cursor-not-allowed disabled:border-ivory/5 disabled:text-ivory/15"
    >
      {children}
    </button>
  );
}
