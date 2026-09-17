import type { Listing } from "./types";

/* Display formatting for listings. Client-safe. Never renders unknown values. */

const PERIOD_SUFFIX = { month: " / month", day: " / day", year: " / year" } as const;

export const formatPrice = (listing: Pick<Listing, "price" | "currency" | "period">) => {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.currency,
    maximumFractionDigits: 0,
  }).format(listing.price);
  return listing.period ? `${amount}${PERIOD_SUFFIX[listing.period]}` : amount;
};

export const formatArea = (sqm: number) => `${sqm.toLocaleString("en-US")} m²`;

/** Compact metadata line: "145 M² · 3 BEDROOMS · 2 BATHROOMS". Unknown values are omitted. */
export const metaLine = (listing: Listing) => {
  const size = listing.area ?? listing.landArea;
  return [
    size !== null ? `${size.toLocaleString("en-US")} M²` : null,
    listing.bedrooms !== null ? `${listing.bedrooms} ${listing.bedrooms === 1 ? "BEDROOM" : "BEDROOMS"}` : null,
    listing.bathrooms !== null ? `${listing.bathrooms} ${listing.bathrooms === 1 ? "BATHROOM" : "BATHROOMS"}` : null,
  ].filter((part): part is string => part !== null);
};

/** "Yerevan · Arabkir", or just the city when the district is unknown. */
export const locationLine = (listing: Pick<Listing, "city" | "districtLabel">) =>
  listing.districtLabel ? `${listing.city} · ${listing.districtLabel}` : listing.city;

/** Two-digit editorial position: 0 → "01". */
export const positionLabel = (index: number) => String(index + 1).padStart(2, "0");
