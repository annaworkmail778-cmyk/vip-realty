"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { MAP_DISTRICTS as DISTRICTS } from "@/lib/listings/taxonomy";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import type { MapDistrictId as District } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   The Yerevan map, shared by the neighbourhood section and the property page.

   A real street map (OpenStreetMap tiles, toned dark in CSS to match the site) with one marker per administrative district. Listings are counted at
   their district's centre — never placed at an address. Leaflet is loaded in
   the browser only; the server renders the sized, dark frame.

   On touch screens one-finger drag is left to the page scroll; the zoom
   buttons and pinch still work. The mouse wheel never zooms the map.
---------------------------------------------------------------------------- */

export interface MapPin {
  slug: string;
  map: { district: District; lat: number; lng: number };
}

const CENTER: [number, number] = [40.1792, 44.5152];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function YerevanMap({
  selected = null,
  pins = [],
  counts,
  onSelectDistrict,
  className = "",
}: {
  selected?: District | null;
  pins?: MapPin[];
  /** Kept for callers that track the previewed listing; markers are per district. */
  activeSlug?: string | null;
  counts?: Partial<Record<District, number>>;
  onSelectDistrict?: (id: District) => void;
  onSelectPin?: (slug: string) => void;
  className?: string;
}) {
  const dict = useDict();
  const fmt = useFormat();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const select = useRef(onSelectDistrict);
  select.current = onSelectDistrict;
  const interactive = Boolean(onSelectDistrict);
  const flownTo = useRef<string | null | undefined>(undefined);

  /* One map per mount. */
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current || map.current) return;
      lib.current = L;
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const m = L.map(box.current, {
        center: CENTER,
        zoom: 12,
        minZoom: 11,
        maxZoom: 17,
        scrollWheelZoom: false,
        dragging: !touch,
        zoomControl: false,
        attributionControl: false,
      });
      L.control.zoom({ position: "bottomright" }).addTo(m);
      L.control.attribution({ position: "bottomleft", prefix: false }).addAttribution(ATTRIBUTION).addTo(m);
      L.tileLayer(TILES, { maxZoom: 19, className: "vr-tiles" }).addTo(m);
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Markers follow the selection and counts. */
  function draw() {
    const L = lib.current, m = map.current, g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();

    const pinned = new Set(pins.map((p) => p.map.district));
    const shown = interactive ? DISTRICTS : DISTRICTS.filter((d) => d.id === selected || pinned.has(d.id));

    for (const d of shown) {
      const on = selected === d.id;
      const count = counts?.[d.id] ?? 0;
      const label = fmt.district(d.id);
      const html =
        `<span class="vr-pin${on ? " is-on" : ""}${count > 0 || !interactive ? " has-items" : ""}">` +
        `<span class="vr-pin-dot">${interactive && count > 0 ? count : ""}</span>` +
        `<span class="vr-pin-label">${esc(label)}</span></span>`;
      const marker = L.marker([d.map.lat, d.map.lng], {
        icon: L.divIcon({ html, className: "vr-pin-wrap", iconSize: [0, 0] }),
        keyboard: interactive,
        title: interactive ? fill(dict.map.districtCount, { district: label, count }) : label,
        riseOnHover: true,
        zIndexOffset: on ? 1000 : count > 0 ? 500 : 0,
      });
      if (interactive) marker.on("click", () => select.current?.(d.id));
      marker.addTo(g);
    }

    /* Move the camera only when the selection changes, not on every render. */
    if (flownTo.current === selected) return;
    const first = flownTo.current === undefined;
    flownTo.current = selected;
    const focus = DISTRICTS.find((d) => d.id === selected);
    if (focus) m.flyTo([focus.map.lat, focus.map.lng], 14, { duration: first ? 0 : 0.8 });
    else if (!first) m.flyTo(CENTER, 12, { duration: 0.8 });
  }

  useEffect(draw); // cheap: at most twelve markers

  return (
    <div
      ref={box}
      role="img"
      aria-label={dict.map.alt}
      className={`vr-map relative z-0 h-[22rem] w-full overflow-hidden bg-[#0e0e10] sm:h-[28rem] lg:h-[32rem] ${className}`}
    />
  );
}
