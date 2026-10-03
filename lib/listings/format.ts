import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import type { Dictionary } from "@/lib/i18n/types";
import { cityIdOf, districtIdOf, type DistrictId } from "./places";
import { isGeneratedTitle, type TitleFields } from "./titles";
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
                 feature codes, district ids)
     resolved    stored values that only restate structured data: a Yerevan
                 district or city name the gazetteer recognises
                 (lib/listings/places.ts), and a system-generated title
                 (lib/listings/titles.ts) — both shown in the visitor's language
     verbatim    every other free-text value the database stores — a custom
                 title, the description, an unknown place name, stored image alt
                 text. Joined and punctuated here, never translated or rewritten.
---------------------------------------------------------------------------- */

type PlaceFields = Pick<Listing, "city" | "districtLabel">;

/* Digits and currency are formatted HERE, not with Intl.NumberFormat. Prices
   and areas render on the server and again in the browser, and browsers do not
   all ship the same locale data: Chrome has none for Armenian, so `hy-AM`
   silently falls back to the browser's own language ("$147,000", or "AMD" for
   ֏), the text no longer matches the server's and React re-renders it. These
   tables reproduce the CLDR digits and symbol placement the server produced
   before; the only visible difference is that ֏ and ₽ are now always shown as
   symbols (Intl wrote "AMD"/"RUB" in some locales). Plural selection stays
   on Intl.PluralRules: the Armenian forms are identical, so a fallback there
   cannot change the text. */
const DIGITS: Record<Locale, { group: string; decimal: string; minGroupingDigits: number }> = {
  hy: { group: "\u00A0", decimal: ",", minGroupingDigits: 2 }, // "1234", "12 345"
  ru: { group: "\u00A0", decimal: ",", minGroupingDigits: 1 }, // "1 234"
  en: { group: ",", decimal: ".", minGroupingDigits: 1 }, // "1,234"
};

const CURRENCY_SYMBOLS: Record<Listing["currency"], string> = { USD: "$", AMD: "֏", EUR: "€", RUB: "₽" };

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
  /** Translated label for a frozen district id; blurb for a map district. */
  district(id: DistrictId): string;
  districtBlurb(id: MapDistrictId): string;
  /** A stored district name in the UI language when recognised, else as stored. */
  districtName(stored: string): string;
  /** A stored city name in the UI language when recognised, else as stored. */
  cityName(stored: string): string;
  /** "Ավան, Երևան" — district and city, or just the city. */
  place(listing: PlaceFields): string;
  /** "Avan · Yerevan" — district first, which is how buyers search. */
  districtFirstLine(listing: PlaceFields): string;
  /** "Yerevan · Avan", or just the city when the district is unknown. */
  locationLine(listing: PlaceFields): string;
  /** The listing title to display: a system-generated one in the UI language,
   *  any other one exactly as stored. `short` drops the place from a generated
   *  title, for tiles that show the place on their own line. */
  title(listing: TitleFields, options?: { short?: boolean }): string;
  /** Alt text for the n-th (1-based) photo of a listing without a stored one. */
  imageAlt(name: string, index: number): string;
}

export function createFormat(locale: Locale, dict: Dictionary): Format {
  const tag = INTL_LOCALE[locale];
  const plurals = new Intl.PluralRules(tag);
  const digits = DIGITS[locale];

  /** Rounded to `maxFraction` places, trailing zeros dropped, grouped per locale. */
  const formatNumber = (value: number, maxFraction: number) => {
    const scale = 10 ** maxFraction;
    const rounded = Math.round(Math.abs(value) * scale) / scale;
    const [int, frac = ""] = rounded.toFixed(maxFraction).split(".");
    const fraction = frac.replace(/0+$/, "");
    const grouped = int.length >= 4 + digits.minGroupingDigits - 1
      ? int.replace(/\B(?=(\d{3})+$)/g, digits.group)
      : int;
    return `${value < 0 && rounded !== 0 ? "-" : ""}${grouped}${fraction ? digits.decimal + fraction : ""}`;
  };

  /** "$147,000" in English, "147 000 $" in Armenian and Russian. */
  const money = (amount: number, currency: Listing["currency"]) => {
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    const value = formatNumber(amount, 0);
    return locale === "en" ? `${symbol}${value}` : `${value}\u00A0${symbol}`;
  };

  const pick = (count: number, forms: PluralForms) => {
    // Intl can also answer "zero", "two" and "other"; only Russian uses `few`,
    // and everything that is not exactly-one falls to the general plural.
    const category = plurals.select(count);
    if (category === "one") return forms.one;
    if (category === "few") return forms.few;
    return forms.many;
  };

  const number = (value: number) => formatNumber(value, 3);

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

  const districtName = (stored: string) => {
    const id = districtIdOf(stored);
    return id ? dict.districts[id] : stored;
  };

  const cityName = (stored: string) => {
    const id = cityIdOf(stored);
    return id ? dict.cities[id] : stored;
  };

  const place = (listing: PlaceFields) =>
    [listing.districtLabel ? districtName(listing.districtLabel) : null, cityName(listing.city)]
      .filter(Boolean)
      .join(", ");

  /* Upper-cases the first letter only ("3-room apartment…" → unchanged,
     "apartment for sale…" → "Apartment for sale…"). */
  const sentence = (text: string) => text.charAt(0).toLocaleUpperCase(tag) + text.slice(1);

  const title = (listing: TitleFields, options: { short?: boolean } = {}) => {
    if (!isGeneratedTitle(listing)) return listing.name;
    const t = dict.listingTitle;
    const type = listing.propertyType;
    const withRooms = type in t.rooms && listing.rooms !== null && listing.rooms > 0
      ? fill(t.rooms[type as keyof typeof t.rooms], { count: listing.rooms })
      : null;
    const subject = withRooms ?? t.subject[type];
    const core = fill(listing.transactionIntent === "rent" ? t.rent : t.sale, { subject });
    const where = options.short ? "" : place(listing);
    return sentence(where ? fill(t.withPlace, { title: core, place: where }) : core);
  };

  return {
    price(listing) {
      const amount = money(listing.price, listing.currency);
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

    districtName,
    cityName,
    place,
    districtFirstLine: (listing) =>
      listing.districtLabel
        ? `${districtName(listing.districtLabel)} · ${cityName(listing.city)}`
        : cityName(listing.city),
    locationLine: (listing) =>
      listing.districtLabel
        ? `${cityName(listing.city)} · ${districtName(listing.districtLabel)}`
        : cityName(listing.city),
    title,
    imageAlt: (name, index) => fill(dict.gallery.imageAlt, { name, index }),
  };
}

/* ---------------------------------------------------------------- locale-free */

/** Two-digit editorial position: 0 → "01". */
export const positionLabel = (index: number) => String(index + 1).padStart(2, "0");
