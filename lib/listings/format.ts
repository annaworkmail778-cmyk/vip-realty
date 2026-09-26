import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import type { Dictionary } from "@/lib/i18n/types";
import type { Listing, MapDistrictId } from "./types";

/* ----------------------------------------------------------------------------
   Display formatting for listings. Client-safe. Never renders unknown values.

   Everything locale-dependent lives behind ONE object, built once per render
   tree by `createFormat(locale, dict)` and reached through `useFormat()` on the
   client or `getDictionary()` on the server. Components therefore carry no
   locale conditionals of their own, and number/currency/plural rules are
   decided in a single place.

   What is formatted here and what is not:
     formatted   numbers, currency, areas, unit words, plural forms, floor
                 wording, and labels derived from FROZEN CODES (property_type,
                 feature codes, map district ids)
     verbatim    every free-text value the database stores — listing title,
                 description, district and city names, image alt text. Those are
                 joined and punctuated here but never translated or rewritten.
---------------------------------------------------------------------------- */

/** Plural word forms; selected with Intl.PluralRules for the active locale. */
export interface PluralForms {
  one: string;
  few: string;
  many: string;
}

/** The plural unit words — every `units` key except the bare area symbol. */
type UnitKind = Exclude<keyof Dictionary["units"], "area">;

export interface Format {
  /** "$300,000" / "300 000 $", plus the period suffix for a rental. */
  price(listing: Pick<Listing, "price" | "currency" | "period">): string;
  /** "145 m²" / "145 քմ" / "145 м²". */
  area(sqm: number): string;
  /** Translated property type for a frozen `property_type` code. */
  type(listing: Pick<Listing, "propertyType">): string;
  /** Sale / rent / land marker. */
  intent(listing: Pick<Listing, "intent">): string;
  /** Compact metadata parts: area, rooms, bedrooms, bathrooms, floor. */
  meta(listing: Listing): string[];
  /** The detail page's floor value: "5 of 9" → "5 / 9" / "5 из 9". */
  floor(value: string): string;
  /** A feature label, or null when it must not be rendered — see the
   *  implementation for the per-locale fallback rule. */
  feature(label: string): string | null;
  /** Just the unit word in the right plural form: "properties". */
  plural(count: number, kind: UnitKind): string;
  /** Count and unit together: "12 properties" / "12 գույք" / "12 объектов". */
  count(value: number, kind: UnitKind): string;
  /** A plain number in the locale's digit grouping. */
  number(value: number): string;
  /** Translated label / blurb for a frozen map district id. */
  district(id: MapDistrictId): string;
  districtBlurb(id: MapDistrictId): string;
}

export function createFormat(locale: Locale, dict: Dictionary): Format {
  const tag = INTL_LOCALE[locale];
  const numbers = new Intl.NumberFormat(tag);
  const plurals = new Intl.PluralRules(tag);
  const currencies = new Map<string, Intl.NumberFormat>();

  const money = (currency: string) => {
    let f = currencies.get(currency);
    if (!f) {
      f = new Intl.NumberFormat(tag, { style: "currency", currency, maximumFractionDigits: 0 });
      currencies.set(currency, f);
    }
    return f;
  };

  const pick = (count: number, forms: PluralForms) => {
    // Intl can also answer "zero", "two" and "other"; only Russian uses `few`,
    // and everything that is not exactly-one falls to the general plural.
    const category = plurals.select(count);
    if (category === "one") return forms.one;
    if (category === "few") return forms.few;
    return forms.many;
  };

  const number = (value: number) => numbers.format(value);

  const plural = (count: number, kind: UnitKind) => pick(count, dict.units[kind]);

  /* The mapper writes the floor as "5 of 9" or "5" (lib/listings/mappers.ts).
     Both shapes are parsed back into parts so the wording can be localised
     without the mapper — and therefore the data layer — changing. */
  const floorParts = (value: string): { floor: number; total: number | null } | null => {
    const pair = /^(\d+) of (\d+)$/.exec(value);
    if (pair) return { floor: Number(pair[1]), total: Number(pair[2]) };
    const single = /^(\d+)$/.exec(value);
    return single ? { floor: Number(single[1]), total: null } : null;
  };

  return {
    price(listing) {
      const amount = money(listing.currency).format(listing.price);
      return listing.period ? `${amount}${dict.period[listing.period]}` : amount;
    },

    area: (sqm) => `${number(sqm)} ${dict.units.area}`,

    type: (listing) => dict.propertyTypes[listing.propertyType],

    intent: (listing) =>
      listing.intent === "rent"
        ? dict.property.forRent
        : listing.intent === "land"
          ? dict.property.land
          : dict.property.forSale,

    /* Rooms and floor are included because extraction records them far more
       often than bedrooms for Armenian listings ("3 սենյականոց" yields rooms,
       not bedrooms), and a card with no metadata at all reads as broken. */
    meta(listing) {
      const size = listing.area ?? listing.landArea;
      const parts: (string | null)[] = [
        size !== null ? `${number(size)} ${dict.units.area}` : null,
        listing.rooms !== null ? `${listing.rooms} ${plural(listing.rooms, "rooms")}` : null,
        listing.bedrooms !== null ? `${listing.bedrooms} ${plural(listing.bedrooms, "bedrooms")}` : null,
        listing.bathrooms !== null ? `${listing.bathrooms} ${plural(listing.bathrooms, "bathrooms")}` : null,
        null,
      ];

      if (listing.floor !== null) {
        const parsed = floorParts(listing.floor);
        parts[4] = parsed
          ? fill(parsed.floor === 1 ? dict.floor.ordinalFirst : dict.floor.ordinal, { floor: parsed.floor })
          : listing.floor;
      }

      return parts.filter((part): part is string => part !== null);
    },

    floor(value) {
      const parsed = floorParts(value);
      if (!parsed) return value;
      return parsed.total === null
        ? String(parsed.floor)
        : fill(dict.floor.pair, { floor: parsed.floor, total: parsed.total });
    },

    /* `featureLabel()` in taxonomy.ts turns "air_conditioning" into
       "Air conditioning"; this reverses that to recover the frozen code, since
       the public Listing model carries the label rather than the code.

       Feature codes come from AI extraction and are open-ended, so the
       dictionary cannot be exhaustive. What happens to an unknown one depends
       on the UI language:

         en      the humanised label the mapper produced is already English, so
                 it is shown as-is.
         hy/ru   a Latin / snake_case code rendered as pseudo-English would be
                 exactly the accidental English leak the site must not have. It
                 is OMITTED rather than guessed at or machine-translated —
                 returning null, which the caller drops.
                 A value that is already human-readable non-Latin text is shown
                 unchanged, since it is content rather than a code.

       Nothing here touches extraction, the stored codes, or the database. */
    feature(label) {
      const code = label.toLowerCase().replace(/ /g, "_");
      const known = (dict.features as Record<string, string | undefined>)[code];
      if (known) return known;
      if (locale === "en") return label;
      return /[A-Za-z]/.test(label) ? null : label;
    },

    plural,
    count: (value, kind) => `${number(value)} ${plural(value, kind)}`,
    number,

    district: (id) => dict.districts[id],
    districtBlurb: (id) => dict.districtBlurbs[id],
  };
}

/* ---------------------------------------------------------------- locale-free */

/** "Arabkir · Yerevan" — district first, which is how buyers search. District and
 *  city are rendered exactly as the database stores them and are never translated. */
export const districtFirstLine = (listing: Pick<Listing, "city" | "districtLabel">) =>
  listing.districtLabel ? `${listing.districtLabel} · ${listing.city}` : listing.city;

/** "Yerevan · Arabkir", or just the city when the district is unknown. */
export const locationLine = (listing: Pick<Listing, "city" | "districtLabel">) =>
  listing.districtLabel ? `${listing.city} · ${listing.districtLabel}` : listing.city;

/** Two-digit editorial position: 0 → "01". */
export const positionLabel = (index: number) => String(index + 1).padStart(2, "0");
