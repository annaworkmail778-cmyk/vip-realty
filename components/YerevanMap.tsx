"use client";

import { DISTRICTS, type District, type Property } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   The stylized Yerevan map, shared by the neighbourhood section and the
   property detail page.

   MAP_SHAPES is abstract placeholder geometry. Replace the five paths with real
   district outlines (or put a tile image behind the <svg>) and every consumer
   keeps working — positions come from `map: { x, y }` in lib/properties.
---------------------------------------------------------------------------- */

export const MAP_SHAPES: Record<District, string> = {
  davtashen: "M 8 8 L 40 12 L 37 35 L 11 33 Z",
  arabkir:   "M 41 14 L 66 18 L 62 45 L 38 42 Z",
  avan:      "M 69 12 L 94 18 L 89 43 L 66 39 Z",
  ajapnyak:  "M 6 40 L 34 46 L 30 70 L 8 65 Z",
  kentron:   "M 38 48 L 66 50 L 70 78 L 40 75 Z",
};

export function YerevanMap({
  selected = null,
  pins = [],
  activeSlug = null,
  counts,
  onSelectDistrict,
  onSelectPin,
  className = "",
}: {
  selected?: District | null;
  pins?: Property[];
  activeSlug?: string | null;
  counts?: Partial<Record<District, number>>;
  onSelectDistrict?: (id: District) => void;
  onSelectPin?: (slug: string) => void;
  className?: string;
}) {
  const interactive = Boolean(onSelectDistrict);

  return (
    <svg
      viewBox="0 0 100 85"
      role="img"
      aria-label="Stylized map of Yerevan districts"
      className={`w-full ${className}`}
    >
      <defs>
        <linearGradient id="mapDistrict" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a1d16" />
          <stop offset="1" stopColor="#1b1512" />
        </linearGradient>
      </defs>

      <rect width="100" height="85" fill="#100d0c" />

      {/* the gorge */}
      <path
        d="M 37 0 C 31 16 23 28 27 44 C 31 60 25 72 19 85"
        stroke="#1d2a2b" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity="0.9"
      />

      {/* avenues */}
      <g stroke="#3b2a20" strokeWidth="0.45" fill="none" opacity="0.85">
        <path d="M 0 47 L 100 41" />
        <path d="M 52 0 L 48 85" />
        <path d="M 12 78 L 88 20" />
        <circle cx="53" cy="60" r="9" />
      </g>

      {DISTRICTS.map((d) => {
        const on = selected === d.id;
        const count = counts?.[d.id];
        const Shape = (
          <>
            <path
              d={MAP_SHAPES[d.id]}
              fill={on ? "#3b2a20" : "url(#mapDistrict)"}
              stroke={on ? "#c9a227" : "#4a3428"}
              strokeWidth={on ? 0.55 : 0.3}
              opacity={selected && !on ? 0.4 : 1}
              className="transition-all duration-500"
            />
            <text
              x={d.map.x} y={d.map.y} textAnchor="middle"
              fill={on ? "#d9be7a" : "#c9b79f"}
              opacity={selected && !on ? 0.45 : 0.85}
              className="pointer-events-none select-none"
              style={{ fontSize: 2.6, letterSpacing: 0.55, fontFamily: "var(--font-sans)" }}
            >
              {d.label.toUpperCase()}
            </text>
            {count !== undefined && (
              <text
                x={d.map.x} y={d.map.y + 3.6} textAnchor="middle"
                fill="#c9a227" opacity={on ? 0.9 : 0.45}
                className="pointer-events-none select-none"
                style={{ fontSize: 2, fontFamily: "var(--font-sans)" }}
              >
                {count}
              </text>
            )}
          </>
        );

        return interactive ? (
          <g
            key={d.id}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${d.label}${count !== undefined ? `, ${count} properties` : ""}`}
            className="cursor-pointer outline-none focus-visible:[&>path]:stroke-champagne"
            onClick={() => onSelectDistrict?.(d.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectDistrict?.(d.id); }
            }}
          >
            {Shape}
          </g>
        ) : (
          <g key={d.id}>{Shape}</g>
        );
      })}

      {pins.map((p) => {
        const on = activeSlug === p.slug;
        return (
          <g
            key={p.slug}
            transform={`translate(${p.map.x} ${p.map.y + 7})`}
            className={onSelectPin ? "cursor-pointer" : undefined}
            onClick={onSelectPin ? () => onSelectPin(p.slug) : undefined}
          >
            <circle r={on ? 1.5 : 1} fill={on ? "#d9be7a" : "#f4efe7"} className="transition-all duration-500" />
            <circle
              r={on ? 3.4 : 2.2} fill="none" stroke="#c9a227" strokeWidth="0.22"
              opacity={on ? 0.9 : 0.35} className="transition-all duration-500"
            />
          </g>
        );
      })}
    </svg>
  );
}
