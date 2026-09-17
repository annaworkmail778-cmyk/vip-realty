import { propertyMedia } from "./media";

/* ----------------------------------------------------------------------------
   LEGACY hard-coded property data — NOT the source of truth.

   The public website reads listings from Supabase (lib/listings). This file is
   kept only for the legacy booking system, which still depends on it:
     * lib/booking/index.ts            (development booking store)
     * components/booking/*            (the `Property` prop type)
     * lib/listings/legacy-booking.ts  (offers booking only for these slugs)
     * scripts/media/install-photos.mjs (legacy local photo installer)
   It is removed together with booking in Phase 3. Do not add listings here.
---------------------------------------------------------------------------- */

export type Intent = "buy" | "rent" | "land";
export type Category = "apartments" | "houses" | "land" | "commercial";
export type District = "kentron" | "arabkir" | "davtashen" | "ajapnyak" | "avan";

export interface Property {
  slug: string;
  name: string;
  /** Editorial index shown in the scroll sequence: "01", "02", … */
  index: string;
  district: District;
  districtLabel: string;
  city: string;
  intent: Intent;
  category: Category;
  typeLabel: string;
  price: number;
  /** Rentals are quoted per month. */
  period?: "month";
  area: number;
  bedrooms: number;
  bathrooms: number;
  floor?: string;
  year?: number;
  /** Position on the stylized map, in 0–100 viewBox units. */
  map: { x: number; y: number };
  summary: string;
  description: string[];
  features: string[];
  featured?: boolean;
  media: ReturnType<typeof propertyMedia>;
}

const p = (
  data: Omit<Property, "media" | "districtLabel"> & { districtLabel?: string },
): Property => ({
  ...data,
  districtLabel: data.districtLabel ?? DISTRICTS.find((d) => d.id === data.district)!.label,
  media: propertyMedia(data.slug),
});

export const DISTRICTS: { id: District; label: string; blurb: string; map: { x: number; y: number } }[] = [
  { id: "kentron",   label: "Kentron",   blurb: "The centre. Opera, Northern Avenue, the cafés that never close.", map: { x: 52, y: 58 } },
  { id: "arabkir",   label: "Arabkir",   blurb: "Established, green, quietly residential. Long streets and old trees.", map: { x: 46, y: 34 } },
  { id: "davtashen", label: "Davtashen", blurb: "Open skies and new build. Families, space, the ring road close by.", map: { x: 24, y: 22 } },
  { id: "ajapnyak",  label: "Ajapnyak",  blurb: "West of the gorge. Wide views back toward the city and Ararat.", map: { x: 20, y: 52 } },
  { id: "avan",      label: "Avan",      blurb: "Elevated and calm, on the north-eastern edge. Air and distance.", map: { x: 78, y: 26 } },
];

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: "apartments", label: "Apartments", blurb: "City floors with light on two sides, from pre-war stone to new towers." },
  { id: "houses",     label: "Houses",     blurb: "Private homes, terraces and gardens within reach of the centre." },
  { id: "land",       label: "Land",       blurb: "Plots with permissions, orientation and a view worth building toward." },
  { id: "commercial", label: "Commercial", blurb: "Ground floors, studios and offices on streets people actually walk." },
];

export const PROPERTY_TYPES = [
  { id: "any", label: "Any type" },
  { id: "apartments", label: "Apartment" },
  { id: "houses", label: "House" },
  { id: "land", label: "Land" },
  { id: "commercial", label: "Commercial" },
] as const;

export const PRICE_BANDS = [
  { id: "any", label: "Any price", min: 0, max: Infinity },
  { id: "0-150", label: "Up to $150,000", min: 0, max: 150_000 },
  { id: "150-300", label: "$150,000 – $300,000", min: 150_000, max: 300_000 },
  { id: "300-600", label: "$300,000 – $600,000", min: 300_000, max: 600_000 },
  { id: "600+", label: "$600,000 +", min: 600_000, max: Infinity },
] as const;

export const BEDROOM_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "1", label: "1 +" },
  { id: "2", label: "2 +" },
  { id: "3", label: "3 +" },
  { id: "4", label: "4 +" },
] as const;

export const PROPERTIES: Property[] = [
  p({
    slug: "modern-residence",
    name: "Modern Residence",
    index: "01",
    district: "arabkir",
    city: "Yerevan",
    intent: "buy",
    category: "apartments",
    typeLabel: "Apartment",
    price: 285_000,
    area: 145,
    bedrooms: 3,
    bathrooms: 2,
    floor: "6 of 9",
    year: 2019,
    map: { x: 46, y: 34 },
    summary: "A corner apartment that takes light from two directions all day.",
    description: [
      "A quiet corner floor on a tree-lined Arabkir street, reworked around a single continuous living space. Glazing runs the full width of the south elevation, so the room changes character four or five times between morning and evening.",
      "Oak floors, plaster walls, concealed storage. The kitchen is built in and disappears when it is not in use. Three bedrooms sit along the quiet side of the plan, away from the street.",
    ],
    features: ["Dual aspect", "Full-width glazing", "Oak flooring", "Built-in kitchen", "Underfloor heating", "Secure parking", "Lift access", "Storage room"],
  }),
  p({
    slug: "panorama-penthouse",
    name: "Panorama Penthouse",
    index: "02",
    district: "kentron",
    city: "Yerevan",
    intent: "buy",
    category: "apartments",
    typeLabel: "Penthouse",
    price: 720_000,
    area: 240,
    bedrooms: 4,
    bathrooms: 3,
    floor: "14 of 14",
    year: 2022,
    map: { x: 54, y: 56 },
    summary: "The top floor above Kentron, with a terrace facing Ararat.",
    description: [
      "The whole of the fourteenth floor, with a wrap terrace on the southern and western sides. On a clear morning the mountain sits directly in the frame of the living room.",
      "The plan is deliberately open at the centre and private at the edges: four bedrooms, each with its own bathroom, arranged behind a single circulation spine.",
    ],
    features: ["Wrap terrace", "Ararat view", "Private lift", "Climate control", "Two parking spaces", "Concierge", "Smart lighting", "Wine storage"],
    featured: true,
  }),
  p({
    slug: "cascade-house",
    name: "Cascade House",
    index: "03",
    district: "avan",
    city: "Yerevan",
    intent: "buy",
    category: "houses",
    typeLabel: "House",
    price: 540_000,
    area: 310,
    bedrooms: 5,
    bathrooms: 4,
    year: 2021,
    map: { x: 78, y: 26 },
    summary: "A stepped house on the slope, built around a courtyard.",
    description: [
      "Three levels that follow the fall of the site, so every room sits at a slightly different height and every room has a door to the outside.",
      "The courtyard is the centre of the house: sheltered from the road, open to the sky, usable from April to November.",
    ],
    features: ["Private courtyard", "Three levels", "Garage for two", "Garden", "Guest suite", "Fireplace", "Solar hot water", "Gated street"],
  }),
  p({
    slug: "atelier-loft",
    name: "Atelier Loft",
    index: "04",
    district: "kentron",
    city: "Yerevan",
    intent: "rent",
    category: "commercial",
    typeLabel: "Studio / Commercial",
    price: 2_400,
    period: "month",
    area: 120,
    bedrooms: 1,
    bathrooms: 1,
    floor: "Ground",
    year: 1962,
    map: { x: 48, y: 62 },
    summary: "A ground-floor studio with north light and a street entrance.",
    description: [
      "Originally a workshop, now a clean white volume with its own door onto the street and a ceiling high enough to hang anything from.",
      "Suited to a studio, showroom or practice. Services are already in place and the floor takes weight.",
    ],
    features: ["Street entrance", "4.2 m ceilings", "North light", "Three-phase power", "Shopfront glazing", "Mezzanine", "Bike storage", "Available now"],
  }),
  p({
    slug: "hillside-land",
    name: "Hillside Plot",
    index: "05",
    district: "ajapnyak",
    city: "Yerevan",
    intent: "land",
    category: "land",
    typeLabel: "Land",
    price: 165_000,
    area: 1_200,
    bedrooms: 0,
    bathrooms: 0,
    map: { x: 20, y: 52 },
    summary: "Twelve hundred square metres facing the gorge, with permissions in place.",
    description: [
      "A regular plot on the western edge with a long southern boundary, which is what you want if you intend to build for light.",
      "Utilities reach the boundary and residential permissions are current. The view back across the gorge toward the city is the reason to buy it.",
    ],
    features: ["Residential permission", "Utilities to boundary", "South-facing", "Road access", "Gorge view", "Regular shape", "Clear title", "1,200 m²"],
  }),
  p({
    slug: "north-avenue-flat",
    name: "North Avenue Flat",
    index: "06",
    district: "davtashen",
    city: "Yerevan",
    intent: "rent",
    category: "apartments",
    typeLabel: "Apartment",
    price: 1_150,
    period: "month",
    area: 96,
    bedrooms: 2,
    bathrooms: 1,
    floor: "4 of 12",
    year: 2018,
    map: { x: 24, y: 22 },
    summary: "A calm two-bedroom with a balcony and open sky on the north side.",
    description: [
      "Straightforward, well-kept and quiet. The balcony runs the length of the living room and looks out over low buildings rather than into another block.",
      "Furnished to a neutral standard, available on a twelve-month term.",
    ],
    features: ["Long balcony", "Furnished", "Open outlook", "Lift", "Parking", "Storage", "Twelve-month term", "Pets considered"],
  }),
];

/* --------------------------------- helpers -------------------------------- */

export const bySlug = (slug: string) => PROPERTIES.find((x) => x.slug === slug);

export const featuredProperty = () => PROPERTIES.find((x) => x.featured) ?? PROPERTIES[0];

export interface Filters {
  intent?: Intent | "all";
  district?: District | "any";
  type?: (typeof PROPERTY_TYPES)[number]["id"];
  price?: (typeof PRICE_BANDS)[number]["id"];
  bedrooms?: (typeof BEDROOM_OPTIONS)[number]["id"];
}

export function filterProperties(list: Property[], f: Filters): Property[] {
  const bandId = f.price ?? "any";
  const band = PRICE_BANDS.find((b) => b.id === bandId) ?? PRICE_BANDS[0];
  const minBeds = f.bedrooms && f.bedrooms !== "any" ? Number(f.bedrooms) : 0;

  return list.filter((x) => {
    if (f.intent && f.intent !== "all" && x.intent !== f.intent) return false;
    if (f.district && f.district !== "any" && x.district !== f.district) return false;
    if (f.type && f.type !== "any" && x.category !== f.type) return false;
    if (minBeds && x.bedrooms < minBeds) return false;

    // The price bands describe purchase prices. Rentals are quoted monthly, so
    // a band can only ever mislead about them: drop rentals from a banded
    // search unless the visitor is explicitly searching rentals.
    if (bandId !== "any") {
      if (x.period === "month") return f.intent === "rent";
      if (x.price < band.min || x.price > band.max) return false;
    }

    return true;
  });
}

export const formatPrice = (property: Pick<Property, "price" | "period">) => {
  const n = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(property.price);
  return property.period === "month" ? `${n} / month` : n;
};

/** Compact metadata line used across the site: "145 M² · 3 BED · 2 BATH". */
export const metaLine = (x: Property) =>
  [
    `${x.area.toLocaleString("en-US")} M²`,
    x.bedrooms ? `${x.bedrooms} ${x.bedrooms === 1 ? "BEDROOM" : "BEDROOMS"}` : null,
    x.bathrooms ? `${x.bathrooms} ${x.bathrooms === 1 ? "BATHROOM" : "BATHROOMS"}` : null,
  ].filter(Boolean) as string[];
